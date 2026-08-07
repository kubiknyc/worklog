/**
 * validateRegistration — jest port of website/lib/validate.test.ts (the two
 * validators mirror each other and the edge function; see the module header).
 *
 * Invite-style registration collects no password, so there is nothing to
 * validate here beyond the three identity fields — the credential floor lives
 * in passwordStrength.ts, exercised on the set-password screen.
 */
import {
  EMAIL_MAX,
  NAME_MAX,
  validateRegistration,
  type RegisterInput,
} from './registrationValidation';

const VALID: RegisterInput = {
  companyName: 'Keystone Build Group',
  fullName: 'Sam Keystone',
  email: 'sam@example.com',
};

it('accepts a valid registration', () => {
  expect(validateRegistration(VALID)).toEqual({});
});

it('requires company and full name, trimmed', () => {
  const errors = validateRegistration({ ...VALID, companyName: '   ', fullName: '' });
  expect(errors.companyName).toBeTruthy();
  expect(errors.fullName).toBeTruthy();
});

it('caps names at the server limit', () => {
  const long = 'x'.repeat(NAME_MAX + 1);
  const errors = validateRegistration({ ...VALID, companyName: long, fullName: long });
  expect(errors.companyName).toBeTruthy();
  expect(errors.fullName).toBeTruthy();
});

it('rejects malformed emails', () => {
  for (const email of ['not-an-email', 'missing@domain', '@no-local.com', '']) {
    expect(validateRegistration({ ...VALID, email }).email).toBeTruthy();
  }
});

it('caps email length (oversized input)', () => {
  const longEmail = `${'a'.repeat(EMAIL_MAX)}@example.com`;
  expect(validateRegistration({ ...VALID, email: longEmail }).email).toBeTruthy();
});

// Regression guard for the registration-takeover fix: a password must never
// re-enter the registration contract. If someone re-adds a password field to
// RegisterInput, this stops it at the test boundary.
it('ignores a password even if a caller smuggles one in', () => {
  const withPassword = { ...VALID, password: 'x' } as RegisterInput;
  expect(validateRegistration(withPassword)).toEqual({});
});
