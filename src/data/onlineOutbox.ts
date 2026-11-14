/**
 * Latest-wins holding area for online-only writes (the web build, and the
 * native fallback when the device DB can't open) whose send failed on the
 * NETWORK — the browser is offline, so the server never saw them (MULT-56).
 *
 * Without this, an edit made offline on web was lost silently: the RPC
 * failed, the section sheet only logged it, and the pill kept saying "All
 * saved". Now the write is held (one per key — a newer edit to the same
 * section replaces the older one), counted on the sync pill, and resent on
 * the browser's `online` event or a backoff timer. A SERVER rejection is
 * never held: it goes straight back to the caller, exactly as before.
 *
 * In-memory only, by design: this is not the native queue. A held write does
 * not survive a reload, and `clearHeldWrites()` drops everything on account
 * change so user A's text never resends under user B's session.
 *
 * Imports nothing but the hub — no Supabase client — so the provider (and its
 * tests) can wire it without pulling in the real client.
 */
import { syncStatusHub } from '../sync/statusHub';
import type { QueueCounter } from '../sync/types';

/** The part of a supabase-js `rpc()` result this module reads. */
export interface SendResult {
  readonly error: { readonly message: string } | null;
  /**
   * HTTP status. postgrest-js resolves `0` when fetch itself threw (offline);
   * a server rejection carries a real >= 400 status. Missing = not network.
   */
  readonly status?: number;
}

export type SendError = SendResult['error'];

/** One write, ready to (re)send. Its identity is the write's identity. */
export type Send = () => PromiseLike<SendResult>;

const FIRST_RETRY_MS = 2_000;
const MAX_RETRY_MS = 30_000;

/** Network-failed writes awaiting a resend, one per key. */
const held = new Map<string, Send>();
/** Newest write submitted per key; anything older is superseded. */
const latest = new Map<string, Send>();
/** Per-key send chain, so a stale send can never land after a newer one. */
const tails = new Map<string, Promise<unknown>>();

let retryDelay = FIRST_RETRY_MS;
let timer: ReturnType<typeof setTimeout> | null = null;
let listening = false;

// `online` exists in browsers only; guarded so native and jest just skip it.
const events = globalThis as {
  addEventListener?: (type: string, fn: () => void) => void;
  removeEventListener?: (type: string, fn: () => void) => void;
};

function changed(): void {
  if (held.size === 0) stopRetrying();
  void syncStatusHub.refresh();
}

function scheduleRetry(): void {
  if (!listening) {
    events.addEventListener?.('online', retryNow);
    listening = true;
  }
  if (timer !== null) return;
  timer = setTimeout(retryNow, retryDelay);
  retryDelay = Math.min(retryDelay * 2, MAX_RETRY_MS);
}

function stopRetrying(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  if (listening) events.removeEventListener?.('online', retryNow);
  listening = false;
  retryDelay = FIRST_RETRY_MS;
}

function retryNow(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  for (const [key, send] of held) {
    void run(key, send).then((error) => {
      // Nobody is awaiting a retry, so there is no caller to reject into.
      // Dropped rather than retried: the server will refuse it every time.
      if (error) console.warn(`[onlineOutbox] held write ${key} rejected; dropped:`, error);
    });
  }
}

async function attempt(key: string, send: Send): Promise<SendError> {
  // Superseded by a newer write, or dropped by clearHeldWrites, before it ran.
  if (latest.get(key) !== send) return null;
  let result: SendResult;
  try {
    result = await send();
  } catch (error: unknown) {
    // supabase-js resolves network failures, but a throw is no answer from
    // the server either.
    result = { error: { message: String(error) }, status: 0 };
  }
  const current = latest.get(key) === send;
  if (result.error && result.status === 0) {
    // Hold only if still the newest write for this key in this session.
    if (current) {
      held.set(key, send);
      changed();
      scheduleRetry();
    }
    return null;
  }
  if (current) {
    latest.delete(key);
    if (held.delete(key)) changed();
  }
  if (result.error) return result.error;
  retryDelay = FIRST_RETRY_MS;
  return null;
}

function run(key: string, send: Send): Promise<SendError> {
  const result = (tails.get(key) ?? Promise.resolve()).then(() => attempt(key, send));
  const tail = result.catch(() => undefined);
  tails.set(key, tail);
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });
  return result;
}

/**
 * Send `send` as the newest write for `key`, superseding any held one.
 * Resolves `null` when it landed OR was held for retry after a network
 * failure; resolves the server's error when the server refused it.
 */
export function sendLatest(key: string, send: Send): Promise<SendError> {
  latest.set(key, send);
  if (held.delete(key)) changed();
  return run(key, send);
}

/** Hub producer: held writes are the only pending work on the online path. */
export const countHeldWrites: QueueCounter = async () => ({ pending: held.size, parked: 0 });

/** Drop every held write and stop retrying (account change / teardown). */
export function clearHeldWrites(): void {
  held.clear();
  latest.clear();
  stopRetrying();
  void syncStatusHub.refresh();
}
