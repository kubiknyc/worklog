/**
 * Pure queue policy: how a push outcome mutates a queued mutation, and how a
 * failed attempt is classified. No IO — `store.native` persists; this decides.
 *
 * The store keeps mutations keyed by `clientId` (the client UUID of the artifact
 * the mutation produces), so a re-enqueue of the same logical write is a no-op
 * and a retried network call can't double-apply.
 */
import type { ErrorClass, Mutation, MutationPayload } from './types';

/** Attempts after which a still-retryable mutation is parked for manual retry. */
export const RETRY_CEILING = 5;

interface SupabaseLikeError {
  readonly code?: string;
  readonly status?: number;
  readonly message?: string;
  readonly name?: string;
}

function asError(err: unknown): SupabaseLikeError {
  if (err && typeof err === 'object') return err as SupabaseLikeError;
  return { message: String(err) };
}

/**
 * Map a push failure to an action:
 * - `evict`    — RLS/authorization denial (Postgres 42501, HTTP 403). The
 *                server won't ever accept this write; drop the local row too.
 * - `permanent`— a deterministic rejection (illegal transition 22000, check
 *                violation 23514, …). Parking it and surfacing beats looping.
 * - `retryable`— 5xx/auth-refresh/unknown — back off and try again next sync.
 * - `offline`  — transport failure (no reply at all). Retried, but exempt from
 *                the ceiling: a week without signal must not park valid writes.
 */
export function classifyError(err: unknown): ErrorClass {
  const e = asError(err);
  const code = e.code ?? '';
  const status = e.status ?? 0;

  if (code === '42501' || status === 403) return 'evict';

  // 401 = expired/invalid access token, not an authorization denial. The
  // Supabase client refreshes the session and the next sync retries; a genuinely
  // dead token just keeps failing until the retry ceiling parks it. Evicting here
  // would silently delete a still-valid offline write.
  if (status === 401) return 'retryable';

  // Server errors are transient but count toward the ceiling — a persistently
  // failing server should eventually park and surface, not loop silently.
  if (status >= 500) return 'retryable';
  // No HTTP status at all → the request never got a response (airplane mode,
  // dead wifi, DNS). This is the normal offline case, not a server verdict.
  if (status === 0 && (e.name === 'TypeError' || /network|fetch|timeout/i.test(e.message ?? ''))) {
    return 'offline';
  }

  // Deterministic rejections: SQL data/constraint errors (22xxx/23xxx) and
  // PL/pgSQL-raised errors. Match the PL/pgSQL SQLSTATE class (P0xxx: P0001
  // raise, P0002 not-found) plus our custom stale-replace code 'PL001' — but
  // NOT PostgREST's 'PGRST###' codes, some of which (e.g. PGRST301 expired JWT)
  // are retryable. A blanket startsWith('P') swept those in by mistake.
  if (/^(22|23)/.test(code)) return 'permanent';
  if (code.startsWith('P0') || code === 'PL001') return 'permanent';

  // 4xx that isn't auth → deterministic; anything else → give it another go.
  if (status >= 400 && status < 500) return 'permanent';
  return 'retryable';
}

/**
 * [R2-6] Normalize a storage-js error before `classifyError`. StorageApiError
 * carries the HTTP status as a *string* `statusCode` (older releases omit the
 * numeric `status` entirely), so an unnormalized "403" would fall through every
 * status check and misclassify an RLS denial as retryable. Returns a plain
 * object with a numeric `status` (Error fields are non-enumerable — a spread
 * would drop `message`/`name`); anything without a parseable status (e.g. a
 * StorageUnknownError wrapping a network failure) passes through unchanged so
 * classifyError's transport-failure heuristics still see it.
 */
export function normalizeStorageError(err: unknown): unknown {
  if (!err || typeof err !== 'object') return err;
  const e = err as SupabaseLikeError & { statusCode?: string | number };
  const numeric =
    typeof e.status === 'number' && e.status !== 0
      ? e.status
      : typeof e.statusCode === 'number'
        ? e.statusCode
        : typeof e.statusCode === 'string'
          ? parseInt(e.statusCode, 10)
          : NaN;
  if (!Number.isFinite(numeric) || numeric <= 0) return err;
  return { name: e.name, message: e.message, code: e.code, status: numeric };
}

/**
 * [R2-2] True when a storage upload failed because the object already exists
 * (HTTP 409 "Duplicate"). The bucket deliberately has no storage UPDATE policy
 * (so `upsert: true` is unavailable — its conflict path is an UPDATE → RLS
 * denial); a 409 on our client-UUID path can only mean a previous attempt's
 * bytes landed before a crash/timeout, so the caller treats it as success and
 * proceeds to the row insert — bytes→crash→retry converges.
 */
export function isDuplicateUpload(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as SupabaseLikeError & { statusCode?: string | number; error?: string };
  if (e.status === 409 || String(e.statusCode ?? '') === '409') return true;
  // Older storage-api releases report the duplicate as 400 + error 'Duplicate'.
  return /duplicate|already exists/i.test(`${e.error ?? ''} ${e.message ?? ''}`);
}

/**
 * [R2-6] Drain order: JSON mutations first (cheap, oldest-first), `add_photo`
 * last (also oldest-first) — one slow multi-MB upload on flaky cell must not
 * transiently stall report/section writes queued behind it. Safe to reorder:
 * no JSON mutation ever depends on a photo (06-sync-mappings.md §A —
 * `update_photo_meta`/`remove_photo` are only ever enqueued for already-synced
 * photos, so no JSON kind can precede its own `add_photo`), while photos DO
 * depend on their report's create_report — which, being JSON, still lands first.
 */
