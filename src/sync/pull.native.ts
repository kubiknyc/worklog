/**
 * The pull orchestrator — the one place the pull path's pieces are composed:
 * cursors (`cursors.ts`), pagination (`paginate.ts`), planning + manifests
 * (`pullCore.ts`), the appliers (`pullTables.native.ts`) and the deletion
 * surfaces (`pullSweep.native.ts`).
 *
 * Contract: NEVER throws. Every phase is independently try/caught and folded
 * into a `PullOutcome`; a client that throws on every call still resolves one.
 * The FIRST failure classified `isLikelyOffline` short-circuits the remaining
 * network phases — no radio-burn on a dead link.
 *
 * Ordering, in one place because the invariants are cross-cutting:
 *
 * 1. Drain any `pull_evict_pending` intent left by a crashed run (see
 *    `EVICT_PENDING_KEY`).
 * 2. Tier-1 fetch (`projects`/`profiles` by id; `project_members`/
 *    `report_member_prefs` by the `(project_id, user_id)` composite key, no
 *    floor — a full snapshot).
 * 3. Tier-1 empty-snapshot floors, then the full replace, then membership
 *    eviction behind floor (b).
 * 4. `planPullRun` over the POST-replace member set.
 * 5. Tier-2 feeds, active project first then the rotation pick.
 * 6. Per-project id sweeps behind floor (c).
 * 7. Rotation write-back.
 */
import { all, first, run } from '../db/rows.native';
import type { Db } from '../db/rows.native';
import { createCursorStore } from './store.native';
import { SCOPES, overlapFloor, nextCursor } from './cursors';
import {
  selectAllById,
  selectAllKeyset,
  selectAllKeyset3,
  PAGE_SIZE,
  type IdPageQuery,
  type KeysetPageQuery,
} from './paginate';
import {
  chunk,
  diffMembership,
  planPullRun,
  IN_CHUNK_SIZE,
  AMENDMENT_CHANGES_PULL_COLUMNS,
  AMENDMENT_PULL_COLUMNS,
  MEMBER_PULL_COLUMNS,
  PHOTO_PULL_COLUMNS,
  PREFS_PULL_COLUMNS,
  PROFILE_PULL_COLUMNS,
  PROJECT_PULL_COLUMNS,
  REPORT_PULL_COLUMNS,
  SECTION_PULL_COLUMNS,
  WEATHER_PULL_COLUMNS,
  type PullOutcome,
  type RotationState,
} from './pullCore';
import {
  applyAmendments,
  applyPhotos,
  applyReferenceSnapshot,
  applyReports,
  applySections,
  type ApplyResult,
  type PulledAmendment,
  type PulledReportBundle,
  type PulledSection,
} from './pullTables.native';
import { evictProjects, sweepProject } from './pullSweep.native';
import { reportSyncIncident } from '../lib/observability.native';
import { errorMessage, isLikelyOffline } from '../lib/errors';

// ---------------------------------------------------------------------------
// Client seam
// ---------------------------------------------------------------------------

/**
 * The PostgREST builder surface this module uses — structurally satisfied by
 * supabase-js. `IdPageQuery` contributes `gt` (the id-keyset scans) and
 * `KeysetPageQuery` the compound/triple scans; `select`/`eq`/`in` are ours.
 * The ONE documented `supabase → PullClient` cast lives in `engine.native.ts`.
 */
export interface PullQueryBuilder<T> extends KeysetPageQuery<T>, IdPageQuery<T> {
  select(columns: string): this;
  eq(column: string, value: string): this;
  in(column: string, values: readonly string[]): this;
}

export interface PullClient {
  from<T = Record<string, unknown>>(table: string): PullQueryBuilder<T>;
}

export type Puller = (input: { readonly sessionUserId: string }) => Promise<PullOutcome>;

// ---------------------------------------------------------------------------
// sync_meta keys
// ---------------------------------------------------------------------------

