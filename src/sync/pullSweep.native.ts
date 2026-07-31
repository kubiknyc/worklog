/**
 * Reconcile sweeps — the pull path's deletion surface (doc 06 §B). Two
 * mechanisms, both mechanical executors: the orchestrator (Task 9) has
 * already applied the throw-on-partial gate and both floors before calling
 * either one.
 *
 * `evictProjects` handles MEMBERSHIP loss: the user is no longer on the
 * project at all, so its entire local subtree — reports, every child row,
 * queued mutations (including a parked `create_report`), cursors, and sweep
 * meta — is dropped.
 *
 * `sweepProject` handles per-project ID reconciliation: a report or photo
 * that's clean locally (`_dirty = 0`, and for photos also `_pending = 0`)
 * but absent from the server's complete id list is gone server-side, so it's
 * dropped locally too. A dirty row is structurally invisible to this sweep —
 * only `evictProjects` can remove it, and only via membership loss.
 *
 * Transaction posture (both functions): NO outer transaction. `deleteLocalReport`
 * (store.native.ts) opens its own tx per call; wrapping this loop around it
 * would nest transactions and deadlock the serialized tx queue
 * (db/rows.native.ts). Every other step here is a plain `run`/`all` statement.
 * This makes both functions idempotent: re-running against rows already gone
 * is a no-op by construction (nothing matches the WHERE clause). It does NOT
 * make them self-resuming on its own — a crash mid-eviction does not "finish
 * on the next call" via a fresh membership diff, because the Tier-1 replace
 * that produced that diff already committed, so the next run's diff is empty
 * and `evictProjects` is never re-called for that project. RESUMPTION is the
 * caller's obligation: the orchestrator (Task 9) persists the evicted-project
 * id set to `sync_meta` BEFORE calling `evictProjects` and drains it at the
 * start of every pull, so a crash mid-eviction is finished on the next run.
 */
import { all, run } from '../db/rows.native';
import type { Db } from '../db/rows.native';
import { deleteLocalReport } from './store.native';
import { SCOPES } from './cursors';
import type { MutationPayload } from './types';

/** Fired once per evicted PROJECT (not per report) — Task 9 maps this to `reportSyncIncident`. */
export type SweepIncident = (projectId: string) => void;

interface QueuedMutationRow {
  readonly client_id: string;
  readonly payload: string;
}

/**
 * Delete every queued mutation (of ANY kind, including a parked
 * `create_report`) whose payload embeds `reportId` — the reparent.native.ts
 * precedent EXACTLY: read every row, `JSON.parse` its payload in JS, match on
 * `data.reportId`, then per-`client_id` DELETE. NOT SQL JSON functions over
 * the payload column. `create_report` is included on purpose here (unlike
 * reparent's re-home, which preserves it): membership is gone, so the create
 * would 403-evict on push anyway — dropping it now just skips that round trip.
 *
 * An UNPARSEABLE payload is DELETED rather than rethrown. A throw here would
 * fail `evictProjects`, and the orchestrator retries the persisted
 * `pull_evict_pending` intent at the start of EVERY run — so one corrupt row
 * would make eviction, and with it every future pull's `ok`, fail forever.
 * Deleting it follows the same reasoning as the parked-create decision above:
 * membership is gone and the row could only 403-evict on push anyway.
 */
async function evictQueueForReport(db: Db, reportId: string): Promise<void> {
  const rows = await all<QueuedMutationRow>(db, `SELECT * FROM sync_mutations`);
  for (const row of rows) {
    let matches: boolean;
    try {
      const payload = JSON.parse(row.payload) as MutationPayload;
      const data = payload.data as unknown as Readonly<Record<string, unknown>>;
      matches = data.reportId === reportId;
    } catch {
      matches = true; // corrupt payload — unpushable, drop it
    }
    if (!matches) continue;
    await run(db, `DELETE FROM sync_mutations WHERE client_id = ?`, [row.client_id]);
  }
}

/**
 * Evict every project in `projectIds` — the user has lost membership on each.
 * Per project: delete every local report's subtree (queued mutations then
 * `deleteLocalReport`), fire `onEvicted` ONCE for the project (after its
 * subtree is fully gone), then drop its four cursor scopes and its two
 * `pull_sweep_*` meta keys. Projects not in `projectIds` are untouched.
 */
export async function evictProjects(
  db: Db,
  projectIds: readonly string[],
  onEvicted: SweepIncident,
): Promise<void> {
  for (const projectId of projectIds) {
    const reports = await all<{ id: string }>(
      db,
      `SELECT id FROM daily_reports WHERE project_id = ?`,
      [projectId],
    );
    for (const { id: reportId } of reports) {
      await evictQueueForReport(db, reportId);
      await deleteLocalReport(db, reportId);
    }

    onEvicted(projectId);

    await run(db, `DELETE FROM sync_cursors WHERE scope = ?`, [SCOPES.reports(projectId)]);
    await run(db, `DELETE FROM sync_cursors WHERE scope = ?`, [SCOPES.sections(projectId)]);
    await run(db, `DELETE FROM sync_cursors WHERE scope = ?`, [SCOPES.photos(projectId)]);
    await run(db, `DELETE FROM sync_cursors WHERE scope = ?`, [SCOPES.amendments(projectId)]);
    await run(db, `DELETE FROM sync_meta WHERE key = ?`, [`pull_sweep_last:${projectId}`]);
    await run(db, `DELETE FROM sync_meta WHERE key = ?`, [`pull_sweep_due:${projectId}`]);
  }
}

/**
 * Reconcile one project's `daily_reports`/`report_photos` against the
 * server's complete id lists (`serverReportIds`/`serverPhotoIds` — the
 * caller, Task 9, guarantees these are complete and floor-(c)-checked).
 * Candidates are restricted to clean rows (`_dirty = 0`; photos additionally
 * `_pending = 0`) — a dirty row never disappears here, by construction. A
 * clean report absent from the server list is dropped via `deleteLocalReport`
 * (cascading away any dirty child section/amendment too — the report row
 * itself is provably gone server-side, so the child's queued mutation is left
 * for the push path's own 403/404 handling to park or evict). A clean,
 * settled photo absent from the server list is a plain row DELETE — sections
 * and amendments cascade with their parent report and are never swept here
 * directly (doc 06 §B).
 *
 * Returns the number of rows this sweep actually deleted (reports + photos) —
 * the orchestrator (Task 9) folds it into `PullOutcome.committed`, which must
 * be true only when local state genuinely changed.
 */
export async function sweepProject(
  db: Db,
  projectId: string,
  serverReportIds: readonly string[],
  serverPhotoIds: readonly string[],
): Promise<number> {
  let deleted = 0;
  const serverReportSet = new Set(serverReportIds);
  const localReports = await all<{ id: string }>(
    db,
    `SELECT id FROM daily_reports WHERE project_id = ? AND _dirty = 0`,
    [projectId],
  );
  for (const { id } of localReports) {
    if (!serverReportSet.has(id)) {
      await deleteLocalReport(db, id);
      deleted++;
    }
  }

  const serverPhotoSet = new Set(serverPhotoIds);
  const localPhotos = await all<{ id: string }>(
    db,
    `SELECT id FROM report_photos WHERE project_id = ? AND _dirty = 0 AND _pending = 0`,
    [projectId],
  );
  for (const { id } of localPhotos) {
    if (!serverPhotoSet.has(id)) {
      const result = await run(db, `DELETE FROM report_photos WHERE id = ?`, [id]);
      deleted += result.changes;
    }
  }

  return deleted;
}
