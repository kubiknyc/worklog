/**
 * `isLikelyOffline` documents itself as mirroring the transport branch of the
 * sync queue's `classifyError`. It used to do that by restating the pattern,
 * and the two had drifted: the copy here omitted `timeout` and bare
 * `network`/`fetch`, so a fetch abort was `offline` to the classifier — exempt
 * from the retry ceiling — while the queue screen rendered "Will retry
 * automatically", telling the user a server retry was pending when the queue
 * was actually parked on connectivity (#22).
 *
 * They now share one exported pattern. The agreement table below is what keeps
 * that true: re-narrowing either side breaks it.
 */
import { errorMessage, isLikelyOffline } from './errors';
import { classifyError } from '../sync/mutationQueue';

describe('errorMessage', () => {
  it('surfaces a real Error message', () => {
    expect(errorMessage(new Error('Enter a project name.'))).toBe('Enter a project name.');
  });

  it('falls back for a blank message, a non-Error, and null', () => {
    // A whitespace-only message would render as an empty toast — worse than
    // the generic string, because it looks like nothing went wrong.
    expect(errorMessage(new Error('   '))).toBe('Something went wrong. Please try again.');
    expect(errorMessage('a bare string')).toBe('Something went wrong. Please try again.');
    expect(errorMessage(null)).toBe('Something went wrong. Please try again.');
  });
});

describe('isLikelyOffline', () => {
  it('rejects non-objects rather than throwing on a bare string', () => {
    // `rowDetailOf` passes `{ message: m.lastError }` precisely because a bare
    // string must not be treated as an error object.
    expect(isLikelyOffline('Network request failed')).toBe(false);
    expect(isLikelyOffline(null)).toBe(false);
    expect(isLikelyOffline(undefined)).toBe(false);
  });

  it('matches on name alone when the caught error is passed through', () => {
    // pull.native.ts:263 hands over the real error, so `name` survives.
    expect(isLikelyOffline({ name: 'TypeError', message: '' })).toBe(true);
  });

  it('matches on message alone when only the persisted lastError is available', () => {
    // SyncQueueScreen rebuilds `{ message }` from the queue row, which never
    // carries `name` — the message arm is the only one that can fire there.
    expect(isLikelyOffline({ message: 'Network request failed' })).toBe(true);
    expect(isLikelyOffline({ message: 'Failed to fetch' })).toBe(true);
  });

  it('ignores a non-string message', () => {
    expect(isLikelyOffline({ message: 42 })).toBe(false);
  });
});

describe('isLikelyOffline agrees with classifyError on transport failures', () => {
  // Each of these reaches `classifyError` with no HTTP status, which is what
  // "the request never got a reply" looks like.
  const TRANSPORT = [
    ['React Native offline', 'Network request failed'],
    ['web offline', 'Failed to fetch'],
    ['WebKit offline', 'Load failed'],
    ['fetch abort', 'Aborted due to timeout'],
  ] as const;

  it.each(TRANSPORT)('%s is offline to both', (_label, message) => {
    // The regression this pins: the classifier exempting a mutation from the
    // retry ceiling while the UI claims a server retry is pending.
    expect(classifyError({ message, status: 0 })).toBe('offline');
    expect(isLikelyOffline({ message })).toBe(true);
  });

  const SERVER_REJECTIONS = [
    ['unique violation', { code: '23505', status: 409, message: 'duplicate key' }],
    ['RLS denial', { code: '42501', status: 403, message: 'permission denied' }],
    ['illegal transition', { code: 'P0001', status: 400, message: 'report already locked' }],
  ] as const;

  it.each(SERVER_REJECTIONS)('%s is offline to neither', (_label, error) => {
    expect(classifyError(error)).not.toBe('offline');
    expect(isLikelyOffline({ message: error.message })).toBe(false);
  });
});
