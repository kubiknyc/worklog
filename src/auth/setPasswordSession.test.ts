/**
 * updateAuthPassword's status mapping and applyAuthTokens' queue-loss guard.
 *
 * The status mapping is the whole reason UpdatePasswordResult is a
 * discriminated union rather than a boolean: an expired one-shot link and a
 * dropped connection need OPPOSITE next steps. Collapsing them told users with
 * a spent link to "check your connection", sending them into a retry loop
 * that could never succeed — on the only screen where an app user gets a
 * credential.
 *
 * The queue-loss guard (spec A5) is the reason applyAuthTokens takes a
 * `pendingMutationCount` producer at all: if user A has unsynced queued
 * mutations and taps user B's confirm/recovery link, applying B's session
 * rebuilds RepositoryProvider and wipes A's local cache — including the
 * queue — before any of it reaches the server. That swap must be refused,
 * never silently destructive.
 */
import { applyAuthTokens, updateAuthPassword } from './setPasswordSession';

const mockUpdateUser = jest.fn();
const mockSetSession = jest.fn();
const mockGetSession = jest.fn();

jest.mock('../supabase/client', () => ({
  supabase: {
    auth: {
      updateUser: (...args: unknown[]) => mockUpdateUser(...args),
      setSession: (...args: unknown[]) => mockSetSession(...args),
      getSession: (...args: unknown[]) => mockGetSession(...args),
    },
  },
}));

/** Build a syntactically-valid (unsigned) JWT carrying only `sub` — GoTrue
 *  verifies the signature server-side; this module only reads the claim. */
function fakeJwt(sub: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub })).toString('base64url');
  return `${header}.${payload}.`;
}

function sessionFor(userId: string) {
  return { data: { session: { user: { id: userId } } } };
}

const NO_SESSION = { data: { session: null } };

beforeEach(() => {
  mockUpdateUser.mockReset();
  mockSetSession.mockReset();
  mockGetSession.mockReset();
});

describe('updateAuthPassword', () => {
  it('reports ok when the password is accepted', async () => {
    mockUpdateUser.mockResolvedValue({ error: null });
    expect(await updateAuthPassword('correct-horse-battery-staple-42')).toEqual({ kind: 'ok' });
  });

  it('sends the password through to GoTrue', async () => {
    mockUpdateUser.mockResolvedValue({ error: null });
    await updateAuthPassword('correct-horse-battery-staple-42');
    expect(mockUpdateUser).toHaveBeenCalledWith({ password: 'correct-horse-battery-staple-42' });
  });

  it.each([401, 403])(
    'maps %i to expired — the link is spent, retrying cannot work',
    async (status) => {
      mockUpdateUser.mockResolvedValue({ error: { status, message: 'unauthorized' } });
      expect(await updateAuthPassword('correct-horse-battery-staple-42')).toEqual({
        kind: 'expired',
      });
    },
  );

  it('maps 422 to rejected and surfaces the server message', async () => {
    mockUpdateUser.mockResolvedValue({ error: { status: 422, message: 'Password is too weak' } });
    expect(await updateAuthPassword('short')).toEqual({
      kind: 'rejected',
      message: 'Password is too weak',
    });
  });

  it('maps a transport failure (no status) to failed, which is the retryable one', async () => {
    mockUpdateUser.mockResolvedValue({ error: { message: 'Network request failed' } });
    expect(await updateAuthPassword('correct-horse-battery-staple-42')).toEqual({
      kind: 'failed',
    });
  });

  it('maps a 5xx to failed rather than expired', async () => {
    mockUpdateUser.mockResolvedValue({ error: { status: 500, message: 'boom' } });
    expect(await updateAuthPassword('correct-horse-battery-staple-42')).toEqual({
      kind: 'failed',
    });
  });

  // An expired link and an offline device must never collapse together again.
  it('never reports expired for a non-auth failure', async () => {
    for (const error of [{ status: 500 }, { status: 429 }, { message: 'offline' }]) {
      mockUpdateUser.mockResolvedValue({ error });
      expect((await updateAuthPassword('correct-horse-battery-staple-42')).kind).not.toBe(
        'expired',
      );
    }
  });
});

describe('applyAuthTokens — queue-loss guard (spec A5)', () => {
  // THE regression this guard exists to prevent: user A has queued offline
  // reports, taps user B's link, and the swap would wipe A's cache.
  it('blocks a different-user session swap when mutations are pending', async () => {
    mockGetSession.mockResolvedValue(sessionFor('user-a'));
    const pendingMutationCount = jest.fn().mockResolvedValue(2);

    const result = await applyAuthTokens(fakeJwt('user-b'), 'rt', pendingMutationCount);

    expect(result).toEqual({ kind: 'blockedPendingSync' });
    expect(mockSetSession).not.toHaveBeenCalled();
  });

  it('applies a different-user session once the pending count is zero', async () => {
    mockGetSession.mockResolvedValue(sessionFor('user-a'));
    mockSetSession.mockResolvedValue({ error: null });
    const pendingMutationCount = jest.fn().mockResolvedValue(0);

    const result = await applyAuthTokens(fakeJwt('user-b'), 'rt', pendingMutationCount);

    expect(result).toEqual({ kind: 'ok' });
    expect(mockSetSession).toHaveBeenCalledWith({
      access_token: fakeJwt('user-b'),
      refresh_token: 'rt',
    });
  });

  it('never consults the counter for a same-user link', async () => {
    mockGetSession.mockResolvedValue(sessionFor('user-a'));
    mockSetSession.mockResolvedValue({ error: null });
    const pendingMutationCount = jest.fn().mockResolvedValue(2);

    const result = await applyAuthTokens(fakeJwt('user-a'), 'rt', pendingMutationCount);

    expect(result).toEqual({ kind: 'ok' });
    expect(pendingMutationCount).not.toHaveBeenCalled();
  });

  it('never consults the counter when nobody is currently signed in', async () => {
    mockGetSession.mockResolvedValue(NO_SESSION);
    mockSetSession.mockResolvedValue({ error: null });
    const pendingMutationCount = jest.fn().mockResolvedValue(5);

    const result = await applyAuthTokens(fakeJwt('user-b'), 'rt', pendingMutationCount);

    expect(result).toEqual({ kind: 'ok' });
    expect(pendingMutationCount).not.toHaveBeenCalled();
  });

  it('falls through to GoTrue validation unguarded when the token cannot be decoded', async () => {
    mockSetSession.mockResolvedValue({ error: null });
    const pendingMutationCount = jest.fn().mockResolvedValue(2);

    const result = await applyAuthTokens('not-a-jwt', 'rt', pendingMutationCount);

    expect(result).toEqual({ kind: 'ok' });
    expect(mockGetSession).not.toHaveBeenCalled();
    expect(pendingMutationCount).not.toHaveBeenCalled();
    expect(mockSetSession).toHaveBeenCalledWith({ access_token: 'not-a-jwt', refresh_token: 'rt' });
  });

  it('reports rejected when GoTrue refuses the pair, guard or not', async () => {
    mockGetSession.mockResolvedValue(sessionFor('user-a'));
    mockSetSession.mockResolvedValue({ error: { message: 'invalid' } });
    const pendingMutationCount = jest.fn().mockResolvedValue(0);

    const result = await applyAuthTokens(fakeJwt('user-a'), 'rt', pendingMutationCount);

    expect(result).toEqual({ kind: 'rejected' });
  });
});
