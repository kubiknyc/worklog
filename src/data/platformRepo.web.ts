/**
 * Web repository factory — online-only Supabase implementation (M1). This
 * file is the web bundle's entry into the data layer; it never imports
 * `src/db` or any `.native` module, so SQLite never reaches the web build.
 */
import { supabaseRepository } from './supabaseRepo';
import type { PlatformRepoBundle } from './types';

export async function createPlatformRepository(): Promise<PlatformRepoBundle> {
  // No queue on web (writes are synchronous RPCs) — no counter to install.
  return { repo: supabaseRepository, counter: null };
}
