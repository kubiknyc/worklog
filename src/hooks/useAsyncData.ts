/**
 * Generic async-data loader backing every read-only screen.
 *
 * Loads on mount and whenever `deps` change (`loading` flips during these).
 * `refresh()` re-runs the loader for pull-to-refresh, toggling `refreshing`
 * instead of `loading`. `reload()` re-runs it silently (no flag flips) — for
 * focus regains and background-sync completions, where a spinner would be
 * noise. A monotonic generation counter discards stale results so a superseded
 * request can never overwrite a newer one (or write post-unmount).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface AsyncData<T> {
  readonly data: T | null;
  readonly loading: boolean;
  readonly error: Error | null;
  readonly refreshing: boolean;
  readonly refresh: () => void;
  /** Re-run the loader without toggling `loading`/`refreshing`. */
  readonly reload: () => void;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error('Something went wrong.');
}

export interface UseAsyncDataOptions {
  /**
   * Clear `data` to null when a dep change triggers a reload, so the screen
   * shows its loading state instead of the previous deps' stale data. Opt-in:
   * leave off for secondary loaders (avatars, contacts) that render `data`
   * directly with no loading guard and should not flicker to empty. Does not
   * affect `refresh()` or the silent `reload()`.
   */
  readonly clearOnReload?: boolean;
}

export function useAsyncData<T>(
  loader: () => Promise<T>,
  deps: readonly unknown[],
  options?: UseAsyncDataOptions,
): AsyncData<T> {
  const clearOnReload = options?.clearOnReload ?? false;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const genRef = useRef(0);
  const mountedRef = useRef(true);
  // Re-bind the loader to the caller-supplied deps; the spread is intentional.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const boundLoader = useCallback(loader, deps);

  const execute = useCallback(
    (mode: 'load' | 'refresh' | 'silent') => {
      const gen = ++genRef.current;
      if (mode === 'load') {
        setLoading(true);
        // Drop stale data so a deps change shows the skeleton, not the prior
        // deps' result (opt-in — see clearOnReload).
        if (clearOnReload) setData(null);
      } else if (mode === 'refresh') setRefreshing(true);
      setError(null);

      boundLoader()
        .then((result) => {
          if (mountedRef.current && gen === genRef.current) setData(result);
        })
        .catch((err: unknown) => {
          if (mountedRef.current && gen === genRef.current) setError(toError(err));
        })
        .finally(() => {
          if (mountedRef.current && gen === genRef.current) {
            setLoading(false);
            setRefreshing(false);
          }
        });
    },
    [boundLoader, clearOnReload],
  );

  useEffect(() => {
    mountedRef.current = true;
    execute('load');
    return () => {
      mountedRef.current = false;
    };
  }, [execute]);

  const refresh = useCallback(() => execute('refresh'), [execute]);
  const reload = useCallback(() => execute('silent'), [execute]);

  return { data, loading, error, refreshing, refresh, reload };
}
