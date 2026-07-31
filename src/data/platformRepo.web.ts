/**
 * Web repository factory — online-only Supabase implementation (M1). This
 * file is the web bundle's entry into the data layer; it never imports
 * `src/db` or any `.native` module, so SQLite never reaches the web build.
 */
import { supabaseRepository } from './supabaseRepo';
import type { PlatformRepoBundle } from './types';

/**
 * `_sessionUserId` is ignored here — it only arms the native engine's pull
 * phase. The param exists so both platform files stay call-compatible.
 */
export async function createPlatformRepository(
  _sessionUserId: string | null,
): Promise<PlatformRepoBundle> {
  // No queue on web (writes are synchronous RPCs) — no engine to attach.
  return { repo: supabaseRepository, engine: null };
}
