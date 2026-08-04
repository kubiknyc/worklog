/**
 * `useReducedMotion` was at 0% (#24 item 9) — and it is the single OS-preference
 * signal every animated surface in the app reads (`Stagger`, `Skeleton`).
 *
 * Three things here are real bugs if they regress, not style points. Seeding
 * from the mount-time value is what makes the preference apply on a cold launch
 * rather than only after the user toggles it again. The subscription is what
 * makes a mid-session Settings change take effect. And the `active` flag is what
 * stops a late-resolving promise calling setState on an unmounted component —
 * this hook lives inside skeletons, which unmount the moment data lands, so
 * losing that race is the common case rather than the rare one.
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { useReducedMotion } from './useReducedMotion';

const remove = jest.fn();
let emit: (enabled: boolean) => void = () => {};

beforeEach(() => {
  remove.mockClear();
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(((
    _event: string,
    handler: (enabled: boolean) => void,
  ) => {
    emit = handler;
    return { remove };
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('useReducedMotion', () => {
  it('starts false so the first frame is never a wrong static render', async () => {
    const { result } = renderHook(() => useReducedMotion());

    expect(result.current).toBe(false);
    await waitFor(() => expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalled());
  });

  it('seeds from the mount-time OS value', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);

    const { result } = renderHook(() => useReducedMotion());

    // Without this a user who set the preference months ago gets full motion
    // until they toggle it off and on again.
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('follows a mid-session Settings toggle in both directions', async () => {
    const { result } = renderHook(() => useReducedMotion());
    await waitFor(() => expect(result.current).toBe(false));

    act(() => emit(true));
    expect(result.current).toBe(true);

    act(() => emit(false));
    expect(result.current).toBe(false);
  });

  it('unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => useReducedMotion());

    unmount();

    // Skeletons unmount as soon as data lands. A leaked listener per skeleton
    // accumulates for the life of the process.
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('does not set state when the OS answers after unmount', async () => {
    let resolve!: (value: boolean) => void;
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockReturnValue(new Promise<boolean>((r) => (resolve = r)));
    const warn = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { unmount } = renderHook(() => useReducedMotion());
    unmount();
    await act(async () => {
      resolve(true);
    });

    // The `active` flag. Losing this race is the COMMON case here, not the rare
    // one: the skeleton this hook lives in unmounts the instant data arrives.
    expect(warn).not.toHaveBeenCalled();
  });
});
