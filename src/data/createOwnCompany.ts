/**
 * Create a company with the signed-in user as its admin, via the
 * `create_own_company` RPC (jobsight-backend, shared with PunchLog).
 * Standalone and online-only, like createProject: nothing to queue offline.
 *
 * Who gets here: a founder who declined the parked company on the website's
 * consent card, or otherwise has no company and no project. Registering again
 * only sends an account-exists email to a confirmed address, so without this
 * they are stuck. The card is gated by `canCreateOwnCompany`
 * (src/auth/roles.ts); the server is the real authority and refuses anyone
 * already affiliated.
 *
 * Only the error's `code` is read — server text is never shown or logged.
 * Each outcome returns its own plain sentence (CREATE_COMPANY_COPY):
 *   42501 / 401 / 403  sign-in expired
 *   PL001              email not confirmed
 *   PL002              already linked to a company (member, project seat,
 *                      phone-book contact, or creator — possibly a create
 *                      whose response was lost, so the caller re-checks)
 *   PL003              name fails the server's name rule (cleanCompanyName)
 *   429                rate limited
 *   anything else (including the function not existing yet) -> generic, or
 *   offline copy for a transport failure
 */
import { isLikelyOffline } from '../lib/errors';
import { supabase } from '../supabase/client';

/** Same cap as the server's PL003 check, in characters (code points). */
export const COMPANY_NAME_MAX = 120;

export const CREATE_COMPANY_COPY = {
  expired: 'Your sign-in has expired. Sign out, sign back in, and try again.',
  notConfirmed: 'Confirm your email first. Open the link in your sign-up email, then try again.',
  alreadyAffiliated:
    "Your account is already linked to a company on WorkLog. If you just set one up, it's ready — otherwise ask them to invite you to a project.",
  invalidName: `Enter a company name of up to ${COMPANY_NAME_MAX} characters, using only letters, numbers and punctuation.`,
  rateLimited: 'Too many tries. Wait a minute, then try again.',
  offline:
    "You appear to be offline. Setting up a company needs a connection — try again once you're back online.",
  failed: "Couldn't set up your company. Please try again.",
} as const;

/**
 * `alreadyAffiliated` is its own kind because it may mean the caller's own
 * earlier create succeeded and only the response was lost: the caller reloads
 * the account, and the card hides itself if a membership now exists.
 */
export type CreateOwnCompanyResult =
  | { readonly kind: 'created' }
  | { readonly kind: 'alreadyAffiliated'; readonly message: string }
  | { readonly kind: 'failed'; readonly message: string };

// Mirrors the server's NAME RULE (jobsight-backend create_own_company). JS `\s`
// already covers [[:space:]], NBSP, U+1680, U+2000–U+200A, U+2028, U+2029,
// U+202F, U+205F, U+3000 and U+FEFF; U+200B is added because JS does not count
// it as whitespace but the server trims it.
const EDGE_SPACE = /^[\s\u200B]+|[\s\u200B]+$/g;
// Refused anywhere: C0/C1 controls and DEL, zero-width and directional marks,
// bidi embeddings/overrides/isolates, and line/paragraph separators.
const FORBIDDEN =
  /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2060\uFEFF\u202A-\u202E\u2066-\u2069\u061C\u2028\u2029]/;

/** The name the server would accept, trimmed as it trims, or null. */
export function cleanCompanyName(raw: string): string | null {
  const name = raw.replace(EDGE_SPACE, '');
  const length = [...name].length;
  if (length < 1 || length > COMPANY_NAME_MAX || FORBIDDEN.test(name)) return null;
  return name;
}

/** PostgREST error -> outcome. Exported for the unit tests. */
export function createCompanyFailure(
  error: { readonly code?: string },
  status: number,
): Exclude<CreateOwnCompanyResult, { kind: 'created' }> {
  const failed = (message: string) => ({ kind: 'failed' as const, message });
  if (status === 401 || status === 403 || error.code === '42501') {
    return failed(CREATE_COMPANY_COPY.expired);
  }
  if (status === 429) return failed(CREATE_COMPANY_COPY.rateLimited);
  if (error.code === 'PL001') return failed(CREATE_COMPANY_COPY.notConfirmed);
  if (error.code === 'PL002') {
    return { kind: 'alreadyAffiliated', message: CREATE_COMPANY_COPY.alreadyAffiliated };
  }
  if (error.code === 'PL003') return failed(CREATE_COMPANY_COPY.invalidName);
  return failed(isLikelyOffline(error) ? CREATE_COMPANY_COPY.offline : CREATE_COMPANY_COPY.failed);
}

export async function createOwnCompany(rawName: string): Promise<CreateOwnCompanyResult> {
  const name = cleanCompanyName(rawName);
  if (name === null) return { kind: 'failed', message: CREATE_COMPANY_COPY.invalidName };
  try {
    const { error, status } = await supabase.rpc('create_own_company', { company_name: name });
    if (!error) return { kind: 'created' };
    // Code only: the message is server text and may echo the name.
    console.warn('[createOwnCompany] rpc failed:', error.code ?? status);
    return createCompanyFailure(error, status);
  } catch (error) {
    // supabase-js resolves network failures into `error`, but a throw from
    // fetch itself still reaches here.
    console.warn('[createOwnCompany] rpc threw:', (error as { name?: unknown } | null)?.name);
    return {
      kind: 'failed',
      message: isLikelyOffline(error) ? CREATE_COMPANY_COPY.offline : CREATE_COMPANY_COPY.failed,
    };
  }
}
