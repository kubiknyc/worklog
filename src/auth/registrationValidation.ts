/**
 * Client-side mirror of the register-company edge function's validation rules.
 * Three copies must stay in sync (none can import the others):
 *   - supabase/functions/register-company/index.ts (server — the authority)
 *   - website/lib/validate.ts (marketing site's register form)
 *   - this file (the app's register screen)
 * This only gives instant field-level feedback before the network call.
 *
 * Invite-style registration collects NO password — the user chooses one on
 * the set-password screen after confirming their email (see app/set-password.tsx).
 */
export const NAME_MAX = 120;
export const EMAIL_MAX = 254; // RFC 5321

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface RegisterInput {
  readonly companyName: string;
  readonly fullName: string;
  readonly email: string;
}

export type RegisterField = keyof RegisterInput;

export type FieldErrors = Partial<Record<RegisterField, string>>;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

/** Returns per-field messages; an empty object means the input is valid. */
export function validateRegistration(input: RegisterInput): FieldErrors {
  const errors: FieldErrors = {};
  const company = input.companyName.trim();
  if (company.length === 0) {
    errors.companyName = 'Enter your company name.';
  } else if (company.length > NAME_MAX) {
    errors.companyName = `Company name must be ${NAME_MAX} characters or fewer.`;
  }
  const name = input.fullName.trim();
  if (name.length === 0) {
    errors.fullName = 'Enter your name.';
  } else if (name.length > NAME_MAX) {
    errors.fullName = `Name must be ${NAME_MAX} characters or fewer.`;
  }
  if (!isValidEmail(input.email) || input.email.trim().length > EMAIL_MAX) {
    errors.email = 'Enter a valid email address.';
  }
  return errors;
}
