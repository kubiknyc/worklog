/**
 * What the legacy confirm shim (app/confirm.tsx) should do with an incoming
 * link. Extracted from the screen so it can be TESTED: CLAUDE.md forbids test
 * files under app/, and this decision is the account-takeover fix.
 *
 * The security property is encoded in the return type. There is no variant
 * that applies tokens or navigates into the app — the pre-fix behaviour
 * (auto-apply the link's tokens and jump to the tabs, which is what let an
 * attacker's chosen password be activated by the victim's click) is not
 * expressible here. A regression would have to add a new variant AND a handler
 * for it, rather than silently flipping a branch.
 */
import { parseAuthLink } from './authLink';

export type ConfirmLandingAction =
  /** No parseable link yet — keep showing the waiting state. */
  | { readonly kind: 'wait' }
  /** GoTrue reported a problem, or the link is malformed. */
  | { readonly kind: 'invalid'; readonly message: string }
  /** Hand this fragment to set-password; tokens stay unapplied. */
  | { readonly kind: 'forward'; readonly fragment: string };

export function planConfirmLanding(url: string | null): ConfirmLandingAction {
  const parsed = parseAuthLink(url);
  if (parsed.kind === 'error') return { kind: 'invalid', message: parsed.message };
  if (parsed.kind !== 'session' || !url) return { kind: 'wait' };
  const hashIndex = url.indexOf('#');
  if (hashIndex < 0) return { kind: 'wait' };
  const fragment = url.slice(hashIndex + 1);
  return fragment ? { kind: 'forward', fragment } : { kind: 'wait' };
}
