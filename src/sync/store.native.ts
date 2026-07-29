/**
 * SQLite-backed persistence for the sync queue and pull cursors. Native-only —
 * Jest never imports this against a real database; the pure policy it serves
 * lives in `mutationQueue.ts`. Implements the `MutationStore` / `CursorStore`
 * seams (sync/types.ts). Ported from PunchLog's `store.native.ts`, adapted to
 * WorkLog's `sync_mutations`/`sync_cursors` tables (identical column names —
 * db/schema.ts) and extended with `enqueueCoalescing` for update_section
 * (doc 06 §A). PunchLog's `nextProvisionalSeq` is intentionally NOT ported:
 * WorkLog rows carry client-UUID-equals-server-id keys, so there are no
 * provisional NEW-n codes to sequence.
 */
import { all, first, run, tx } from '../db/rows.native';
import type { Db } from '../db/rows.native';
import type { RowTarget } from './mutationQueue';
import type {
  CursorStore,
  Mutation,
  MutationPayload,
  MutationStatus,
  MutationStore,
  QueueCounter,
} from './types';

interface MutationRow {
  client_id: string;
  kind: string;
  payload: string;
  created_at: string;
  attempts: number;
  status: string;
  last_error: string | null;
  revision: number;
}

/**
 * Map a row to a Mutation, or null if its payload is unparseable. A single
 * corrupt row must not throw out of `pending()`/`all()` and halt ALL sync —
 * callers drop the nulls so the rest of the queue still drains.
 */
function toMutation(r: MutationRow): Mutation | null {
  let payload: MutationPayload;
  try {
    payload = JSON.parse(r.payload) as MutationPayload;
  } catch {
    return null;
  }
  return {
    clientId: r.client_id,
    payload,
    createdAt: r.created_at,
    attempts: r.attempts,
    status: r.status as MutationStatus,
    lastError: r.last_error,
    revision: r.revision,
  };
}

/**
 * Map rows to Mutations; a row whose payload no longer parses can never be
 * pushed (and its enqueue reported success long ago), so leaving it would hide
 * the loss forever behind a queue entry no UI surfaces. Delete it and warn once
 * with its clientId — the delete makes the warning one-shot. Never throws
 * (`pending()`/`all()` must keep serving the healthy rest of the queue).
 */
async function toMutations(db: Db, rows: MutationRow[]): Promise<Mutation[]> {
  const out: Mutation[] = [];
  for (const r of rows) {
    const m = toMutation(r);
    if (m) {
      out.push(m);
      continue;
    }
    console.warn(
      `[sync] Dropping mutation ${r.client_id}: corrupt payload (unparseable JSON) — this edit will not sync`,
    );
    try {
      await run(db, `DELETE FROM sync_mutations WHERE client_id = ?`, [r.client_id]);
    } catch {
      // Deletion is best-effort; the row is still filtered from the result.
    }
  }
  return out;
}

