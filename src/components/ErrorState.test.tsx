/**
 * `ErrorState` had no test (#24 item 9) and, as of #22's audit, still has no
 * consumer: Today and report detail each hand-compose `EmptyState` +
 * `PrimaryButton("Try again")` because both need a screen-specific icon and
 * title this message-only API cannot express.
 *
 * So this pins a contract nothing calls yet — deliberately, on request. The
 * value it does carry is as the reference for the widened API that would let
 * those two screens adopt it: the behaviours below are the ones any successor
 * has to keep, and the missing `title`/`icon` are visible here by their absence.
 */
import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { ThemeProvider } from '../theme';
import { ErrorState } from './ErrorState';

function wrapper({ children }: { readonly children: ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

describe('ErrorState', () => {
  it('falls back to a generic message rather than rendering a blank', () => {
    render(<ErrorState onRetry={jest.fn()} />, { wrapper });

    expect(screen.getByText('Something went wrong.')).toBeTruthy();
  });

  it('shows a supplied message instead of the default', () => {
    render(<ErrorState message="Couldn't load your reports." onRetry={jest.fn()} />, { wrapper });

    expect(screen.getByText("Couldn't load your reports.")).toBeTruthy();
    expect(screen.queryByText('Something went wrong.')).toBeNull();
  });

  it('always offers a way out', () => {
    const onRetry = jest.fn();
    render(<ErrorState message="Offline." onRetry={onRetry} />, { wrapper });

    fireEvent.press(screen.getByRole('button'));

    // An error state with no working retry is a dead end: the user's only
    // remaining move is to kill the app, which on this app means leaving
    // queued writes undrained.
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('labels the retry in words, not by icon alone', () => {
    render(<ErrorState onRetry={jest.fn()} />, { wrapper });

    // The refresh glyph carries no accessible name of its own.
    expect(screen.getByText('Try again')).toBeTruthy();
  });
});
