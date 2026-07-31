/**
 * Wiring test for `createSyncEngine`: NetInfo/AppState triggers and the
 * bounded backoff ladder. `createEngineCore` is mocked out entirely — the
 * drain-loop policy it implements is exercised on its own in
 * engineCore.test.ts — so this file only proves the shell wires triggers and
 * timers correctly around whatever `core.run()`/`core.getState()` report.
 */
import { AppState } from 'react-native';

import { createSyncEngine } from './engine.native';
import { createEngineCore } from './engineCore';
import type { EngineCore, EngineDeps } from './engineCore';
import { createPuller } from './pull.native';
import { first, run as runSql } from '../db/rows.native';
import { newMutation } from './mutationQueue';
import type { Mutation, MutationPayload } from './types';
import type { SyncState } from './engineApi';
import type { Db } from '../db/rows.native';

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { addEventListener: jest.fn() },
}));

jest.mock('../supabase/client', () => ({
  supabase: { rpc: jest.fn() },
}));

jest.mock('./store.native', () => ({
  createMutationStore: jest.fn(() => ({})),
  clearDirty: jest.fn(),
  deleteLocalReport: jest.fn(),
}));

jest.mock('./push.native', () => ({
  createPusher: jest.fn(() => jest.fn()),
}));

jest.mock('./pull.native', () => ({
  createPuller: jest.fn(() => jest.fn()),
}));

jest.mock('../db/rows.native', () => ({
  first: jest.fn(),
  run: jest.fn(),
}));

jest.mock('./engineCore', () => ({
  createEngineCore: jest.fn(),
}));

jest.mock('../lib/observability.native', () => ({
  reportSyncIncident: jest.fn(),
}));

const mockCreateEngineCore = createEngineCore as jest.MockedFunction<typeof createEngineCore>;
const mockCreatePuller = createPuller as jest.MockedFunction<typeof createPuller>;
const mockFirst = first as jest.MockedFunction<typeof first>;
const mockRun = runSql as jest.MockedFunction<typeof runSql>;

/** The deps object the shell handed to `createEngineCore` on the last build. */
function lastCoreDeps(): EngineDeps {
  const call = mockCreateEngineCore.mock.calls.at(-1);
  if (!call) throw new Error('createEngineCore was never called');
  return call[0];
}

/**
 * Not imported by name (`@react-native-community/netinfo`) anywhere in this
 * file — `platformSplit.test.ts` forbids that outside `*.native.ts(x)` and a
 * `.native.test.ts` file doesn't qualify. `jest.requireMock` on the literal
 * module id reaches the mock registered above without a static import.
 */
interface NetInfoMock {
  addEventListener: jest.Mock;
}
const NetInfo = jest.requireMock('@react-native-community/netinfo').default as NetInfoMock;

const IDLE: SyncState = {
  online: true,
  syncing: false,
  pending: 0,
  parked: 0,
  lastError: null,
  completedPulls: 0,
  reparents: 0,
};

function makeState(overrides: Partial<SyncState>): SyncState {
  return { ...IDLE, ...overrides };
}

interface Harness {
  readonly core: jest.Mocked<EngineCore>;
  readonly netInfoUnsubscribe: jest.Mock;
  readonly appStateRemove: jest.Mock;
  netInfoListener: (state: { isConnected: boolean | null }) => void;
  appStateListener: (status: string) => void;
}

function setupHarness(initialState: SyncState = IDLE): Harness {
  const core: jest.Mocked<EngineCore> = {
    getState: jest.fn(() => initialState),
    subscribe: jest.fn((_fn: (s: SyncState) => void) => jest.fn()),
    run: jest.fn().mockResolvedValue(undefined),
    retryParked: jest.fn().mockResolvedValue(undefined),
    discardParked: jest.fn().mockResolvedValue(0),
  };
  mockCreateEngineCore.mockReturnValue(core);

  const netInfoUnsubscribe = jest.fn();
  let netInfoListener: Harness['netInfoListener'] = () => {};
  (NetInfo.addEventListener as jest.Mock).mockImplementation((cb: typeof netInfoListener) => {
    netInfoListener = cb;
    // Real NetInfo fires the current state synchronously-ish on subscribe.
    cb({ isConnected: true });
    return netInfoUnsubscribe;
  });

  const appStateRemove = jest.fn();
  let appStateListener: Harness['appStateListener'] = () => {};
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, cb) => {
    appStateListener = cb as Harness['appStateListener'];
    return { remove: appStateRemove } as never;
  });

  return {
    core,
    netInfoUnsubscribe,
    appStateRemove,
    get netInfoListener() {
      return netInfoListener;
    },
    set netInfoListener(fn) {
      netInfoListener = fn;
    },
    get appStateListener() {
      return appStateListener;
    },
    set appStateListener(fn) {
      appStateListener = fn;
    },
  };
}

