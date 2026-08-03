/**
 * Coverage for the session storage adapters (#15).
 *
 * These were 0% covered and invisible to every threshold while they lived in
 * `client.ts` behind a `collectCoverageFrom` exclusion. The failure they guard
 * against is quiet: an off-by-one in the slice arithmetic, or a dropped
 * `clearChunks` on overwrite, leaves `getItem` reassembling a truncated session
 * JSON. supabase-js fails to restore it and the user is silently signed out —
 * which offline means losing access to a report they are standing in front of.
 */
import * as SecureStore from 'expo-secure-store';

import { CHUNK_SIZE, SecureStoreAdapter, WebStorageAdapter } from './storageAdapters';

const store = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const mocked = SecureStore as jest.Mocked<typeof SecureStore>;

beforeEach(() => {
  store.clear();
  jest.clearAllMocks();
  mocked.getItemAsync.mockImplementation(async (key: string) => store.get(key) ?? null);
  mocked.setItemAsync.mockImplementation(async (key: string, value: string) => {
    store.set(key, value);
  });
  mocked.deleteItemAsync.mockImplementation(async (key: string) => {
    store.delete(key);
  });
});

const KEY = 'sb-worklog-auth-token';

/** A stand-in for a real session JSON, sized to force `chunks` slices. */
function sessionOfChunks(chunks: number): string {
  return 'S'.repeat(CHUNK_SIZE * chunks);
}

describe('SecureStoreAdapter', () => {
  it('round-trips a value smaller than one chunk', async () => {
    await SecureStoreAdapter.setItem(KEY, 'short-session');

    expect(await SecureStoreAdapter.getItem(KEY)).toBe('short-session');
    expect(store.get(KEY)).toBe('1');
    expect(store.get(`${KEY}.0`)).toBe('short-session');
  });

  it('round-trips a value spanning several chunks without dropping bytes', async () => {
    // Deliberately not a chunk multiple: an off-by-one in the slice bounds
    // shows up as a length mismatch rather than a silently equal-length value.
    const value = sessionOfChunks(3) + 'tail';
    await SecureStoreAdapter.setItem(KEY, value);

    const read = await SecureStoreAdapter.getItem(KEY);
    expect(read).toHaveLength(value.length);
    expect(read).toBe(value);
    expect(store.get(KEY)).toBe('4');
  });

  it('writes no slice larger than CHUNK_SIZE', async () => {
    await SecureStoreAdapter.setItem(KEY, sessionOfChunks(3) + 'tail');

    const slices = [...store.entries()].filter(([k]) => k !== KEY);
    expect(slices).toHaveLength(4);
    for (const [, slice] of slices) {
      expect(slice.length).toBeLessThanOrEqual(CHUNK_SIZE);
    }
  });

  it('leaves no stale slices when a shrinking value overwrites a larger one', async () => {
    await SecureStoreAdapter.setItem(KEY, sessionOfChunks(4));
    await SecureStoreAdapter.setItem(KEY, 'tiny');

    expect(await SecureStoreAdapter.getItem(KEY)).toBe('tiny');
    expect(store.get(KEY)).toBe('1');
    // The regression this catches: `.1`–`.3` surviving the overwrite, so a
    // later count bump would reassemble a Frankenstein session.
    expect([...store.keys()].sort()).toEqual([KEY, `${KEY}.0`]);
  });

  it('stores an empty value as a single empty slice, not as absent', async () => {
    await SecureStoreAdapter.setItem(KEY, '');

    expect(store.get(KEY)).toBe('1');
    expect(await SecureStoreAdapter.getItem(KEY)).toBe('');
  });

  it('returns null for a key that was never written', async () => {
    expect(await SecureStoreAdapter.getItem(KEY)).toBeNull();
  });

  it('returns null rather than a partial session when a slice is missing', async () => {
    await SecureStoreAdapter.setItem(KEY, sessionOfChunks(3));
    store.delete(`${KEY}.1`); // simulate a torn write / partial keychain wipe

    expect(await SecureStoreAdapter.getItem(KEY)).toBeNull();
  });

  it.each([
    ['a non-numeric count', 'garbage'],
    ['a zero count', '0'],
    ['a negative count', '-2'],
  ])('returns null for %s', async (_label, count) => {
    store.set(KEY, count);

    expect(await SecureStoreAdapter.getItem(KEY)).toBeNull();
  });

  it('removeItem clears the count key and every slice', async () => {
    await SecureStoreAdapter.setItem(KEY, sessionOfChunks(3));
    await SecureStoreAdapter.removeItem(KEY);

    expect(store.size).toBe(0);
    expect(await SecureStoreAdapter.getItem(KEY)).toBeNull();
  });

  it('removeItem clears a key whose count is unparseable', async () => {
    store.set(KEY, 'garbage');
    await SecureStoreAdapter.removeItem(KEY);

    expect(store.has(KEY)).toBe(false);
  });

  it('removeItem on an absent key is a no-op that still deletes cleanly', async () => {
    await expect(SecureStoreAdapter.removeItem(KEY)).resolves.toBeUndefined();
    expect(store.size).toBe(0);
  });
});

describe('WebStorageAdapter', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');

  afterEach(() => {
    if (original) Object.defineProperty(globalThis, 'window', original);
    else delete (globalThis as { window?: unknown }).window;
  });

  function withLocalStorage(): Map<string, string> {
    const backing = new Map<string, string>();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        localStorage: {
          getItem: (k: string) => backing.get(k) ?? null,
          setItem: (k: string, v: string) => backing.set(k, v),
          removeItem: (k: string) => backing.delete(k),
        },
      },
    });
    return backing;
  }

  function withoutWindow(): void {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: undefined });
  }

  it('round-trips through localStorage', async () => {
    withLocalStorage();

    await WebStorageAdapter.setItem(KEY, 'web-session');
    expect(await WebStorageAdapter.getItem(KEY)).toBe('web-session');

    await WebStorageAdapter.removeItem(KEY);
    expect(await WebStorageAdapter.getItem(KEY)).toBeNull();
  });

  it('never touches SecureStore', async () => {
    withLocalStorage();

    await WebStorageAdapter.setItem(KEY, 'web-session');
    await WebStorageAdapter.getItem(KEY);
    await WebStorageAdapter.removeItem(KEY);

    expect(mocked.getItemAsync).not.toHaveBeenCalled();
    expect(mocked.setItemAsync).not.toHaveBeenCalled();
    expect(mocked.deleteItemAsync).not.toHaveBeenCalled();
  });

  it('is inert during the Node render, where window is absent', async () => {
    withoutWindow();

    // The regression this catches: dropping the `typeof window` guards, which
    // throws during Expo Router's static pass and kills the dev server.
    await expect(WebStorageAdapter.setItem(KEY, 'v')).resolves.toBeUndefined();
    await expect(WebStorageAdapter.removeItem(KEY)).resolves.toBeUndefined();
    expect(await WebStorageAdapter.getItem(KEY)).toBeNull();
  });
});
