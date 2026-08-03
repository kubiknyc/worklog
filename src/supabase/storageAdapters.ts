/**
 * Auth-session storage adapters for supabase-js (#15).
 *
 * Extracted out of `client.ts` so the chunking logic is reachable by tests.
 * `client.ts` can only be imported for its side effects — it throws on missing
 * env vars, constructs a real client, and registers an `AppState` listener at
 * module scope — which is why it sat behind a `collectCoverageFrom` exclusion
 * with 0% coverage on a security-critical path. The wiring stays there; the
 * logic lives here.
 *
 * A silent break here signs the user out with no way back in offline, which in
 * a field app means losing access to a report while standing in front of it.
 */
import * as SecureStore from 'expo-secure-store';

/**
 * SecureStore warns (and on iOS can refuse) values over ~2 KB, and a Supabase
 * session JSON (access + refresh JWT) routinely exceeds that. So values are
 * chunked: the primary key holds a chunk count, and `<key>.0`, `<key>.1`, …
 * hold the slices. Reads reassemble; writes/removes clean up any prior chunks.
 */
export const CHUNK_SIZE = 2000;

export interface SessionStorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

function chunkKey(key: string, index: number): string {
  return `${key}.${index}`;
}

async function clearChunks(key: string): Promise<void> {
  const countRaw = await SecureStore.getItemAsync(key);
  const count = countRaw ? parseInt(countRaw, 10) : 0;
  if (Number.isNaN(count) || count <= 0) {
    await SecureStore.deleteItemAsync(key);
    return;
  }
  for (let i = 0; i < count; i += 1) {
    await SecureStore.deleteItemAsync(chunkKey(key, i));
  }
  await SecureStore.deleteItemAsync(key);
}

export const SecureStoreAdapter: SessionStorageAdapter = {
  async getItem(key: string): Promise<string | null> {
    const countRaw = await SecureStore.getItemAsync(key);
    if (countRaw == null) return null;
    const count = parseInt(countRaw, 10);
    if (Number.isNaN(count) || count <= 0) return null;
    const parts: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const part = await SecureStore.getItemAsync(chunkKey(key, i));
      if (part == null) return null; // a missing slice means a corrupt/partial write
      parts.push(part);
    }
    return parts.join('');
  },
  async setItem(key: string, value: string): Promise<void> {
    await clearChunks(key); // drop any larger prior value's leftover slices
    const count = Math.max(1, Math.ceil(value.length / CHUNK_SIZE));
    for (let i = 0; i < count; i += 1) {
      await SecureStore.setItemAsync(
        chunkKey(key, i),
        value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
      );
    }
    await SecureStore.setItemAsync(key, String(count));
  },
  async removeItem(key: string): Promise<void> {
    await clearChunks(key);
  },
};

/**
 * Web storage adapter. Web builds must never touch SecureStore: the native
 * module doesn't exist there, and during Expo Router's Node render (static/SSR
 * pass, where `window` is also absent) the call throws and kills the dev
 * server. localStorage matches supabase-js's own web default; the web target
 * is an online-only companion surface, so the keychain-level threat model in
 * `client.ts` doesn't apply.
 */
export const WebStorageAdapter: SessionStorageAdapter = {
  async getItem(key: string): Promise<string | null> {
    if (typeof window === 'undefined') return null; // Node render: no session
    return window.localStorage.getItem(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(key, value);
  },
  async removeItem(key: string): Promise<void> {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(key);
  },
};
