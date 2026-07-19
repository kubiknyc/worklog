/**
 * Supabase client (auth/data/storage).
 *
 * Reads public env vars injected by Expo at build time, plus the URL polyfill
 * required by supabase-js on React Native. Session tokens are persisted in the
 * device keychain via `expo-secure-store` (NOT AsyncStorage) — the refresh token
 * grants indefinite access, so it must not sit in cleartext where a rooted device
 * or an unencrypted backup can read it. On web there is no keychain, so the
 * online-only web build falls back to localStorage (supabase-js's own web
 * default); the router's Node render persists nothing.
 */
import 'react-native-url-polyfill/auto';

import * as SecureStore from 'expo-secure-store';
import { AppState, Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';

import type { Database } from './types';

/**
 * SecureStore-backed storage adapter for the Supabase auth session.
 *
 * SecureStore warns (and on iOS can refuse) values over ~2 KB, and a Supabase
 * session JSON (access + refresh JWT) routinely exceeds that. So values are
 * chunked: the primary key holds a chunk count, and `<key>.0`, `<key>.1`, …
 * hold the slices. Reads reassemble; writes/removes clean up any prior chunks.
 */
const CHUNK_SIZE = 2000;

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

const SecureStoreAdapter = {
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
      await SecureStore.setItemAsync(chunkKey(key, i), value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE));
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
 * the header doesn't apply.
 */
const WebStorageAdapter = {
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

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase env vars. Set EXPO_PUBLIC_SUPABASE_URL and ' +
      'EXPO_PUBLIC_SUPABASE_ANON_KEY in your .env file (see .env.example).',
  );
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: Platform.OS === 'web' ? WebStorageAdapter : SecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    // No URL-based session detection on native; deep-link auth lands later.
    detectSessionInUrl: false,
  },
});

// Supabase's recommended React Native wiring: the auto-refresh timer only runs
// reliably while the app is foregrounded, so start it on `active` and stop it
// otherwise (a backgrounded timer would fire late and let the session lapse).
// Web tabs refresh fine without this, so guard to native.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}
