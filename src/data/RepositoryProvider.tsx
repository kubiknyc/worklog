/**
 * Dependency-injects the active Repository (M1: listProjects, getReportByDate).
 *
 * Web stays online-only and synchronous: the Supabase repo is the initial
 * state, so the first render never blocks. Native gates children behind an
 * async hydration step (open the device DB via platformRepo.native's
 * openDb()) — a fast local open, not a network wait. `./platformRepo`
 * resolves to the native or web implementation via the project's
 * `moduleSuffixes` (tsconfig) / Metro platform resolution, mirroring
 * PunchLog's split idiom.
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';

import { useAuth } from '../auth';
import { syncStatusHub } from '../sync/statusHub';
import type { SyncEngineApi } from '../sync/engineApi';
import { useTheme } from '../theme';
import { createPlatformRepository } from './platformRepo';
import type { Repository } from './types';
import { supabaseRepository } from './supabaseRepo';

/**
 * Sync actions exposed to screens (e.g. the parked-mutations unwedging UI).
 * No-ops on web / before the engine attaches — `discardSync`'s `0` return
 * mirrors `SyncEngineApi.discardParked`'s "no-op, not a real discard" signal.
 */
export interface SyncActions {
  retrySync(): Promise<void>;
  discardSync(clientId: string): Promise<number>;
  /**
   * True once this provider instance has fallen back to the online-only
   * Supabase repository (device DB open failed). REACT STATE, not just the
   * module-level `didFallBackToOnlineOnly()` flag below — the banner needs to
   * re-render the moment the fallback catch fires, and a plain module
   * variable can't trigger that.
   */
  readonly degraded: boolean;
}

const noopSyncActions: SyncActions = {
  retrySync: () => Promise.resolve(),
  discardSync: () => Promise.resolve(0),
  degraded: false,
};

const SyncActionsContext = createContext<SyncActions>(noopSyncActions);

export function useSyncActions(): SyncActions {
  return useContext(SyncActionsContext);
}

const missingProvider = new Proxy({} as Repository, {
  get() {
    throw new Error('useRepository must be used within a RepositoryProvider');
  },
});
const RepositoryContext = createContext<Repository>(missingProvider);

// Set when the native device DB fails to open and the app falls back to the
// online-only Supabase repository. M3's sync-status surface should read this
// (via didFallBackToOnlineOnly()) so the degraded offline posture is visible
// to the user instead of silently behaving like a web build.
let fellBackToOnlineOnly = false;

/** True once `createPlatformRepository()` has failed and the app is running
 * on the online-only Supabase repository instead of the device SQLite DB. */
export function didFallBackToOnlineOnly(): boolean {
  return fellBackToOnlineOnly;
}

interface Props {
  readonly children: ReactNode;
  /** Override for tests or explicit per-platform selection. */
  readonly repository?: Repository;
}

export function RepositoryProvider({ children, repository }: Props) {
  const override = repository ?? null;
  // The native repo is scoped to the signed-in user: createPlatformRepository()
  // runs reconcileDbOwnership(), which wipes a previous owner's cached rows
  // before any read/write can touch them. Keying the (re)build on userId is
  // what closes the in-process account-switch leak — a sign-out -> different-
  // user sign-in must rebuild, or the new user inherits the old user's cache.
  const { userId } = useAuth();
  const [resolved, setResolved] = useState<Repository | null>(() => {
    if (override) return override;
    // Web is online-only: ready on first render, no hydration gate.
    if (Platform.OS === 'web') return supabaseRepository;
    return null;
  });

  // The current engine (null on web, before hydration, or after a fallback)
  // and its statusHub detach fn. Read by the stable `syncActions` delegators
  // below — a ref (not state) so the action functions never need to change
  // identity as the repo/engine is rebuilt across account switches.
  const engineRef = useRef<SyncEngineApi | null>(null);
  const detachRef = useRef<(() => void) | null>(null);
  // React-state mirror of `fellBackToOnlineOnly` (module-level, below) — the
  // banner's `degraded` row must re-render the instant the fallback catch
  // fires, which a plain module variable can't do.
  const [degraded, setDegraded] = useState(false);

  useEffect(() => {
    // Override (tests/explicit) and web (online-only, RLS-enforced, no local
    // cache to reconcile) never rebuild on account change.
    if (override || Platform.OS === 'web') return;

    let active = true;
    // Gate children while the switch reconciles ownership, so the previous
    // user's repository is never readable during the rebuild.
    setResolved(null);
    // userId arms the engine's pull phase (null signed-out → push-only).
    createPlatformRepository(userId)
      .then(({ repo, engine }) => {
        if (!active) return; // superseded build: never attach/start its engine late
        engineRef.current = engine;
        if (engine) {
          // Attach BEFORE children can render — attachEngine publishes the
          // engine's current state immediately, so a cold launch with queued
          // rows shows the right pending/parked counts from first paint.
          detachRef.current = syncStatusHub.attachEngine(engine);
          engine.start();
        }
        setDegraded(false);
        setResolved(repo);
      })
      .catch((error: unknown) => {
        // Device DB open failed — fall back to online so the app still
        // functions, but never silently: this converts an offline-first
        // native app into online-only, so it must be visible in diagnostics
        // and to M3's sync-status surface (see didFallBackToOnlineOnly above).
        console.warn(
          '[data] platform repository init failed; falling back to online-only Supabase repository',
          error,
        );
        fellBackToOnlineOnly = true;
        if (active) {
          engineRef.current = null;
          // Never leave a counter over a queue nothing will write to or drain.
          syncStatusHub.setCounter(null);
          setDegraded(true);
          setResolved(supabaseRepository);
        }
      });
    return () => {
      active = false;
      // Sign-out/unmount: detach + stop the torn-down user's engine BEFORE
      // the setCounter(null) fallback reset, so the engine never publishes
      // through the hub again after this component has moved on.
      detachRef.current?.();
      detachRef.current = null;
      engineRef.current?.stop();
      engineRef.current = null;
      syncStatusHub.setCounter(null);
    };
    // userId in deps: re-run (rebuild + reconcile) whenever the account
    // changes. A token refresh keeps the same userId and does not re-run.
  }, [userId, override]);

  const syncActions = useMemo<SyncActions>(
    () => ({
      retrySync: () => engineRef.current?.retryParked() ?? Promise.resolve(),
      discardSync: (clientId) => engineRef.current?.discardParked(clientId) ?? Promise.resolve(0),
      degraded,
    }),
    [degraded],
  );

  if (!resolved) return <HydrationGate />;

  return (
    <SyncActionsContext.Provider value={syncActions}>
      <RepositoryContext.Provider value={resolved}>{children}</RepositoryContext.Provider>
    </SyncActionsContext.Provider>
  );
}

function HydrationGate() {
  const { colors } = useTheme();
  return (
    <View style={[styles.gate, { backgroundColor: colors.bg }]}>
      <ActivityIndicator color={colors.muted} />
    </View>
  );
}

export function useRepository(): Repository {
  return useContext(RepositoryContext);
}

const styles = StyleSheet.create({
  gate: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