export function createMutationStore(db: Db): MutationStore {
  return {
    async enqueue(m) {
      // OR IGNORE makes re-enqueue of the same clientId a no-op (idempotent).
      // The persisted `kind` column derives from the payload discriminant.
      await run(
        db,
        `INSERT OR IGNORE INTO sync_mutations
           (client_id, kind, payload, created_at, attempts, status, last_error, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          m.clientId,
          m.payload.kind,
          JSON.stringify(m.payload),
          m.createdAt,
          m.attempts,
          m.status,
          m.lastError,
          m.revision,
        ],
      );
    },
    async enqueueCoalescing(m) {
      // [doc 06 §A] update_section coalesces per (reportId, section): a repeat
      // edit REPLACES the still-queued mutation's payload in place under the
      // same clientId and re-pends it (status='pending', attempts=0,
      // last_error=NULL) so a fresh edit both supersedes a parked mutation's
      // stale content and buys a fresh retry ceiling. `created_at` (and thus
      // the AUTOINCREMENT `seq` drain order) is deliberately NOT touched on
      // conflict — the section keeps its original queue position. `revision`
      // bumps on every coalesce so a push already in flight for the pre-edit
      // payload fails its revision-guarded `replace`/`remove` and can't
      // clobber this fresher edit.
      await run(
        db,
        `INSERT INTO sync_mutations
           (client_id, kind, payload, created_at, attempts, status, last_error, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (client_id) DO UPDATE SET
           payload    = excluded.payload,
           status     = 'pending',
           attempts   = 0,
           last_error = NULL,
           revision   = sync_mutations.revision + 1`,
        [
          m.clientId,
          m.payload.kind,
          JSON.stringify(m.payload),
          m.createdAt,
          m.attempts,
          m.status,
          m.lastError,
          m.revision,
        ],
      );
    },
    async pending() {
      const rows = await all<MutationRow>(
        db,
        `SELECT * FROM sync_mutations WHERE status = 'pending' ORDER BY seq ASC`,
      );
      return toMutations(db, rows);
    },
    async all() {
      const rows = await all<MutationRow>(db, `SELECT * FROM sync_mutations ORDER BY seq DESC`);
      return toMutations(db, rows);
    },
    async replace(m) {
      // Guards against a coalesce race (a coalesced edit bumped the row's
      // revision after `m` was read for pushing), NOT against re-entrant
      // pushes: two back-to-back `replace` calls for the same unchanged
      // revision both succeed, since neither call itself advances it.
      const result = await run(
        db,
        `UPDATE sync_mutations SET attempts = ?, status = ?, last_error = ?
         WHERE client_id = ? AND revision = ?`,
        [m.attempts, m.status, m.lastError, m.clientId, m.revision],
      );
      return result.changes;
    },
    async remove(clientId, revision) {
      const result = await run(
        db,
        `DELETE FROM sync_mutations WHERE client_id = ? AND revision = ?`,
        [clientId, revision],
      );
      return result.changes;
    },
    async removeParked(clientId) {
      // Status guard (not a revision guard): a racing coalesce flips a parked
      // row back to 'pending' before this runs, so the WHERE clause misses it
      // and the fresh edit survives a stale discard tap.
      const result = await run(
        db,
        `DELETE FROM sync_mutations WHERE client_id = ? AND status = 'parked'`,
        [clientId],
      );
      return result.changes;
    },
    async removeMany(clientIds) {
      // Unconditional — used only by the create_report reparent cascade, which
      // already owns the decision to drop these rows outright.
      for (const clientId of clientIds) {
        await run(db, `DELETE FROM sync_mutations WHERE client_id = ?`, [clientId]);
      }
    },
    async unpark(clientId) {
      await run(
        db,
        `UPDATE sync_mutations SET status = 'pending', attempts = 0, last_error = NULL WHERE client_id = ?`,
        [clientId],
      );
    },
  };
}

/**
 * Cheap aggregate for the sync status pill — one GROUP BY, never loads
 * payload TEXT. Any status value outside 'pending' | 'parked' folds into
 * `pending`: visible-by-default beats silently dropped.
 *
 * Divergence from `pending()`, accepted deliberately: COUNT(*) includes
 * corrupt-payload rows that `pending()` would delete on read. In M2 nothing
 * calls `pending()`, so a corrupt row keeps the pill at N>0 — over-reporting
 * unsent work is the safe direction; M3's first drain reconciles it.
 */
export function createMutationCounter(db: Db): QueueCounter {
  return async () => {
    const rows = await all<{ status: string; n: number }>(
      db,
      `SELECT status, COUNT(*) AS n FROM sync_mutations GROUP BY status`,
    );
    let pending = 0;
    let parked = 0;
    for (const r of rows) {
      if (r.status === 'parked') parked += r.n;
      else pending += r.n;
    }
    return { pending, parked };
  };
}

export function createCursorStore(db: Db): CursorStore {
  return {
    async get(scope) {
      const row = await first<{ value: string }>(
        db,
        `SELECT value FROM sync_cursors WHERE scope = ?`,
        [scope],
      );
      return row?.value ?? null;
    },
    async set(scope, value) {
      await run(
        db,
        `INSERT INTO sync_cursors (scope, value) VALUES (?, ?)
         ON CONFLICT (scope) DO UPDATE SET value = excluded.value`,
        [scope, value],
      );
    },
  };
}

/** Splits a `report_sections` composite id (`${reportId}:${section}`) into its parts. */
function splitSectionId(id: string): { reportId: string; section: string } {
  const i = id.indexOf(':');
  return { reportId: id.slice(0, i), section: id.slice(i + 1) };
}

/**
 * Clear `_dirty` on the local row(s) a successfully-pushed mutation targets.
 * `report_sections` splits the composite id [R2]; when the section is
 * `'weather'` this ALSO clears `report_weather` by `report_id` — the queue
 * files a weather override under `report_sections` [R3], but the local
 * mirror for weather lives in its own 1:1 table, not a `report_sections` row.
 */
export async function clearDirty(db: Db, target: RowTarget): Promise<void> {
  if (target.table === 'report_sections') {
    const { reportId, section } = splitSectionId(target.id);
    await run(db, `UPDATE report_sections SET _dirty = 0 WHERE report_id = ? AND section = ?`, [
      reportId,
      section,
    ]);
    if (section === 'weather') {
      await run(db, `UPDATE report_weather SET _dirty = 0 WHERE report_id = ?`, [reportId]);
    }
    return;
  }
  await run(db, `UPDATE ${target.table} SET _dirty = 0 WHERE id = ?`, [target.id]);
}

/**
 * Child tables of a report (schema.ts), all keyed directly by `report_id`.
 * `report_amendment_changes` is NOT in this list — it keys off `amendment_id`,
 * not `report_id` — and is instead swept via a subquery on `report_amendments`
 * before that table's own rows are deleted (below).
 */
const REPORT_CHILD_TABLES = [
  'report_sections',
  'report_weather',
  'report_photos',
  'report_amendments',
  'report_crew',
  'report_equipment',
  'report_work_performed',
  'report_delays',
  'report_safety_observations',
] as const;

/**
 * Task 5's discard cascade: delete a report and every child-table row for it
 * in ONE transaction. `tx` is zero-arg (no nested `tx` calls inside — that
 * deadlocks the transaction queue), so every delete below is a plain `run`.
 *
 * `report_amendment_changes` rows key off `amendment_id`, not `report_id`, so
 * they can't be targeted by the `REPORT_CHILD_TABLES` loop; the subquery here
 * MUST run before `report_amendments` is deleted (the loop below), or the
 * subquery would see zero matching amendments and leave the changes orphaned.
 */
export async function deleteLocalReport(db: Db, reportId: string): Promise<void> {
  await tx(db, async () => {
    await run(
      db,
      `DELETE FROM report_amendment_changes
       WHERE amendment_id IN (SELECT id FROM report_amendments WHERE report_id = ?)`,
      [reportId],
    );
    for (const table of REPORT_CHILD_TABLES) {
      await run(db, `DELETE FROM ${table} WHERE report_id = ?`, [reportId]);
    }
    await run(db, `DELETE FROM daily_reports WHERE id = ?`, [reportId]);
  });
}
