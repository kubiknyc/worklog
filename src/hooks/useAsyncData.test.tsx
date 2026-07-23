import { act, renderHook, waitFor } from '@testing-library/react-native';

import { useAsyncData, type AsyncData } from './useAsyncData';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

// The loader is an inline closure (as real callers write it) so useCallback keyed
// on deps yields a fresh identity when deps change and the reload effect re-fires.
describe('useAsyncData clearOnReload', () => {
  it('clears data on a deps change when clearOnReload is set', async () => {
    let d = deferred<string>();
    const { result, rerender } = renderHook<AsyncData<string>, { dep: number }>(
      ({ dep }) => useAsyncData(() => d.promise, [dep], { clearOnReload: true }),
      { initialProps: { dep: 1 } },
    );

    await act(async () => {
      d.resolve('first');
    });
    await waitFor(() => expect(result.current.data).toBe('first'));

    // Deps change → reload. With clearOnReload, stale data is dropped immediately.
    d = deferred<string>();
    act(() => rerender({ dep: 2 }));
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(true);

    await act(async () => {
      d.resolve('second');
    });
    await waitFor(() => expect(result.current.data).toBe('second'));
  });

  it('retains stale data on a deps change when clearOnReload is not set', async () => {
    let d = deferred<string>();
    const { result, rerender } = renderHook<AsyncData<string>, { dep: number }>(
      ({ dep }) => useAsyncData(() => d.promise, [dep]),
      { initialProps: { dep: 1 } },
    );

    await act(async () => {
      d.resolve('first');
    });
    await waitFor(() => expect(result.current.data).toBe('first'));

    d = deferred<string>();
    act(() => rerender({ dep: 2 }));
    // Previous deps' data stays mounted until the new load resolves.
    expect(result.current.data).toBe('first');

    await act(async () => {
      d.resolve('second');
    });
    await waitFor(() => expect(result.current.data).toBe('second'));
  });

  it('does not clear data on refresh() or the silent reload()', async () => {
    let d = deferred<string>();
    const { result } = renderHook<AsyncData<string>, { dep: number }>(
      ({ dep }) => useAsyncData(() => d.promise, [dep], { clearOnReload: true }),
      { initialProps: { dep: 1 } },
    );

    await act(async () => {
      d.resolve('first');
    });
    await waitFor(() => expect(result.current.data).toBe('first'));

    // refresh(): data stays while the new request is in flight.
    d = deferred<string>();
    act(() => result.current.refresh());
    expect(result.current.data).toBe('first');
    expect(result.current.refreshing).toBe(true);
    await act(async () => {
      d.resolve('second');
    });
    await waitFor(() => expect(result.current.data).toBe('second'));

    // reload(): silent — no flag flips, no data clearing.
    d = deferred<string>();
    act(() => result.current.reload());
    expect(result.current.data).toBe('second');
    expect(result.current.loading).toBe(false);
    expect(result.current.refreshing).toBe(false);
    await act(async () => {
      d.resolve('third');
    });
    await waitFor(() => expect(result.current.data).toBe('third'));
  });
});
