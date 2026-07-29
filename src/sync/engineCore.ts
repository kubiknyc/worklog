/**
 * Pure engine core: the drain loop, single-flight + dirty-coalescing, and the
 * discard/retry unwedging surfaces. No IO, no timers, no native imports —
 * listeners (NetInfo/AppState) and timers are the shell's job (Task 6), which
 * composes `{ ...createEngineCore(deps), start, stop }` into `SyncEngineApi`.
 *
 * `run()` never rejects: any throw from `store.remove`/`store.replace`/
 * `clearDirty` is caught per-mutation, surfaced via `lastError`, and the cycle
 * is aborted cleanly (the remaining pending mutations are simply not
 * attempted this cycle — they are picked up on the next `run()`).
 */
import { IDLE_SYNC_STATE } from './engineApi';
import type { SyncEngineApi, SyncState } from './engineApi';
import { applyOutcome, orderForDrain, otherMutationTargetsRow, rowTargetOf } from './mutationQueue';
import type { PushOutcome, RowTarget } from './mutationQueue';
import type { Mutation, MutationPayload, MutationStore } from './types';

export interface EngineDeps {
  readonly store: MutationStore;
  // Restated inline from mutationQueue/types exports — do NOT import the
  // Pusher alias from push.native.ts (a bare value import would drag the
  // native graph into the pure core; restating avoids even the type-only
  // dependency).
  readonly push: (m: Mutation) => Promise<PushOutcome>;
  readonly clearDirty: (target: RowTarget) => Promise<void>;
  readonly onIncident: (kind: 'parked' | 'evicted', m: Mutation, error: unknown) => void;
  readonly isOnline: () => boolean;
  /**
   * `discardParked`'s create_report cascade seam: one transaction deleting the
   * `daily_reports` row and every child-table row for that report. The server
   * never saw this report and `sqliteRepo.createReport` short-circuits on an
   * existing local row, so keeping the local subtree would strand it.
   */
  readonly deleteLocalReport: (reportId: string) => Promise<void>;
}

export type EngineCore = Omit<SyncEngineApi, 'start' | 'stop'>;

interface StatusCounts {
  readonly pending: number;
  readonly parked: number;
}

function countStatuses(all: readonly Mutation[]): StatusCounts {
  let pending = 0;
  let parked = 0;
  for (const m of all) {
    if (m.status === 'pending') pending += 1;
    else parked += 1;
  }
  return { pending, parked };
}

/** Every payload variant carries `reportId` — the per-report grouping key for skip rules. */
function reportIdOf(payload: MutationPayload): string {
  return payload.data.reportId;
}

/**
 * A copy of `payload` re-keyed to the reparent winner. Only ever called for
 * `create_report` payloads (the only kind `PushOutcome.reparentedTo` is set
 * for), but written generically over the union for clarity.
 */
