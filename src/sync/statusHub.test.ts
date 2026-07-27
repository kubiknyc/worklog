/**
 * statusHub is the sync pill's state spine — pinned at 95/100/95/95 in
 * package.json. Tests run against isolated `createSyncStatusHub()` instances
 * (never the app singleton) so cases cannot leak into each other.
 */
import { createSyncStatusHub } from './statusHub';
import type { QueueCounts, QueueCounter } from './types';

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
    const gates: Array<ReturnType<typeof deferred<QueueCounts>>> = [];
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
