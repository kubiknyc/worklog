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
 * Only the error's `code` is read — server text is never shown. Each outcome
 * returns its own plain sentence:
 *   42501  not signed in / session expired
 *   PL001  email not confirmed
 *   PL002  already in a company, project, or phone book
 *   PL003  name blank or over 120 characters
 *   anything else (including the function not existing yet) -> generic
 */
import { isLikelyOffline } from '../lib/errors';
import { supabase } from '../supabase/client';

/** Same cap as the server's PL003 check. */
export const COMPANY_NAME_MAX = 120;

export const CREATE_COMPANY_COPY = {
  expired: 'Your sign-in has expired. Sign out, sign back in, and try again.',
  notConfirmed: 'Confirm your email first. Open the link in your sign-up email, then try again.',
  alreadyAffiliated:
    "Your account is already part of a company or project, so you can't set up a new one here.",
  invalidName: `Enter a company name of up to ${COMPANY_NAME_MAX} characters.`,
  offline:
    "You appear to be offline. Setting up a company needs a connection — try again once you're back online.",
  failed: "Couldn't set up your company. Please try again.",
} as const;

export type CreateOwnCompanyResult =
  { readonly ok: true } | { readonly ok: false; readonly message: string };

/** PostgREST error -> plain copy. Exported for the unit tests. */
export function createCompanyFailureCopy(
  error: { readonly code?: string },
  status: number,
): string {
  if (status === 401 || status === 403 || error.code === '42501') {
    return CREATE_COMPANY_COPY.expired;
  }
  if (error.code === 'PL001') return CREATE_COMPANY_COPY.notConfirmed;
  if (error.code === 'PL002') return CREATE_COMPANY_COPY.alreadyAffiliated;
  if (error.code === 'PL003') return CREATE_COMPANY_COPY.invalidName;
  return isLikelyOffline(error) ? CREATE_COMPANY_COPY.offline : CREATE_COMPANY_COPY.failed;
}

export async function createOwnCompany(rawName: string): Promise<CreateOwnCompanyResult> {
  const name = rawName.trim();
  if (name.length === 0 || name.length > COMPANY_NAME_MAX) {
    return { ok: false, message: CREATE_COMPANY_COPY.invalidName };
  }
  try {
    const { error, status } = await supabase.rpc('create_own_company', { company_name: name });
    if (!error) return { ok: true };
    console.warn('[createOwnCompany] rpc failed:', error);
    return { ok: false, message: createCompanyFailureCopy(error, status) };
  } catch (error) {
    // supabase-js resolves network failures into `error`, but a throw from
    // fetch itself still reaches here.
    console.warn('[createOwnCompany] rpc threw:', error);
    return {
      ok: false,
      message: isLikelyOffline(error) ? CREATE_COMPANY_COPY.offline : CREATE_COMPANY_COPY.failed,
    };
  }
}
