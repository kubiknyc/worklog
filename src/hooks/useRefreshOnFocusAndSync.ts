/**
 * Refetches screen data on screen focus (expo-router's `useFocusEffect`) and
 * whenever the sync engine lands new pulled data (`SyncState.completedPulls`
 * bumps — ref-diffed against the last-seen value, never on mount before any
 * bump, and never on an unrelated hub republish that leaves `completedPulls`
 * unchanged, e.g. a pending-count change).
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';

import { useSyncStatus } from './useSyncStatus';

export function useRefreshOnFocusAndSync(refetch: () => void): void {
  const { completedPulls } = useSyncStatus();
  const lastSeenRef = useRef(completedPulls);

  useEffect(() => {
    if (completedPulls === lastSeenRef.current) return;
    lastSeenRef.current = completedPulls;
    refetch();
  }, [completedPulls, refetch]);

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch]),
  );
}
