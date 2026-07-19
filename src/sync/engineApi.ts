/**
 * Pure engine surface — the slice the UI and platform layer depend on, with no
 * native imports. `engine.native`'s `SyncEngine` implements it; `platformRepo.web`
 * references only this type so the web bundle never pulls in native sync code.
 */
export interface SyncState {
  readonly online: boolean;
  readonly syncing: boolean;
  /** Mutations queued for the next sync. */
  readonly pending: number;
  /** Mutations that hit a permanent error / the retry ceiling — need attention. */
  readonly parked: number;
  readonly lastError: string | null;
  /**
   * Bumped after every successful pull. Screens subscribe to this to refetch
   * when a background sync lands new server data (see useRefreshOnFocusAndSync).
   */
  readonly completedPulls: number;
}

export interface SyncEngineApi {
  /** Subscribe NetInfo/AppState triggers and kick the first sync. */
  start(): void;
  /** Tear down listeners + any pending debounce (call on provider unmount). */
  stop(): void;
  getState(): SyncState;
  subscribe(fn: (s: SyncState) => void): () => void;
  run(): Promise<void>;
  /** Re-queue every parked mutation and sync (explicit user retry). */
  retryParked(): Promise<void>;
}

export const IDLE_SYNC_STATE: SyncState = {
  online: true,
  syncing: false,
  pending: 0,
  parked: 0,
  lastError: null,
  completedPulls: 0,
};
