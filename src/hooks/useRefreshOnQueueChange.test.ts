/**
 * useRefreshOnQueueChange: calls `refetch` whenever the hub's `pending`/`parked`
 * counts change (ref-diffed) — never on mount, never on a republish that leaves
 * both unchanged.
 */
import { renderHook, act } from '@testing-library/react-native';

import { IDLE_SYNC_STATE } from '../sync/engineApi';
import type { SyncEngineApi, SyncState } from '../sync/engineApi';
import { syncStatusHub } from '../sync/statusHub';

import { useRefreshOnQueueChange } from './useRefreshOnQueueChange';

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
  act(() => {
    syncStatusHub.setCounter(null);
  });
});

describe('useRefreshOnQueueChange', () => {
  test('does not call refetch on mount, even with the hub already attached', () => {
    const refetch = jest.fn();
    const engine = fakeEngine({ ...IDLE_SYNC_STATE, pending: 2, parked: 1 });
    const detach = syncStatusHub.attachEngine(engine.api);

    renderHook(() => useRefreshOnQueueChange(refetch));

    expect(refetch).not.toHaveBeenCalled();
    act(() => detach());
  });

  test('calls refetch when parked drops to 0 — the retry-unpark case', () => {
    const refetch = jest.fn();
    const engine = fakeEngine({ ...IDLE_SYNC_STATE, pending: 0, parked: 3 });
    const detach = syncStatusHub.attachEngine(engine.api);

    renderHook(() => useRefreshOnQueueChange(refetch));

    // retryParked() unparked everything; the drain has not finished yet.
    act(() => {
      engine.publish({ ...IDLE_SYNC_STATE, pending: 3, parked: 0 });
    });

    expect(refetch).toHaveBeenCalledTimes(1);
    act(() => detach());
  });

  test('calls refetch when only pending changes', () => {
    const refetch = jest.fn();
    const engine = fakeEngine({ ...IDLE_SYNC_STATE, pending: 3, parked: 0 });
    const detach = syncStatusHub.attachEngine(engine.api);

    renderHook(() => useRefreshOnQueueChange(refetch));

    act(() => {
      engine.publish({ ...IDLE_SYNC_STATE, pending: 2, parked: 0 });
    });

    expect(refetch).toHaveBeenCalledTimes(1);
    act(() => detach());
  });

  test('does not call refetch when both counts are unchanged', () => {
    const refetch = jest.fn();
    const engine = fakeEngine({ ...IDLE_SYNC_STATE, pending: 1, parked: 1 });
    const detach = syncStatusHub.attachEngine(engine.api);

    renderHook(() => useRefreshOnQueueChange(refetch));

    act(() => {
      // Unrelated field moves; the queue itself did not change.
      engine.publish({ ...IDLE_SYNC_STATE, pending: 1, parked: 1, syncing: true });
    });

    expect(refetch).not.toHaveBeenCalled();
    act(() => detach());
  });

  test('calls refetch again on each later distinct change', () => {
    const refetch = jest.fn();
    const engine = fakeEngine({ ...IDLE_SYNC_STATE, pending: 3, parked: 0 });
    const detach = syncStatusHub.attachEngine(engine.api);

    renderHook(() => useRefreshOnQueueChange(refetch));

    act(() => {
      engine.publish({ ...IDLE_SYNC_STATE, pending: 2, parked: 0 });
    });
    act(() => {
      engine.publish({ ...IDLE_SYNC_STATE, pending: 1, parked: 0 });
    });

    expect(refetch).toHaveBeenCalledTimes(2);
    act(() => detach());
  });
});
