/**
 * Web repository factory — online-only Supabase implementation (M1). This
 * file is the web bundle's entry into the data layer; it never imports
 * `src/db` or any `.native` module, so SQLite never reaches the web build.
 */
import { supabaseRepository } from './supabaseRepo';
import type { Repository } from './types';

export async function createPlatformRepository(): Promise<Repository> {
  return supabaseRepository;
}
