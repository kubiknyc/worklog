/**
 * Redirects a mounted report screen off a same-day reparent (Task 5's engine
 * core): when a queued `create_report` collides with an existing report for
 * the same `(projectId, reportDate)`, the server keeps the WINNER's id and
 * the engine rewrites every local row + queued mutation from the loser onto
 * it. A report screen still mounted on the loser's id must follow.
 *
 * `routeId` alone can't drive the re-resolve — after the rename the loser id
 * matches nothing (`getReportByDate` and the row itself are gone), so the
 * caller passes the identity pair from its ALREADY-LOADED report state (the
 * in-memory copy, which survives the rename).
 *
 * On every bump of `SyncState.reparents` (monotone, never reset — see
 * engineApi.ts) with `loaded` non-null, re-resolve `(projectId, reportDate)`
 * through the repo. A transient miss (`getReportByDate` returns null — e.g.
 * the winner's row hasn't landed locally yet) MUST do nothing: navigating
 * away from a report that's still loading would be a worse bug than staying
 * put. Only a resolved id that differs from `routeId` triggers a
 * `router.replace`.
 */
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';

import { useRepository } from '../data/RepositoryProvider';
import { useSyncStatus } from './useSyncStatus';

export interface ReparentIdentity {
  readonly projectId: string;
  readonly reportDate: string;
}

export function useReparentRedirect(routeId: string, loaded: ReparentIdentity | null): void {
  const repo = useRepository();
  const { reparents } = useSyncStatus();
  const lastSeenRef = useRef(reparents);

  useEffect(() => {
    // Only a CHANGE in reparents triggers a re-resolve — not every render
    // (deps include `loaded`, whose identity can change without a reparent).
    if (reparents === lastSeenRef.current) return;
    // Don't mark this bump "seen" until it's actually actionable: if `loaded`
    // is still null (e.g. the bump lands right after navigation, before the
    // report data has resolved), leave lastSeenRef alone so the NEXT effect
    // run — once `loaded` becomes non-null — still sees the unconsumed bump
    // and retries. Marking it seen here would silently drop the redirect.
    if (!loaded) return;
    lastSeenRef.current = reparents;

    let cancelled = false;
    void repo.getReportByDate(loaded.projectId, loaded.reportDate).then((row) => {
      if (cancelled || !row) return; // transient miss — never navigate
      if (row.id !== routeId) {
        router.replace(`/report/${row.id}`);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [reparents, loaded, repo, routeId]);
}
