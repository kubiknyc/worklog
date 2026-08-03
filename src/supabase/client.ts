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

import { AppState, Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';

import { SecureStoreAdapter, WebStorageAdapter } from './storageAdapters';
import type { Database } from './types';

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
