/**
 * parseAuthLink — fragment parsing for the invite deep link: session tokens,
 * GoTrue error redirects, and everything else reads as "none".
 */
import { parseAuthLink } from './authLink';

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

it('falls back to linkType "other" for unknown or missing type values', () => {
  expect(
    parseAuthLink('worklog://set-password#access_token=at&refresh_token=rt&type=magiclink'),
  ).toMatchObject({ kind: 'session', linkType: 'other' });
  expect(parseAuthLink('worklog://set-password#access_token=at&refresh_token=rt')).toMatchObject({
    kind: 'session',
    linkType: 'other',
  });
});

it('surfaces a GoTrue error redirect with readable spacing', () => {
  const result = parseAuthLink(
    'worklog://set-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
  );
  expect(result).toEqual({ kind: 'error', message: 'Email link is invalid or has expired' });
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
