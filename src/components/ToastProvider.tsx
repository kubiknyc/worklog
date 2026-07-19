/**
 * Toast / undo controller.
 *
 * `showUndoable` defers the real write: it shows a pill for `duration` (default
 * 4200ms). Tapping Undo cancels the timer and runs `undo` WITHOUT committing;
 * letting the timer elapse runs `commit` (the repo write) then dismisses.
 * Showing a new toast of ANY kind — or unmounting — clears the dismiss timer
 * and flushes any pending commit first, so a write is never silently dropped
 * and a stale timer can never dismiss the toast that superseded it. `show` and
 * `showError` are plain ~2.6s pills.
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
import { AccessibilityInfo, Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme, type ReportStatus } from '../theme';

const UNDO_DURATION_MS = 4200;
const PLAIN_DURATION_MS = 2600;

export interface UndoableToastOptions {
  readonly message: string;
  readonly commit: () => Promise<void> | void;
  readonly undo?: () => void;
  readonly duration?: number;
  /** Optional report status to tint the leading dot. */
  readonly status?: ReportStatus;
  /**
   * Surfaced only when the deferred commit runs to completion on its own timer.
   * A commit flushed because a newer toast superseded it (or because the provider
   * unmounted) swallows its error instead, so a stale failure can't overwrite the
   * toast now on screen. The commit closure should still roll back optimistic UI.
   */
  readonly onCommitError?: (err: unknown) => void;
}

export interface ToastApi {
  showUndoable: (opts: UndoableToastOptions) => void;
  show: (message: string) => void;
  /**
   * Show a plain error toast. Like every toast, it supersedes whatever is on
   * screen: any still-pending undoable commit is flushed (committed) first, so
   * an error pill never hides a deferred write behind a toast with no Undo —
   * and never strands it. (When called from `onCommitError`, the failed commit
   * has already been consumed, so there is nothing pending to flush.)
   */
  showError: (message: string) => void;
}

interface ToastState {
  readonly message: string;
  readonly canUndo: boolean;
  readonly status?: ReportStatus;
}

const ToastContext = createContext<ToastApi | null>(null);

interface PendingCommit {
  readonly commit: () => Promise<void> | void;
  readonly onCommitError?: (err: unknown) => void;
}

