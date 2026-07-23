/**
 * Invite a teammate onto a project via the `invite-user` edge function.
 * Standalone and online-only (like createProject): `admin.generateLink` is a
 * service-role API the client can never call, so there is nothing to queue —
 * an invite either goes out now or the caller retries.
 *
 * ── BACKEND PREREQUISITE (Wave 6 blocker) ───────────────────────────────────
 * The deployed function hardcodes `REDIRECT_TO = "punchlist://set-password"`.
 * The `app` field this helper sends is a PENDING, additive backend change
 * (jobsight-backend) that will map `'worklog'` → `worklog://set-password`;
 * until that ships the function ignores the field (it destructures only
 * email/projectId/role/fullName/trade) and every invite link still deep-links
 * into PunchLog. So: this helper is written against the INTENDED contract, is
 * safe to ship today, and WorkLog's invite deep link does not actually land
 * until the backend PR + the Supabase Auth redirect-URL allowlist entry are
 * done. Do not wire the set-password screen's acceptance path to a real invite
 * before then.
 *
 * ── Verified contract (supabase/functions/invite-user/index.ts) ─────────────
 * Request body:  { email, projectId, role, fullName?, trade? }  (+ pending `app`)
 *   • email     — validated server-side, lowercased/trimmed there
 *   • projectId — must be a uuid
 *   • role      — 'sub' | 'super' | 'admin'. WorkLog exposes only super|sub:
 *                 'admin' is a company-wide role only a company admin may mint,
 *                 which is not a WorkLog surface.
 * Success (200): { ok: true, emailSent: boolean, existingUser: boolean,
 *                  inviteUrl?: string }
 *   `inviteUrl` is present ONLY when the invite created a NEW account AND the
 *   instance has no email configured — an existing user's magiclink is never
 *   returned to the caller. That is the manual-share fallback.
 * Failure: non-2xx JSON `{ error: string }` (400/401/403/404/500).
 */
import { supabase } from '../supabase/client';

export interface InviteMemberInput {
  readonly email: string;
  readonly projectId: string;
  /** WorkLog surfaces project roles only — company 'admin' is out of scope. */
  readonly role: 'super' | 'sub';
  readonly fullName?: string;
  readonly trade?: string;
}

export type InviteMemberResult =
  | {
      readonly ok: true;
      /** The invite email was accepted by the mailer. */
      readonly emailSent: boolean;
      /** The address already had an account (membership added, no new signup). */
      readonly existingUser: boolean;
      /**
       * Manual-share link — set only for a NEW account on an instance with no
       * email configured. Show a "Copy link" affordance when present.
       */
      readonly inviteUrl: string | null;
    }
  | { readonly ok: false; readonly message: string };

const GENERIC_FAILURE = "Couldn't send the invite. Please check your connection and try again.";

/**
 * Server-sent messages that are internal codes rather than user-facing copy —
 * these get the generic retry line instead of being surfaced verbatim.
 */
const OPAQUE_SERVER_ERRORS = new Set(['unauthorized', 'invite failed', 'invalid JSON body']);

/**
 * Pull the plain-language failure text out of a failed `functions.invoke`.
 * FunctionsHttpError carries the raw Response as `context`. This function
 * answers with `{ error }` (AuthProvider's `readFunctionErrorMessage` reads
 * `message`, which the delete-account function uses) — accept either so this
 * keeps working if the body key is normalised later.
 */
async function readInviteErrorMessage(error: unknown): Promise<string | null> {
  const context = (error as { context?: unknown } | null)?.context;
  if (!(context instanceof Response)) return null;
  try {
    const body: unknown = await context.json();
    const raw = (body as { error?: unknown; message?: unknown } | null) ?? {};
    const text = typeof raw.error === 'string' ? raw.error : raw.message;
    if (typeof text !== 'string' || text.length === 0) return null;
    return OPAQUE_SERVER_ERRORS.has(text) ? null : text;
  } catch {
    return null;
  }
}

export async function inviteMember(input: InviteMemberInput): Promise<InviteMemberResult> {
  const { data, error } = await supabase.functions.invoke('invite-user', {
    body: {
      email: input.email.trim(),
      projectId: input.projectId,
      role: input.role,
      ...(input.fullName?.trim() ? { fullName: input.fullName.trim() } : {}),
      ...(input.trade?.trim() ? { trade: input.trade.trim() } : {}),
      // Pending backend change — see the header note.
      app: 'worklog',
    },
  });

  if (error) {
    const serverMessage = await readInviteErrorMessage(error);
    return { ok: false, message: serverMessage ?? GENERIC_FAILURE };
  }

  const body = (data ?? {}) as {
    ok?: unknown;
    emailSent?: unknown;
    existingUser?: unknown;
    inviteUrl?: unknown;
  };
  // A 2xx with an unexpected body means the contract drifted — treat it as a
  // failure rather than reporting a send that may not have happened.
  if (body.ok !== true) return { ok: false, message: GENERIC_FAILURE };

  return {
    ok: true,
    emailSent: body.emailSent === true,
    existingUser: body.existingUser === true,
    inviteUrl: typeof body.inviteUrl === 'string' ? body.inviteUrl : null,
  };
}
