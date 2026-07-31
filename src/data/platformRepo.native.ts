/**
 * Native repository factory — opens the device database, guards it against a
 * cross-user handover, and wires the mutation store + SQLite repository +
 * sync engine. Native-only; the explicit `.native` imports here are safe
 * because this file is never in the web bundle's graph.
 *
 * The reference mirror (projects/members/profiles/prefs) is populated by the
 * sync engine's Tier-1 pull, not by this factory: `engine.start()`'s initial
 * kick performs the first pull, and `useRefreshOnFocusAndSync` (Task 11)
 * refetches screens when `completedPulls` bumps. Hydration therefore no
 * longer awaits a network round-trip before returning the repo bundle.
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
 * `sessionUserId` is the signed-in user from `RepositoryProvider`'s
 * `useAuth()` — nullable because the provider mounts at the app root and runs
 * signed-out too. With null the engine still drains queued pushes; only the
 * pull phase stays unarmed. The provider re-keys the whole bundle on a userId
 * change, so signing in rebuilds and arms it.
 */
export async function createPlatformRepository(
  sessionUserId: string | null,
): Promise<PlatformRepoBundle> {
  const db = await openDb();
  // Guard against a different account inheriting the previous user's cache
  // before any read or write can touch it.
  await reconcileDbOwnership(db);
  const mutations = createMutationStore(db);
  const engine = createSyncEngine(db, sessionUserId);
  // The nudge kicks the engine after every enqueued write, so a new mutation
  // drains promptly instead of waiting for the next backoff/NetInfo/AppState
  // trigger. The engine is returned, NOT attached/started here — that happens
  // in RepositoryProvider under its `active` guard, so a stale (superseded)
  // build can't attach or start late.
  const repo = createSqliteRepo(db, mutations, () => void engine.run());
  return { repo, engine };
}
