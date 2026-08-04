/**
 * Web repository factory — online-only Supabase implementation (M1). This
 * file is the web bundle's entry into the data layer; it never imports
 * `src/db` or any `.native` module, so SQLite never reaches the web build.
 */
import { supabaseRepository } from './supabaseRepo';
import type { PlatformRepoBundle, Repository } from './types';

/**
 * The repository available on the FIRST render, or null when the platform
 * needs async hydration first. Web is online-only, so it has one immediately
 * and never shows a hydration gate.
 *
 * This exists so the provider asks the seam instead of branching on
 * `Platform.OS === 'web'` itself. Before #22 it did the latter and imported
 * `supabaseRepository` directly, which left this whole file dead at runtime:
 * editing it to return a caching repo or a real engine changed nothing, and
 * nothing caught that — tsc resolves `./platformRepo` to the `.native` variant
 * via `moduleSuffixes`, and `check:web` bundles this file without calling it.
 */
export const INITIAL_REPOSITORY: Repository | null = supabaseRepository;

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
