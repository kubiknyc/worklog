/**
 * Refetches whenever the sync engine's QUEUE COUNTS change (`pending` or
 * `parked`, ref-diffed against the last-seen pair) — never on mount, and never
 * on a republish that leaves both unchanged.
 *
 * Distinct from `useRefreshOnFocusAndSync`, which diffs `completedPulls` and so
 * only fires on landed pull data. The sync-queue screen needs the opposite
 * signal: it renders the queue itself, and its rows change on every recount.
 *
 * Why it matters beyond freshness: `retryParked()` unparks the whole queue and
 * then awaits a multi-second drain. Without this subscription the screen holds
 * its pre-retry snapshot for that entire drain, leaving Discard tappable on
 * rows that are no longer parked. `discardParked`'s status guard makes that tap
 * harmless, but the button should not be offered at all once the rows go
 * pending.
 *
 * `{ drainsOnly: true }` refetches only when a count DROPS — work resolved, so
 * the server/local rows moved (MULT-56: a web resend landed). The report
 * screen uses it: a rising `pending` means a write was just queued or held
 * (on web: the device just went offline), and refetching then would only fail
 * into the screen's error state.
 */
import { useEffect, useRef } from 'react';

import { useSyncStatus } from './useSyncStatus';

export function useRefreshOnQueueChange(
  refetch: () => void,
  options?: { readonly drainsOnly?: boolean },
): void {
  const drainsOnly = options?.drainsOnly ?? false;
  const { pending, parked } = useSyncStatus();
  const lastSeenRef = useRef({ pending, parked });

  useEffect(() => {
    const last = lastSeenRef.current;
    if (last.pending === pending && last.parked === parked) return;
    lastSeenRef.current = { pending, parked };
    if (drainsOnly && pending >= last.pending && parked >= last.parked) return;
    refetch();
  }, [pending, parked, refetch, drainsOnly]);
}
