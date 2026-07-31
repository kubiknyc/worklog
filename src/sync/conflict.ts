/**
 * Pure conflict resolution for the pull merge — generic-record last-writer-wins
 * with dirty-row protection (06-sync-mappings.md §B, invariant 6): "a pulled
 * row never overwrites a local row whose `_dirty = 1` ... the queued mutation
 * will re-assert the local state, and `clearDirtyIfUncontested` only clears
 * the flag when no other queued mutation still targets that row." In the
 * common case sync is push-then-pull and pull runs only after a *fully*
 * successful push, so no local row is dirty when a pull lands — the row
 * surviving to this point is one whose mutation is still queued or was parked
 * (a permanent/evicted edit). There we still let the server win unless the
 * local edit is strictly newer (mutationQueue.ts's `otherMutationTargetsRow`
 * doc comment calls this "conflict.ts's 'dirty parked edit survives LWW'
 * protection").
 *
 * Ported from PunchLog's `sync/conflict.ts` and generalized: PunchLog's
 * `MergeableItem` named punch-item-specific fields (`status`, `assignee_id`)
 * and merged them individually — `status` was always adopted from the server
 * (workflow status is server-governed there) while `assignee_id` was the one
 * field eligible for LWW. WorkLog has no single cross-table analogue of that
 * split (e.g. `daily_reports.status` is server-governed via a dedicated
 * resolver per 06-sync-mappings.md §B, `resolveReport` — out of scope for this
 * generic primitive), so `mergeItem`/`resolveItem` here operate on the WHOLE
 * row: dirty-and-local-newer keeps the local row verbatim; otherwise the
 * server row wins verbatim. The LWW timestamp math (`isServerNewer`) and the
 * three-way branching structure are unchanged from PunchLog.
 */

/** Last-writer-wins by `updated_at`. Server wins on ties and when local is null. */
export function isServerNewer(
  localUpdatedAt: string | null,
  serverUpdatedAt: string | null,
): boolean {
  if (!serverUpdatedAt) return false;
  if (!localUpdatedAt) return true;
  return serverUpdatedAt >= localUpdatedAt;
}

/** Minimal shape `mergeItem`/`resolveItem` need — any row with a nullable `updated_at`. */
export interface MergeableItem {
  readonly updated_at: string | null;
}

/**
 * Merge a pulled server row over the local row.
 * - not dirty, or server newer → take the server row verbatim.
 * - dirty and local newer → keep the local row verbatim. The queued mutation
 *   will re-assert it on the next push; `_dirty` is only cleared once nothing
 *   else queued still targets the row (`otherMutationTargetsRow`).
 */
export function mergeItem<T extends MergeableItem>(local: T, server: T, localDirty: boolean): T {
  if (!localDirty || isServerNewer(local.updated_at, server.updated_at)) return server;
  return local;
}

export interface ResolvedItem<T extends MergeableItem> {
  readonly item: T;
  /** 1 only when the local row survived the merge and still needs pushing. */
  readonly dirty: 0 | 1;
}

/**
 * Decide the row to persist on a pull AND whether it stays dirty.
 *
 * Dirty is derived from WHICH row survived the merge (reference equality with
 * `server`), not a per-field diff: when the server wins outright (the common
 * case — offline writes never bump `updated_at`, so the server is "newer" on
 * the tie), the optimistic edit has been reconciled away and the dirty flag
 * MUST clear; leaving it set shows the row as "pending" forever and re-merges
 * it on every subsequent pull (H2, carried over from PunchLog).
 */
export function resolveItem<T extends MergeableItem>(
  local: T | null,
  server: T,
  localDirty: boolean,
): ResolvedItem<T> {
  if (!local || !localDirty) return { item: server, dirty: 0 };
  const merged = mergeItem(local, server, true);
  const dirty: 0 | 1 = merged === server ? 0 : 1;
  return { item: merged, dirty };
}

/** Minimal shape `resolveReport` needs — a row with a server-governed `status`. */
export interface ReportLike {
  readonly status: string;
}

export interface ResolvedReport<T extends ReportLike> {
  readonly item: T;
  /** 1 only when the local row's content survived, shielded, and still needs pushing. */
  readonly dirty: 0 | 1;
}

/**
 * Resolve a pulled `daily_reports` row against the local row: the absolute
 * dirty shield (06-sync-mappings.md §B, invariant 8), deliberately NOT the
 * generic `resolveItem` LWW above.
 *
 * Report lifecycle is RPC-governed, so `status` is always adopted from the
 * server. Content, however, is either taken wholesale from the server (clean
 * rows — an offline device's local `updated_at` is meaningless, so no
 * timestamp comparison happens) or shielded wholesale from the local row
 * (dirty rows — the queued mutation still owns the content and will
 * re-assert it on the next push).
 */
export function resolveReport<T extends ReportLike>(
  local: T | null,
  server: T,
  localDirty: boolean,
): ResolvedReport<T> {
  if (!local || !localDirty) return { item: server, dirty: 0 };
  return { item: { ...local, status: server.status }, dirty: 1 };
}
