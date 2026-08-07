/**
 * Auth-layer seam for the register-company edge function (the app's register
 * screen). Like invites.ts, this lives here rather than on src/data because
 * screens never import the Supabase client (CLAUDE.md hard rule) and
 * registration is an online-only pre-auth call, not repository data.
 *
 * The function's error contract is {error, field} (not {message}), so this
 * parses FunctionsHttpError.context itself instead of reusing AuthProvider's
 * readFunctionErrorMessage.
 */
import { Platform } from 'react-native';

import { supabase } from '../supabase/client';
import type { RegisterField } from './registrationValidation';

/**
 * Invite-style registration: NO password in the contract. The server mints a
 * discarded random one; the emailed confirm link lands on set-password where
 * the user chooses their real credential.
 */
export interface RegisterCompanyRequest {
  readonly companyName: string;
  readonly fullName: string;
  readonly email: string;
}

/**
 * 'ok' covers the account-already-exists path too — the server's 200 is
 * byte-identical on purpose (no account enumeration), and the screen's
 * success copy must not diverge either.
 */
export type RegisterCompanyResult =
  | { readonly kind: 'ok' }
  | { readonly kind: 'invalid'; readonly message: string; readonly field?: RegisterField }
  | { readonly kind: 'rateLimited' }
  | { readonly kind: 'failed' };

const KNOWN_FIELDS: readonly RegisterField[] = ['companyName', 'fullName', 'email'];

/** The error body is untrusted network input — keep only expected shapes. */
async function parseErrorBody(
  response: Response,
): Promise<{ message?: string; field?: RegisterField }> {
  try {
    const body: unknown = await response.json();
    if (typeof body !== 'object' || body === null) return {};
    const record = body as Record<string, unknown>;
    return {
      message: typeof record.error === 'string' ? record.error : undefined,
      field: KNOWN_FIELDS.find((f) => f === record.field),
    };
  } catch {
    return {};
  }
}

/**
 * `client` picks which surface the emailed confirm link opens: native builds
 * send 'app' (punchlist://set-password deep link); the web build sends 'web'
 * because a custom-scheme link is dead in a desktop browser.
 */
export async function registerCompany(
  request: RegisterCompanyRequest,
): Promise<RegisterCompanyResult> {
  const { error } = await supabase.functions.invoke('register-company', {
    body: { ...request, client: Platform.OS === 'web' ? 'web' : 'app' },
  });
  if (!error) return { kind: 'ok' };

  // FunctionsHttpError carries the raw Response on `context`; anything else
  // (network failure, relay error, missing context) degrades to 'failed'.
  const response = (error as { context?: unknown }).context;
  if (!(response instanceof Response)) return { kind: 'failed' };
  if (response.status === 429) return { kind: 'rateLimited' };
  if (response.status === 400) {
    const { message, field } = await parseErrorBody(response);
    // Only surface the server's wording when it maps to a form field the user
    // can act on; field-less 400s (bad JSON, contract drift) are integration
    // bugs whose messages aren't written for end users.
    return field
      ? { kind: 'invalid', message: message ?? 'Check your details and try again.', field }
      : { kind: 'invalid', message: 'Check your details and try again.' };
  }
  return { kind: 'failed' };
}
