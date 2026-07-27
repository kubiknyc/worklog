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
import { all, first, run } from '../db/rows.native';
import type { Db } from '../db/rows.native';
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
           (client_id, kind, payload, created_at, attempts, status, last_error)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          m.clientId,
          m.payload.kind,
          JSON.stringify(m.payload),
          m.createdAt,
          m.attempts,
          m.status,
          m.lastError,
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
      // conflict — the section keeps its original queue position.
      await run(
        db,
        `INSERT INTO sync_mutations
           (client_id, kind, payload, created_at, attempts, status, last_error)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (client_id) DO UPDATE SET
           payload    = excluded.payload,
           status     = 'pending',
           attempts   = 0,
           last_error = NULL`,
        [
          m.clientId,
          m.payload.kind,
          JSON.stringify(m.payload),
          m.createdAt,
          m.attempts,
          m.status,
          m.lastError,
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
      await run(
        db,
        `UPDATE sync_mutations SET attempts = ?, status = ?, last_error = ? WHERE client_id = ?`,
        [m.attempts, m.status, m.lastError, m.clientId],
      );
    },
    async remove(clientId) {
      await run(db, `DELETE FROM sync_mutations WHERE client_id = ?`, [clientId]);
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
