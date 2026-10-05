/**
 * The /welcome "Run your own company?" form, for a reader from a register link
 * who reaches the done card without a company: they declined the parked one,
 * skipped after a failed claim, hit an out-of-date link, or came from a
 * nameless link. `create_own_company` accepts all of them (a leftover parked
 * marker is cleared) and refuses anyone already affiliated.
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
 *   PL003  name fails the server's name rule                  -> invalidName
 *   429    too many requests                                  -> rateLimited
 *   anything else (including a 404 before the migration is applied) -> failed
 *
 * expired, notConfirmed and alreadyAffiliated END the form: retrying cannot
 * help, so the page drops its access token and shows the message with no
 * submit button. invalidName, rateLimited and failed keep the form live.
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
  notConfirmed: "Your email isn't confirmed yet. Open the link in your sign-up email, then try again.",
  alreadyAffiliated:
    "Your account is already linked to a company on WorkLog. If you just set one up, it's ready — otherwise ask them to invite you to a project.",
  invalidName: `Enter a company name of up to ${COMPANY_NAME_MAX} characters, using only letters, numbers and punctuation.`,
  rateLimited: "Too many attempts — wait a minute and try again.",
  failed: "Something went wrong. Please try again.",
};

/** Shown when the company was created. Ends the form. */
export const CREATE_COMPANY_DONE =
  "Your company is set up. Sign in to the WorkLog app — then create your first project and invite your team.";

/** Shown when the reader taps "Not now". Ends the form. */
export const CREATE_COMPANY_DECLINED = "Your password is saved. Open the WorkLog app and sign in.";

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

// Mirrors the server's NAME RULE (jobsight-backend create_own_company). JS `\s`
// already covers [[:space:]], NBSP, U+1680, U+2000–U+200A, U+2028, U+2029,
// U+202F, U+205F, U+3000 and U+FEFF; U+200B is added because JS does not count
// it as whitespace but the server trims it.
const EDGE_SPACE = /^[\s\u200B]+|[\s\u200B]+$/g;
// Refused anywhere: C0/C1 controls and DEL, zero-width and directional marks,
// bidi embeddings/overrides/isolates, and line/paragraph separators.
const FORBIDDEN =
  /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2060\uFEFF\u202A-\u202E\u2066-\u2069\u061C\u2028\u2029]/;

/** The name the server would accept, trimmed as it trims, or null — caught
 *  here so a bad name never costs a round trip. */
export function cleanCompanyName(raw: string): string | null {
  const name = raw.replace(EDGE_SPACE, "");
  const length = [...name].length;
  if (length < 1 || length > COMPANY_NAME_MAX || FORBIDDEN.test(name)) return null;
  return name;
}

/** The `code` field of a PostgREST error body, or null. Never the message. */
export async function readErrorCode(response: Response): Promise<string | null> {
  const body: unknown = await response.json().catch(() => null);
  if (typeof body !== "object" || body === null || !("code" in body)) return null;
  return typeof body.code === "string" ? body.code : null;
}
