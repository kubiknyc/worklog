/**
 * The account-takeover regression guard.
 *
 * Before the fix, a signup confirm link landing on app/confirm.tsx applied its
 * tokens and dropped the user into the tabs — so an attacker who registered a
 * victim's email with a password of their choosing had that account activated
 * by the victim's own click. The fix: this screen must NEVER apply tokens or
 * navigate into the app; it only forwards the fragment to set-password, where
 * the inbox owner chooses the credential.
 */
import { planConfirmLanding, type ConfirmLandingAction } from './confirmLanding';

const SIGNUP_LINK = 'worklog://confirm#access_token=at123&refresh_token=rt456&type=signup';

it('forwards a signup confirm link instead of consuming it', () => {
  const action = planConfirmLanding(SIGNUP_LINK);
  expect(action).toEqual({
    kind: 'forward',
    fragment: 'access_token=at123&refresh_token=rt456&type=signup',
  });
});

it('forwards the fragment verbatim — tokens are not parsed out or altered', () => {
  const action = planConfirmLanding(SIGNUP_LINK);
  // set-password re-parses the fragment; anything lost here strands the user.
  expect(action.kind === 'forward' && action.fragment).toContain('access_token=at123');
  expect(action.kind === 'forward' && action.fragment).toContain('refresh_token=rt456');
});

// THE takeover guard: no reachable action signs the user in or routes to tabs.
it('never yields an action that applies tokens or enters the app', () => {
  const inputs = [
    SIGNUP_LINK,
    'worklog://confirm#access_token=a&refresh_token=b&type=recovery',
    'worklog://confirm#access_token=a&refresh_token=b&type=invite',
    'worklog://confirm#error_description=expired',
    'worklog://confirm',
    null,
  ];
  const allowed = new Set<ConfirmLandingAction['kind']>(['wait', 'invalid', 'forward']);
  for (const input of inputs) {
    expect(allowed.has(planConfirmLanding(input).kind)).toBe(true);
  }
});

it('reports a GoTrue error link as invalid rather than forwarding it', () => {
  const action = planConfirmLanding('worklog://confirm#error_description=Token+has+expired');
  expect(action.kind).toBe('invalid');
});

it('waits when there is no link yet', () => {
  expect(planConfirmLanding(null)).toEqual({ kind: 'wait' });
});

it('waits on a session-less or fragment-less link rather than forwarding nothing', () => {
  expect(planConfirmLanding('worklog://confirm')).toEqual({ kind: 'wait' });
  expect(planConfirmLanding('worklog://confirm#')).toEqual({ kind: 'wait' });
});
