/**
 * Password strength for the /welcome set-password step (zxcvbn via @zxcvbn-ts).
 * Registration collects no password (invite-style flow), so /welcome is the
 * only place a web registrant chooses a credential — the strength floor lives
 * here.
 *
 * Mirrors src/auth/passwordStrength.ts in the app (separate package, not
 * shared): keep MIN_PASSWORD_LENGTH / MIN_PASSWORD_SCORE and the labels in
 * sync with it.
 *
 * Ported verbatim from PunchLog's website (PLW/lib/passwordStrength.ts) —
 * zxcvbn strength logic with no product-name references to rebrand.
 */
import type { ZxcvbnFactory } from "@zxcvbn-ts/core";

export const MIN_PASSWORD_LENGTH = 8;
/** zxcvbn score floor (0–4). 2 blocks the trivially guessable tier while
 *  staying realistic for phone keyboards on a job site. */
export const MIN_PASSWORD_SCORE = 2;

// @zxcvbn-ts v4 replaced v3's `zxcvbn()` + `zxcvbnOptions` singleton with a
// factory that takes its options at construction.
//
// The language packs are ~800 kB — statically importing them put that in
// /welcome's FIRST-LOAD bundle, on a page every registrant lands on. They are
// therefore imported dynamically (a separate chunk, fetched on the first
// keystroke) and the factory promise is memoised so the cost is paid once.
// This is why the web mirror is async and the app's is not: Metro bundles the
// app up front regardless, so there is nothing to defer there.
let factoryPromise: Promise<ZxcvbnFactory> | null = null;
function getFactory(): Promise<ZxcvbnFactory> {
  if (!factoryPromise) {
    factoryPromise = (async () => {
      const [core, common, en] = await Promise.all([
        import("@zxcvbn-ts/core"),
        import("@zxcvbn-ts/language-common"),
        import("@zxcvbn-ts/language-en"),
      ]);
      return new core.ZxcvbnFactory({
        translations: en.translations,
        graphs: common.adjacencyGraphs,
        dictionary: { ...common.dictionary, ...en.dictionary },
      });
    })();
    // Do NOT cache a rejection: the chunk fetch can fail transiently (offline,
    // or a stale build id after a redeploy — realistic for a link opened days
    // after the email). Caching the failure would make every later attempt
    // fail too, on the only web path to a credential.
    factoryPromise.catch(() => {
      factoryPromise = null;
    });
  }
  return factoryPromise;
}

export interface PasswordStrength {
  /** zxcvbn score, 0 (worst) – 4 (best). */
  readonly score: 0 | 1 | 2 | 3 | 4;
  /** Meets both the length floor and the score floor. */
  readonly isAcceptable: boolean;
  /** Plain-language meter label. */
  readonly label: string;
  /** zxcvbn's top suggestion when the password is too weak, else null. */
  readonly suggestion: string | null;
}

const LABELS: readonly string[] = ["Very weak", "Weak", "Okay", "Good", "Strong"];

export async function checkPasswordStrength(password: string): Promise<PasswordStrength> {
  if (password.length === 0) {
    return { score: 0, isAcceptable: false, label: "", suggestion: null };
  }
  const result = (await getFactory()).check(password);
  const score = result.score;
  const isAcceptable = password.length >= MIN_PASSWORD_LENGTH && score >= MIN_PASSWORD_SCORE;
  const suggestion = isAcceptable
    ? null
    : result.feedback.warning || result.feedback.suggestions[0] || null;
  return { score, isAcceptable, label: LABELS[score], suggestion };
}
