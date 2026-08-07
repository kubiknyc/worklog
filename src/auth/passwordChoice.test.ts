/**
 * The only credential gate an app user passes through. Registration collects
 * no password, so a regression here means weak passwords reach real accounts
 * with nothing else to catch them.
 */
import { validatePasswordChoice } from './passwordChoice';
import { MIN_PASSWORD_LENGTH } from './passwordStrength';

const STRONG = 'correct-horse-battery-staple-42';

it('accepts a strong password that matches its confirmation', () => {
  expect(validatePasswordChoice(STRONG, STRONG)).toEqual({ kind: 'ok' });
});

it('rejects passwords below the length floor', () => {
  const short = 'q7#Zx';
  expect(short.length).toBeLessThan(MIN_PASSWORD_LENGTH);
  const result = validatePasswordChoice(short, short);
  expect(result.kind).toBe('error');
  expect(result.kind === 'error' && result.message).toContain(`${MIN_PASSWORD_LENGTH}`);
});

// The floor that actually matters: these all clear 8 characters, and the
// pre-fix screen (length-only) would have accepted every one of them.
it('rejects long-but-guessable passwords', () => {
  for (const weak of ['password', '12345678', 'qwertyui', 'aaaaaaaa', 'password123']) {
    expect(weak.length).toBeGreaterThanOrEqual(MIN_PASSWORD_LENGTH);
    expect(validatePasswordChoice(weak, weak).kind).toBe('error');
  }
});

it('rejects a mismatched confirmation even when the password is strong', () => {
  const result = validatePasswordChoice(STRONG, `${STRONG}x`);
  expect(result).toEqual({ kind: 'error', message: "Those passwords don't match." });
});

it('rejects an empty password', () => {
  expect(validatePasswordChoice('', '').kind).toBe('error');
});

// Strength is checked BEFORE the match, so a weak password typed identically
// twice is still refused rather than sliding through on "they match".
it('checks strength before confirmation matching', () => {
  const result = validatePasswordChoice('password', 'password');
  expect(result.kind).toBe('error');
  expect(result.kind === 'error' && result.message).not.toContain("don't match");
});

it('only ever returns ok or error — there is no bypass value', () => {
  for (const [pw, cf] of [
    [STRONG, STRONG],
    ['password', 'password'],
    ['', ''],
    [STRONG, 'nope'],
  ]) {
    expect(['ok', 'error']).toContain(validatePasswordChoice(pw, cf).kind);
  }
});
