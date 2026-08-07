/**
 * The confirm.tsx -> set-password hand-off. This module exists because
 * `router.replace` fires no deep-link event and a warm-start `useURL()` can
 * return a STALE launch URL — so if the hand-off silently stops working, a
 * legacy confirm link strands the user with an unspent one-shot token.
 */
import { stashAuthFragment, takeAuthFragment } from './pendingAuthLink';

beforeEach(() => {
  // Drain anything a previous test left behind — module state is shared.
  takeAuthFragment();
});

it('hands a stashed fragment to the next reader', () => {
  stashAuthFragment('access_token=abc&refresh_token=def&type=signup');
  expect(takeAuthFragment()).toBe('access_token=abc&refresh_token=def&type=signup');
});

it('strips a leading # so the value is a bare fragment', () => {
  stashAuthFragment('#access_token=abc');
  expect(takeAuthFragment()).toBe('access_token=abc');
});

it('returns null when nothing was stashed', () => {
  expect(takeAuthFragment()).toBeNull();
});

// A one-shot token must not be replayable: a second mount (or a re-render
// that re-reads) has to get nothing rather than re-apply spent tokens.
it('clears the fragment on read so it can only be consumed once', () => {
  stashAuthFragment('access_token=abc');
  expect(takeAuthFragment()).toBe('access_token=abc');
  expect(takeAuthFragment()).toBeNull();
});

it('treats an empty fragment as nothing stashed', () => {
  stashAuthFragment('#');
  expect(takeAuthFragment()).toBeNull();
});

it('keeps only the most recent fragment', () => {
  stashAuthFragment('access_token=old');
  stashAuthFragment('access_token=new');
  expect(takeAuthFragment()).toBe('access_token=new');
});
