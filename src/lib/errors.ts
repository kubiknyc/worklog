/**
 * Narrow an unknown thrown value to a user-facing message. Repository writes
 * already scrub PostgREST detail into friendly strings, so surfacing
 * `error.message` is safe for the toast/inline error path.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return 'Something went wrong. Please try again.';
}

/**
 * Heuristic: does this thrown value look like a transport failure (device
 * offline / unreachable network) rather than a server rejection? Mirrors the
 * transport branch of the sync queue's error classifier: fetch surfaces
 * connectivity loss as a TypeError with no HTTP status — message "Network
 * request failed" on React Native, "Failed to fetch" on web.
 */
export function isLikelyOffline(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  const text = typeof message === 'string' ? message : '';
  if (name === 'TypeError' && /network|fetch/i.test(text)) return true;
  return /network request failed|failed to fetch/i.test(text);
}
