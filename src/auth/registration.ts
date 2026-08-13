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
 * The invoked slug is the WorkLog FORK, `worklog-register-company` — the
 * shared `register-company` is another product's function on the same
 * project and is never called from here. RELEASE ORDERING: this seam must
 * not reach users before that slug is deployed, or every registration hits
 * a function that does not exist.
 *
 * `client` picks which surface the emailed confirm link opens. Per spec
 * amendment A1, the fork never mints a `punchlist://` URL for a
 * WorkLog registration — that was PunchLog's fallback and, delivered to a
 * device with PunchLog also installed, would hand a WorkLog auth token to
 * the wrong app. Both `'app'` and `'web'` land the confirm link on the
 * WorkLog website's `/welcome` set-password page; `client` only lets the
 * backend fork vary presentation (e.g. an app-store nudge for `'app'`), not
 * the destination. `worklog://set-password` stays reachable only via the
 * in-app links this screen already handles (invite/recovery), never via the
 * registration confirm email.
 */
export async function registerCompany(
  request: RegisterCompanyRequest,
): Promise<RegisterCompanyResult> {
  const { error } = await supabase.functions.invoke('worklog-register-company', {
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
