/**
 * Auth-layer seam for the set-password deep-link flow (app/set-password.tsx).
 * Screens never import the Supabase client (CLAUDE.md hard rule); these two
 * calls are auth operations with no offline path, so they live in src/auth
 * with the rest of the client's auth surface.
 */
import { supabase } from '../supabase/client';

/**
 * Async producer of the pending-mutation count, injected by the caller —
 * same shape as `QueueCounter` (src/sync/types.ts), the producer wired into
 * `syncStatusHub`. Kept as a narrower local type rather than importing from
 * `src/sync/`: this module has no other reason to depend on the sync layer,
 * and the guard only needs a single number, not the full `QueueCounts` shape.
 */
export type PendingMutationCount = () => Promise<number>;

/**
 * Outcome of applying the deep link's token pair as the device session.
 * Deliberately discriminated rather than a boolean — `blockedPendingSync` is
 * a refusal, not a failure: GoTrue accepted the tokens, but swapping to them
 * would silently destroy another user's queued offline work (spec A5).
 */
export type ApplyAuthTokensResult =
  | { readonly kind: 'ok' }
  /** GoTrue rejected the pair (expired or already-used link). */
  | { readonly kind: 'rejected' }
  /**
   * The link belongs to a different user than the one currently signed in,
   * and that user has unsynced queued mutations. Applying the new session
   * would rebuild `RepositoryProvider` and wipe the current user's local
   * cache — including the queue — before it ever reaches the server.
   */
  | { readonly kind: 'blockedPendingSync' };

/** Decode a JWT's `sub` claim without verifying the signature — GoTrue does
 *  the verification; this is only used to compare against the currently
 *  signed-in user before deciding whether the queue-loss guard applies.
 *  Returns null for anything that doesn't parse as a JWT, so a malformed or
 *  unusual token falls through to GoTrue's own validation unguarded rather
 *  than blocking a legitimate session swap. */
function decodeJwtUserId(token: string): string | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const json = JSON.parse(atob(padded)) as { sub?: unknown };
    return typeof json.sub === 'string' ? json.sub : null;
  } catch {
    return null;
  }
}

/**
 * Apply the deep link's token pair as the device session.
 *
 * Before swapping to a session for a DIFFERENT user than the one currently
 * signed in, consults `pendingMutationCount` — if that user has queued
 * mutations, the swap is refused (`blockedPendingSync`) rather than silently
 * discarding their offline work when `RepositoryProvider` rebuilds. Same-user
 * links (routine password reset/re-invite of the signed-in account) and links
 * opened with nobody signed in skip the check entirely — there is no other
 * user's queue to lose.
 */
export async function applyAuthTokens(
  accessToken: string,
  refreshToken: string,
  pendingMutationCount: PendingMutationCount,
): Promise<ApplyAuthTokensResult> {
  const targetUserId = decodeJwtUserId(accessToken);
  if (targetUserId) {
    const {
      data: { session: currentSession },
    } = await supabase.auth.getSession();
    const currentUserId = currentSession?.user.id ?? null;
    if (currentUserId && currentUserId !== targetUserId) {
      const pending = await pendingMutationCount();
      if (pending > 0) {
        return { kind: 'blockedPendingSync' };
      }
    }
  }

  const { error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  return error ? { kind: 'rejected' } : { kind: 'ok' };
}

/**
 * Outcome of setting the password. Deliberately discriminated rather than a
 * boolean: under invite-style registration this is the only place an app user
 * gets a credential, and "your one-shot link expired" and "you're offline"
 * need OPPOSITE next steps (reset from sign-in vs. retry). Collapsing them
 * sent expired-token users into a retry loop that could never succeed.
 */
export type UpdatePasswordResult =
  | { readonly kind: 'ok' }
  /** The session is gone — the link was already used or has expired. */
  | { readonly kind: 'expired' }
  /** The server refused this password (policy). `message` is safe to show. */
  | { readonly kind: 'rejected'; readonly message: string }
  /** Offline or transport failure — retrying is meaningful. */
  | { readonly kind: 'failed' };

/** Set the signed-in user's password. */
export async function updateAuthPassword(password: string): Promise<UpdatePasswordResult> {
  const { error } = await supabase.auth.updateUser({ password });
  if (!error) return { kind: 'ok' };
  // GoTrue uses 401/403 for a dead session and 422 for a rejected password.
  const status = error.status ?? 0;
  if (status === 401 || status === 403) return { kind: 'expired' };
  if (status === 422) return { kind: 'rejected', message: error.message };
  return { kind: 'failed' };
}
