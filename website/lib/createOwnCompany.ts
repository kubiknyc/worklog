/**
 * The /welcome "Run your own company?" form, for a reader from a NAMED
 * register link who reaches the done card without a company: they declined
 * the parked one, skipped after a failed claim, or hit an out-of-date link.
 * `create_own_company` accepts all of them (a leftover parked marker is
 * cleared) and refuses anyone already affiliated. A nameless register link is
 * a pending invitee's resend — they hold a project seat, the server would
 * refuse them (PL002), and the page never offers them this form.
 *
 * Why here and not "register again": for a declined reader the marker is gone,
 * and registering again only sends an account-exists email. (A confirmed
 * account whose marker is still unspent is re-parked and mailed a fresh consent
 * link by worklog-register-company — but the form is quicker for them too.)
 *
 * `create_own_company(company_name)` (jobsight-backend, shared with PunchLog)
 * returns the new company's id. Its refusals carry a Postgres `code`, and that
 * code is the ONLY part of the error body this site reads: the message is
 * server text and is never rendered (the same phishing guard as everywhere
 * else on /welcome). Each outcome has its own plain sentence below.
 *
 *   42501 / 401 / 403  not signed in, or the session has gone -> expired
 *   PL001  email not confirmed                                -> notConfirmed
 *   PL002  already in a company, project, or phone book       -> alreadyAffiliated
 *   PL003  name fails the server's name rule (cleanCompanyName
 *          catches it first)                                  -> invalidName
 *   429    too many requests                                  -> rateLimited
 *   anything else (including a 404 before the migration is applied) -> failed
 *
 * expired, notConfirmed and alreadyAffiliated END the form: retrying cannot
 * help, so the page drops its access token and shows the message with no
 * submit button. So do success and "Not now" (which shows nothing extra: the
 * done card already says the password is saved). invalidName, rateLimited and
 * failed keep the form live.
 */

/** Same cap as the server's PL003 check, in characters (code points). */
export const COMPANY_NAME_MAX = 120;

export type CreateCompanyOutcome =
  | "expired"
  | "notConfirmed"
  | "alreadyAffiliated"
  | "invalidName"
  | "rateLimited"
  | "failed";

export const CREATE_COMPANY_MESSAGES: Readonly<Record<CreateCompanyOutcome, string>> = {
  expired: "This page timed out before your company was set up. Open the WorkLog app and sign in.",
  notConfirmed:
    "Your email isn't confirmed yet, so we couldn't set up your company. Open the WorkLog app and sign in.",
  alreadyAffiliated:
    "Your account is already linked to a company on WorkLog. If you just set one up, it's ready — otherwise ask that company's administrator to add you to a project.",
  invalidName: `Enter a company name of up to ${COMPANY_NAME_MAX} characters, with no hidden or special characters.`,
  rateLimited: "Too many attempts — wait a minute and try again.",
  failed: "Something went wrong. Please try again.",
};

/** Shown when the company was created. Ends the form. */
export const CREATE_COMPANY_DONE =
  "Your company is set up. Sign in to the WorkLog app — then create your first project and invite your team.";

/** Outcomes a retry cannot fix: the form ends and the token is dropped. */
export function endsCreateCompany(outcome: CreateCompanyOutcome): boolean {
  return outcome === "expired" || outcome === "notConfirmed" || outcome === "alreadyAffiliated";
}

/** Map a failed `create_own_company` call to an outcome. `code` is the
 *  Postgres code from the error body, or null when the body had none. */
export function classifyCreateCompanyFailure(
  status: number,
  code: string | null,
): CreateCompanyOutcome {
  if (status === 401 || status === 403 || code === "42501") return "expired";
  if (status === 429) return "rateLimited";
  if (code === "PL001") return "notConfirmed";
  if (code === "PL002") return "alreadyAffiliated";
  if (code === "PL003") return "invalidName";
  return "failed";
}

// Mirrors the server's NAME RULE (jobsight-backend create_own_company,
// 20261005000201). Keep the sets below in step with that header.
//
// Trimmed from both ends: JS `\s` already covers U+0009-000D, U+0020,
// U+00A0, U+1680, U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, U+3000 and
// U+FEFF (the server uses its own explicit character list, not Postgres
// [[:space:]], but lands on the same set); U+200B is added because JS does
// not count it as whitespace but the server trims it.
const EDGE_SPACE = /^[\s\u200B]+|[\s\u200B]+$/g;
// Refused ANYWHERE: C0/C1 controls and DEL, soft hyphen, grapheme joiner, ALM,
// Hangul fillers, Khmer inherent vowels, Mongolian separator (not the free
// variation selectors — those are fine inside a name, see BLANK_ONLY_EXTRA
// below), zero-width space and LRM/RLM (not ZWNJ/ZWJ — those join emoji and
// script ligatures, also allowed inside), line/paragraph separators, bidi
// embeddings and overrides, word joiner/invisible operators/bidi isolates,
// BOM, specials, and two supplementary-plane format-control ranges. The `u`
// flag is required for the \u{...} supplementary ranges to match as single
// code points instead of lone surrogate halves.
const REFUSED =
  /[\u0000-\u001F\u007F-\u009F\u00AD\u034F\u061C\u115F-\u1160\u17B4\u17B5\u180E-\u180F\u200B\u200E-\u200F\u2028-\u2029\u202A-\u202E\u2060-\u206F\u3164\uFEFF\uFFA0\uFFF0-\uFFF8\u{1BCA0}-\u{1BCA3}\u{1D173}-\u{1D17A}]/u;
// Refused as the WHOLE name (BLANK_ONLY_EXTRA, allowed inside a name):
// nothing but whitespace, refused characters, variation selectors
// U+FE00–U+FE0F, the Braille blank U+2800, ZWNJ/ZWJ (U+200C/U+200D),
// Mongolian free variation selectors (U+180B–U+180D), and the tag
// characters/VS17–256 block (U+E0000–U+E0FFF) — all render blank alone but
// are fine inside a name (an emoji or ligature needs one).
const INVISIBLE_ONLY =
  /^[\s\u200B\uFE00-\uFE0F\u2800\u200C\u200D\u180B-\u180D\u{E0000}-\u{E0FFF}]+$/u;
// A lone UTF-16 surrogate (a high one not followed by a low one, or a low one
// not preceded by a high one): not a character, and not valid JSON text.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** The name the server would accept, trimmed as it trims, or null — caught
 *  here (after trimming, as the server checks) so a bad name never costs a
 *  round trip. */
export function cleanCompanyName(raw: string): string | null {
  const name = raw.replace(EDGE_SPACE, "");
  const length = [...name].length;
  if (length < 1 || length > COMPANY_NAME_MAX) return null;
  if (REFUSED.test(name) || INVISIBLE_ONLY.test(name) || LONE_SURROGATE.test(name)) return null;
  return name;
}

/** The `code` field of a PostgREST error body, or null. Never the message. */
export async function readErrorCode(response: Response): Promise<string | null> {
  const body: unknown = await response.json().catch(() => null);
  if (typeof body !== "object" || body === null || !("code" in body)) return null;
  return typeof body.code === "string" ? body.code : null;
}
