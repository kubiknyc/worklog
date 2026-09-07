/**
 * Pure logic behind /welcome, extracted so it can be tested (the page itself
 * is a client component wired to window + fetch).
 *
 * /welcome is the only web path to a credential under invite-style
 * registration, so both pieces here are load-bearing: reading the confirm
 * link's token out of the fragment, and deciding what a failed save means.
 *
 * Ported verbatim from PunchLog's website (PLW/lib/welcomeLink.ts) — this
 * file is pure URL-fragment parsing with no product-name references, so
 * nothing needed rebranding.
 */

/**
 * Whether GoTrue reported a problem in the URL fragment.
 *
 * Deliberately a boolean: `error_description` is fully attacker-controllable
 * (anyone can craft `/welcome#error_description=...`) and rendering it under
 * the real logo would be a phishing vector.
 *
 * Checks BOTH `error` and `error_description`, matching the native mirror
 * (src/auth/authLink.ts). GoTrue does not promise to send them as a pair, and
 * an `#error=access_denied` fragment with no description used to fall through
 * to the "You're confirmed" success card — telling someone whose link had just
 * been refused that their account was ready.
 */
export function hasHashError(hash: string): boolean {
  const value = hash.replace(/^#/, "");
  if (!value) return false;
  const params = new URLSearchParams(value);
  return params.has("error") || params.has("error_description");
}

/** The access token from the confirm link's fragment, when present. */
export function readAccessToken(hash: string): string | null {
  const value = hash.replace(/^#/, "");
  if (!value) return null;
  return new URLSearchParams(value).get("access_token") || null;
}

/**
 * The hashed one-time token from a `token_hash`-style confirm link fragment
 * (`#token_hash=...&type=...`), GoTrue's replacement for the plain
 * `/auth/v1/verify?token=...` GET link that a corporate mail scanner would
 * consume by fetching it. `URLSearchParams.get` already URL-decodes the
 * value.
 */
export function readTokenHash(hash: string): string | null {
  const value = hash.replace(/^#/, "");
  if (!value) return null;
  return new URLSearchParams(value).get("token_hash") || null;
}

/** The `type` values GoTrue's `POST /auth/v1/verify` accepts for a
 *  `token_hash` exchange. Anything else is not a type this flow knows how to
 *  spend, so `readVerifyType` returns null rather than guessing. */
export type VerifyType = "signup" | "invite" | "magiclink" | "recovery" | "email";

const VERIFY_TYPES: ReadonlySet<string> = new Set<VerifyType>([
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email",
]);

export function readVerifyType(hash: string): VerifyType | null {
  const value = hash.replace(/^#/, "");
  if (!value) return null;
  const raw = new URLSearchParams(value).get("type");
  return raw !== null && VERIFY_TYPES.has(raw) ? (raw as VerifyType) : null;
}

/**
 * Which kind of link brought the reader here. Mirrors `linkTypeOf` in the
 * native app (src/auth/authLink.ts) — keep the two in step.
 *
 * /welcome now serves three audiences: a founder confirming a company signup,
 * an invited subcontractor, and anyone using a password-reset link (both
 * forgot-password and invite-user's existing-user branch land here). Only
 * `signup` may be told "your company is ready" — an invitee has no company of
 * their own and cannot create projects, so promising them that reads as the
 * wrong account.
 *
 * Anything unrecognised collapses to 'other' and takes the neutral copy, which
 * is true for every reader. That default is deliberate: an existing-user invite
 * arrives as `type=magiclink`, which is not in the union, and the neutral
 * branch is exactly right for it.
 */
export type WelcomeLinkType = "invite" | "recovery" | "signup" | "other";

export function readLinkType(hash: string): WelcomeLinkType {
  const value = hash.replace(/^#/, "");
  if (!value) return "other";
  const raw = new URLSearchParams(value).get("type");
  return raw === "invite" || raw === "recovery" || raw === "signup" ? raw : "other";
}

export type SaveOutcome =
  /** Token spent or expired — retrying cannot work; offer /forgot-password. */
  | { readonly kind: "expired" }
  /** Server refused the password; `message` (when given) is safe to show. */
  | { readonly kind: "rejected"; readonly message: string | null }
  /** Rate limited — backing off is meaningful. */
  | { readonly kind: "rateLimited" }
  /** Anything else. */
  | { readonly kind: "failed" };

/**
 * Map a failed `PUT /auth/v1/user` to an outcome. Reporting everything as
 * "expired" sent users with a rejected password — or a transient 5xx — down
 * the wrong recovery path.
 */
export function classifySaveFailure(status: number, message?: string | null): SaveOutcome {
  if (status === 401 || status === 403) return { kind: "expired" };
  if (status === 422) return { kind: "rejected", message: message ?? null };
  if (status === 429) return { kind: "rateLimited" };
  return { kind: "failed" };
}
