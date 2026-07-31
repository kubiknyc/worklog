/**
 * useRefreshOnFocusAndSync: calls `refetch` on screen focus (expo-router's
 * useFocusEffect) and whenever the hub's `completedPulls` CHANGES (ref-diffed
 * against the last-seen value) — never on mount before any bump, and never on
 * a same-value republish (an unrelated HubSyncState field changing).
 */
import { act, renderHook } from '@testing-library/react-native';

let focusCallback: (() => void) | null = null;
const mockUseFocusEffect = jest.fn((cb: () => void) => {
  focusCallback = cb;
});
jest.mock('expo-router', () => ({
  useFocusEffect: (cb: () => void) => mockUseFocusEffect(cb),
}));

// eslint-disable-next-line import/first
import { IDLE_SYNC_STATE } from '../sync/engineApi';
// eslint-disable-next-line import/first
import type { SyncEngineApi, SyncState } from '../sync/engineApi';
// eslint-disable-next-line import/first
import { syncStatusHub } from '../sync/statusHub';
// eslint-disable-next-line import/first
import { useRefreshOnFocusAndSync } from './useRefreshOnFocusAndSync';

function fakeEngine(initial: SyncState) {
  let state = initial;
  const listeners = new Set<(s: SyncState) => void>();
  const api: Pick<SyncEngineApi, 'getState' | 'subscribe'> = {
    getState: () => state,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  return {
    api,
    publish(next: SyncState) {
      state = next;
      for (const fn of listeners) fn(next);
    },
  };
}

afterEach(() => {
  jest.clearAllMocks();
  focusCallback = null;
  act(() => {
    syncStatusHub.setCounter(null);
  });
});

describe('useRefreshOnFocusAndSync', () => {
  test('does not call refetch on mount, even with the hub already attached', () => {
    const refetch = jest.fn();
    const engine = fakeEngine(IDLE_SYNC_STATE);
    const detach = syncStatusHub.attachEngine(engine.api);

    renderHook(() => useRefreshOnFocusAndSync(refetch));

    expect(refetch).not.toHaveBeenCalled();
    act(() => detach());
  });

  test('calls refetch when completedPulls bumps', () => {
    const refetch = jest.fn();
    const engine = fakeEngine(IDLE_SYNC_STATE);
    const detach = syncStatusHub.attachEngine(engine.api);

    renderHook(() => useRefreshOnFocusAndSync(refetch));

    act(() => {
      engine.publish({ ...IDLE_SYNC_STATE, completedPulls: 1 });
    });
    expect(refetch).toHaveBeenCalledTimes(1);

    act(() => detach());
  });

  test('does not call refetch on a republish that leaves completedPulls unchanged', () => {
    const refetch = jest.fn();
    const engine = fakeEngine({ ...IDLE_SYNC_STATE, completedPulls: 1 });
    const detach = syncStatusHub.attachEngine(engine.api);

    renderHook(() => useRefreshOnFocusAndSync(refetch));

    act(() => {
      // Same completedPulls, unrelated field changes (e.g. pending count) —
      // must not fire the sync-half of the hook.
      engine.publish({ ...IDLE_SYNC_STATE, completedPulls: 1, pending: 3 });
    });
    expect(refetch).not.toHaveBeenCalled();

    act(() => detach());
  });

  test('calls refetch again on a later, distinct completedPulls bump', () => {
    const refetch = jest.fn();
    const engine = fakeEngine(IDLE_SYNC_STATE);
    const detach = syncStatusHub.attachEngine(engine.api);

    renderHook(() => useRefreshOnFocusAndSync(refetch));

    act(() => {
      engine.publish({ ...IDLE_SYNC_STATE, completedPulls: 1 });
    });
    act(() => {
      engine.publish({ ...IDLE_SYNC_STATE, completedPulls: 2 });
    });
    expect(refetch).toHaveBeenCalledTimes(2);

    act(() => detach());
  });

  test('calls refetch on screen focus via expo-router useFocusEffect', () => {
    const refetch = jest.fn();
    renderHook(() => useRefreshOnFocusAndSync(refetch));

    expect(focusCallback).not.toBeNull();
    act(() => {
      focusCallback?.();
    });
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
