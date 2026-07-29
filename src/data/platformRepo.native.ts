/**
 * Native repository factory — opens the device database, guards it against a
 * cross-user handover, wires the mutation store + SQLite repository + sync
 * engine, and seeds a best-effort reference mirror so the offline reads have
 * projects/members to show on first run. Native-only; the explicit `.native`
 * imports here are safe because this file is never in the web bundle's graph.
 *
 * `seedReferenceMirror` is a temporary bridge: M3's Tier-1 reference pull
 * (cursored, incremental, run by the engine) replaces it wholesale.
 */
import { openDb } from '../db/open.native';
import { first, run, tx, type Db } from '../db/rows.native';
import { createSyncEngine } from '../sync/engine.native';
import { createMutationStore } from '../sync/store.native';
import { supabase } from '../supabase/client';
import { createSqliteRepo } from './sqliteRepo.native';
import type { PlatformRepoBundle } from './types';

/** sync_meta key recording which user's data the local cache holds (bare uuid). */
export const OWNER_META_KEY = 'owner_user_id';

/**
 * Every local table holding cached or queued user data. Wiped when the device
 * changes hands (a different account signs in), so the next user can't read the
 * previous user's rows out of the shared SQLite file — rows RLS would never have
 * shown them. Must stay in step with `db/schema.ts`; `sync_meta` is cleared too
 * (device-scoped keys must not leak) and the new owner is re-stamped afterwards.
 * The photo outbox dir (queued capture files outside SQLite) joins this wipe
 * when photo capture lands in M5.
 */
const LOCAL_DATA_TABLES: readonly string[] = [
  'profiles',
  'projects',
  'project_members',
  'report_member_prefs',
  'daily_reports',
  'report_sections',
  'report_crew',
  'report_equipment',
  'report_work_performed',
  'report_delays',
  'report_safety_observations',
  'report_weather',
  'report_photos',
  'report_amendments',
  'report_amendment_changes',
  'sync_mutations',
  'sync_cursors',
  'sync_meta',
];

/**
 * Wipe only when we KNOW the cache belongs to someone else: a signed-in user, a
 * recorded owner, and the two differ. First launch (no owner yet), same-user
 * re-login, and offline cold start (no session readable) all keep the cache.
 */
export function shouldWipeLocalData(
  ownerUserId: string | null,
  sessionUserId: string | null,
): boolean {
  return sessionUserId !== null && ownerUserId !== null && ownerUserId !== sessionUserId;
}

/**
 * Cross-user cache guard, run once per hydration before any local write path is
 * reachable — mandatory now that WorkLog writes local rows + queues mutations.
 *
 * - Different signed-in user than the recorded owner → delete every data table
 *   in one transaction (their first pull repopulates from the server).
 * - Any signed-in user → stamp `owner_user_id` = their id.
 * - No session (offline cold start, or getSession failing) → change nothing:
 *   the cached owner is exactly who the offline UI is serving.
 */
export async function reconcileDbOwnership(db: Db): Promise<void> {
  let sessionUserId: string | null;
  try {
    const { data } = await supabase.auth.getSession();
    sessionUserId = data.session?.user.id ?? null;
  } catch {
    sessionUserId = null; // auth storage unreadable — treat as "no session"
  }
  if (sessionUserId === null) return;

  const ownerRow = await first<{ value: string }>(db, `SELECT value FROM sync_meta WHERE key = ?`, [
    OWNER_META_KEY,
  ]);
  if (shouldWipeLocalData(ownerRow?.value ?? null, sessionUserId)) {
    await tx(db, async () => {
      for (const table of LOCAL_DATA_TABLES) {
        await run(db, `DELETE FROM ${table}`);
      }
    });
  }
  await run(
    db,
    `INSERT INTO sync_meta (key, value) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    [OWNER_META_KEY, sessionUserId],
  );
}

/**
 * Best-effort online snapshot of the reference tables the offline reads need
 * (projects, members, profiles, prefs). Every step swallows its own failure —
 * being offline is the normal case, and a partial seed is still useful. No
 * cursors are written; M3's cursored Tier-1 pull supersedes this entirely.
 */
export async function seedReferenceMirror(db: Db): Promise<void> {
  try {
    const projects = await supabase
      .from('projects')
      .select('id, name, address, timezone, lat, lng');
    if (!projects.error && projects.data) {
      for (const p of projects.data) {
        await run(
          db,
          `INSERT OR REPLACE INTO projects (id, name, address, timezone, lat, lng) VALUES (?, ?, ?, ?, ?, ?)`,
          [p.id, p.name, p.address, p.timezone, p.lat, p.lng],
        );
      }
    }

    const profiles = await supabase
      .from('profiles')
      .select('id, full_name, email, phone, company, trade, avatar_url');
    if (!profiles.error && profiles.data) {
      for (const pr of profiles.data) {
        await run(
          db,
          `INSERT OR REPLACE INTO profiles (id, full_name, email, phone, company, trade, avatar_url)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [pr.id, pr.full_name, pr.email, pr.phone, pr.company, pr.trade, pr.avatar_url],
        );
      }
    }

    const members = await supabase
      .from('project_members')
      .select('project_id, user_id, role, created_at');
    if (!members.error && members.data) {
      for (const m of members.data) {
        await run(
          db,
          `INSERT OR REPLACE INTO project_members (project_id, user_id, role, created_at) VALUES (?, ?, ?, ?)`,
          [m.project_id, m.user_id, m.role, m.created_at],
        );
      }
    }

    const prefs = await supabase.from('report_member_prefs').select('project_id, user_id, title');
    if (!prefs.error && prefs.data) {
      for (const pf of prefs.data) {
        await run(
          db,
          `INSERT OR REPLACE INTO report_member_prefs (project_id, user_id, title) VALUES (?, ?, ?)`,
          [pf.project_id, pf.user_id, pf.title],
        );
      }
    }
  } catch {
    // Offline / RLS / transient — a missing or partial mirror is acceptable;
    // M3's reference pull will fill it in. Never let seeding fail hydration.
  }
}

export async function createPlatformRepository(): Promise<PlatformRepoBundle> {
  const db = await openDb();
  // Guard against a different account inheriting the previous user's cache
  // before any read or write can touch it.
  await reconcileDbOwnership(db);
  const mutations = createMutationStore(db);
  // Best-effort refresh of the reference mirror (swallowed on failure).
  await seedReferenceMirror(db);
  const engine = createSyncEngine(db);
  // The nudge kicks the engine after every enqueued write, so a new mutation
  // drains promptly instead of waiting for the next backoff/NetInfo/AppState
  // trigger. The engine is returned, NOT attached/started here — that happens
  // in RepositoryProvider under its `active` guard, so a stale (superseded)
  // build can't attach or start late.
  const repo = createSqliteRepo(db, mutations, () => void engine.run());
  return { repo, engine };
}
