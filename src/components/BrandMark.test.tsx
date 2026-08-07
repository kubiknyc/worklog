/**
 * BrandMark: renders a field-notebook daily-report mark at the given size,
 * with a fixed internal palette (logos don't re-tint with theme). Covers
 * default render, the `chip` variant, and no-throw across the sizes it's
 * actually used at (32/64/120 — see PL/src/components/BrandMark.tsx for the
 * PunchLog analog this mirrors the props contract of).
 */
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react-native';

import { ThemeProvider } from '../theme';
import { BrandMark } from './BrandMark';

function wrapper({ children }: { readonly children: ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

describe('BrandMark', () => {
  it('renders at the default size', () => {
    render(<BrandMark />, { wrapper });
    expect(screen.getByTestId('brand-mark')).toBeTruthy();
  });

  it('renders with the chip variant', () => {
    render(<BrandMark chip />, { wrapper });
    expect(screen.getByTestId('brand-mark')).toBeTruthy();
  });

  it.each([32, 64, 120])('renders without throwing at size %i', (size) => {
    expect(() => render(<BrandMark size={size} />, { wrapper })).not.toThrow();
  });
});
