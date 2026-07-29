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
  /**
   * Bumped once per same-day-collision reparent (Task 5's engine core).
   * Monotone across every publish — never reset — so `useReparentRedirect`
   * can diff against its last-seen value and never observes a rollback.
   */
  readonly reparents: number;
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
  /**
   * Discard one parked mutation (Task 8's unwedging surface). Returns the
   * affected-row count so the caller can tell a real discard (1) from a
   * guard-won no-op (0, e.g. a racing fresh edit already un-parked the row).
   */
  discardParked(clientId: string): Promise<number>;
}

export const IDLE_SYNC_STATE: SyncState = {
  online: true,
  syncing: false,
  pending: 0,
  parked: 0,
  lastError: null,
  completedPulls: 0,
  reparents: 0,
};