const FAKE_DB = {} as Db;
const SESSION_USER_ID = 'user-1';

function sectionPayload(reportId: string): MutationPayload {
  return {
    kind: 'update_section',
    data: { reportId, section: 'crew', content: {}, isComplete: false },
  };
}

function photoPayload(reportId: string, projectId: string): MutationPayload {
  return {
    kind: 'add_photo',
    data: {
      photoId: 'ph1',
      reportId,
      projectId,
      storagePath: `${projectId}/${reportId}/ph1.jpg`,
      localUri: 'file://x',
      width: 10,
      height: 10,
      capturedAt: null,
      exifDateTimeOriginal: null,
      gpsLat: null,
      gpsLng: null,
      gpsAccuracy: null,
      source: 'camera',
      tradeTag: null,
      locationTag: null,
      caption: null,
    },
  };
}

function mutationOf(payload: MutationPayload): Mutation {
  return newMutation('c1', payload, '2026-07-30T00:00:00Z');
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('createSyncEngine — start()', () => {
  test('subscribes to NetInfo + AppState and kicks exactly one run (no NetInfo-initial double-run)', async () => {
    const h = setupHarness();
    const engine = createSyncEngine(FAKE_DB, SESSION_USER_ID);

    engine.start();
    await Promise.resolve();
    await Promise.resolve();

    expect(h.core.run).toHaveBeenCalledTimes(1);
  });

  test('offline→online NetInfo edge triggers a run', async () => {
    const h = setupHarness();
    const engine = createSyncEngine(FAKE_DB, SESSION_USER_ID);

    engine.start();
    await Promise.resolve();
    h.core.run.mockClear();

    h.netInfoListener({ isConnected: false });
    h.netInfoListener({ isConnected: true });
    await Promise.resolve();

    expect(h.core.run).toHaveBeenCalledTimes(1);
  });

  test('AppState active triggers a run', async () => {
    const h = setupHarness();
    const engine = createSyncEngine(FAKE_DB, SESSION_USER_ID);

    engine.start();
    await Promise.resolve();
    h.core.run.mockClear();

    h.appStateListener('active');
    await Promise.resolve();

    expect(h.core.run).toHaveBeenCalledTimes(1);
  });
});

describe('createSyncEngine — backoff ladder', () => {
  test('a failing cycle (arm 1: server error while online) schedules exactly one timer at 30s, then 2m, then 10m', async () => {
    const h = setupHarness();
    h.core.getState.mockReturnValue(makeState({ pending: 1, lastError: 'boom', online: true }));
    const engine = createSyncEngine(FAKE_DB, SESSION_USER_ID);

    engine.start();
    await Promise.resolve();
    h.core.run.mockClear();

    expect(jest.getTimerCount()).toBe(1);

    jest.advanceTimersByTime(30_000);
    await Promise.resolve();
    expect(h.core.run).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(1); // rescheduled once more, not stacked

    jest.advanceTimersByTime(120_000);
    await Promise.resolve();
    expect(h.core.run).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(600_000);
    await Promise.resolve();
    expect(h.core.run).toHaveBeenCalledTimes(3);

    jest.advanceTimersByTime(600_000);
    await Promise.resolve();
    expect(h.core.run).toHaveBeenCalledTimes(4); // clamps at the ladder ceiling
  });

  test('arm 2: offline with NetInfo still reporting connected (captive portal) schedules a timer', async () => {
    const h = setupHarness();
    h.core.getState.mockReturnValue(makeState({ pending: 1, lastError: null, online: false }));
    const engine = createSyncEngine(FAKE_DB, SESSION_USER_ID);

    engine.start(); // NetInfo fires isConnected: true on subscribe
    await Promise.resolve();

    expect(jest.getTimerCount()).toBe(1);
  });

  test('a clean cycle resets the ladder and schedules no timer', async () => {
    setupHarness();
    const engine = createSyncEngine(FAKE_DB, SESSION_USER_ID);

    engine.start();
    await Promise.resolve();

    expect(jest.getTimerCount()).toBe(0);
  });

  test('an earlier trigger (foreground) supersedes a pending backoff timer', async () => {
    const h = setupHarness();
    h.core.getState.mockReturnValue(makeState({ pending: 1, lastError: 'boom', online: true }));
    const engine = createSyncEngine(FAKE_DB, SESSION_USER_ID);

    engine.start();
    await Promise.resolve();
    h.core.run.mockClear();
    expect(jest.getTimerCount()).toBe(1);

    h.appStateListener('active');
    await Promise.resolve();

    expect(h.core.run).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(1); // rescheduled fresh, still exactly one
  });
});

describe('createSyncEngine — stop()', () => {
  test('clears NetInfo/AppState subscriptions and any pending timer', async () => {
    const h = setupHarness();
    h.core.getState.mockReturnValue(makeState({ pending: 1, lastError: 'boom', online: true }));
    const engine = createSyncEngine(FAKE_DB, SESSION_USER_ID);

    engine.start();
    await Promise.resolve();
    expect(jest.getTimerCount()).toBe(1);

    engine.stop();

    expect(h.netInfoUnsubscribe).toHaveBeenCalledTimes(1);
    expect(h.appStateRemove).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('stop() while a run is in flight prevents its resolve from re-arming the backoff timer', async () => {
    const h = setupHarness();
    h.core.getState.mockReturnValue(makeState({ pending: 1, lastError: 'boom', online: true }));
    let resolveRun: () => void = () => {};
    h.core.run.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveRun = resolve;
        }),
    );
    const engine = createSyncEngine(FAKE_DB, SESSION_USER_ID);

    engine.start(); // kicks a run that never resolves until we say so
    await Promise.resolve();

    engine.stop(); // stop fires while that run is still in flight
    resolveRun(); // the in-flight run now resolves, after stop()
    await Promise.resolve();
    await Promise.resolve();

    expect(jest.getTimerCount()).toBe(0); // no zombie backoff timer re-armed
  });
});

