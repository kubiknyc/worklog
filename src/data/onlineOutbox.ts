/**
 * Latest-wins holding area for online-only writes (the web build, and the
 * native fallback when the device DB can't open) whose send failed on the
 * NETWORK — the browser is offline, so the server never saw them (MULT-56).
 *
 * Without this, an edit made offline on web was lost silently: the RPC
 * failed, the section sheet only logged it, and the pill kept saying "All
 * saved". Now the write is held (one per key — a newer edit to the same
 * section replaces the older one), counted on the sync pill, and resent on
 * the browser's `online` event or a backoff timer. A SERVER rejection of the
 * first (direct) send is never held: it goes straight back to the caller,
 * exactly as before.
 *
 * A held write the server refuses on RESEND has nobody awaiting it, so it is
 * PARKED instead of dropped: it stays listed (sync queue screen) and counted
 * as "needs attention" until the user acts — a later edit of that section
 * lands, they Discard it, or they Retry it. Account change drops everything.
 *
 * In-memory only, by design: this is not the native queue. A held write does
 * not survive a reload — so while anything is held or parked, the browser is
 * asked to warn before unloading. `clearHeldWrites()` drops everything on
 * account change so user A's text never resends under user B's session.
 *
 * Imports nothing but the hub and types — no Supabase client, nothing native
 * — so the provider, the section-draft hook, and their tests can use it.
 */
import { syncStatusHub } from '../sync/statusHub';
import type { Mutation, QueueCounter, UpdateSectionPayload } from '../sync/types';

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

/** A section write: what to send, plus the ORIGINAL content it carries. */
export interface OutboxWrite extends UpdateSectionPayload {
  readonly send: Send;
}

/** A held or parked write, as listed on the sync queue screen. */
interface Entry {
  readonly write: OutboxWrite;
  readonly createdAt: string;
  readonly attempts: number;
}

const FIRST_RETRY_MS = 2_000;
const MAX_RETRY_MS = 30_000;
/** Plain copy only — `rowDetailOf` maps it, and never shows raw server text. */
const OFFLINE_MESSAGE = 'Network request failed'; // reads as "Waiting for connection"
const REFUSED_MESSAGE = "The server didn't accept this change";

/** Network-failed writes awaiting a resend, one per key. */
const held = new Map<string, Entry>();
/** Resends the server refused; kept until the user acts. */
const parked = new Map<string, Entry>();
/** Newest unlanded write per key; anything older is superseded. */
const latest = new Map<string, OutboxWrite>();
/** Per-key send chain, so a stale send can never land after a newer one. */
const tails = new Map<string, Promise<unknown>>();

let retryDelay = FIRST_RETRY_MS;
let timer: ReturnType<typeof setTimeout> | null = null;
let listening = false;
let guardingUnload = false;

interface UnloadEvent {
  preventDefault(): void;
  returnValue: unknown;
}

// `online` / `beforeunload` exist in browsers only; guarded so native and
// jest just skip them.
const events = globalThis as {
  addEventListener?: (type: string, fn: (event: UnloadEvent) => void) => void;
  removeEventListener?: (type: string, fn: (event: UnloadEvent) => void) => void;
};

const keyOf = (reportId: string, section: string) => `${reportId}:${section}`;

/** The browser's "leave site? changes may not be saved" prompt. */
function warnBeforeUnload(event: UnloadEvent): void {
  event.preventDefault();
  event.returnValue = '';
}

