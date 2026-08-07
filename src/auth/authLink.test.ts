/**
 * parseAuthLink — fragment parsing for the invite deep link: session tokens,
 * GoTrue error redirects, and everything else reads as "none".
 */
import { LINK_PROBLEM_MESSAGE, parseAuthLink } from './authLink';

it('extracts the session tokens from an invite redirect', () => {
  const result = parseAuthLink(
    'worklog://set-password#access_token=at123&refresh_token=rt456&expires_in=3600&type=invite',
  );
  expect(result).toEqual({
    kind: 'session',
    accessToken: 'at123',
    refreshToken: 'rt456',
    linkType: 'invite',
  });
});

it('tags a password-recovery redirect so the screen can vary its copy', () => {
  const result = parseAuthLink(
    'worklog://set-password#access_token=at123&refresh_token=rt456&type=recovery',
  );
  expect(result).toEqual({
    kind: 'session',
    accessToken: 'at123',
    refreshToken: 'rt456',
    linkType: 'recovery',
  });
});

it('tags a signup confirmation redirect (registration confirm flow)', () => {
  const result = parseAuthLink(
    'worklog://confirm#access_token=at123&refresh_token=rt456&type=signup',
  );
  expect(result).toEqual({
    kind: 'session',
    accessToken: 'at123',
    refreshToken: 'rt456',
    linkType: 'signup',
  });
});

it('falls back to linkType "other" for unknown or missing type values', () => {
  expect(
    parseAuthLink('worklog://set-password#access_token=at&refresh_token=rt&type=magiclink'),
  ).toMatchObject({ kind: 'session', linkType: 'other' });
  expect(parseAuthLink('worklog://set-password#access_token=at&refresh_token=rt')).toMatchObject({
    kind: 'session',
    linkType: 'other',
  });
});

it('reports a GoTrue error redirect as an error', () => {
  const result = parseAuthLink(
    'worklog://set-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
  );
  expect(result).toEqual({ kind: 'error', message: LINK_PROBLEM_MESSAGE });
});

// PHISHING GUARD. A custom-scheme link can be opened by any web page, SMS or
// QR code, so `error_description` is entirely attacker-authored. Echoing it
// renders arbitrary text under the real WorkLog branding ("Your account is
// locked, call this number"). Native must not be weaker than that guarantee.
it('never echoes attacker-supplied error_description text', () => {
  const attacks = [
    'worklog://set-password#error_description=Your+account+is+locked.+Call+555-0100+to+restore+access',
    'worklog://confirm#error=x&error_description=Send+your+password+to+support@evil.example',
    'worklog://set-password#error_description=<b>urgent</b>',
  ];
  for (const url of attacks) {
    const result = parseAuthLink(url);
    expect(result).toEqual({ kind: 'error', message: LINK_PROBLEM_MESSAGE });
  }
});

it('reads a bare open (no fragment) as none', () => {
  expect(parseAuthLink('worklog://set-password')).toEqual({ kind: 'none' });
  expect(parseAuthLink(null)).toEqual({ kind: 'none' });
});

it('reads a fragment missing either token as none', () => {
  expect(parseAuthLink('worklog://set-password#access_token=at123&type=invite')).toEqual({
    kind: 'none',
  });
});
