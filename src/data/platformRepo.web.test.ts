/**
 * `platformRepo.web.ts` was at 0% (#24) — the web half of the repository seam.
 *
 * It has already been dead once. Before #22 the provider branched on
 * `Platform.OS === 'web'` and imported `supabaseRepository` itself, so editing
 * this file changed nothing at runtime and nothing caught it: `tsc` resolves
 * `./platformRepo` to the `.native` variant via `moduleSuffixes`, and
 * `check:web` bundles this file without ever calling it. A test that imported
 * `./platformRepo` would repeat that mistake — it would resolve to the native
 * module and report the wrong file green. Hence the explicit `.web` import.
 */
import { INITIAL_REPOSITORY, createPlatformRepository } from './platformRepo.web';

// The real module constructs a Supabase client and throws without EXPO_PUBLIC_*
// env. Identity is all that matters here, so a sentinel is enough.
const webRepo = { __sentinel: 'supabaseRepository' };
jest.mock('./supabaseRepo', () => ({ supabaseRepository: webRepo }));

describe('the web seam', () => {
  it('offers a repository on the first render rather than null', () => {
    // This is the whole contract the provider reads. `null` here would put the
    // web build behind a hydration gate that never resolves — there is no
    // async hydration on web to close it.
    expect(INITIAL_REPOSITORY).toBe(webRepo);
  });

  it('builds the online-only repo with no engine', async () => {
    // No queue on web (writes are synchronous RPCs). An engine here would
    // attach a counter over a queue nothing writes to and nothing drains, so
    // the sync pill would report on a queue that cannot exist.
    await expect(createPlatformRepository(null)).resolves.toEqual({
      repo: webRepo,
      engine: null,
    });
  });

  it('ignores the session user id, which only arms the native pull phase', async () => {
    const signedOut = await createPlatformRepository(null);
    const signedIn = await createPlatformRepository('user-A');

    // The param exists so both platform files stay call-compatible; if web ever
    // starts varying on it, the provider's "never rebuild on account change"
    // guard becomes wrong and this is where that shows up.
    expect(signedIn.repo).toBe(signedOut.repo);
    expect(signedIn.engine).toBeNull();
  });
});
