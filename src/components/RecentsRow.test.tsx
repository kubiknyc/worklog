/**
 * `RecentsRow` had no test (#24 item 9) and no consumer (#22's audit).
 *
 * Two behaviours here are load-bearing whenever a sheet does adopt it. It
 * renders NOTHING when empty — recents grow organically from day-1 use, so an
 * empty-state affordance would be permanent chrome on a brand-new install. And
 * its chips carry a 48px minimum height: these are one-tap pre-fills a
 * superintendent hits with gloves on, which is the AC-T1 touch-target floor the
 * #33 work was about.
 */
import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { ThemeProvider } from '../theme';
import { RecentsRow } from './RecentsRow';

function wrapper({ children }: { readonly children: ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

const RECENTS = ['Ferguson', 'White Cap', 'City Inspector'];

describe('RecentsRow', () => {
  it('renders nothing at all when there are no recents', () => {
    const { toJSON } = render(<RecentsRow values={[]} onPick={jest.fn()} />, { wrapper });

    // Not "renders an empty row" — null. Recents only exist after day-1 use, so
    // any chrome here is permanent furniture on a fresh install.
    expect(toJSON()).toBeNull();
  });

  it('renders one tappable chip per value', () => {
    render(<RecentsRow values={RECENTS} onPick={jest.fn()} />, { wrapper });

    expect(screen.getAllByRole('button')).toHaveLength(RECENTS.length);
    for (const value of RECENTS) expect(screen.getByText(value)).toBeTruthy();
  });

  it('picks the value that was tapped', () => {
    const onPick = jest.fn();
    render(<RecentsRow values={RECENTS} onPick={onPick} />, { wrapper });

    fireEvent.press(screen.getByLabelText('White Cap'));

    // The whole point is one-tap pre-fill. Handing back the wrong neighbour
    // writes a different supplier onto a delivery than the one tapped.
    expect(onPick).toHaveBeenCalledWith('White Cap');
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it('names each chip for a screen reader', () => {
    render(<RecentsRow values={RECENTS} onPick={jest.fn()} />, { wrapper });

    // The label is the value; the visible Text is numberOfLines={1} and may be
    // truncated, so the a11y name must not be derived from what fits.
    expect(screen.getByRole('button', { name: 'City Inspector' })).toBeTruthy();
  });

  it('keeps every chip at or above the 48px touch-target floor', () => {
    render(<RecentsRow values={RECENTS} onPick={jest.fn()} />, { wrapper });

    for (const chip of screen.getAllByRole('button')) {
      const style = chip.props.style as { minHeight?: number } | readonly { minHeight?: number }[];
      const flat = Array.isArray(style) ? style : [style];
      const minHeight = flat.map((s) => s?.minHeight).find(Boolean);
      // AC-T1. These are small chips holding short strings, so the floor is
      // load-bearing rather than incidental — nothing else keeps them tappable.
      expect(minHeight).toBeGreaterThanOrEqual(48);
    }
  });
});
