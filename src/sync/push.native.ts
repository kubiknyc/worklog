/**
 * Native pusher: turns one queued `Mutation` into a Postgres RPC call and folds
 * the result into a `PushOutcome` (mutationQueue.ts). Task 6's shell injects
 * `supabase.rpc` as the `RpcRunner`; Jest never opens a real Supabase client or
 * SQLite database — `reparentReport` is exercised on its own in
 * reparent.native.test.ts and is mocked here.
 *
 * Error shape: postgrest-js errors are PLAIN objects (verified at source), so
 * `{ ...error, status }` preserves `code`/`message` and folds in the transport
 * status `classifyError` (mutationQueue.ts) branches on for its 403-evict/401/
 * 5xx verdicts. A non-object `error` (defensive-only — postgrest-js never
 * sends one) is wrapped instead of spread, so `classifyError`'s `asError` still
 * sees a `message`.
 */
import type { Db } from '../db/rows.native';
import type { PushOutcome } from './mutationQueue';
import { reparentReport } from './reparent.native';
import { rpcCallOf } from './rpcMap';
import type { RpcName } from './rpcMap';
import type { Mutation } from './types';

export type RpcRunner = (
  fn: RpcName,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: unknown; status: number }>;

export type Pusher = (m: Mutation) => Promise<PushOutcome>;

/** The `create_report` RPC's setof return row (02 §C get-or-create). */
interface CreateReportRow {
  readonly report_id: string;
}

function mergedError(error: unknown, status: number): unknown {
  if (error && typeof error === 'object') return { ...error, status };
  return { message: String(error), status };
}

/**
 * Builds a `Pusher` bound to one `RpcRunner` and one open `Db` (for the
 * reparent transaction). Any thrown exception — from the RPC call itself or
 * from `reparentReport` — is caught and reported as `{ ok: false, error }`;
 * nothing propagates out of the returned function.
 */
export function createPusher(rpc: RpcRunner, db: Db): Pusher {
  return async (m: Mutation): Promise<PushOutcome> => {
    try {
      const { fn, args } = rpcCallOf(m.payload);
      const { data, error, status } = await rpc(fn, args);

      if (error) {
        return { ok: false, error: mergedError(error, status) };
      }

      if (m.payload.kind === 'create_report') {
        const rows = data as readonly CreateReportRow[];
        const winnerId = rows[0]!.report_id;
        const loserId = m.payload.data.reportId;
        if (winnerId !== loserId) {
          await reparentReport(db, loserId, winnerId);
          return { ok: true, reparentedTo: winnerId };
        }
      }

      return { ok: true };
    } catch (err) {
      return { ok: false, error: err };
    }
  };
}
