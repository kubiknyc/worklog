/**
 * Native sync engine shell: composes the pure `EngineCore` (Task 5) with the
 * one thing that has to live outside it — IO and timers. `engineCore.ts` stays
 * pure (no native imports, no timers) so it can be unit-tested without a
 * device; this file is the composition root that wires it to a real SQLite
 * `Db`, the Supabase client, NetInfo/AppState, and Sentry.
 *
 * `createEngineCore`'s `run`/`retryParked`/`discardParked`/`getState`/
 * `subscribe` are spread through UNCHANGED — an explicit caller (e.g. a
 * pull-to-refresh) talks to the core directly. Only `start`/`stop` are new:
 * they own the NetInfo/AppState listeners and the backoff timer that decide
 * WHEN to call `core.run()` on the engine's own initiative.
 *
 * Backoff ladder (30s / 2m / 10m, indexed by consecutive non-clean cycles):
 * after every self-triggered run resolves, `scheduleBackoff` inspects
 * `core.getState()` and arms exactly one `setTimeout` when either arm holds:
 *
 *   1. `lastError !== null && online` — a real server-side failure while
 *      NetInfo believes we're connected. No NetInfo edge will ever fire for
 *      this (we never went offline), so this arm is the only thing that
 *      retries a stuck queue. Deliberately NOT gated on `pending > 0`: a
 *      non-offline PULL failure (an RLS/grant regression, a refused floor)
 *      ends the cycle `online: true`, `pending: 0`, `lastError` set, and
 *      without this arm nothing would retry it until the next enqueue,
 *      foreground, or NetInfo edge. The ladder clamps at its last rung, so a
 *      persistent failure degrades to a bounded slow poll rather than a spin.
 *   2. `!state.online && netInfoSaysConnected` — a transport failure the ENGINE
 *      detected (captive portal / dead DNS: the cycle published
 *      `online: false` because a push attempt, or the pull phase, actually
 *      failed at the network level) while NetInfo still reports the interface
 *      as connected. No NetInfo edge fires here either, by construction —
 *      NetInfo never left the connected state. Deliberately NOT gated on
 *      `pending > 0`: an offline-classified pull failure ends the cycle
 *      `online: false` with an empty queue, and without this arm nothing would
 *      retry it until the next enqueue or NetInfo flap.
 *
 * A clean cycle (neither arm holds) resets the ladder to its first rung. Any
 * earlier trigger — a NetInfo reconnect edge, an AppState foreground, the
 * initial kick in `start()` — clears a pending timer before running, so at
 * most one timer is ever outstanding.
 */
import NetInfo from '@react-native-community/netinfo';
import type { NetInfoState } from '@react-native-community/netinfo';
import { AppState } from 'react-native';
import type { AppStateStatus } from 'react-native';

import { first, run as runSql, type Db } from '../db/rows.native';
import { reportSyncIncident } from '../lib/observability.native';
import { supabase } from '../supabase/client';
import { createEngineCore } from './engineCore';
import type { SyncEngineApi } from './engineApi';
import { createPuller } from './pull.native';
import type { PullClient } from './pull.native';
import { createPusher } from './push.native';
import { clearDirty, createMutationStore, deleteLocalReport } from './store.native';
import type { Mutation } from './types';

/** Milliseconds, indexed by consecutive non-clean cycles; clamps at the last rung. */
const BACKOFF_LADDER_MS = [30_000, 120_000, 600_000] as const;

interface ErrorDetail {
  readonly errorCode?: string;
  readonly errorStatus?: number;
}

/**
 * Pull `code`/`status` off an unknown push error for the incident report.
 * Mirrors `mutationQueue.ts`'s `asError` narrowing — postgrest-js errors are
 * plain objects, so this is defensive against anything else reaching here.
 */
function errorDetailOf(error: unknown): ErrorDetail {
  if (!error || typeof error !== 'object') return {};
  const e = error as { code?: unknown; status?: unknown };
  return {
    errorCode: typeof e.code === 'string' ? e.code : undefined,
    errorStatus: typeof e.status === 'number' ? e.status : undefined,
  };
}

/** `sync_meta` key prefix the puller reads to decide a per-project id sweep is due. */
const SWEEP_DUE_PREFIX = 'pull_sweep_due:';

