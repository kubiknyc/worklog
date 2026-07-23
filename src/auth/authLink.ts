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

/** Which GoTrue action link produced the session — drives screen copy only
 *  (an invitee is welcomed; a password reset says "reset"). Unknown/absent
 *  `type` values fall back to 'other' rather than failing the parse. */
export type AuthLinkType = 'invite' | 'recovery' | 'other';

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
  return raw === 'invite' || raw === 'recovery' ? raw : 'other';
}

export function parseAuthLink(url: string | null): AuthLinkResult {
  if (!url) return { kind: 'none' };
  const hashIndex = url.indexOf('#');
  if (hashIndex < 0) return { kind: 'none' };

  const params = new URLSearchParams(url.slice(hashIndex + 1));
  const errorDescription = params.get('error_description');
  if (params.get('error') || errorDescription) {
    return {
      kind: 'error',
      // GoTrue encodes spaces as '+' in error_description.
      message: (errorDescription ?? 'This link is no longer valid.').replace(/\+/g, ' '),
    };
  }

  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (accessToken && refreshToken) {
    return { kind: 'session', accessToken, refreshToken, linkType: linkTypeOf(params.get('type')) };
  }
  return { kind: 'none' };
}
