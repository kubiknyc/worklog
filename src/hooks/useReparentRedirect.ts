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
  // The `reparents` value a resolve is currently in flight for — distinct
  // from `lastSeenRef` (which only advances on a SETTLED, still-relevant
  // attempt). Guards against a same-render duplicate (e.g. `repo`'s identity
  // shifting without an actual reparents change) re-firing the RPC for a
  // request already pending. Cleared in the effect's own CLEANUP, not in
  // `.then`/`.catch` — cleanup fires on every re-run (including one triggered
  // by `loaded` getting a fresh object identity from a report-screen reload
  // while the fetch is still in flight), so the marker can never outlive the
  // request it belongs to. If it were only cleared from `.then`/`.catch`, a
  // cancelled in-flight request would leave it set forever (the cancelled
  // callback bails before reaching the clear), permanently stranding that
  // bump — never retried, never navigated.
  const inFlightForRef = useRef<number | null>(null);

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
    if (inFlightForRef.current === reparents) return;
    inFlightForRef.current = reparents;

    let cancelled = false;
    void repo
      .getReportByDate(loaded.projectId, loaded.reportDate)
      .then((row) => {
        if (cancelled) return;
        // Only consume the bump once the resolve actually settled — mirrors
        // the `!loaded` guard above.
        lastSeenRef.current = reparents;
        if (!row) return; // transient miss — never navigate
        if (row.id !== routeId) {
          router.replace(`/report/${row.id}`);
        }
      })
      .catch(() => {
        if (cancelled) return;
        // Swallow-with-intent: a transient resolve failure must never
        // navigate and must not crash. Deliberately do NOT mark this bump
        // "seen" — the in-flight marker is cleared below in cleanup, so a
        // later effect re-run (this same bump on a fresh render, or a
        // genuinely new reparents bump) retries the resolve instead of
        // silently losing it.
      });
    return () => {
      cancelled = true;
      // Always clear here, not in `.then`/`.catch` — this runs on EVERY
      // re-run of this effect (a real reparents bump, or just `loaded`/`repo`
      // getting a new identity while the request above is still pending), so
      // a cancelled request can never leave the marker stuck. The next
      // effect execution is then free to start a replacement fetch for the
      // same bump.
      inFlightForRef.current = null;
    };
  }, [reparents, loaded, repo, routeId]);
}