function changed(): void {
  if (held.size === 0) stopRetrying();
  const wantGuard = held.size + parked.size > 0;
  if (wantGuard !== guardingUnload) {
    if (wantGuard) events.addEventListener?.('beforeunload', warnBeforeUnload);
    else events.removeEventListener?.('beforeunload', warnBeforeUnload);
    guardingUnload = wantGuard;
  }
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

/** Resend every held write; settles when each attempt has. */
function resendHeld(): Promise<void> {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  return Promise.all([...held].map(([key, entry]) => run(key, entry.write, entry))).then(
    () => undefined,
  );
}

function retryNow(): void {
  void resendHeld();
}

async function callSend(send: Send): Promise<SendResult> {
  try {
    return await send();
  } catch {
    // supabase-js resolves network failures, but a throw is no answer from
    // the server either.
    return { error: { message: OFFLINE_MESSAGE }, status: 0 };
  }
}

/** `resendOf` is the held entry being resent; null for the direct send. */
async function attempt(
  key: string,
  write: OutboxWrite,
  resendOf: Entry | null,
): Promise<SendError> {
  // Superseded by a newer write, or dropped by clearHeldWrites, before it ran.
  if (latest.get(key) !== write) return null;
  const result = await callSend(write.send);
  // Verified against @supabase/supabase-js / postgrest-js 2.110.7: when fetch
  // throws, the non-throwing builder resolves `{ status: 0 }`, and a POST
  // (every rpc() here) is not in postgrest-js's RETRYABLE_METHODS, so there is
  // no internal retry first — status 0 means the server never answered.
  const offline = result.error !== null && result.status === 0;
  // Superseded or cleared meanwhile: never held or parked. A direct send the
  // server refused still rejects to its caller, as it always has.
  if (latest.get(key) !== write) return offline || resendOf ? null : result.error;
  const entry: Entry = {
    write,
    createdAt: resendOf?.createdAt ?? new Date().toISOString(),
    attempts: (resendOf?.attempts ?? 0) + 1,
  };
  if (offline) {
    held.set(key, entry);
    parked.delete(key); // this newer content supersedes a stale parked one
    changed();
    scheduleRetry();
    return null;
  }
  latest.delete(key);
  let touched = held.delete(key);
  if (!result.error) {
    // The user's later edit landed: a stale parked one no longer matters.
    touched = parked.delete(key) || touched;
    retryDelay = FIRST_RETRY_MS;
  } else if (resendOf) {
    // Nobody is awaiting a resend, so there is no caller to reject into —
    // park it where the user can see, retry, or discard it.
    console.warn(`[onlineOutbox] held write ${key} refused on resend; parked:`, result.error);
    parked.set(key, entry);
    touched = true;
  }
  if (touched) changed();
  return resendOf ? null : result.error;
}

function run(key: string, write: OutboxWrite, resendOf: Entry | null): Promise<SendError> {
  const result = (tails.get(key) ?? Promise.resolve()).then(() => attempt(key, write, resendOf));
  const tail = result.catch(() => undefined);
  tails.set(key, tail);
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });
  return result;
}

/**
 * Send `write` as the newest write for its section, superseding any held
 * one. Resolves `null` when it landed OR was held for retry after a network
 * failure; resolves the server's error when the server refused it.
 */
export function sendLatest(write: OutboxWrite): Promise<SendError> {
  const key = keyOf(write.reportId, write.section);
  // The held entry stays counted until this newer write resolves (`attempt`
  // replaces or clears it) — clearing it here would flicker the pill to "All
  // saved" between two offline edits. Its own resend is already superseded.
  latest.set(key, write);
  return run(key, write, null);
}

/**
 * The newest content for a section that has not reached the server — in
 * flight or held first, else parked — or null. Seeds a reopened section sheet
 * so the next edit builds on the offline text instead of replacing it.
 */
export function pendingSectionContent(
  reportId: string,
  section: string,
): Pick<UpdateSectionPayload, 'content' | 'isComplete'> | null {
  const key = keyOf(reportId, section);
  const write = latest.get(key) ?? parked.get(key)?.write;
  return write ? { content: write.content, isComplete: write.isComplete } : null;
}

/** Hub producer: held + parked writes are the only work on the online path. */
export const countHeldWrites: QueueCounter = async () => ({
  pending: held.size,
  parked: parked.size,
});

function toMutation(key: string, entry: Entry, parkedRow: boolean): Mutation {
  const { reportId, section, content, isComplete } = entry.write;
  return {
    clientId: key,
    payload: { kind: 'update_section', data: { reportId, section, content, isComplete } },
    createdAt: entry.createdAt,
    attempts: entry.attempts,
    status: parkedRow ? 'parked' : 'pending',
    lastError: parkedRow ? REFUSED_MESSAGE : OFFLINE_MESSAGE,
    revision: 0,
  };
}

/** Held and parked writes as queue rows, for the sync queue screen. */
export function listHeldWrites(): readonly Mutation[] {
  return [
    ...[...held].map(([key, entry]) => toMutation(key, entry, false)),
    ...[...parked].map(([key, entry]) => toMutation(key, entry, true)),
  ];
}

/** Discard a parked write (user action). Returns 1, or 0 if none was parked. */
export function discardHeldWrite(key: string): number {
  if (!parked.delete(key)) return 0;
  changed();
  return 1;
}

/**
 * "Retry now": move every parked write back to held and resend everything
 * held. A refused resend parks again. Settles when every attempt has.
 */
export function retryHeldWrites(): Promise<void> {
  for (const [key, entry] of parked) {
    // A newer write already in flight for this section supersedes the stale
    // parked one: never resend it over the newer edit (it clears once that
    // one lands or is held).
    if (latest.has(key)) continue;
    parked.delete(key);
    latest.set(key, entry.write);
    held.set(key, entry);
  }
  changed();
  return resendHeld();
}

/** Drop every held and parked write and stop retrying (account change / teardown). */
export function clearHeldWrites(): void {
  held.clear();
  parked.clear();
  latest.clear();
  changed();
}
