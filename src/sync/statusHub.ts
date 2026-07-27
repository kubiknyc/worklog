/**
 * Publishes queue counts as `SyncState` for the sync status pill. The M2
 * producer is an injected `QueueCounter` (a COUNT over `sync_mutations`),
 * recounted on every repo `nudge`; M3's engine replaces the counter as the
 * producer through this same surface and `setCounter` is retired then.
 *
 * This module is the sanctioned stateful exception in `src/sync/`: mutable
 * module-level subscription state, but still zero IO — the counter is
 * injected, so the hub stays device-free testable. `createSyncStatusHub` is
 * exported so tests get isolated instances; the app uses the singleton.
 */
import { IDLE_SYNC_STATE } from './engineApi';
import type { SyncState } from './engineApi';
import type { QueueCounter } from './types';

/**
 * Hub-owned published shape. `countError` is the hub's "the COUNT query
 * failed" flag — deliberately distinct from `SyncState.lastError`, which is
 * reserved for the M3 engine's last *sync* error.
 *
 * In M2 `online` and `completedPulls` are inherited idle placeholders
 * (`true` / `0`) — no consumer may read them until the engine produces them.
 */
export type HubSyncState = SyncState & { readonly countError: boolean };

export interface SyncStatusHub {
  /** Stable snapshot ref between notifications (useSyncExternalStore contract). */
  getState(): HubSyncState;
  subscribe(fn: () => void): () => void;
  /**
   * Swap the counts producer. Bumps the epoch (discarding any in-flight
   * count), resets published state to idle (notifying subscribers so a
   * sign-out/fallback is visible immediately), then refreshes if non-null.
   */
  setCounter(counter: QueueCounter | null): void;
  /** Recount and publish. Serialized + coalesced; never rejects. */
  refresh(): Promise<void>;
}

const IDLE_HUB_STATE: HubSyncState = { ...IDLE_SYNC_STATE, countError: false };

export function createSyncStatusHub(): SyncStatusHub {
  let counter: QueueCounter | null = null;
  let epoch = 0;
  let state: HubSyncState = IDLE_HUB_STATE;
  let cycle: Promise<void> | null = null;
  let dirty = false;
  let warned = false;
  const listeners = new Set<() => void>();

  function publish(next: HubSyncState): void {
    state = next;
    for (const fn of listeners) fn();
  }

  /**
   * One counter run under the epoch captured at its own entry. The coalesced
   * re-run in `refresh` calls this again fresh, so it re-reads the CURRENT
   * counter and epoch — a `setCounter` racing an in-flight count ends with
   * the new counter's counts published, never a stale result and never
   * pinned idle.
   */
  async function runOnce(): Promise<void> {
    const c = counter;
    if (!c) return;
    const startedEpoch = epoch;
    try {
      const counts = await c();
      if (epoch !== startedEpoch) return; // stale — a newer setCounter owns the state now
      warned = false; // successful count re-arms the one-shot warning
      publish({ ...state, pending: counts.pending, parked: counts.parked, countError: false });
    } catch (error: unknown) {
      if (epoch !== startedEpoch) return;
      if (!warned) {
        warned = true;
        console.warn('[sync] Queue count failed — sync pill may be stale', error);
      }
      // Keep last-known counts; flag the failure so the pill never falsely
      // claims "All saved" over unsent work (AC-O6).
      publish({ ...state, countError: true });
    }
  }

  function refresh(): Promise<void> {
    if (!counter) return Promise.resolve(); // no producer (web, fallback) — nothing to touch
    if (cycle) {
      // Coalesce: the running cycle re-runs once more before finishing, and
      // callers awaiting this refresh observe that completion.
      dirty = true;
      return cycle;
    }
    cycle = (async () => {
      try {
        do {
          dirty = false;
          await runOnce();
        } while (dirty);
      } finally {
        cycle = null;
      }
    })();
    return cycle;
  }

  return {
    getState: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    setCounter(next) {
      epoch += 1;
      counter = next;
      warned = false;
      publish(IDLE_HUB_STATE);
      if (next) void refresh();
    },
    refresh,
  };
}

/** App-wide instance — installed by RepositoryProvider, read by useSyncStatus. */
export const syncStatusHub: SyncStatusHub = createSyncStatusHub();