export function ToastProvider({ children }: { readonly children: ReactNode }) {
  const { colors, fonts, reportStatus: statusColors, radii } = useTheme();
  const [toast, setToast] = useState<ToastState | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;

  // Single dismiss/commit timer shared by every toast kind. A second,
  // per-kind timer ref proved a trap: a timer armed by one kind and never
  // cleared by the others would dismiss the NEXT toast mid-window.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<PendingCommit | null>(null);
  const mountedRef = useRef(true);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const dismiss = useCallback(() => {
    Animated.timing(opacity, { toValue: 0, duration: 160, useNativeDriver: true }).start((result) => {
      // Only clear when the fade-out actually completed. `present()` calls
      // `opacity.setValue(0)`, which synchronously interrupts an in-flight
      // fade-out and fires this callback with `finished: false` — clearing then
      // would wipe the toast that just superseded this one.
      if (result?.finished && mountedRef.current) setToast(null);
    });
  }, [opacity]);

  /**
   * Run any deferred commit immediately (timer elapsed or superseded/unmount).
   * When `silent` (superseded by a newer toast, or unmounting), a commit failure
   * is swallowed: surfacing it would clobber the toast that now owns the screen.
   * The optimistic rollback still runs inside the commit closure, so the UI stays
   * consistent — only the now-stale error message is suppressed.
   */
  const flushPending = useCallback((silent = false) => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (!pending) return;
    Promise.resolve()
      .then(() => pending.commit())
      .catch((err: unknown) => {
        if (silent) return;
        pending.onCommitError?.(err);
      });
  }, []);

  const present = useCallback(
    (next: ToastState) => {
      setToast(next);
      opacity.setValue(0);
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
      // Screen readers don't notice the pill appearing on their own; announce it.
      // (Covers iOS, where accessibilityLiveRegion is a no-op.)
      AccessibilityInfo.announceForAccessibility(next.message);
    },
    [opacity],
  );

  const undoCallbackRef = useRef<(() => void) | undefined>(undefined);

  const showUndoable = useCallback(
    (opts: UndoableToastOptions) => {
      // A new toast supersedes the previous one — flush its pending write first,
      // silently (this toast now owns the screen; the old commit's error must not
      // land on top of it).
      clearTimer();
      flushPending(true);
      pendingRef.current = { commit: opts.commit, onCommitError: opts.onCommitError };
      undoCallbackRef.current = opts.undo;
      present({ message: opts.message, canUndo: !!opts.undo, status: opts.status });
      const duration = opts.duration ?? UNDO_DURATION_MS;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        // Timer elapsed: this commit runs on its own, so surface a failure.
        flushPending();
        dismiss();
      }, duration);
    },
    [clearTimer, dismiss, flushPending, present],
  );

  const handleUndo = useCallback(() => {
    clearTimer();
    pendingRef.current = null; // cancel the deferred commit
    const undo = undoCallbackRef.current;
    undoCallbackRef.current = undefined;
    if (undo) undo();
    dismiss();
  }, [clearTimer, dismiss]);

  /**
   * Shared implementation for the plain pills (`show` and `showError`). Every
   * toast supersedes the previous one the same way: clear the shared dismiss
   * timer (so a stale timer can't dismiss this pill early) and flush any
   * pending undoable commit silently — presenting over a still-pending
   * undoable would otherwise hide its Undo affordance while the write is still
   * deferred, and its stale failure must not clobber this toast.
   */
  const showPlain = useCallback(
    (message: string) => {
      clearTimer();
      flushPending(true);
      present({ message, canUndo: false });
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        dismiss();
      }, PLAIN_DURATION_MS);
    },
    [clearTimer, dismiss, flushPending, present],
  );

  // Identical behavior today; kept as separate API entries because callers
  // encode intent (and error pills may diverge in styling later).
  const show = showPlain;
  const showError = showPlain;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimer();
      flushPending(true);
    };
  }, [clearTimer, flushPending]);

  const api = useMemo<ToastApi>(
    () => ({ showUndoable, show, showError }),
    [showUndoable, show, showError],
  );

  const dotColor = toast?.status ? statusColors[toast.status] : colors.accent;

  return (
    <ToastContext.Provider value={api}>
      {children}
      {toast ? (
        <Animated.View pointerEvents="box-none" style={[styles.wrap, { opacity }]}>
          <View
            accessibilityLiveRegion="polite"
            accessibilityRole="alert"
            style={[
              styles.pill,
              { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.pill },
            ]}
          >
            <View style={[styles.dot, { backgroundColor: dotColor }]} />
            <Text
              numberOfLines={2}
              style={[styles.message, { color: colors.text, fontFamily: fonts.mono.medium }]}
            >
              {toast.message}
            </Text>
            {toast.canUndo ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Undo"
                onPress={handleUndo}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.undoBtn,
                  { backgroundColor: colors.accent, borderRadius: radii.pill },
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.undoText, { color: colors.accentInk, fontFamily: fonts.ui.bold }]}>Undo</Text>
              </Pressable>
            ) : null}
          </View>
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (ctx === null) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16, bottom: 96, alignItems: 'center' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
    maxWidth: 460,
    width: '100%',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  dot: { width: 9, height: 9, borderRadius: 5 },
  message: { flex: 1, fontSize: 12.5, letterSpacing: 0.2, lineHeight: 17 },
  undoBtn: { paddingHorizontal: 12, paddingVertical: 6 },
  undoText: { fontSize: 13, letterSpacing: 0.3 },
  pressed: { opacity: 0.6 },
});
