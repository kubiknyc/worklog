/**
 * The /welcome "Run your own company?" form, for a founder who said no to the
 * parked company on the consent card. Declining clears the marker and mints
 * nothing, and registering again only sends an account-exists email to a
 * confirmed address — so without this form they would be stuck with an
 * account and no company.
 *
 * `create_own_company(company_name)` (jobsight-backend, shared with PunchLog)
 * returns the new company's id. Its refusals carry a Postgres `code`, and that
 * code is the ONLY part of the error body this site reads: the message is
 * server text and is never rendered (the same phishing guard as everywhere
 * else on /welcome). Each outcome has its own plain sentence below.
 *
 *   42501  not signed in, or the session has gone  -> expired
 *   PL001  email not confirmed                     -> notConfirmed
 *   PL002  already in a company, project, or phone book -> alreadyAffiliated
 *   PL003  name blank or over 120 characters       -> invalidName
 *   anything else (including a 404 before the migration is applied) -> failed
 */

/** Same cap as the server's PL003 check and the parked name on the link. */
export const COMPANY_NAME_MAX = 120;

export type CreateCompanyOutcome =
  | "expired"
  | "notConfirmed"
  | "alreadyAffiliated"
  | "invalidName"
  | "rateLimited"
  | "failed";

export const CREATE_COMPANY_MESSAGES: Readonly<Record<CreateCompanyOutcome, string>> = {
  expired:
    "This page has timed out. Your password is saved — sign in to the WorkLog app to carry on.",
  notConfirmed: "Your email isn't confirmed yet. Open the link in your sign-up email, then try again.",
  alreadyAffiliated:
    "Your account is already part of a company or project, so you can't set up a new one here.",
  invalidName: `Enter a company name of up to ${COMPANY_NAME_MAX} characters.`,
  rateLimited: "Too many attempts — wait a minute and try again.",
  failed: "Something went wrong. Please try again.",
};

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

/** The name to send, trimmed, or null when it cannot pass the server's check
 *  — caught here so an empty tap never costs a round trip. */
export function cleanCompanyName(raw: string): string | null {
  const name = raw.trim();
  return name.length >= 1 && name.length <= COMPANY_NAME_MAX ? name : null;
}

/** The `code` field of a PostgREST error body, or null. Never the message. */
export async function readErrorCode(response: Response): Promise<string | null> {
  const body: unknown = await response.json().catch(() => null);
  if (typeof body !== "object" || body === null || !("code" in body)) return null;
  return typeof body.code === "string" ? body.code : null;
}
