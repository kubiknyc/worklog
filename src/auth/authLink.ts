/**
 * Auth deep-link parsing (ported verbatim from PunchLog — the parser is
 * scheme-agnostic). GoTrue action links verify the token server-side, then
 * redirect to `worklog://set-password` carrying the session in the URL
 * FRAGMENT (implicit flow):
 *
 *   worklog://set-password#access_token=...&refresh_token=...&type=invite
 *
 * or, when the link is expired/used, an error:
 *
 *   worklog://set-password#error=access_denied&error_description=...
 *
 * The client is configured with `detectSessionInUrl: false`, so this parses
 * the fragment explicitly; the caller feeds the result to
 * `supabase.auth.setSession`. Pure — unit-tested without any linking mocks.
 */

/** Which GoTrue action link produced the session. 'invite' and 'recovery'
 *  land on set-password (they drive its copy). 'signup' is the registration
 *  confirm link, which ALSO lands on set-password under invite-style
 *  registration — no password is collected at sign-up, so the confirm link is
 *  where the account owner chooses one.
 *  Unknown/absent `type` values fall back to 'other' rather than failing the
 *  parse. */
export type AuthLinkType = 'invite' | 'recovery' | 'signup' | 'other';

export type AuthLinkResult =
  | {
      readonly kind: 'session';
      readonly accessToken: string;
      readonly refreshToken: string;
      readonly linkType: AuthLinkType;
    }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'none' };

function linkTypeOf(raw: string | null): AuthLinkType {
  return raw === 'invite' || raw === 'recovery' || raw === 'signup' ? raw : 'other';
}

/** The ONLY message shown for a failed auth link — see the note in
 *  parseAuthLink about attacker-controlled `error_description`. */
export const LINK_PROBLEM_MESSAGE = 'This link is no longer valid.';

export function parseAuthLink(url: string | null): AuthLinkResult {
  if (!url) return { kind: 'none' };
  const hashIndex = url.indexOf('#');
  if (hashIndex < 0) return { kind: 'none' };

  const params = new URLSearchParams(url.slice(hashIndex + 1));
  if (params.get('error') || params.get('error_description')) {
    // SECURITY: never surface GoTrue's `error_description`. A custom-scheme
    // link is openable by any web page or app, so `error_description` is
    // fully attacker-controlled — echoing it renders arbitrary text under the
    // WorkLog logo ("Your account is locked, call this number…"), which is a
    // phishing vector. A fixed string tells the user everything they can act
    // on anyway.
    return { kind: 'error', message: LINK_PROBLEM_MESSAGE };
  }

  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (accessToken && refreshToken) {
    return { kind: 'session', accessToken, refreshToken, linkType: linkTypeOf(params.get('type')) };
  }
  return { kind: 'none' };
}