const ACTIVE_PROJECT_KEY = 'active_project_id';
const ROTATION_KEY = 'pull_rotation_v1';
/**
 * Eviction INTENT, persisted before `evictProjects` runs and deleted after it
 * returns. The Tier-1 replace commits BEFORE the eviction, so the membership
 * diff that produced the evicted set is gone by the next run — a crash
 * mid-eviction would otherwise strand a half-evicted project subtree forever
 * (`pullSweep.native.ts` documents this as the caller's obligation). Draining
 * this key at the start of every run makes the eviction resumable.
 */
const EVICT_PENDING_KEY = 'pull_evict_pending';
const SWEEP_DUE_PREFIX = 'pull_sweep_due:';
const SWEEP_LAST_PREFIX = 'pull_sweep_last:';

type Raw = Record<string, unknown>;
type RawWithId = Raw & { id: string };

interface MetaState {
  readonly activeProjectId: string | null;
  readonly rotation: RotationState;
  /** Parsed intent; empty when absent OR unparseable (see `evictPendingCorrupt`). */
  readonly evictPending: readonly string[];
  readonly evictPendingCorrupt: boolean;
  readonly sweepDueProjectIds: readonly string[];
  readonly sweepLastByProject: Readonly<Record<string, string | null>>;
}

function parseRotation(value: string | undefined): RotationState {
  if (value === undefined) return { lastProjectId: null, lastAt: null };
  try {
    const parsed = JSON.parse(value) as Partial<RotationState> | null;
    if (parsed === null || typeof parsed !== 'object') throw new Error('not an object');
    return {
      lastProjectId: typeof parsed.lastProjectId === 'string' ? parsed.lastProjectId : null,
      lastAt: typeof parsed.lastAt === 'string' ? parsed.lastAt : null,
    };
  } catch {
    return { lastProjectId: null, lastAt: null };
  }
}

async function readMeta(db: Db): Promise<MetaState> {
  const rows = await all<{ key: string; value: string }>(db, `SELECT key, value FROM sync_meta`);
  const byKey = new Map(rows.map((r) => [r.key, r.value]));

  const pendingRaw = byKey.get(EVICT_PENDING_KEY);
  let evictPending: readonly string[] = [];
  let evictPendingCorrupt = false;
  if (pendingRaw !== undefined) {
    try {
      const parsed: unknown = JSON.parse(pendingRaw);
      if (!Array.isArray(parsed) || parsed.some((v) => typeof v !== 'string')) {
        throw new Error('not a string array');
      }
      evictPending = parsed as string[];
    } catch {
      evictPendingCorrupt = true;
    }
  }

  const sweepDueProjectIds: string[] = [];
  const sweepLastByProject: Record<string, string | null> = {};
  for (const { key, value } of rows) {
    if (key.startsWith(SWEEP_DUE_PREFIX))
      sweepDueProjectIds.push(key.slice(SWEEP_DUE_PREFIX.length));
    if (key.startsWith(SWEEP_LAST_PREFIX))
      sweepLastByProject[key.slice(SWEEP_LAST_PREFIX.length)] = value;
  }

  return {
    activeProjectId: byKey.get(ACTIVE_PROJECT_KEY) ?? null,
    rotation: parseRotation(byKey.get(ROTATION_KEY)),
    evictPending,
    evictPendingCorrupt,
    sweepDueProjectIds,
    sweepLastByProject,
  };
}

