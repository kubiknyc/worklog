/**
 * AuthProvider — (1) signOut revokes the Supabase session and always clears
 * local account caches, even when the revoke call itself fails. (2) When the
 * account fetch fails, a server-side session revocation (getUser → 401/403)
 * lands signed out — never on cached data — while a transient network
 * failure still restores the cached account.
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AuthApiError } from '@supabase/supabase-js';
import type { ReactNode } from 'react';

// Captured onAuthStateChange callback — tests emit fake sessions through it.
let mockAuthCallback: (event: string, session: unknown) => void = () => {};
const mockSignOut = jest.fn(async (): Promise<{ error: AuthApiError | null }> => ({ error: null }));
const mockGetUser = jest.fn(
  async (): Promise<{ data: { user: null }; error: AuthApiError | null }> => ({
    data: { user: null },
    error: null,
  }),
);
// loadAccount path: any table read fails, driving applySession into its catch.
const mockFrom = jest.fn(() => {
  throw new Error('account fetch failed');
});

jest.mock('../supabase/client', () => ({
  supabase: {
    auth: {
      onAuthStateChange: jest.fn((cb: (event: string, session: unknown) => void) => {
        mockAuthCallback = cb;
        return { data: { subscription: { unsubscribe: jest.fn() } } };
      }),
      signOut: (...args: unknown[]) => mockSignOut(...(args as [])),
      getUser: (...args: unknown[]) => mockGetUser(...(args as [])),
    },
    from: (...args: unknown[]) => mockFrom(...(args as [])),
  },
}));

// eslint-disable-next-line import/first
import { AuthProvider, useAuth } from './AuthProvider';

const FAKE_SESSION = { user: { id: 'user-1' } };

function wrapper({ children }: { readonly children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

describe('AuthProvider.signOut', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('revokes the Supabase session', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {
      await result.current.signOut();
    });
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  test('clears local session state when the revoke request fails', async () => {
    // The provider logs a diagnostic warning on this path (no toast surface
    // is wired up yet, M0) — expected, so silence it for a clean test run.
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockSignOut.mockResolvedValueOnce({
      error: new AuthApiError('offline', 500, 'unknown'),
    });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {
      mockAuthCallback('SIGNED_IN', FAKE_SESSION);
    });
    await waitFor(() => expect(result.current.status).toBe('authed'));
    await act(async () => {
      await result.current.signOut();
    });
    await waitFor(() => expect(result.current.status).toBe('signedOut'));
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });
});

describe('AuthProvider revoked-session detection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('a revoked session lands signed out, never on cached data', async () => {
    // Server verdict: the JWT is definitively rejected (revoked / user deleted).
    mockGetUser.mockResolvedValueOnce({
      data: { user: null },
      error: new AuthApiError('session revoked', 401, 'session_not_found'),
    });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {
      mockAuthCallback('SIGNED_IN', FAKE_SESSION);
    });
    await waitFor(() => expect(result.current.status).toBe('signedOut'));
    expect(result.current.profile).toBeNull();
    expect(result.current.memberships).toEqual([]);
  });

  test('a transient network failure still restores the cached account path', async () => {
    // No verdict: getUser itself fails (offline) — not proof of revocation.
    mockGetUser.mockRejectedValueOnce(new Error('network down'));
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {
      mockAuthCallback('SIGNED_IN', FAKE_SESSION);
    });
    // Stays authed (cached-account fallback; empty cache in this test, but the
    // session survives) instead of being force-signed-out.
    await waitFor(() => expect(result.current.status).toBe('authed'));
    expect(result.current.userId).toBe('user-1');
  });
});
