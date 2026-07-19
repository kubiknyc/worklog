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
const mockFrom = jest.fn((..._args: string[]): unknown => {
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

const mockClearAccountCaches = jest.fn(async (): Promise<void> => undefined);
jest.mock('./accountCaches', () => ({
  ...jest.requireActual('./accountCaches'),
  clearAccountCaches: () => mockClearAccountCaches(),
}));

// eslint-disable-next-line import/first
import { AuthProvider, useAuth } from './AuthProvider';

const FAKE_SESSION = { user: { id: 'user-1' } };
const FAKE_SESSION_2 = { user: { id: 'user-2' } };

function wrapper({ children }: { readonly children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

/** A chainable, awaitable stand-in for a PostgREST read query: `.eq()` returns
 *  itself, and the object itself resolves to `result` when awaited — covers
 *  both `.select().eq()` and bare `.select()` call shapes used by loadAccount. */
function makeReadOnlyTable<T>(result: { data: T; error: unknown }) {
  const thenable: {
    eq: () => typeof thenable;
    then: Promise<{ data: T; error: unknown }>['then'];
  } = {
    eq: () => thenable,
    then: (onFulfilled, onRejected) => Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return { select: () => thenable };
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

describe('AuthProvider.updateProfile generation guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('does not commit a stale PATCH response after the session generation has moved on', async () => {
    const initialProfile = { id: 'user-1', full_name: 'Original Name' };
    let resolveUpdate: (value: { data: unknown; error: null }) => void = () => {};
    const deferredUpdate = new Promise<{ data: unknown; error: null }>((resolve) => {
      resolveUpdate = resolve;
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: initialProfile, error: null }) }),
          }),
          update: () => ({
            eq: () => ({ select: () => ({ maybeSingle: () => deferredUpdate }) }),
          }),
        };
      }
      return makeReadOnlyTable({ data: [], error: null });
    });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {
      mockAuthCallback('SIGNED_IN', FAKE_SESSION);
    });
    await waitFor(() => expect(result.current.status).toBe('authed'));
    expect(result.current.profile).toEqual(initialProfile);

    // Fire the PATCH but don't await it yet — it stays pending on deferredUpdate.
    let updatePromise: Promise<string | null> = Promise.resolve(null);
    act(() => {
      updatePromise = result.current.updateProfile({ full_name: 'Patched Name' });
    });

    // A newer "session" supersedes the in-flight PATCH's generation before it
    // resolves (sign-out is the simplest way to bump sessionGenRef here).
    await act(async () => {
      mockAuthCallback('SIGNED_OUT', null);
    });
    await waitFor(() => expect(result.current.status).toBe('signedOut'));

    // Now let the stale PATCH resolve.
    await act(async () => {
      resolveUpdate({ data: { ...initialProfile, full_name: 'Patched Name' }, error: null });
      await updatePromise;
    });

    // The stale response must not resurrect a profile after sign-out.
    expect(result.current.status).toBe('signedOut');
    expect(result.current.profile).toBeNull();
  });
});

describe('AuthProvider revoked-session generation guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('a revoked verdict for a superseded session does not sign out the newer session', async () => {
    const user2Profile = { id: 'user-2', full_name: 'User Two' };
    let resolveGetUser: (value: { data: { user: null }; error: AuthApiError }) => void = () => {};
    const deferredGetUser = new Promise<{ data: { user: null }; error: AuthApiError }>(
      (resolve) => {
        resolveGetUser = resolve;
      },
    );
    mockGetUser.mockImplementationOnce(
      () => deferredGetUser as unknown as ReturnType<typeof mockGetUser>,
    );

    // Session A (user-1): loadAccount always throws until session B lands,
    // driving applySession into the catch branch → isSessionRevoked(), which
    // stays pending on deferredGetUser above.
    // Session B (user-2): loadAccount succeeds once installed.
    let sessionBInstalled = false;
    mockFrom.mockImplementation((table: string) => {
      if (!sessionBInstalled) throw new Error('account fetch failed');
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: user2Profile, error: null }) }),
          }),
        };
      }
      return makeReadOnlyTable({ data: [], error: null });
    });

    const { result } = renderHook(() => useAuth(), { wrapper });

    // Session A: loadAccount throws, isSessionRevoked() call held pending.
    await act(async () => {
      mockAuthCallback('SIGNED_IN', FAKE_SESSION);
    });

    // Session B installs and completes while session A's revoked-verdict is
    // still in flight.
    sessionBInstalled = true;
    await act(async () => {
      mockAuthCallback('SIGNED_IN', FAKE_SESSION_2);
    });
    await waitFor(() => expect(result.current.status).toBe('authed'));
    expect(result.current.userId).toBe('user-2');
    expect(result.current.profile).toEqual(user2Profile);

    // Session A's revoked verdict resolves late.
    await act(async () => {
      resolveGetUser({
        data: { user: null },
        error: new AuthApiError('session revoked', 401, 'session_not_found'),
      });
      // Flush the catch branch's chained awaits (signOut().catch(), then
      // clearAccountCaches(), then commit) so a still-unguarded
      // implementation has a chance to stomp session B's state.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Session B's state must survive untouched.
    expect(result.current.status).toBe('authed');
    expect(result.current.userId).toBe('user-2');
    expect(result.current.profile).toEqual(user2Profile);
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(mockClearAccountCaches).not.toHaveBeenCalled();
  });
});
