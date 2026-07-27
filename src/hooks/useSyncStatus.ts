/**
 * Subscribe to the app-wide sync status hub. Returns the current published
 * `HubSyncState`; re-renders on every hub notification (each queue recount).
 */
import { useSyncExternalStore } from 'react';

import { syncStatusHub } from '../sync/statusHub';
import type { HubSyncState } from '../sync/statusHub';

export function useSyncStatus(): HubSyncState {
  return useSyncExternalStore(
    syncStatusHub.subscribe,
    syncStatusHub.getState,
    syncStatusHub.getState,
  );
}
