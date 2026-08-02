/**
 * statusHub is the sync pill's state spine — pinned at 95/100/95/95 in
 * package.json. Tests run against isolated `createSyncStatusHub()` instances
 * (never the app singleton) so cases cannot leak into each other.
 */
import { createSyncStatusHub } from './statusHub';
import { IDLE_SYNC_STATE } from './engineApi';
import type { SyncState } from './engineApi';
import type { QueueCounts, QueueCounter } from './types';

/** Minimal `Pick<SyncEngineApi,'getState'|'subscribe'>` fake — no native deps. */
function fakeEngine(initial: SyncState) {
  let state = initial;
  const listeners = new Set<(s: SyncState) => void>();
  return {
    getState: () => state,
    subscribe: (fn: (s: SyncState) => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    publish: (s: SyncState) => {
      state = s;
      for (const fn of listeners) fn(s);
    },
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const counts = (pending: number, parked = 0): QueueCounts => ({ pending, parked });

/** Let pending microtasks/timers run so an in-flight hub cycle can finish. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('createSyncStatusHub', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  test('starts idle: zero counts, no error, synced shape', () => {
    const hub = createSyncStatusHub();

    const s = hub.getState();

    expect(s.pending).toBe(0);
    expect(s.parked).toBe(0);
    expect(s.countError).toBe(false);
  });

  test('setCounter installs a counter, refreshes, and publishes its counts', async () => {
    const hub = createSyncStatusHub();

    hub.setCounter(async () => counts(3, 1));
    await hub.refresh();

    expect(hub.getState().pending).toBe(3);
    expect(hub.getState().parked).toBe(1);
  });

  test('setCounter notifies subscribers with an idle reset before the recount lands', () => {
    const hub = createSyncStatusHub();
    const gate = deferred<QueueCounts>();
    const seen: number[] = [];
    hub.subscribe(() => seen.push(hub.getState().pending));

    hub.setCounter(() => gate.promise);

    // The idle reset itself must notify — without it, useSyncExternalStore
    // would keep rendering the previous user's counts across a sign-out.
    expect(seen).toEqual([0]);
  });

  test('refresh notifies subscribers and getState returns a stable ref between notifications', async () => {
    const hub = createSyncStatusHub();
    let notifications = 0;
    hub.subscribe(() => {
      notifications += 1;
    });
    hub.setCounter(async () => counts(2));
    await hub.refresh();

    const a = hub.getState();
    const b = hub.getState();

    expect(a).toBe(b); // same object ref until the next publish
    expect(a.pending).toBe(2);
    expect(notifications).toBeGreaterThanOrEqual(2); // idle reset + at least one recount
  });

  test('unsubscribe stops notifications', async () => {
    const hub = createSyncStatusHub();
    let calls = 0;
    const unsubscribe = hub.subscribe(() => {
      calls += 1;
    });

    unsubscribe();
    hub.setCounter(async () => counts(1));
    await hub.refresh();

    expect(calls).toBe(0);
  });

  test('refresh with no counter installed is a no-op and does not notify', async () => {
    const hub = createSyncStatusHub();
    let calls = 0;
    hub.subscribe(() => {
      calls += 1;
    });
    const before = hub.getState();

    await hub.refresh();

    expect(hub.getState()).toBe(before);
    expect(calls).toBe(0);
  });

  test('refresh after setCounter(null) is a no-op — nudge closures outlive a fallback reset', async () => {
    const hub = createSyncStatusHub();
    hub.setCounter(async () => counts(5));
    await hub.refresh();

    hub.setCounter(null);
    const idle = hub.getState();
    await hub.refresh(); // the repo's nudge closure still fires unconditionally

    expect(hub.getState()).toBe(idle);
    expect(hub.getState().pending).toBe(0);
    expect(hub.getState().countError).toBe(false);
  });

  test('concurrent refreshes coalesce into a single trailing re-run', async () => {
    const hub = createSyncStatusHub();
    let runs = 0;
    const gates: ReturnType<typeof deferred<QueueCounts>>[] = [];
    hub.setCounter(() => {
      runs += 1;
      const gate = deferred<QueueCounts>();
      gates.push(gate);
      return gate.promise;
    });
    gates[0]!.resolve(counts(0)); // settle the setCounter-triggered install refresh
    await flush();
    expect(runs).toBe(1);

    const first = hub.refresh(); // runs=2
    void hub.refresh(); // while in flight: sets dirty
    void hub.refresh(); // still one dirty flag — coalesces
    gates[1]!.resolve(counts(4));
    await flush(); // loop notices dirty → the single trailing re-run (runs=3)
    gates[2]!.resolve(counts(7));
    await first;

    expect(runs).toBe(3); // install + in-flight run + ONE coalesced re-run
    expect(hub.getState().pending).toBe(7); // last write wins
  });

  test('epoch x coalescing: setCounter mid-flight publishes the NEW counter, never the stale result', async () => {
    const hub = createSyncStatusHub();
    const stale = deferred<QueueCounts>();
    hub.setCounter(() => stale.promise);
    const staleRefresh = hub.refresh();

    hub.setCounter(async () => counts(9)); // account switch while A's count is in flight
    stale.resolve(counts(100)); // previous user's counts resolve late
    await staleRefresh;
    await hub.refresh();

    // The stale result is discarded (epoch mismatch) and the coalesced re-run
    // re-reads the current counter — never pinned idle, never 100.
    expect(hub.getState().pending).toBe(9);
    expect(hub.getState().countError).toBe(false);
  });

  test('setCounter(null) mid-flight: the coalesced re-run finds no counter and stops cleanly', async () => {
    const hub = createSyncStatusHub();
    const stale = deferred<QueueCounts>();
    hub.setCounter(() => stale.promise);
    const staleRefresh = hub.refresh();
    void hub.refresh(); // dirty — forces a re-run after the in-flight one

    hub.setCounter(null); // sign-out/fallback while the count is in flight
    stale.resolve(counts(50));
    await staleRefresh;

    // Stale result discarded (epoch), re-run no-ops on the null counter.
    expect(hub.getState().pending).toBe(0);
    expect(hub.getState().countError).toBe(false);
  });

  test('a stale counter FAILURE is discarded silently — no warn, no countError', async () => {
    const hub = createSyncStatusHub();
    const stale = deferred<QueueCounts>();
    hub.setCounter(() => stale.promise);
    const staleRefresh = hub.refresh();

    hub.setCounter(async () => counts(3)); // new epoch owns the state now
    stale.reject(new Error('previous DB gone'));
    await staleRefresh;
    await hub.refresh();

    expect(warnSpy).not.toHaveBeenCalled();
    expect(hub.getState().countError).toBe(false);
    expect(hub.getState().pending).toBe(3);
  });

  test('counter failure: warns once, sets countError, keeps last-known counts', async () => {
    const hub = createSyncStatusHub();
    let fail = false;
    hub.setCounter(async () => {
      if (fail) throw new Error('db locked');
      return counts(6);
    });
    await hub.refresh();

    fail = true;
    await hub.refresh();
    await hub.refresh(); // second consecutive failure must not warn again

    const s = hub.getState();
    expect(s.countError).toBe(true);
    expect(s.pending).toBe(6); // retained — never a false "All saved"
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  test('recovery: a successful refresh clears countError and re-arms the warn', async () => {
    const hub = createSyncStatusHub();
    let fail = true;
    hub.setCounter(async () => {
      if (fail) throw new Error('transient');
      return counts(2);
    });
    await hub.refresh();
    expect(hub.getState().countError).toBe(true);

    fail = false;
    await hub.refresh();
    expect(hub.getState().countError).toBe(false);
    expect(hub.getState().pending).toBe(2);

    fail = true;
    await hub.refresh(); // re-armed: a fresh failure warns again

    expect(hub.getState().countError).toBe(true);
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  test('setCounter re-arms the warn without a successful count in between', async () => {
    const hub = createSyncStatusHub();
    const failing: QueueCounter = async () => {
      throw new Error('boom');
    };
    hub.setCounter(failing);
    await hub.refresh();
    expect(warnSpy).toHaveBeenCalledTimes(1);

    hub.setCounter(failing); // new epoch (e.g. account switch) re-arms
    await hub.refresh();

    expect(warnSpy).toHaveBeenCalledTimes(2);
  });
});

describe('createSyncStatusHub — attachEngine', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  test('attach publishes engine.getState() immediately and mirrors every subsequent publish', () => {
    const hub = createSyncStatusHub();
    const engine = fakeEngine({ ...IDLE_SYNC_STATE, pending: 2, syncing: true });

    hub.attachEngine(engine);

    expect(hub.getState()).toEqual({ ...engine.getState(), countError: false });

    engine.publish({ ...IDLE_SYNC_STATE, pending: 5, syncing: false, completedPulls: 1 });

    expect(hub.getState()).toEqual({
      ...IDLE_SYNC_STATE,
      pending: 5,
      syncing: false,
      completedPulls: 1,
      countError: false,
    });
  });

  test('detach unsubscribes from the engine and resets to idle', () => {
    const hub = createSyncStatusHub();
    const engine = fakeEngine({ ...IDLE_SYNC_STATE, pending: 3 });

    const detach = hub.attachEngine(engine);
    detach();

    expect(hub.getState()).toEqual({ ...IDLE_SYNC_STATE, countError: false });

    // A late-arriving engine publish after detach must not resurrect state.
    engine.publish({ ...IDLE_SYNC_STATE, pending: 99 });
    expect(hub.getState()).toEqual({ ...IDLE_SYNC_STATE, countError: false });
  });

  test('refresh() no-ops while attached — the engine drives publishes, not the hub', async () => {
    const hub = createSyncStatusHub();
    const engine = fakeEngine({ ...IDLE_SYNC_STATE, pending: 4 });
    hub.attachEngine(engine);

    const before = hub.getState();
    await hub.refresh();

    expect(hub.getState()).toBe(before); // no publish triggered by refresh()
  });

  test('detach is idempotent — a stale second call cannot stomp a later attach', () => {
    const hub = createSyncStatusHub();
    const engineA = fakeEngine({ ...IDLE_SYNC_STATE, pending: 1 });
    const detachA = hub.attachEngine(engineA);
    detachA();

    const engineB = fakeEngine({ ...IDLE_SYNC_STATE, pending: 7 });
    hub.attachEngine(engineB);
    detachA(); // stale closure re-invoked (e.g. a duplicate cleanup) — must no-op

    expect(hub.getState()).toEqual({ ...engineB.getState(), countError: false });
  });

  // #21: `publish()` wraps every subscriber call in try/catch so one bad
  // subscriber cannot break the hub or `refresh()`'s never-rejects contract.
  // That guard had no test — the suite's only `throw`s were inside QueueCounter
  // fakes, never inside a subscribe callback — so the 100%-function pin was
  // satisfied without the catch ever executing.
  describe('a throwing subscriber cannot break the hub', () => {
    // Created per-test: this project restores mocks between tests, so a spy
    // installed at describe-eval time would be torn down before it ran.
    let warn: jest.SpyInstance;
    beforeEach(() => {
      warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => warn.mockRestore());

    test('later subscribers still receive the notification', () => {
      const hub = createSyncStatusHub();
      const seen: string[] = [];
      hub.subscribe(() => seen.push('first'));
      hub.subscribe(() => {
        throw new Error('subscriber blew up');
      });
      hub.subscribe(() => seen.push('third'));

      const engine = fakeEngine({ ...IDLE_SYNC_STATE, pending: 4 });
      hub.attachEngine(engine);

      // The thrower sits between them: both neighbours must still be called.
      expect(seen).toEqual(['first', 'third']);
      expect(warn).toHaveBeenCalled();
    });

    test('state is still published and readable after a subscriber throws', () => {
      const hub = createSyncStatusHub();
      hub.subscribe(() => {
        throw new Error('subscriber blew up');
      });

      const engine = fakeEngine({ ...IDLE_SYNC_STATE, pending: 7 });
      hub.attachEngine(engine);

      expect(hub.getState().pending).toBe(7);
    });

    test('refresh() still resolves when a subscriber throws', async () => {
      const hub = createSyncStatusHub();
      hub.subscribe(() => {
        throw new Error('subscriber blew up');
      });
      const counter: QueueCounter = () => Promise.resolve({ pending: 2, parked: 1 });
      hub.setCounter(counter);

      // The never-rejects contract: a throwing subscriber must not surface as
      // a rejected refresh, and must not be misread as a count failure.
      await expect(hub.refresh()).resolves.toBeUndefined();
      expect(hub.getState().pending).toBe(2);
      expect(hub.getState().countError).toBe(false);
    });
  });

  test('epoch: a stale setCounter resolving after attachEngine is ignored', async () => {
    const hub = createSyncStatusHub();
    const stale = deferred<QueueCounts>();
    hub.setCounter(() => stale.promise);
    const staleRefresh = hub.refresh();

    const engine = fakeEngine({ ...IDLE_SYNC_STATE, pending: 9 });
    hub.attachEngine(engine); // bumps epoch — supersedes the in-flight counter run

    stale.resolve({ pending: 100, parked: 0 }); // previous producer resolves late
    await staleRefresh;

    expect(hub.getState()).toEqual({ ...engine.getState(), countError: false });
    expect(hub.getState().pending).toBe(9);
  });
});
