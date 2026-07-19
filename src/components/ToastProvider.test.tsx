/**
 * Regression tests for the optimistic-write / undo machinery in ToastProvider.
 *
 * These lock in the defect classes fixed in the PunchLog original (ported with
 * the component):
 *  - a superseded deferred commit is flushed but its failure is swallowed
 *    (it must not clobber the toast that now owns the screen),
 *  - the deferred commit fires on timer-elapse and surfaces its error,
 *  - tapping Undo cancels the deferred commit entirely,
 *  - showError supersedes like any toast: it flushes (commits) a still-pending
 *    undoable rather than hiding its Undo affordance over a deferred write,
 *  - a stale dismiss timer from a prior toast (e.g. an error pill) can never
 *    dismiss the toast that superseded it mid-undo-window.
 */
import type { ReactNode } from 'react';
import { act, fireEvent, renderHook, screen } from '@testing-library/react-native';

import { ThemeProvider } from '../theme';
import { ToastProvider, useToast, type ToastApi } from './ToastProvider';

function wrapper({ children }: { readonly children: ReactNode }) {
  return (
    <ThemeProvider>
      <ToastProvider>{children}</ToastProvider>
    </ThemeProvider>
  );
}

/** Mount under real timers (renderHook flushes the initial mount via act), then
 * switch to fake timers for deterministic control of the undo/commit schedule. */
function mountToast(): ToastApi {
  const { result } = renderHook(() => useToast(), { wrapper });
  if (!result.current) throw new Error('ToastApi was not captured');
  jest.useFakeTimers();
  return result.current;
}

/** Let the flushPending promise chain (.then → .catch) settle. */
async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('ToastProvider undoable commits', () => {
  test('runs the deferred commit when the undo timer elapses', async () => {
    const api = mountToast();
    const commit = jest.fn().mockResolvedValue(undefined);

    act(() => api.showUndoable({ message: 'Advanced', commit, duration: 1000 }));
    expect(commit).not.toHaveBeenCalled(); // deferred, not immediate

    act(() => jest.advanceTimersByTime(1000));
    await flushMicrotasks();

    expect(commit).toHaveBeenCalledTimes(1);
  });

  test('tapping Undo cancels the deferred commit and runs undo', async () => {
    const api = mountToast();
    const commit = jest.fn().mockResolvedValue(undefined);
    const undo = jest.fn();

    act(() => api.showUndoable({ message: 'Advanced', commit, undo, duration: 4200 }));

    fireEvent.press(screen.getByLabelText('Undo'));
    act(() => jest.advanceTimersByTime(5000));
    await flushMicrotasks();

    expect(commit).not.toHaveBeenCalled();
    expect(undo).toHaveBeenCalledTimes(1);
  });

  test('a superseding toast flushes the prior commit immediately', async () => {
    const api = mountToast();
    const first = jest.fn().mockResolvedValue(undefined);

    act(() => api.showUndoable({ message: 'A', commit: first, duration: 4200 }));
    act(() => api.showUndoable({ message: 'B', commit: jest.fn(), duration: 4200 }));
    await flushMicrotasks();

    // Flushed on supersede, before its own 4200ms timer.
    expect(first).toHaveBeenCalledTimes(1);
  });

  test('a superseded commit failure is swallowed (onCommitError not called)', async () => {
    const api = mountToast();
    const commit = jest.fn().mockRejectedValue(new Error('network'));
    const onCommitError = jest.fn();

    act(() => api.showUndoable({ message: 'A', commit, onCommitError, duration: 4200 }));
    act(() => api.showUndoable({ message: 'B', commit: jest.fn(), duration: 4200 }));
    await flushMicrotasks();

    expect(commit).toHaveBeenCalledTimes(1);
    expect(onCommitError).not.toHaveBeenCalled();
  });

  test('a timer-elapsed commit failure surfaces via onCommitError', async () => {
    const api = mountToast();
    const commit = jest.fn().mockRejectedValue(new Error('network'));
    const onCommitError = jest.fn();

    act(() => api.showUndoable({ message: 'A', commit, onCommitError, duration: 1000 }));
    act(() => jest.advanceTimersByTime(1000));
    await flushMicrotasks();

    expect(onCommitError).toHaveBeenCalledTimes(1);
  });

  test('showError over a pending undoable flushes (commits) it rather than orphaning it', async () => {
    const api = mountToast();
    const commit = jest.fn().mockResolvedValue(undefined);
    const undo = jest.fn();

    act(() => api.showUndoable({ message: 'A', commit, undo, duration: 4200 }));
    act(() => api.showError('Something failed'));
    await flushMicrotasks();

    // The deferred write commits immediately instead of being stranded behind
    // an error pill that offers no Undo.
    expect(commit).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('Undo')).toBeNull(); // error pill, no Undo
    expect(screen.getByText('Something failed')).toBeTruthy();

    // The undoable's original timer was cleared: no double commit later.
    act(() => jest.advanceTimersByTime(10_000));
    await flushMicrotasks();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(undo).not.toHaveBeenCalled();
  });

  test('a commit flushed by showError swallows its failure (onCommitError not called)', async () => {
    const api = mountToast();
    const commit = jest.fn().mockRejectedValue(new Error('network'));
    const onCommitError = jest.fn();

    act(() => api.showUndoable({ message: 'A', commit, onCommitError, duration: 4200 }));
    act(() => api.showError('Something else failed'));
    await flushMicrotasks();

    expect(commit).toHaveBeenCalledTimes(1);
    expect(onCommitError).not.toHaveBeenCalled(); // stale failure must not clobber the error pill
  });

  test('a stale error timer does not dismiss a later undoable toast early', async () => {
    const api = mountToast();
    const commit = jest.fn().mockResolvedValue(undefined);
    const undo = jest.fn();

    act(() => api.showError('Something failed')); // arms a 2600ms dismiss timer
    act(() => jest.advanceTimersByTime(1000));

    act(() => api.showUndoable({ message: 'Advanced', commit, undo, duration: 4200 }));
    // Cross the stale error timer's original deadline (2600ms after arming).
    act(() => jest.advanceTimersByTime(2000));
    await flushMicrotasks();

    // The undoable pill — and its Undo affordance — must still be on screen
    // and functional for the full undo window.
    expect(screen.getByText('Advanced')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Undo'));
    act(() => jest.advanceTimersByTime(10_000));
    await flushMicrotasks();

    expect(undo).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled();
  });
});
