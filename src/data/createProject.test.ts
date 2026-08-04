/**
 * The header of `createProject.ts` used to delegate the offline-vs-rejected
 * decision to CreateProjectSheet via `isLikelyOffline`. That gate was
 * unreachable: `fail()` discarded the original error and threw one fixed
 * string, on which `isLikelyOffline` is always false — so every offline
 * attempt would have shown server-rejection copy (#22). The classification now
 * happens while the original error still exists, and these tests are what stop
 * it from being masked away again.
 */
import { createProject, OFFLINE_COPY, REJECTED_COPY } from './createProject';

type InsertResult = { error: { message: string; code?: string; status?: number } | null };

const mockInsert = jest.fn((..._args: unknown[]): Promise<InsertResult> =>
  Promise.resolve({ error: null }),
);
let mockSessionUserId: string | null = 'user-1';

jest.mock('../supabase/client', () => ({
  supabase: {
    auth: {
      getSession: () =>
        Promise.resolve({
          data: { session: mockSessionUserId ? { user: { id: mockSessionUserId } } : null },
        }),
    },
    from: () => ({ insert: (...args: unknown[]) => mockInsert(...args) }),
  },
}));
jest.mock('../lib/uuid', () => ({ uuidv4: () => 'minted-project-id' }));

let warnSpy: jest.SpyInstance;

beforeEach(() => {
  mockSessionUserId = 'user-1';
  mockInsert.mockClear();
  mockInsert.mockImplementation(() => Promise.resolve({ error: null }));
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => warnSpy.mockRestore());

describe('createProject success path', () => {
  it('returns the client-minted id and inserts without a select()', async () => {
    const id = await createProject({ name: '  Alpha  ' });

    // The id is minted client-side and IS the server PK; the insert carries no
    // .select() because RETURNING would 403 before the membership trigger
    // commits (see the module header).
    expect(id).toBe('minted-project-id');
    const row = mockInsert.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(row.id).toBe('minted-project-id');
    expect(row.name).toBe('Alpha'); // trimmed
    expect(row.created_by).toBe('user-1');
  });

  it('records provenance only when a real pin is supplied', async () => {
    await createProject({ name: 'Alpha', lat: 40.7, lng: -74 });
    const withPin = mockInsert.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(withPin.geocode_source).toBe('manual_pin');
    expect(typeof withPin.geocoded_at).toBe('string');

    mockInsert.mockClear();
    await createProject({ name: 'Alpha' });
    const noPin = mockInsert.mock.calls[0]?.[0] as Record<string, unknown>;
    // Both null so M9's geocoder can tell "never geocoded" from "user-placed".
    expect(noPin.geocode_source).toBeNull();
    expect(noPin.geocoded_at).toBeNull();
  });

  it('normalizes a blank address to null rather than an empty string', async () => {
    await createProject({ name: 'Alpha', address: '   ' });
    const row = mockInsert.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(row.address).toBeNull();
  });
});

describe('createProject input and session guards', () => {
  it('refuses a signed-out session before touching the network', async () => {
    mockSessionUserId = null;

    await expect(createProject({ name: 'Alpha' })).rejects.toThrow(
      'You appear to be signed out. Please sign in again.',
    );
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('refuses a whitespace-only name before touching the network', async () => {
    await expect(createProject({ name: '   ' })).rejects.toThrow('Enter a project name.');
    expect(mockInsert).not.toHaveBeenCalled();
  });
});

describe('createProject failure copy preserves the transport/server distinction', () => {
  it('shows offline copy when the request never reached the server', async () => {
    mockInsert.mockImplementation(() =>
      Promise.resolve({ error: { message: 'Network request failed', status: 0 } }),
    );

    // The whole point of the fix: masking first made this indistinguishable
    // from a server rejection, so the user was told the server said no.
    await expect(createProject({ name: 'Alpha' })).rejects.toThrow(OFFLINE_COPY);
  });

  it('shows rejection copy when the server replied and refused', async () => {
    mockInsert.mockImplementation(() =>
      Promise.resolve({ error: { message: 'permission denied', code: '42501', status: 403 } }),
    );

    await expect(createProject({ name: 'Alpha' })).rejects.toThrow(REJECTED_COPY);
  });

  it('never surfaces the raw PostgREST message, but does log it', async () => {
    mockInsert.mockImplementation(() =>
      Promise.resolve({ error: { message: 'column "secret_col" does not exist' } }),
    );

    await expect(createProject({ name: 'Alpha' })).rejects.not.toThrow(/secret_col/);
    expect(warnSpy).toHaveBeenCalledWith(
      '[createProject] project insert failed:',
      expect.objectContaining({ message: 'column "secret_col" does not exist' }),
    );
  });
});