export function createSyncEngine(db: Db, sessionUserId: string | null): SyncEngineApi {
  const store = createMutationStore(db);
  // The single documented cast site: `supabase.rpc`'s builders are
  // PromiseLike (not Promise) and its generated overloads key off literal
  // function-name strings, so a generic `RpcName` can't satisfy them without
  // `as never` on both the name and the args. `await` turns the PromiseLike
  // builder into the real `{ data, error, status }` response `RpcRunner`
  // promises. Note: the generated `submit_report` overload types
  // `p_signer_title` as non-nullable while the payload/SQL both allow null —
  // the same cast covers that mismatch too; the payload's `null` still passes
  // through to Postgres unmodified.
  const push = createPusher(async (fn, args) => await supabase.rpc(fn as never, args as never), db);
  // Set by stop(), cleared by start(). Two jobs, both about the async gap a
  // sign-out opens:
  //  - it guards wrappedRun: a cycle already in flight when stop() fires must
  //    not re-arm the backoff timer on its resolve — that would leave a zombie
  //    drain loop running after sign-out, or a second engine ticking alongside
  //    a freshly started one after re-sign-in;
  //  - it is the puller's cancellation predicate: an in-flight pull keeps
  //    running after stop() returns, and without this it would commit the
  //    departing user's fetched rows (Tier-1 snapshot, Tier-2 feeds, cursors)
  //    into the next user's freshly wiped mirror. Declared HERE, above
  //    `createPuller`, so the closure below reads an initialised binding.
  let stopped = false;
  // Sibling of the rpc cast above, same reason: `PullClient` is the structural
  // slice of the PostgREST builder surface the puller uses (see
  // `pull.native.ts`), and supabase-js satisfies it structurally but not
  // nominally — its generated `from()` overloads key off literal table-name
  // strings the puller's runtime-chosen table names can't satisfy.
  const pull = createPuller(supabase as unknown as PullClient, db, () => stopped);

  /**
   * A 403 eviction means the server refused a write we believed we owned — our
   * local view of that project is stale, so flag it for a full id sweep on the
   * next pull. Fire-and-forget: an incident report must never block or fail the
   * drain.
   *
   * NOTE: `engineCore.discardParked`'s create_report cascade-failure path also
   * fires `onIncident('evicted', …)` with a real Mutation, so it arms a
   * sweep-due flag too. That is harmless by design — the sweep is exactly what
   * reconciles the half-discarded local subtree it leaves behind.
   */
  async function armSweepDue(m: Mutation): Promise<void> {
    try {
      const { data } = m.payload;
      // Only create_report/add_photo carry projectId; every other kind is
      // resolved through its report (which may already be gone locally).
      const projectId =
        'projectId' in data
          ? data.projectId
          : ((
              await first<{ project_id: string }>(
                db,
                `SELECT project_id FROM daily_reports WHERE id = ?`,
                [data.reportId],
              )
            )?.project_id ?? null);
      if (projectId === null) return;
      await runSql(
        db,
        `INSERT INTO sync_meta (key, value) VALUES (?, ?)
           ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
        [`${SWEEP_DUE_PREFIX}${projectId}`, new Date().toISOString()],
      );
    } catch {
      // Best-effort: a missed flag costs staleness until the project's next
      // scheduled sweep, never correctness.
    }
  }

  function onIncident(kind: 'parked' | 'evicted', m: Mutation, error: unknown): void {
    reportSyncIncident(kind, {
      kind: m.payload.kind,
      attempts: m.attempts,
      ...errorDetailOf(error),
    });
    if (kind === 'evicted') void armSweepDue(m);
  }

  const core = createEngineCore({
    store,
    push,
    pull,
    sessionUserId,
    clearDirty: (target) => clearDirty(db, target),
    onIncident,
    isOnline: () => netInfoConnected,
    deleteLocalReport: (reportId) => deleteLocalReport(db, reportId),
  });

  // Best-known NetInfo transport state — distinct from `core.getState().online`,
  // which can be forced false by an actual failed push attempt (see module
  // doc, arm 2) even while NetInfo still reports the interface connected.
  let netInfoConnected = true;
  let sawFirstNetInfoEvent = false;
  let consecutiveNonCleanCycles = 0;
  let backoffTimer: ReturnType<typeof setTimeout> | null = null;
  let netInfoUnsubscribe: (() => void) | null = null;
  let appStateSubscription: { remove(): void } | null = null;

  function clearBackoffTimer(): void {
    if (backoffTimer !== null) {
      clearTimeout(backoffTimer);
      backoffTimer = null;
    }
  }

  async function wrappedRun(): Promise<void> {
    await core.run();
    if (stopped) return;
    scheduleBackoff();
  }

  function scheduleBackoff(): void {
    clearBackoffTimer();
    const state = core.getState();
    // No `pending > 0` conjunct (see module doc, arm 1): a non-offline pull
    // failure leaves an EMPTY queue with `lastError` set, and no other trigger
    // would ever come back to it.
    const serverFailureWhileOnline = state.lastError !== null && state.online;
    // No `pending > 0` conjunct: an offline-classified PULL failure ends the
    // cycle `online: false` with an EMPTY queue, and nothing else would ever
    // retry it (no enqueue coming, no NetInfo edge — NetInfo never left
    // connected).
    const transportFailureBehindNetInfo = !state.online && netInfoConnected;

    if (!serverFailureWhileOnline && !transportFailureBehindNetInfo) {
      consecutiveNonCleanCycles = 0;
      return;
    }

    const delay =
      BACKOFF_LADDER_MS[Math.min(consecutiveNonCleanCycles, BACKOFF_LADDER_MS.length - 1)];
    consecutiveNonCleanCycles += 1;
    backoffTimer = setTimeout(() => {
      backoffTimer = null;
      void wrappedRun();
    }, delay);
  }

  /** Any self-initiated trigger: cancel a pending backoff timer, then run. */
  function trigger(): void {
    clearBackoffTimer();
    void wrappedRun();
  }

  function onNetInfoChange(state: NetInfoState): void {
    const connected = state.isConnected ?? false;
    const cameOnline = !netInfoConnected && connected;
    netInfoConnected = connected;

    // NetInfo fires the current state immediately on subscribe — that first
    // callback must not double-run alongside start()'s own explicit kick.
    if (!sawFirstNetInfoEvent) {
      sawFirstNetInfoEvent = true;
      return;
    }
    if (cameOnline) trigger();
  }

  function onAppStateChange(status: AppStateStatus): void {
    if (status === 'active') trigger();
  }

  function start(): void {
    stopped = false;
    netInfoUnsubscribe = NetInfo.addEventListener(onNetInfoChange);
    appStateSubscription = AppState.addEventListener('change', onAppStateChange);
    trigger();
  }

  function stop(): void {
    stopped = true;
    netInfoUnsubscribe?.();
    netInfoUnsubscribe = null;
    appStateSubscription?.remove();
    appStateSubscription = null;
    clearBackoffTimer();
  }

  return {
    ...core,
    start,
    stop,
  };
}