export function orderForDrain(pending: readonly Mutation[]): Mutation[] {
  const json = pending.filter((m) => m.payload.kind !== 'add_photo');
  const photos = pending.filter((m) => m.payload.kind === 'add_photo');
  return [...json, ...photos];
}

/** A mutation as first enqueued: pending, zero attempts. */
export function newMutation(
  clientId: string,
  payload: MutationPayload,
  createdAt: string,
): Mutation {
  return {
    clientId,
    payload,
    createdAt,
    attempts: 0,
    status: 'pending',
    lastError: null,
    revision: 0,
  };
}

/**
 * clientId for the two lifecycle kinds. `create_report` keeps the BARE report
 * UUID (it doubles as the RPC's p_client_id idempotency key); submit/lock get
 * a namespaced key so enqueue's INSERT OR IGNORE can never silently drop them
 * against the queued create_report row or each other. Mirrors update_section's
 * `${reportId}:${section}` composite. Re-enqueue of the same action stays an
 * idempotent no-op by design.
 */
export function lifecycleClientId(kind: 'submit_report' | 'lock_report', reportId: string): string {
  return kind === 'submit_report' ? `submit:${reportId}` : `lock:${reportId}`;
}

/** The local cached row a mutation writes (and marks `_dirty` until pushed —
 * except photos, whose unpushed-flag analogue is `_pending`). */
export interface RowTarget {
  readonly table: 'daily_reports' | 'report_sections' | 'report_photos' | 'report_amendments';
  readonly id: string;
}

/**
 * Which local row a mutation dirties. Section rows have a composite identity
 * [R2] — `(reportId, section)` joined with ':' (SectionKind values never
 * contain ':'). Lifecycle kinds (create/submit/lock) touch the report row.
 */
export function rowTargetOf(payload: MutationPayload): RowTarget {
  switch (payload.kind) {
    case 'update_section':
      return { table: 'report_sections', id: `${payload.data.reportId}:${payload.data.section}` };
    case 'add_photo':
    case 'update_photo_meta':
    case 'remove_photo':
      return { table: 'report_photos', id: payload.data.photoId };
    case 'create_amendment':
      return { table: 'report_amendments', id: payload.data.amendmentId };
    case 'create_report':
    case 'submit_report':
    case 'lock_report':
      return { table: 'daily_reports', id: payload.data.reportId };
  }
}

/**
 * True when any OTHER queued mutation (pending or parked — a parked edit is
 * still an unpushed local change) targets the same local row as `m`. Used by the
 * push: after `m` succeeds, the row's `_dirty` flag may only be cleared when
 * nothing else queued still owns that row — a blind clear would let the next
 * pull revert a local edit made while `m` was in flight, and would defeat
 * conflict.ts's "dirty parked edit survives LWW" protection.
 */
export function otherMutationTargetsRow(queued: readonly Mutation[], m: Mutation): boolean {
  const target = rowTargetOf(m.payload);
  return queued.some((q) => {
    if (q.clientId === m.clientId) return false;
    const t = rowTargetOf(q.payload);
    return t.table === target.table && t.id === target.id;
  });
}

export interface PushOutcome {
  readonly ok: boolean;
  /** Present when `ok` is false. */
  readonly error?: unknown;
  /**
   * Set by Task 4's pusher when a `create_report` push hit a same-day
   * UNIQUE(project_id, report_date) collision and the get-or-create RPC
   * returned the existing report's id (the "winner"). `applyOutcome` never
   * branches on it — it exists purely for Task 5's engine to read after the
   * push and re-parent local rows/queued mutations onto the winner.
   */
  readonly reparentedTo?: string;
}

export interface AppliedOutcome {
  /** The mutation's next state, or null when it should be removed from the queue. */
  readonly next: Mutation | null;
  /** True when the local row(s) must be evicted (RLS denial). */
  readonly evict: boolean;
  /** `classifyError`'s verdict for a failed outcome; null on success. */
  readonly errorClass: ErrorClass | null;
}

/**
 * Fold a push outcome into the mutation. Pure: returns the next queue state and
 * whether the caller must evict the local row. Success → remove. Retryable →
 * bump attempts (park at the ceiling). Offline → stay pending, attempts
 * untouched. Permanent/evict → park immediately.
 */
export function applyOutcome(m: Mutation, outcome: PushOutcome): AppliedOutcome {
  if (outcome.ok) return { next: null, evict: false, errorClass: null };

  const cls = classifyError(outcome.error);
  const lastError = messageOf(outcome.error);

  // Offline is not a failed attempt — nothing was judged. Leave the mutation
  // exactly as queued so extended offline use can never park valid work.
  if (cls === 'offline') {
    return { next: { ...m, lastError }, evict: false, errorClass: cls };
  }

  const attempts = m.attempts + 1;

  if (cls === 'evict') {
    return { next: { ...m, attempts, status: 'parked', lastError }, evict: true, errorClass: cls };
  }
  if (cls === 'permanent') {
    return {
      next: { ...m, attempts, status: 'parked', lastError },
      evict: false,
      errorClass: cls,
    };
  }
  // retryable
  const status = attempts >= RETRY_CEILING ? 'parked' : 'pending';
  return { next: { ...m, attempts, status, lastError }, evict: false, errorClass: cls };
}

function messageOf(err: unknown): string {
  const e = asError(err);
  return e.message ?? 'Sync failed';
}
