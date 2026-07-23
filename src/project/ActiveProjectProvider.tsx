/**
 * ActiveProjectProvider (M2, ported from PunchLog M8a) — the single source of
 * truth for which project the app is looking at, so no screen re-derives it
 * from `memberships[0]?.project_id`.
 *
 * The persisted choice lives under a USER-SCOPED AsyncStorage key
 * (`activeProject:<userId>` via {@link activeProjectKey} — a device-global key
 * would leak user A's project choice into user B's session) and is already
 * swept by `clearAccountCaches()` on sign-out, so this module adds no new key.
 * Resolution is pure ({@link resolveActiveProject}): a persisted id must still
 * be one of the user's memberships, else the deterministic default applies —
 * that is what discards a project the user has been removed from.
 *
 * Deliberately NOT coupled to the data layer: this provider knows only ids.
 * Project details (name, timezone) come from `useRepository().getProject()` at
 * the call sites, which is what lets it mount OUTSIDE RepositoryProvider (it
 * needs the session, not the database).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useAuth } from '../auth';
import { activeProjectKey } from '../auth/accountCaches';
import { resolveActiveProject } from './resolveActiveProject';

export interface ActiveProjectContextValue {
  readonly activeProjectId: string | null;
  /** False until the persisted selection has been read for this user. */
  readonly ready: boolean;
  setActiveProject: (projectId: string) => void;
}

const ActiveProjectContext = createContext<ActiveProjectContextValue | null>(null);

export function ActiveProjectProvider({ children }: { readonly children: ReactNode }) {
  const { userId, memberships } = useAuth();
  // The raw persisted choice; validity is resolved per render so a membership
  // change (kicked / newly created project) takes effect immediately.
  const [persisted, setPersisted] = useState<string | null>(null);
  // Which user the persisted value was hydrated for — a user switch re-reads.
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);
  // True once a manual switch happened after the hydration read was issued —
  // the stale read must never clobber it. (The `active` flag only guards
  // unmount/user-switch, not a same-user write racing the read.)
  const manualWriteRef = useRef(false);

  useEffect(() => {
    if (!userId) return;
    manualWriteRef.current = false;
    let active = true;
    AsyncStorage.getItem(activeProjectKey(userId))
      .then((stored) => {
        if (!active) return;
        if (!manualWriteRef.current) setPersisted(stored);
        setHydratedFor(userId);
      })
      .catch(() => {
        if (!active) return;
        // Storage failure → deterministic default (silent, same tolerance as
        // the account-cache reads).
        if (!manualWriteRef.current) setPersisted(null);
        setHydratedFor(userId);
      });
    return () => {
      active = false;
    };
  }, [userId]);

  const setActiveProject = useCallback(
    (projectId: string) => {
      // Write-through: state now, persistence best-effort in the background.
      manualWriteRef.current = true;
      setPersisted(projectId);
      if (userId) {
        AsyncStorage.setItem(activeProjectKey(userId), projectId).catch(() => {});
      }
    },
    [userId],
  );

  // Signed out (userId null) is trivially ready: null project, empty states.
  const ready = userId === null || hydratedFor === userId;
  const activeProjectId = ready ? resolveActiveProject(persisted, memberships) : null;

  const value = useMemo<ActiveProjectContextValue>(
    () => ({ activeProjectId, ready, setActiveProject }),
    [activeProjectId, ready, setActiveProject],
  );

  return <ActiveProjectContext.Provider value={value}>{children}</ActiveProjectContext.Provider>;
}

export function useActiveProject(): ActiveProjectContextValue {
  const ctx = useContext(ActiveProjectContext);
  if (ctx === null) {
    throw new Error('useActiveProject must be used within an ActiveProjectProvider');
  }
  return ctx;
}
