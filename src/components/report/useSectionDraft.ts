/**
 * useSectionDraft — the save model for every section sheet.
 *
 * PRD §6: "draft autosaves locally on every change — there is no Save button."
 * So `setDraft` is optimistic: local state moves immediately (the field atoms
 * must never wait on a write) and a debounced `repo.updateSection` follows.
 * Two layers of coalescing sit under this: the ~400ms debounce collapses a
 * burst of taps into one repository call, and (native) the mutation queue
 * coalesces by `clientId = ${reportId}:${section}` so even multiple calls
 * become one queued mutation.
 *
 * Flush strategy — chosen: **flush on unmount, plus an exported `flush()`**.
 *   The sheets mount their editors behind `visible`, and BottomSheet keeps the
 *   subtree mounted while closed, so unmount alone would let a dismissal sit on
 *   an unwritten tail edit for as long as the screen lives. `flush()` therefore
 *   exists for the sheet's `onClose` (call it before `onClose()`); the
 *   unmount flush is the backstop that covers navigating away, going
 *   background-then-killed, and sheets that do forget to call it. Both paths
 *   write the SAME tail state, and flushing twice is harmless (the second call
 *   sees no pending timer and returns).
 *
 * Ordering: writes are chained, so a slow in-flight `updateSection` can never
 * land after a newer one and clobber it, and a write superseded before it even
 * starts is dropped via a generation token (the codebase's established guard —
 * cf. AuthProvider's `sessionGenRef`). `updateSection` is full-replacement, so
 * only the last payload matters.
 *
 * `initial` is read once, at mount. A sheet showing a different report/section
 * must be remounted (give it a `key`) — the hook does not resync from props,
 * which would fight the optimistic local state.
 *
 * `options.readOnly` is the client half of the lifecycle guard (§B.7): a
 * non-draft report's sheet may render content but can never produce a
 * repository write or queued mutation. It is enforced at the single choke
 * point every write funnels through — `issueWrite` — so the debounce timer,
 * `flush()`, `markComplete`, and the unmount backstop are all inert; local
 * state (`draft`) still updates so the sheet can render freely.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { useRepository } from '../../data';
import type { Json, SectionKind } from '../../data/types';

/** Debounce window for the autosave write. Long enough to swallow a burst of
 *  stepper taps, short enough that a dismissal rarely has to flush. */
export const SECTION_DRAFT_DEBOUNCE_MS = 400;

export interface SectionDraft<T extends Json> {
  readonly draft: T;
  /** Optimistic: updates state now, schedules the debounced write. */
  setDraft: (next: T) => void;
  /** Write through with an explicit completeness flag ("None today"). */
  markComplete: (isComplete: boolean) => void;
  /** Write any pending edit immediately — call from the sheet's dismiss. */
  flush: () => void;
}

export function useSectionDraft<T extends Json>(
  reportId: string,
  section: SectionKind,
  initial: T,
  options?: { readonly readOnly?: boolean },
): SectionDraft<T> {
  const readOnly = options?.readOnly ?? false;
  const repo = useRepository();
  const [draft, setDraftState] = useState<T>(initial);

  // Latest values the next write should send, readable from timers/unmount
  // without re-arming effects on every keystroke.
  const contentRef = useRef<T>(initial);
  const completeRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Serialises writes and lets a superseded one be skipped before it runs.
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const genRef = useRef(0);
  const repoRef = useRef(repo);
  repoRef.current = repo;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /** Queue a write of whatever `contentRef`/`completeRef` hold when it runs. */
  const issueWrite = useCallback(() => {
    if (readOnly) return;
    const gen = (genRef.current += 1);
    chainRef.current = chainRef.current
      .then(() => {
        // A newer write was queued behind this one before it started — its
        // payload is strictly fresher, so this one is pure redundancy.
        if (gen !== genRef.current) return;
        return repoRef.current.updateSection(
          reportId,
          section,
          contentRef.current,
          completeRef.current,
        );
      })
      .catch((error: unknown) => {
        // Autosave has no UI affordance to fail into (there is no Save button
        // to re-enable). Native enqueues, so a real failure here is a web/
        // fallback-path server rejection: log it, keep the optimistic state,
        // and let the next edit retry.
        console.warn(`[useSectionDraft] updateSection(${section}) failed:`, error);
      });
  }, [reportId, section, readOnly]);

  const flush = useCallback(() => {
    if (timerRef.current === null) return; // nothing pending
    clearTimer();
    issueWrite();
  }, [clearTimer, issueWrite]);

  const setDraft = useCallback(
    (next: T) => {
      contentRef.current = next;
      setDraftState(next);
      // Re-arming the timer is what coalesces a burst into one write.
      clearTimer();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        issueWrite();
      }, SECTION_DRAFT_DEBOUNCE_MS);
    },
    [clearTimer, issueWrite],
  );

  const markComplete = useCallback(
    (isComplete: boolean) => {
      // The affirmation is a deliberate user act — write it through now, and
      // drop any pending debounce (this write carries the same content).
      completeRef.current = isComplete;
      clearTimer();
      issueWrite();
    },
    [clearTimer, issueWrite],
  );

  useEffect(
    () => () => {
      // Backstop flush: write the tail edit, then guarantee no timer can fire
      // (and no further write can be scheduled) after unmount.
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
        issueWrite();
      }
    },
    [issueWrite],
  );

  return { draft, setDraft, markComplete, flush };
}
