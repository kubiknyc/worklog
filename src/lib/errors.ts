import { TRANSPORT_MESSAGE } from '../sync/mutationQueue';

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
 * transport branch of the sync queue's error classifier by *importing its
 * pattern* rather than restating it — the two had already drifted, and the
 * copy here omitted `timeout` and bare `network`/`fetch` (#22). A fetch abort
 * (`TypeError: Aborted due to timeout`) was therefore `offline` to the
 * classifier — exempt from the retry ceiling — while the queue screen said
 * "Will retry automatically", promising a server retry that was not pending.
 *
 * Two arms, because the call sites hand over different things:
 *  - `pull.native.ts:263` passes the caught error, so `name` is present.
 *  - `SyncQueueScreen.tsx:53` rebuilds `{ message: m.lastError }` from the
 *    persisted queue row, which never carries `name` — only the message arm
 *    can match there.
 */
export function isLikelyOffline(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  const text = typeof message === 'string' ? message : '';
  // `status` is unavailable here (the queue row does not persist it), so this
  // stays a heuristic: the classifier additionally requires `status === 0`.
  if (name === 'TypeError') return true;
  return TRANSPORT_MESSAGE.test(text);
}
