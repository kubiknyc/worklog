/**
 * Pure pull-cursor math.
 *
 * A cursor is the high-water `updated_at`/`created_at` seen for a feed. We pull
 * with `>= overlapFloor(cursor)` (NOT `> cursor`): boundary rows and a short
 * trailing window are re-fetched each time, which is safe because upserts are
 * idempotent, and guarantees we skip neither rows sharing the exact boundary
 * timestamp (Postgres timestamps collide under bulk writes) nor rows whose
 * transaction committed late (see OVERLAP_MS). The cost is a few redundant
 * rows per pull — negligible.
 *
 * Unlike PunchLog (whose cursors are global, one per table, because every pull
 * is already RLS-scoped to the rows the user may see), WorkLog's Tier 2 report
 * domain is keyed per-project (06-sync-mappings.md §B): the active project
 * pulls eagerly every sync run, other member projects rotate in the
 * background, and each needs its own high-water mark. Tier 1 reference data
 * (`projects`, `project_members`, `profiles`) stays global, matching PunchLog.
 */

/**
 * Cursor scope keys, one per pulled feed. String literals cross-checked
 * against the cursor table in 06-sync-mappings.md §B — the doc is
 * authoritative; keep these in sync with it, not the other way around.
 *
 * `report_member_prefs` deliberately has NO scope here: per §B it "rides with
 * `project_members`" — snapshot-pulled in the same transaction, sharing that
 * cursor, because the table has no `updated_at` to keyset on.
 */
export const SCOPES = {
  // Tier 1 — global reference data, not per-project (PunchLog-style).
  projects: () => 'projects',
  projectMembers: () => 'project_members',
  profiles: () => 'profiles',
  // Tier 2 — per-project report domain.
  reports: (projectId: string) => `reports:${projectId}`,
  sections: (projectId: string) => `report_sections:${projectId}`,
  // `report_photos_v1`, versioned from day one (§B) — PunchLog learned this
  // lesson the hard way bumping `photos` → `photos_v2` mid-flight [R1-2]; the
  // `_v1` suffix means a future pull-semantics change mints `_v2` instead of
  // silently misreading a stale cursor under new semantics.
  photos: (projectId: string) => `report_photos_v1:${projectId}`,
  amendments: (projectId: string) => `report_amendments:${projectId}`,
} as const;

/**
 * How far behind the stored cursor each pull's timestamp filter reaches, in ms.
 *
 * Postgres `now()` (which stamps `updated_at`/`created_at`) is transaction-
 * START time, not commit time. A transaction that started before a pull read
 * but committed after it leaves a row timestamped BELOW the cursor the pull
 * just advanced — filtered by `>= cursor` alone, that row is never fetched
 * (permanently, for append-only feeds like `report_amendments`). Querying from
 * `cursor - OVERLAP_MS` re-checks the recent window so such late commits are
 * picked up on the next pull. 10s comfortably exceeds any sane write
 * transaction's lifetime here (single-row/RPC upserts).
 */
export const OVERLAP_MS = 10_000;

/**
 * The timestamp floor a pull should QUERY with, given its stored cursor:
 * `cursor - overlapMs`, as an ISO string (`null` cursor stays `null` — a first
 * pull has no floor). The overlap is applied only when USING the cursor, never
 * when storing it, so the stored cursor itself stays monotonic (`nextCursor`).
 *
 * Re-fetching the overlap window is safe: rows carry client-generated UUID
 * primary keys and every pull write is an idempotent upsert, so a re-fetched
 * row just overwrites itself. JS `Date` math truncates sub-millisecond
 * precision, which can only move the floor slightly EARLIER — a wider window,
 * still safe. An unparseable cursor falls back to the exact cursor value.
 */
export function overlapFloor(cursor: string | null, overlapMs: number = OVERLAP_MS): string | null {
  if (cursor === null) return null;
  const parsed = Date.parse(cursor);
  if (Number.isNaN(parsed)) return cursor;
  return new Date(parsed - overlapMs).toISOString();
}

/** The high-water mark after folding a batch of timestamps in. */
export function nextCursor(
  current: string | null,
  timestamps: readonly (string | null)[],
): string | null {
  let max = current;
  for (const t of timestamps) {
    if (t && (max === null || t > max)) max = t;
  }
  return max;
}
