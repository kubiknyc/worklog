/**
 * Password strength for the set-password screen (zxcvbn via @zxcvbn-ts).
 * Registration collects no password (invite-style flow), so this screen is
 * the only place a credential is chosen — the strength floor lives here.
 *
 * Mirrored (not shared — separate package) by website/lib/passwordStrength.ts;
 * keep MIN_PASSWORD_LENGTH / MIN_PASSWORD_SCORE and the labels in sync.
 */
import { ZxcvbnFactory } from '@zxcvbn-ts/core';
import * as zxcvbnCommonPackage from '@zxcvbn-ts/language-common';
import * as zxcvbnEnPackage from '@zxcvbn-ts/language-en';

export const MIN_PASSWORD_LENGTH = 8;
/** zxcvbn score floor (0–4). 2 blocks the trivially guessable tier while
 *  staying realistic for phone keyboards on a job site. */
export const MIN_PASSWORD_SCORE = 2;

// @zxcvbn-ts v4 replaced v3's `zxcvbn()` + `zxcvbnOptions` singleton with a
// factory that takes its options at construction. Built lazily and reused so
// the dictionaries are loaded once, on the first check, rather than at import
// time. (Unlike the website mirror this is synchronous: Metro bundles the app
// up front, so there is nothing to defer.)
let factory: ZxcvbnFactory | null = null;
function getFactory(): ZxcvbnFactory {
  if (!factory) {
    factory = new ZxcvbnFactory({
      translations: zxcvbnEnPackage.translations,
      graphs: zxcvbnCommonPackage.adjacencyGraphs,
      dictionary: { ...zxcvbnCommonPackage.dictionary, ...zxcvbnEnPackage.dictionary },
    });
  }
  return factory;
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

const LABELS: readonly string[] = ['Very weak', 'Weak', 'Okay', 'Good', 'Strong'];

export function checkPasswordStrength(password: string): PasswordStrength {
  if (password.length === 0) {
    return { score: 0, isAcceptable: false, label: '', suggestion: null };
  }
  const result = getFactory().check(password);
  const score = result.score;
  const isAcceptable = password.length >= MIN_PASSWORD_LENGTH && score >= MIN_PASSWORD_SCORE;
  const suggestion = isAcceptable
    ? null
    : result.feedback.warning || result.feedback.suggestions[0] || null;
  return { score, isAcceptable, label: LABELS[score], suggestion };
}
