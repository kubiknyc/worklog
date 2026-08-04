/**
 * `AuthSplash` had no test (#24 item 9). It is small, but it sits on the
 * session-restore hot path: `app/index.tsx` renders it while the session is
 * being restored, and its whole reason for existing is that the app must never
 * flash the login screen at a user who is already signed in.
 *
 * So the thing worth pinning is that it renders SOMETHING branded and opaque —
 * a component that quietly returned null would restore the exact flash it was
 * added to prevent, and no other test would notice.
 */
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react-native';

import { ThemeProvider } from '../theme';
import { AuthSplash } from './AuthSplash';

function wrapper({ children }: { readonly children: ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

describe('AuthSplash', () => {
  it('renders the branded lockup rather than a blank window', () => {
    render(<AuthSplash />, { wrapper });

    expect(screen.getByText('WorkLog')).toBeTruthy();
    expect(screen.getByText('Keystone Build Group')).toBeTruthy();
  });

  it('paints an opaque themed background', () => {
    const { toJSON } = render(<AuthSplash />, { wrapper });
    const root = toJSON() as { props: { style: readonly { backgroundColor?: string }[] } };
    const flat = ([] as { backgroundColor?: string }[]).concat(root.props.style);

    // A transparent root would let the login screen show through — the flash
    // this component exists to prevent, reintroduced without removing it.
    expect(flat.map((s) => s?.backgroundColor).find(Boolean)).toBeTruthy();
  });

  it('shows progress, so a slow restore does not read as a hang', () => {
    const { UNSAFE_root } = render(<AuthSplash />, { wrapper });

    expect(UNSAFE_root.findAllByType('ActivityIndicator' as never).length).toBeGreaterThan(0);
  });
});
