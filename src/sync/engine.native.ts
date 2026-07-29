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
 *   1. `pending > 0 && lastError !== null && online` — a real server-side
 *      failure while NetInfo believes we're connected. No NetInfo edge will
 *      ever fire for this (we never went offline), so this arm is the only
 *      thing that retries a stuck queue.
 *   2. `pending > 0 && !state.online && netInfoSaysConnected` — a transport
 *      failure the ENGINE detected (captive portal / dead DNS: the cycle
 *      published `online: false` because a push attempt actually failed at
 *      the network level) while NetInfo still reports the interface as
 *      connected. No NetInfo edge fires here either, by construction — NetInfo
 *      never left the connected state.
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

import type { Db } from '../db/rows.native';
import { reportSyncIncident } from '../lib/observability.native';
import { supabase } from '../supabase/client';
import { createEngineCore } from './engineCore';
import type { SyncEngineApi } from './engineApi';
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

function onIncident(kind: 'parked' | 'evicted', m: Mutation, error: unknown): void {
  reportSyncIncident(kind, {
    kind: m.payload.kind,
    attempts: m.attempts,
    ...errorDetailOf(error),
  });
}

export function createSyncEngine(db: Db): SyncEngineApi {
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

  const core = createEngineCore({
    store,
    push,
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
  // Set by stop(), cleared by start(). Guards the async gap in wrappedRun: a
  // cycle already in flight when stop() fires must not re-arm the backoff
  // timer on its resolve — that would leave a zombie drain loop running after
  // sign-out, or a second engine ticking alongside a freshly started one after
  // re-sign-in.
  let stopped = false;

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
    const serverFailureWhileOnline = state.pending > 0 && state.lastError !== null && state.online;
    const transportFailureBehindNetInfo = state.pending > 0 && !state.online && netInfoConnected;

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