function withReportId(payload: MutationPayload, reportId: string): MutationPayload {
  return { ...payload, data: { ...payload.data, reportId } } as MutationPayload;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export function createEngineCore(deps: EngineDeps): EngineCore {
  const { store, push, clearDirty, onIncident, isOnline, deleteLocalReport } = deps;

  let state: SyncState = { ...IDLE_SYNC_STATE, reparents: 0 };
  let reparentsCount = 0;
  let cyclePromise: Promise<void> | null = null;
  let dirty = false;
  const listeners = new Set<(s: SyncState) => void>();

  function publish(next: SyncState): void {
    state = next;
    for (const fn of listeners) fn(next);
  }

  async function publishRecount(): Promise<void> {
    const counts = countStatuses(await store.all());
    publish({ ...state, pending: counts.pending, parked: counts.parked });
  }

  async function runOnce(): Promise<void> {
    const startAll = await store.all();
    const startCounts = countStatuses(startAll);
    publish({
      online: isOnline(),
      syncing: true,
      pending: startCounts.pending,
      parked: startCounts.parked,
      lastError: state.lastError,
      reparents: reparentsCount,
      completedPulls: 0,
    });

    // Cross-cycle skip rule: a PARKED mutation for report R blocks every
    // pending mutation for R this cycle — discard/retry is the resolution
    // path, not a silent drain past it.
    const parkedReportIds = new Set(
      startAll.filter((m) => m.status === 'parked').map((m) => reportIdOf(m.payload)),
    );
    // Within-cycle skip rule: a failure for report R this cycle shadows R's
    // later mutations this cycle (out-of-order writes would otherwise land).
    const shadowedReportIds = new Set<string>();

    const ordered = orderForDrain(await store.pending());

    let thrown: string | null = null;
    let stoppedOffline = false;
    let lastFailureMessage: string | null = null;

    for (const m of ordered) {
      const reportId = reportIdOf(m.payload);
      if (parkedReportIds.has(reportId) || shadowedReportIds.has(reportId)) continue;

      const outcome = await push(m);
      const applied = applyOutcome(m, outcome);

      if (outcome.ok) {
        try {
          const removed = await store.remove(m.clientId, m.revision);
          // 0 rows affected = a fresh coalesce won the race; skip clearDirty
          // entirely rather than clearing a flag the coalesced edit still owns.
          if (removed > 0) {
            const winner = outcome.reparentedTo;
            const comparePayload = winner ? withReportId(m.payload, winner) : m.payload;
            // Contention check calls store.all() FRESH here (never a
            // cycle-start snapshot) so a different-clientId mutation enqueued
            // mid-cycle against the same row is seen. Re-keyed to the winner
            // when reparented, since the reparent already rewrote every other
            // queued mutation to the winner id.
            const freshAll = await store.all();
            const contended = otherMutationTargetsRow(freshAll, { ...m, payload: comparePayload });
            if (!contended) {
              await clearDirty(rowTargetOf(comparePayload));
            }
          }
        } catch (err: unknown) {
          thrown = errorMessage(err);
          break;
        }

        if (outcome.reparentedTo) {
          reparentsCount += 1;
          // Abort the remaining cycle; mark dirty for an immediate follow-up
          // that reloads with the rewritten ids — no push against a dead
          // loser id, no spurious incident.
          dirty = true;
          break;
        }
        continue;
      }

      // Failure path.
      let replaced = 0;
      try {
        replaced = await store.replace(applied.next as Mutation);
      } catch (err: unknown) {
        thrown = errorMessage(err);
        break;
      }

      if (applied.errorClass === 'offline') {
        // The queued count IS the offline UX — never-alarm contract.
        stoppedOffline = true;
        break;
      }

      // 0 rows affected = a fresh coalesce already superseded this mutation;
      // charge nothing — no incident, the attempt never lands anywhere.
      if (replaced > 0 && (applied.evict || applied.next?.status === 'parked')) {
        onIncident(applied.evict ? 'evicted' : 'parked', m, outcome.error);
      }
      lastFailureMessage = applied.next?.lastError ?? null;
      shadowedReportIds.add(reportId);
    }

    const endAll = await store.all();
    const endCounts = countStatuses(endAll);
    const online = stoppedOffline ? false : isOnline();
    const lastError = thrown ?? (stoppedOffline ? null : lastFailureMessage);
    publish({
      online,
      syncing: false,
      pending: endCounts.pending,
      parked: endCounts.parked,
      lastError,
      reparents: reparentsCount,
      completedPulls: 0,
    });
  }

  function run(): Promise<void> {
    if (cyclePromise) {
      // Coalesce: the running cycle re-runs once more before finishing, so
      // the trailing cycle always recounts the last enqueue.
      dirty = true;
      return cyclePromise;
    }
    cyclePromise = (async () => {
      try {
        do {
          dirty = false;
          await runOnce();
        } while (dirty);
      } finally {
        cyclePromise = null;
      }
    })();
    return cyclePromise;
  }

  async function retryParked(): Promise<void> {
    const all = await store.all();
    const parkedIds = all.filter((m) => m.status === 'parked').map((m) => m.clientId);
    for (const clientId of parkedIds) {
      await store.unpark(clientId);
    }
    await run();
  }

  async function discardParked(clientId: string): Promise<number> {
    const all = await store.all();
    const target = all.find((m) => m.clientId === clientId);
    let affected = 0;
    if (target) {
      if (target.payload.kind === 'create_report') {
        const reportId = target.payload.data.reportId;
        const relatedIds = all
          .filter((m) => reportIdOf(m.payload) === reportId)
          .map((m) => m.clientId);
        await store.removeMany(relatedIds);
        await deleteLocalReport(reportId);
        affected = relatedIds.length;
      } else {
        affected = await store.removeParked(clientId);
      }
    }
    await publishRecount();
    return affected;
  }

  return {
    getState: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    run,
    retryParked,
    discardParked,
  };
}
