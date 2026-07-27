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
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';

import { useAuth } from '../auth';
import { syncStatusHub } from '../sync/statusHub';
import { useTheme } from '../theme';
import { createPlatformRepository } from './platformRepo';
import type { Repository } from './types';
import { supabaseRepository } from './supabaseRepo';

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

  useEffect(() => {
    // Override (tests/explicit) and web (online-only, RLS-enforced, no local
    // cache to reconcile) never rebuild on account change.
    if (override || Platform.OS === 'web') return;

    let active = true;
    // Gate children while the switch reconciles ownership, so the previous
    // user's repository is never readable during the rebuild.
    setResolved(null);
    createPlatformRepository()
      .then(({ repo, counter }) => {
        if (!active) return; // superseded build: never install its counter late
        // Install the queue counter for the sync pill BEFORE children can
        // render — setCounter resets to idle and kicks the initial recount,
        // so a cold launch with queued rows shows the right count.
        syncStatusHub.setCounter(counter);
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
          // Never leave a counter over a queue nothing will write to or drain.
          syncStatusHub.setCounter(null);
          setResolved(supabaseRepository);
        }
      });
    return () => {
      active = false;
      // Sign-out/unmount: drop the counter bound to the torn-down user's DB.
      syncStatusHub.setCounter(null);
    };
    // userId in deps: re-run (rebuild + reconcile) whenever the account
    // changes. A token refresh keeps the same userId and does not re-run.
  }, [userId, override]);

  if (!resolved) return <HydrationGate />;

  return <RepositoryContext.Provider value={resolved}>{children}</RepositoryContext.Provider>;
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
