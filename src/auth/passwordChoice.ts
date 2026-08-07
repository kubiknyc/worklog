/**
 * The credential gate for app/set-password.tsx, extracted so it can be TESTED
 * (CLAUDE.md forbids test files under app/).
 *
 * Under invite-style registration nothing is collected at sign-up, so this is
 * the ONLY point where an app user chooses a password. The server minimum is
 * weaker than what we want, so if this gate is wrong there is no second one.
 * Mirrors the website's /welcome check.
 */
import { checkPasswordStrength, MIN_PASSWORD_LENGTH } from './passwordStrength';

export type PasswordChoiceResult =
  { readonly kind: 'ok' } | { readonly kind: 'error'; readonly message: string };

/**
 * Validate a chosen password and its confirmation. `ok` is the ONLY result the
 * caller may treat as permission to write the credential.
 */
export function validatePasswordChoice(
  password: string,
  confirmation: string,
): PasswordChoiceResult {
  const strength = checkPasswordStrength(password);
  if (!strength.isAcceptable) {
    return {
      kind: 'error',
      message:
        password.length < MIN_PASSWORD_LENGTH
          ? `Use at least ${MIN_PASSWORD_LENGTH} characters.`
          : (strength.suggestion ??
            'That password is too easy to guess — try a longer or less common one.'),
    };
  }
  if (password !== confirmation) {
    return { kind: 'error', message: "Those passwords don't match." };
  }
  return { kind: 'ok' };
}