describe('createSyncEngine — pull wiring', () => {
  test('builds a puller over the shared client + db and hands it to the core with the session user', () => {
    setupHarness();
    const puller = jest.fn();
    mockCreatePuller.mockReturnValue(puller);

    createSyncEngine(FAKE_DB, SESSION_USER_ID);

    expect(mockCreatePuller).toHaveBeenCalledTimes(1);
    expect(mockCreatePuller.mock.calls[0]![1]).toBe(FAKE_DB);
    expect(lastCoreDeps().pull).toBe(puller);
    expect(lastCoreDeps().sessionUserId).toBe(SESSION_USER_ID);
  });

  test('hands the puller a cancellation predicate that tracks stop()/start()', () => {
    setupHarness();
    const engine = createSyncEngine(FAKE_DB, SESSION_USER_ID);
    const isCancelled = mockCreatePuller.mock.calls[0]![2]!;

    expect(isCancelled()).toBe(false);
    engine.start();
    expect(isCancelled()).toBe(false);
    engine.stop();
    expect(isCancelled()).toBe(true);
    engine.start();
    expect(isCancelled()).toBe(false);
  });

  test('stop() during an in-flight cycle flips the predicate the running pull is consulting', async () => {
    const h = setupHarness();
    const engine = createSyncEngine(FAKE_DB, SESSION_USER_ID);
    const isCancelled = mockCreatePuller.mock.calls[0]![2]!;

    let observedMidRun: boolean | null = null;
    let finishRun: () => void = () => {};
    h.core.run.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishRun = () => {
            // What the puller's own phase check would read at this instant.
            observedMidRun = isCancelled();
            resolve();
          };
        }),
    );

    engine.start();
    await Promise.resolve();
    expect(isCancelled()).toBe(false); // pull is free to write while running

    engine.stop(); // sign-out lands mid-cycle
    finishRun();
    await Promise.resolve();

    expect(observedMidRun).toBe(true); // every remaining phase abandons its writes
  });

  test('a null sessionUserId still builds a working push-only engine (pull left unarmed)', async () => {
    const h = setupHarness();

    const engine = createSyncEngine(FAKE_DB, null);
    engine.start();
    await Promise.resolve();

    expect(lastCoreDeps().sessionUserId).toBeNull();
    expect(h.core.run).toHaveBeenCalledTimes(1); // pushes still drain
  });
});

