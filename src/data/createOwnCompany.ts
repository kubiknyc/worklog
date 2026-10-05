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
 *   PL003              name fails the server's name rule (checkCompanyName
 *                      catches it first; this is the fallback copy)
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
    "Your account is already linked to a company, so you can't set up another one here. Ask that company's administrator to invite you to a project.",
  invalidName: `Enter your company's name (up to ${COMPANY_NAME_MAX} characters).`,
  refusedCharacters: 'The company name has hidden characters. Clear the field and type it again.',
  rateLimited: 'Too many tries. Wait a minute, then try again.',
  offline:
    "You appear to be offline. Setting up a company needs a connection — try again once you're back online.",
  failed: "Couldn't set up your company. Please try again.",
} as const;

/**
 * `alreadyAffiliated` is its own kind because it may mean the caller's own
 * earlier create succeeded and only the response was lost: the caller reloads
 * the account and decides (see CreateCompanySection).
 */
export type CreateOwnCompanyResult =
  | { readonly kind: 'created' }
  | { readonly kind: 'alreadyAffiliated'; readonly message: string }
  | { readonly kind: 'failed'; readonly message: string };

// Mirrors the server's NAME RULE (jobsight-backend create_own_company,
// 20261005000201). Keep the three sets below in step with that header.
//
// Trimmed from both ends: a set that equals the server's explicit trim list
// (JS `\s` plus U+200B). JS `\s` is U+0009–U+000D, space, NBSP, U+1680,
// U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, U+3000 and U+FEFF; U+200B is
// added because JS does not count it as whitespace. U+001C–U+001F and U+0085
// are NOT trimmed — they fall in the refused set below.
const EDGE_SPACE = /^[\s\u200B]+|[\s\u200B]+$/g;
// Refused ANYWHERE: C0/C1 controls and DEL, soft hyphen, grapheme joiner, ALM,
// Hangul fillers, Khmer inherent vowels, Mongolian selectors (U+180E–180F;
// 180B–180D are the free variation selectors, allowed inside — see below),
// zero-width space and LRM/RLM (ZWNJ U+200C and ZWJ U+200D are allowed inside,
// for joined scripts and ZWJ emoji), line/paragraph separators, bidi
// embeddings and overrides, word joiner/invisible operators/bidi isolates,
// BOM, specials, and two supplementary-plane format-control ranges.
const REFUSED =
  /[\u0000-\u001F\u007F-\u009F\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u180F\u200B\u200E\u200F\u2028\u2029\u202A-\u202E\u2060-\u206F\u3164\uFEFF\uFFA0\uFFF0-\uFFF8\u{1BCA0}-\u{1BCA3}\u{1D173}-\u{1D17A}]/u;
// Refused as the WHOLE name: nothing but whitespace, variation selectors
// U+FE00–U+FE0F, the Braille blank U+2800, ZWNJ/ZWJ, the Mongolian free
// variation selectors, and the tag characters + VS17–256 block — each is fine
// inside a real name (an emoji needs a selector, a joined script needs ZWJ/
// ZWNJ, a flag-with-subdivision needs tag characters) but renders blank alone.
const INVISIBLE_ONLY =
  /^[\s\u200B\uFE00-\uFE0F\u2800\u200C\u200D\u180B-\u180D\u{E0000}-\u{E0FFF}]+$/u;
// A lone UTF-16 surrogate (a high one not followed by a low one, or a low one
// not preceded by a high one): not a character, and not valid JSON text.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/;

export type CompanyNameCheck =
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly reason: 'length' | 'characters' };

/** Check a typed name the way the server will, returning it trimmed as the
 *  server trims, or why it would be refused. */
export function checkCompanyName(raw: string): CompanyNameCheck {
  const name = raw.replace(EDGE_SPACE, '');
  const length = [...name].length;
  if (length < 1 || length > COMPANY_NAME_MAX) return { ok: false, reason: 'length' };
  // A lone surrogate isn't a character someone typed on purpose to strip out
  // of an otherwise-fine name — it's malformed input, same bucket as empty.
  if (LONE_SURROGATE.test(name)) return { ok: false, reason: 'length' };
  if (REFUSED.test(name) || INVISIBLE_ONLY.test(name)) return { ok: false, reason: 'characters' };
  return { ok: true, name };
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
  const check = checkCompanyName(rawName);
  if (!check.ok) {
    return {
      kind: 'failed',
      message:
        check.reason === 'length'
          ? CREATE_COMPANY_COPY.invalidName
          : CREATE_COMPANY_COPY.refusedCharacters,
    };
  }
  const { name } = check;
  try {
    const { error, status } = await supabase.rpc('create_own_company', { company_name: name });
    if (!error) return { kind: 'created' };
    // Code only: the message is server text and may echo the name.
    console.warn('[createOwnCompany] rpc failed:', error.code || status);
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
