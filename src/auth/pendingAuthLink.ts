/**
 * One-shot in-memory hand-off for an auth-link fragment between two routes.
 *
 * The legacy confirm shim (app/confirm.tsx) receives a signup fragment on
 * `worklog://confirm` and has to get it to app/set-password.tsx. Neither of
 * the obvious routes works:
 *   - `router.replace` fires no deep-link event, so set-password's `useURL()`
 *     is not re-triggered, and on a warm start it returns the STALE launch URL
 *     (possibly a different, earlier auth link whose tokens would then be
 *     applied by mistake).
 *   - passing the fragment as a route param puts a live access token in the
 *     query string, which on the Expo web build lands in browser history and
 *     the Referer header.
 *
 * So the fragment is handed over in module scope instead: never serialized,
 * never in a URL, and cleared on read so a token can only ever be consumed
 * once.
 */
let pending: string | null = null;

/** Stash the raw fragment (leading '#' optional) for the next screen. */
export function stashAuthFragment(fragment: string): void {
  pending = fragment.replace(/^#/, '') || null;
}

/** Read and clear the stashed fragment. Returns null when there is none. */
export function takeAuthFragment(): string | null {
  const value = pending;
  pending = null;
  return value;
}
