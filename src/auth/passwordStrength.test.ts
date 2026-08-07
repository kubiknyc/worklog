/**
 * checkPasswordStrength — the credential floor for invite-style registration.
 * Registration collects no password, so set-password is the ONLY place a
 * credential is chosen; if this floor is wrong there is no second gate.
 */
import { checkPasswordStrength, MIN_PASSWORD_LENGTH, MIN_PASSWORD_SCORE } from './passwordStrength';

it('treats an empty password as unacceptable with no label', () => {
  const result = checkPasswordStrength('');
  expect(result.isAcceptable).toBe(false);
  expect(result.label).toBe('');
  expect(result.suggestion).toBeNull();
});

it('rejects a password below the length floor even when it scores well', () => {
  // Short-but-random: zxcvbn may score this highly, so length must be
  // enforced independently of score.
  const result = checkPasswordStrength('q7#Zx');
  expect(result.isAcceptable).toBe(false);
});

it('rejects trivially guessable passwords at or above the length floor', () => {
  for (const weak of ['password', '12345678', 'qwertyui', 'aaaaaaaa']) {
    const result = checkPasswordStrength(weak);
    expect(result.isAcceptable).toBe(false);
    expect(result.score).toBeLessThan(MIN_PASSWORD_SCORE);
  }
});

it('accepts a strong passphrase', () => {
  const result = checkPasswordStrength('correct-horse-battery-staple-42');
  expect(result.isAcceptable).toBe(true);
  expect(result.score).toBeGreaterThanOrEqual(MIN_PASSWORD_SCORE);
  expect(result.suggestion).toBeNull();
});

it('offers a suggestion only while the password is unacceptable', () => {
  expect(checkPasswordStrength('password').suggestion).toBeTruthy();
  expect(checkPasswordStrength('correct-horse-battery-staple-42').suggestion).toBeNull();
});

it('always reports a score in the 0–4 range with a matching label', () => {
  for (const candidate of ['a', 'password', 'Tr0ub4dor&3', 'correct-horse-battery-staple-42']) {
    const result = checkPasswordStrength(candidate);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(4);
    expect(result.label.length).toBeGreaterThan(0);
  }
});

// Exact values, not >=: the website mirror (website/lib/passwordStrength.ts)
// pins the same two numbers, and a loose assertion here would let the app's
// floor silently drop to the trivially-guessable tier while staying green.
it('keeps the floors in sync with the website mirror', () => {
  expect(MIN_PASSWORD_LENGTH).toBe(8);
  expect(MIN_PASSWORD_SCORE).toBe(2);
});
