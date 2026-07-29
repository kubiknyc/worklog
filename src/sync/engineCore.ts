/**
 * Pure engine core: the drain loop, single-flight + dirty-coalescing, and the
 * discard/retry unwedging surfaces. No IO, no timers, no native imports —
 * listeners (NetInfo/AppState) and timers are the shell's job (Task 6), which
 * composes `{ ...createEngineCore(deps), start, stop }` into `SyncEngineApi`.
 *
 * `run()` never rejects — this is absolute, not just a per-mutation guarantee:
 * a throw from `store.remove`/`store.replace`/`clearDirty` is caught
 * per-mutation, surfaced via `lastError`, and aborts the cycle cleanly (the
 * remaining pending mutations are simply not attempted this cycle — they are
 * picked up on the next `run()`); a throw from the cycle-level `store.all()`/
 * `store.pending()` reads is caught by an outer guard for the same reason.
 * `retryParked()` and `discardParked()` apply the same never-reject discipline
 * (Task 6 calls all three from NetInfo/AppState listeners and UI event
 * handlers, where a rejection becomes an unhandled promise rejection).
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

  let state: SyncState = IDLE_SYNC_STATE;
  let reparentsCount = 0;
  let cyclePromise: Promise<void> | null = null;
  let dirty = false;
  const listeners = new Set<(s: SyncState) => void>();

  function publish(next: SyncState): void {
    state = next;
    for (const fn of listeners) fn(next);
  }

  async function publishRecount(): Promise<void> {
    try {
      const counts = countStatuses(await store.all());
      publish({ ...state, pending: counts.pending, parked: counts.parked });
    } catch {
      // Never-reject: a failed recount leaves the last-published counts in
      // place rather than surfacing to the caller.
    }
  }

  async function runOnce(): Promise<void> {
    let thrown: string | null = null;
    let stoppedOffline = false;
    let lastFailureMessage: string | null = null;

    try {
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
              const contended = otherMutationTargetsRow(freshAll, {
                ...m,
                payload: comparePayload,
              });
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

        // Failure path. `applied.next` is only ever null on the success
        // branch (outcome.ok) per applyOutcome's contract — narrow instead of
        // casting so this stays sound if that contract ever changes.
        if (!applied.next) continue;

        let replaced = 0;
        try {
          replaced = await store.replace(applied.next);
        } catch (err: unknown) {
          thrown = errorMessage(err);
          break;
        }

        if (applied.errorClass === 'offline') {
          // The queued count IS the offline UX — never-alarm contract. Note
          // store.replace still ran above (guarded); offline's applyOutcome
          // output leaves attempts untouched, so this is a no-op write.
          stoppedOffline = true;
          break;
        }

        // 0 rows affected = a fresh coalesce already superseded this
        // mutation at the store level — no incident, this attempt's charge
        // never lands anywhere. It still shadows later mutations for this
        // report and still informs lastError below: the push itself really
        // did fail (a real round-trip happened), independent of whether the
        // now-stale row got persisted.
        if (replaced > 0 && (applied.evict || applied.next.status === 'parked')) {
          onIncident(applied.evict ? 'evicted' : 'parked', m, outcome.error);
        }
        lastFailureMessage = applied.next.lastError;
        shadowedReportIds.add(reportId);
      }
    } catch (err: unknown) {
      // Catches a throw from the cycle-level store.all()/store.pending()
      // reads themselves (not just the per-mutation store calls above) — the
      // never-rejects contract is absolute, not scoped to the drain loop.
      thrown = errorMessage(err);
    }

    let endCounts: StatusCounts = { pending: state.pending, parked: state.parked };
    try {
      endCounts = countStatuses(await store.all());
    } catch (err: unknown) {
      thrown = thrown ?? errorMessage(err);
    }
    const online = stoppedOffline ? false : isOnline();
    // Offline's never-alarm contract is absolute: it must win even when the
    // cycle-end recount itself throws (a store read failure must not surface
    // as a false alarm on top of "we're offline").
    const lastError = stoppedOffline ? null : (thrown ?? lastFailureMessage);
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
    try {
      const all = await store.all();
      const parkedIds = all.filter((m) => m.status === 'parked').map((m) => m.clientId);
      for (const clientId of parkedIds) {
        await store.unpark(clientId);
      }
    } catch {
      // Never-reject: fall through to run() even if some/all unparks failed —
      // whatever did unpark still gets a chance to drain.
    }
    await run(); // run() itself never rejects.
  }

  async function discardParked(clientId: string): Promise<number> {
    let affected = 0;
    try {
      const all = await store.all();
      const target = all.find((m) => m.clientId === clientId);
      if (target) {
        if (target.payload.kind === 'create_report') {
          // Unlike the `removeParked` branch below, this cascade is
          // unconditional — no status guard. The server never saw this
          // report at all, so every queued mutation for it (pending OR
          // parked) is orphaned the moment the create_report itself is
          // discarded; Task 8's UI must only ever offer this action for a
          // PARKED create_report, but the engine doesn't re-check that here.
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
    } catch {
      affected = 0;
    }
    await publishRecount(); // never-rejects on its own.
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