describe('createSyncEngine — 403-evict sweep-due flag', () => {
  test('an evicted incident whose payload carries no projectId resolves it via daily_reports and writes the flag', async () => {
    setupHarness();
    mockFirst.mockResolvedValue({ project_id: 'proj-9' });
    createSyncEngine(FAKE_DB, SESSION_USER_ID);

    lastCoreDeps().onIncident('evicted', mutationOf(sectionPayload('r1')), { status: 403 });
    await Promise.resolve();
    await Promise.resolve();

    expect(mockFirst).toHaveBeenCalledWith(FAKE_DB, expect.stringContaining('daily_reports'), [
      'r1',
    ]);
    expect(mockRun).toHaveBeenCalledWith(
      FAKE_DB,
      expect.stringContaining('sync_meta'),
      expect.arrayContaining(['pull_sweep_due:proj-9']),
    );
  });

  test('a payload carrying projectId writes the flag without touching daily_reports', async () => {
    setupHarness();
    createSyncEngine(FAKE_DB, SESSION_USER_ID);

    lastCoreDeps().onIncident('evicted', mutationOf(photoPayload('r1', 'proj-2')), {
      status: 403,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(mockFirst).not.toHaveBeenCalled();
    expect(mockRun).toHaveBeenCalledWith(
      FAKE_DB,
      expect.any(String),
      expect.arrayContaining(['pull_sweep_due:proj-2']),
    );
  });

  test('a missing local report row writes nothing and never throws', async () => {
    setupHarness();
    mockFirst.mockResolvedValue(undefined);
    createSyncEngine(FAKE_DB, SESSION_USER_ID);

    lastCoreDeps().onIncident('evicted', mutationOf(sectionPayload('gone')), { status: 403 });
    await Promise.resolve();
    await Promise.resolve();

    expect(mockRun).not.toHaveBeenCalled();
  });

  test('a throwing lookup is swallowed (fire-and-forget, no unhandled rejection)', async () => {
    setupHarness();
    mockFirst.mockRejectedValue(new Error('db closed'));
    createSyncEngine(FAKE_DB, SESSION_USER_ID);

    expect(() =>
      lastCoreDeps().onIncident('evicted', mutationOf(sectionPayload('r1')), { status: 403 }),
    ).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockRun).not.toHaveBeenCalled();
  });

  test('a "parked" incident is reported but arms no sweep flag', async () => {
    setupHarness();
    createSyncEngine(FAKE_DB, SESSION_USER_ID);

    lastCoreDeps().onIncident('parked', mutationOf(photoPayload('r1', 'proj-2')), {
      status: 500,
    });
    await Promise.resolve();

    expect(mockRun).not.toHaveBeenCalled();
  });
});

describe('createSyncEngine — backoff arm 1 with an empty queue', () => {
  test('a non-offline server failure (online:true, pending:0, lastError set) still arms the ladder', async () => {
    const h = setupHarness();
    // The RLS/grant/floor class: the pull refused, the queue is empty, and no
    // enqueue or NetInfo edge is ever coming back to it.
    h.core.getState.mockReturnValue(makeState({ pending: 0, lastError: 'boom', online: true }));
    const engine = createSyncEngine(FAKE_DB, SESSION_USER_ID);

    engine.start();
    await Promise.resolve();

    expect(jest.getTimerCount()).toBe(1);

    jest.advanceTimersByTime(30_000);
    await Promise.resolve();
    expect(h.core.run).toHaveBeenCalledTimes(2); // the ladder actually retries it
  });

  test('a clean cycle with an empty queue still schedules nothing', async () => {
    const h = setupHarness();
    h.core.getState.mockReturnValue(makeState({ pending: 0, lastError: null, online: true }));
    const engine = createSyncEngine(FAKE_DB, SESSION_USER_ID);

    engine.start();
    await Promise.resolve();

    expect(jest.getTimerCount()).toBe(0);
    expect(h.core.run).toHaveBeenCalledTimes(1);
  });
});

describe('createSyncEngine — backoff arm 2 with an empty queue', () => {
  test('an offline-classified pull failure (online:false, pending:0) still arms the ladder while NetInfo reports connected', async () => {
    const h = setupHarness();
    h.core.getState.mockReturnValue(makeState({ pending: 0, lastError: null, online: false }));
    const engine = createSyncEngine(FAKE_DB, SESSION_USER_ID);

    engine.start(); // NetInfo fires isConnected: true on subscribe
    await Promise.resolve();

    expect(jest.getTimerCount()).toBe(1);
  });

  test('no timer when NetInfo itself reports disconnected (deliberate radio quiet)', async () => {
    const h = setupHarness();
    h.core.getState.mockReturnValue(makeState({ pending: 0, lastError: null, online: false }));
    const engine = createSyncEngine(FAKE_DB, SESSION_USER_ID);

    engine.start();
    await Promise.resolve();
    h.netInfoListener({ isConnected: false });
    jest.advanceTimersByTime(30_000);
    await Promise.resolve();

    // The NetInfo-disconnected edge fires no trigger; the run that resolves
    // after it re-evaluates the arms and finds neither holds.
    await Promise.resolve();
    expect(jest.getTimerCount()).toBe(0);
  });
});