function setMeta(db: Db, key: string, value: string): Promise<unknown> {
  return run(
    db,
    `INSERT INTO sync_meta (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}

function deleteMeta(db: Db, key: string): Promise<unknown> {
  return run(db, `DELETE FROM sync_meta WHERE key = ?`, [key]);
}

async function countRows(db: Db, sql: string, params: string[] = []): Promise<number> {
  const row = await first<{ n: number }>(db, sql, params);
  return row?.n ?? 0;
}

// ---------------------------------------------------------------------------
// Row helpers
// ---------------------------------------------------------------------------

/**
 * Drop the embedded `daily_reports` key PostgREST adds for the `!inner` join
 * filter — the appliers project onto `DOMAIN_COLUMNS`, and an unknown nested
 * object has no business reaching them.
 */
function stripEmbed(row: Raw): Raw {
  const out: Raw = {};
  for (const [k, v] of Object.entries(row)) {
    if (k !== 'daily_reports') out[k] = v;
  }
  return out;
}

function stringIds(rows: readonly Raw[]): readonly string[] {
  return rows.map((r) => r.id).filter((id): id is string => typeof id === 'string');
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export function createPuller(client: PullClient, db: Db): Puller {
  const cursors = createCursorStore(db);

  return async function pull({ sessionUserId }): Promise<PullOutcome> {
    let ok = true;
    let committed = false;
    let offline = false;
    let error: string | null = null;

    /** Record a thrown failure; the first offline-classified one arms the short-circuit. */
    function failWith(label: string, err: unknown): void {
      ok = false;
      if (isLikelyOffline(err)) {
        offline = true;
        return;
      }
      if (error === null) error = `${label}: ${errorMessage(err)}`;
    }

    /** Record a refusal that is not an exception (a floor, a skipped/held-back feed). */
    function refuse(message: string): void {
      ok = false;
      if (error === null) error = message;
    }

    const onEvicted = (): void => {
      reportSyncIncident('evicted', { kind: 'membership_sweep', attempts: 0 });
    };

    /**
     * Apply the cursor rule to one feed's result: advance ONLY on a fully
     * clean apply, and only when the fold is non-null (`CursorStore.set` is
     * non-null; `nextCursor(c, [])` returns `c`, null on a first pull with
     * nothing creditable).
     */
    async function settleFeed(
      scope: string,
      cursor: string | null,
      applied: ApplyResult,
    ): Promise<void> {
      if (applied.applied > 0) committed = true;
      if (applied.hardSkipped > 0 || applied.heldBack > 0) {
        refuse(
          `${scope}: ${applied.hardSkipped} hard-skipped, ${applied.heldBack} held back — cursor frozen`,
        );
        return;
      }
      const next = nextCursor(cursor, applied.cursorKeys);
      if (next !== null) await cursors.set(scope, next);
    }

    try {
      const meta = await readMeta(db);

      // --- 1. Drain a crashed run's eviction intent ------------------------
      // Ids still persisted in EVICT_PENDING_KEY after this step. A FAILED
      // drain leaves them there: those projects already left `project_members`
      // in an earlier run, so no future membership diff will ever rediscover
      // them — the key is their only record, and step 3 must MERGE into it
      // rather than overwrite it.
      let stillPending: readonly string[] = [];
      if (meta.evictPendingCorrupt) {
        await deleteMeta(db, EVICT_PENDING_KEY);
      } else if (meta.evictPending.length > 0) {
        try {
          await evictProjects(db, meta.evictPending, onEvicted);
          await deleteMeta(db, EVICT_PENDING_KEY);
          committed = true;
        } catch (err) {
          stillPending = meta.evictPending;
          failWith('evict drain', err);
        }
      }

      // --- 2. Tier-1 fetch -------------------------------------------------
      let projects: RawWithId[];
      let profiles: RawWithId[];
      let members: Raw[];
      let prefs: Raw[];
      try {
        projects = await selectAllById<RawWithId>(() =>
          client.from<RawWithId>('projects').select(PROJECT_PULL_COLUMNS),
        );
        profiles = await selectAllById<RawWithId>(() =>
          client.from<RawWithId>('profiles').select(PROFILE_PULL_COLUMNS),
        );
        const composite = { primary: 'project_id', tiebreak: 'user_id' } as const;
        const compositeKey = (row: Raw) => ({
          primary: String(row.project_id),
          tiebreak: String(row.user_id),
        });
        // NO floor: composite-PK tables have no `updated_at` to keyset on —
        // doc 06 §B "snapshot by composite key" means a FULL snapshot.
        members = await selectAllKeyset<Raw>(
          () => client.from<Raw>('project_members').select(MEMBER_PULL_COLUMNS),
          composite,
          compositeKey,
        );
        prefs = await selectAllKeyset<Raw>(
          () => client.from<Raw>('report_member_prefs').select(PREFS_PULL_COLUMNS),
          composite,
          compositeKey,
        );
      } catch (err) {
        failWith('tier1 fetch', err);
        return { ok, committed, offline, error };
      }

      // --- 3. Tier-1 floors, replace, eviction -----------------------------
      // Floor (a): an empty snapshot against a non-empty local table is a
      // grant/RLS regression, not a deletion — refuse the whole replace.
      const floorTables: readonly (readonly [string, readonly unknown[]])[] = [
        ['projects', projects],
        ['project_members', members],
        ['profiles', profiles],
      ];
      for (const [table, fetched] of floorTables) {
        if (fetched.length > 0) continue;
        if ((await countRows(db, `SELECT COUNT(*) AS n FROM ${table}`)) === 0) continue;
        refuse(`tier1 ${table} empty — refusing replace`);
        return { ok, committed, offline, error };
      }

      let membership;
      try {
        membership = await applyReferenceSnapshot(db, sessionUserId, {
          projects,
          members,
          prefs,
          profiles,
        });
      } catch (err) {
        failWith('tier1 replace', err);
        return { ok, committed, offline, error };
      }
      if (membership.changed) committed = true;

      const evicted = diffMembership(membership.beforeProjectIds, membership.afterProjectIds);
      // Floor (b): a wholesale membership wipe is refused unless the device
      // genuinely had no membership before. Refused LOUDLY, like floors (a)
      // and (c): the floor's own premise is a SUSPECTED server-side membership
      // regression, and the Tier-1 replace has already committed, so a silent
      // `ok: true` would report a clean run over exactly the state that
      // warrants attention. Tier 2 still proceeds — the members snapshot
      // itself passed floor (a).
      const floorBPasses =
        membership.afterProjectIds.length > 0 || membership.beforeProjectIds.length === 0;
      if (evicted.length > 0 && !floorBPasses) {
        refuse('tier1 membership: refusing eviction — all memberships vanished');
      } else if (evicted.length > 0) {
        // MERGE, never overwrite: an un-drained set from a failed step-1 drain
        // would otherwise be clobbered and its half-evicted subtrees stranded
        // permanently. The key is deleted only after ONE `evictProjects` call
        // has covered everything the key holds.
        const toEvict = [...new Set([...stillPending, ...evicted])];
        try {
          await setMeta(db, EVICT_PENDING_KEY, JSON.stringify(toEvict));
          await evictProjects(db, toEvict, onEvicted);
          await deleteMeta(db, EVICT_PENDING_KEY);
          committed = true;
        } catch (err) {
          failWith('eviction', err);
        }
      }

      // --- 4. Plan ---------------------------------------------------------
      const nowIso = new Date().toISOString();
      const plan = planPullRun({
        activeProjectId: meta.activeProjectId,
        memberProjectIds: membership.afterProjectIds,
        rotation: meta.rotation,
        sweepDueProjectIds: meta.sweepDueProjectIds,
        sweepLastByProject: meta.sweepLastByProject,
        nowIso,
      });

      // --- 5. Tier-2 feeds -------------------------------------------------
      const memberSet = new Set(membership.afterProjectIds);
      const targets: string[] = [];
      if (plan.activeProjectId !== null && memberSet.has(plan.activeProjectId)) {
        targets.push(plan.activeProjectId);
      }
      if (plan.rotationPick !== null && !targets.includes(plan.rotationPick)) {
        targets.push(plan.rotationPick);
      }

      for (const projectId of targets) {
        if (offline) break;
        await pullReports(projectId);
        if (offline) break;
        await pullSections(projectId);
        if (offline) break;
        await pullPhotos(projectId);
        if (offline) break;
        await pullAmendments(projectId);
      }

      // --- 6. Sweeps -------------------------------------------------------
      for (const projectId of plan.sweepProjects) {
        if (offline) break;
        await runSweep(projectId, nowIso);
      }

      // --- 7. Rotation write-back ------------------------------------------
      try {
        await setMeta(db, ROTATION_KEY, JSON.stringify(plan.nextRotationState));
      } catch (err) {
        failWith('rotation write-back', err);
      }
    } catch (err) {
      // Belt and braces: the never-throws contract holds even for a failure in
      // the orchestration scaffolding itself (meta read, planning).
      failWith('pull', err);
    }

    return { ok, committed, offline, error };

    // -- feeds ------------------------------------------------------------

    async function pullReports(projectId: string): Promise<void> {
      const scope = SCOPES.reports(projectId);
      try {
        const cursor = await cursors.get(scope);
        const rows = await selectAllKeyset<Raw>(
          () =>
            client
              .from<Raw>('daily_reports')
              .select(REPORT_PULL_COLUMNS)
              .eq('project_id', projectId),
          { primary: 'updated_at', tiebreak: 'id' },
          (r) => ({ primary: String(r.updated_at), tiebreak: String(r.id) }),
          overlapFloor(cursor),
        );

        // Weather ride-along: upsert-only downstream, so a truncated read can
        // only DELAY a weather row, never delete one — a plain chunked `.in()`
        // is sound here (unlike the amendment-changes full replace).
        const weatherByReport = new Map<string, Raw>();
        for (const ids of chunk(stringIds(rows), IN_CHUNK_SIZE)) {
          const { data, error: pageError } = await client
            .from<Raw>('report_weather')
            .select(WEATHER_PULL_COLUMNS)
            .in('report_id', ids)
            .limit(PAGE_SIZE);
          if (pageError) throw pageError;
          for (const w of data ?? []) weatherByReport.set(String(w.report_id), w);
        }

        const bundles: PulledReportBundle[] = rows.map((report) => ({
          report,
          weather: weatherByReport.get(String(report.id)) ?? null,
        }));
        await settleFeed(scope, cursor, await applyReports(db, bundles));
      } catch (err) {
        failWith(scope, err);
      }
    }

    async function pullSections(projectId: string): Promise<void> {
      const scope = SCOPES.sections(projectId);
      try {
        const cursor = await cursors.get(scope);
        const rows = await selectAllKeyset3<Raw>(
          () =>
            client
              .from<Raw>('report_sections')
              .select(`${SECTION_PULL_COLUMNS}, daily_reports!inner(project_id)`)
              .eq('daily_reports.project_id', projectId),
          { primary: 'updated_at', second: 'report_id', third: 'section' },
          (r) => ({
            primary: String(r.updated_at),
            second: String(r.report_id),
            third: String(r.section),
          }),
          overlapFloor(cursor),
        );
        const stripped = rows.map(stripEmbed) as unknown as PulledSection[];
        await settleFeed(scope, cursor, await applySections(db, stripped));
      } catch (err) {
        failWith(scope, err);
      }
    }

    async function pullPhotos(projectId: string): Promise<void> {
      const scope = SCOPES.photos(projectId);
      try {
        const cursor = await cursors.get(scope);
        const rows = await selectAllKeyset<Raw>(
          () =>
            client
              .from<Raw>('report_photos')
              .select(PHOTO_PULL_COLUMNS)
              .eq('project_id', projectId),
          { primary: 'updated_at', tiebreak: 'id' },
          (r) => ({ primary: String(r.updated_at), tiebreak: String(r.id) }),
          overlapFloor(cursor),
        );
        await settleFeed(scope, cursor, await applyPhotos(db, rows));
      } catch (err) {
        failWith(scope, err);
      }
    }

    async function pullAmendments(projectId: string): Promise<void> {
      const scope = SCOPES.amendments(projectId);
      try {
        const cursor = await cursors.get(scope);
        const rows = await selectAllKeyset<Raw>(
          () =>
            client
              .from<Raw>('report_amendments')
              .select(`${AMENDMENT_PULL_COLUMNS}, daily_reports!inner(project_id)`)
              .eq('daily_reports.project_id', projectId),
          { primary: 'created_at', tiebreak: 'id' },
          (r) => ({ primary: String(r.created_at), tiebreak: String(r.id) }),
          overlapFloor(cursor),
        );
        const amendments = rows.map(stripEmbed);

        // The changes ride-along feeds a FULL REPLACE — a deletion path — so
        // each chunk is read through `selectAllById` (paginated,
        // throw-on-page-error). A bare `.in()` could be silently truncated by
        // a server `db-max-rows` cap, and the append-only `created_at` cursor
        // would never re-deliver the wiped rows.
        const changesByAmendment = new Map<string, Raw[]>();
        for (const ids of chunk(stringIds(amendments), IN_CHUNK_SIZE)) {
          const changes = await selectAllById<RawWithId>(() =>
            client
              .from<RawWithId>('report_amendment_changes')
              .select(AMENDMENT_CHANGES_PULL_COLUMNS)
              .in('amendment_id', ids),
          );
          for (const change of changes) {
            const key = String(change.amendment_id);
            const bucket = changesByAmendment.get(key);
            if (bucket) bucket.push(change);
            else changesByAmendment.set(key, [change]);
          }
        }

        const bundles: PulledAmendment[] = amendments.map((amendment) => ({
          amendment,
          changes: changesByAmendment.get(String(amendment.id)) ?? [],
        }));
        await settleFeed(scope, cursor, await applyAmendments(db, bundles));
      } catch (err) {
        failWith(scope, err);
      }
    }

    // -- sweeps -------------------------------------------------------------

    async function runSweep(projectId: string, stampIso: string): Promise<void> {
      try {
        const serverReports = await selectAllById<RawWithId>(() =>
          client.from<RawWithId>('daily_reports').select('id').eq('project_id', projectId),
        );
        const serverPhotos = await selectAllById<RawWithId>(() =>
          client.from<RawWithId>('report_photos').select('id').eq('project_id', projectId),
        );

        // Floor (c): an empty server id set is only deletion authority when
        // there is nothing CLEAN locally that it would delete. A dirty row is
        // structurally invisible to the sweep, so it must not hold the floor.
        const cleanReports = await countRows(
          db,
          `SELECT COUNT(*) AS n FROM daily_reports WHERE project_id = ? AND _dirty = 0`,
          [projectId],
        );
        const cleanPhotos = await countRows(
          db,
          `SELECT COUNT(*) AS n FROM report_photos WHERE project_id = ? AND _dirty = 0 AND _pending = 0`,
          [projectId],
        );
        if (serverReports.length === 0 && cleanReports > 0) {
          refuse(`sweep ${projectId}: server reports empty — refusing sweep`);
          return;
        }
        if (serverPhotos.length === 0 && cleanPhotos > 0) {
          refuse(`sweep ${projectId}: server photos empty — refusing sweep`);
          return;
        }

        const deleted = await sweepProject(
          db,
          projectId,
          stringIds(serverReports),
          stringIds(serverPhotos),
        );
        if (deleted > 0) committed = true;
        await setMeta(db, `${SWEEP_LAST_PREFIX}${projectId}`, stampIso);
        await deleteMeta(db, `${SWEEP_DUE_PREFIX}${projectId}`);
      } catch (err) {
        failWith(`sweep ${projectId}`, err);
      }
    }
  };
}
