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
  const [resolved, setResolved] = useState<Repository | null>(() => {
    if (override) return override;
    // Web is online-only: ready on first render, no hydration gate.
    if (Platform.OS === 'web') return supabaseRepository;
    return null;
  });

  useEffect(() => {
    if (resolved) return; // override or web already resolved in initial state
    let active = true;
    createPlatformRepository()
      .then((repo) => {
        if (active) setResolved(repo);
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
        if (active) setResolved(supabaseRepository);
      });
    return () => {
      active = false;
    };
  }, [resolved]);

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
