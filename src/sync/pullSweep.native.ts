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
 * This makes both functions idempotent and resumable: a crash mid-eviction
 * leaves a partially-evicted project (some reports gone, some cursors/meta
 * still present) that the next call — same diff, membership still gone —
 * finishes; re-running against rows already gone is a no-op by construction
 * (nothing matches the WHERE clause).
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
 */
async function evictQueueForReport(db: Db, reportId: string): Promise<void> {
  const rows = await all<QueuedMutationRow>(db, `SELECT * FROM sync_mutations`);
  for (const row of rows) {
    const payload = JSON.parse(row.payload) as MutationPayload;
    const data = payload.data as unknown as Readonly<Record<string, unknown>>;
    if (data.reportId !== reportId) continue;
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
 */
export async function sweepProject(
  db: Db,
  projectId: string,
  serverReportIds: readonly string[],
  serverPhotoIds: readonly string[],
): Promise<void> {
  const serverReportSet = new Set(serverReportIds);
  const localReports = await all<{ id: string }>(
    db,
    `SELECT id FROM daily_reports WHERE project_id = ? AND _dirty = 0`,
    [projectId],
  );
  for (const { id } of localReports) {
    if (!serverReportSet.has(id)) {
      await deleteLocalReport(db, id);
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
      await run(db, `DELETE FROM report_photos WHERE id = ?`, [id]);
    }
  }
}
