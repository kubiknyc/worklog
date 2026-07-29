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
import type { EngineCore } from './engineCore';
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

jest.mock('./engineCore', () => ({
  createEngineCore: jest.fn(),
}));

jest.mock('../lib/observability.native', () => ({
  reportSyncIncident: jest.fn(),
}));

const mockCreateEngineCore = createEngineCore as jest.MockedFunction<typeof createEngineCore>;

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
    const engine = createSyncEngine(FAKE_DB);

    engine.start();
    await Promise.resolve();
    await Promise.resolve();

    expect(h.core.run).toHaveBeenCalledTimes(1);
  });

  test('offline→online NetInfo edge triggers a run', async () => {
    const h = setupHarness();
    const engine = createSyncEngine(FAKE_DB);

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
    const engine = createSyncEngine(FAKE_DB);

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
    const engine = createSyncEngine(FAKE_DB);

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
    const engine = createSyncEngine(FAKE_DB);

    engine.start(); // NetInfo fires isConnected: true on subscribe
    await Promise.resolve();

    expect(jest.getTimerCount()).toBe(1);
  });

  test('a clean cycle resets the ladder and schedules no timer', async () => {
    setupHarness();
    const engine = createSyncEngine(FAKE_DB);

    engine.start();
    await Promise.resolve();

    expect(jest.getTimerCount()).toBe(0);
  });

  test('an earlier trigger (foreground) supersedes a pending backoff timer', async () => {
    const h = setupHarness();
    h.core.getState.mockReturnValue(makeState({ pending: 1, lastError: 'boom', online: true }));
    const engine = createSyncEngine(FAKE_DB);

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
    const engine = createSyncEngine(FAKE_DB);

    engine.start();
    await Promise.resolve();
    expect(jest.getTimerCount()).toBe(1);

    engine.stop();

    expect(h.netInfoUnsubscribe).toHaveBeenCalledTimes(1);
    expect(h.appStateRemove).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });
});
