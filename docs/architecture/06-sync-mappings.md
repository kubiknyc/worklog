# WorkLog — Phase 3 Sync Mappings

> Phase 3 (data model) deliverable. This is the authoritative kind-by-kind mapping between the mutation queue (`src/sync/types.ts`), the push handlers (`src/sync/push.native.ts`, Phase 4), the Postgres tables (`04-data-model.md`), and the local rows they dirty. It folds in the **approved reconciliations** from `00-README.md` (R1 queued `update_photo_meta`; R2 composite section PK; R3 weather as the 11th `SectionKind`; R5 `remove_photo` = soft delete; R6 locked cutoff covers photos), which override the older per-track wording in `02-modules-navigation-sync.md` §C and `03-photo-voice-pdf.md` §A.8 where they differ.

---

## A. Mutation kinds → push handlers (8 kinds)

Enforcement recap (04 §B/§C): report tables are SELECT-only to clients; the five lifecycle kinds go through SECURITY DEFINER RPCs. `report_photos` is the one table with direct client INSERT/UPDATE grants, so the three photo kinds are storage + direct table ops.

| # | Kind | Payload (client UUIDs **bold**) | Push handler | Postgres target(s) | `rowTargetOf` (local row dirtied) | Drain class |
|---|---|---|---|---|---|---|
| 1 | `create_report` | **reportId**, projectId, reportDate, carryForwardSourceReportId | RPC `create_report(p_project_id, p_report_date, p_client_id)` — get-or-create | `daily_reports` (+ `daily_report_audit_log` 'created') | `{ table: 'daily_reports', id: reportId, reportId }` | JSON |
| 2 | `update_section` (non-weather) | reportId, section, content, isComplete | Upsert `report_sections` via RPC `update_section` (explodes child rows transactionally; draft-window only — P0001 once submitted/locked; post-submit corrections are amendments) | `report_sections` + `report_crew`/`report_equipment`/`report_work_performed`/`report_delays`/`report_safety_observations` for the relational sections (+ `has_incident`/`has_delay` recompute on `daily_reports`) | `{ table: 'report_sections', id: reportId, section, reportId }` | JSON |
| 3 | `update_section` (section = `'weather'`) [R3] | reportId, section='weather', content = `WeatherOverrideContent` | Same RPC, weather branch: writes `override_condition`/`override_temp_f`, stamps `override_at`/`override_by`, sets `weather_source = 'manual'` | `report_weather` | `{ table: 'report_weather', id: reportId, reportId }` | JSON |
| 4 | `submit_report` | reportId, signaturePngBase64, signerName, signerTitle | RPC `submit_report` — enforces `draft → submitted`, persists signature atomically, audit row; distribution email/PDF via outbox table, out of transaction | `daily_reports`, `report_signatures`, `daily_report_audit_log` | `{ table: 'daily_reports', id: reportId, reportId }` | JSON |
| 5 | `lock_report` | reportId | RPC `lock_report` — enforces `submitted → locked` (explicit tap only; auto-lock is server-scheduled) | `daily_reports`, `daily_report_audit_log` | `{ table: 'daily_reports', id: reportId, reportId }` | JSON |
| 6 | `create_amendment` | **amendmentId**, reportId, reason, changes[], signaturePngBase64? | RPC `amend_report` — idempotent on amendmentId; snapshots before, applies after, assigns `amendment_number`, requires status ∈ (submitted, locked) | `report_amendments`, `report_amendment_changes`, `report_sections` (+ child re-explosion), `report_signatures` (if signed), `daily_report_audit_log` | `{ table: 'report_amendments', id: amendmentId, reportId }` | JSON |
| 7 | `add_photo` | **photoId**, reportId, projectId, storagePath, localUri, width, height, capturedAt, exifDateTimeOriginal, gps*, source, tradeTag, locationTag, caption | Bytes-then-row (PunchLog `pushAddPhoto` shape): storage upload (409 duplicate ⇒ success), then direct upsert (`onConflict: 'id'`, `ignoreDuplicates`); INSERT allowed while status ∈ (draft, submitted), rejected once locked [R6]; success clears `_pending`/`local_uri`, deletes outbox file | `storage.objects` (worklog-photos) + `report_photos` | `{ table: 'report_photos', id: photoId, reportId }` | photo (last) |
| 8 | `update_photo_meta` [R1] | photoId, reportId, caption, tradeTag, locationTag | Guarded direct `UPDATE report_photos SET caption, trade_tag, location_tag WHERE id = ? AND deleted_at IS NULL` — meta trio only; provenance columns trigger-protected server-side | `report_photos` | `{ table: 'report_photos', id: photoId, reportId }` | JSON |
| 9 | `remove_photo` [R5] | photoId, reportId, storagePath | Guarded soft delete: storage `remove(storagePath)` first (the draft-only storage DELETE policy is the gate; "not found" ⇒ treated as success on retry), then direct `UPDATE report_photos SET deleted_at = now-ish server-side WHERE id = ? AND deleted_at IS NULL` (the photos touch trigger stamps `updated_at`, which is what publishes the tombstone) | `storage.objects` + `report_photos` | `{ table: 'report_photos', id: photoId, reportId }` | JSON |

(Rows 2–3 are one kind, `update_section`, branched inside the handler on `section === 'weather'` — the kind count is 8.)

### `RowTarget` shape (extends PunchLog's `{ table, id }`)

```ts
interface RowTarget {
  table: 'daily_reports' | 'report_sections' | 'report_weather' | 'report_photos' | 'report_amendments';
  id: string;              // row PK; for report_sections it is reportId (composite PK, see below)
  section?: SectionKind;   // present only for table === 'report_sections' — completes the composite key [R2]
  reportId: string;        // grouping key for the per-report conflict/park surfaces
}
```

- `clearDirtyIfUncontested` clears `_dirty` with `WHERE id = ?` on `daily_reports`/`report_amendments`, `WHERE report_id = ?` on `report_weather`, `WHERE report_id = ? AND section = ?` on `report_sections`, and `WHERE id = ?` on `report_photos` (the meta-edit `_dirty`; `add_photo`'s handler owns `_pending` itself, exactly like PunchLog).
- `otherMutationTargetsRow` compares the full tuple (`table` + `id` + `section` when present), so a queued crew edit never blocks clearing a pushed notes edit on the same report.

**Shipped `RowTarget` shape (blessed deviation from the interface above).** The implementation in `src/sync/mutationQueue.ts` (Task 4 Edit B) flattens `RowTarget` to just `{ table, id }` — no `section` or `reportId` fields. For `update_section` (including the weather branch), `id` is the composite `(reportId, section)` tuple joined with `':'` (`${reportId}:${section}`; `SectionKind` values never contain `':'`, so the join is unambiguous and reversible). Weather rides the same `report_sections` mapping as every other section at this layer — there is no separate `report_weather` entry in the mutation-queue's `RowTarget.table` union. This is behaviorally equivalent to the `{ table, id, section?, reportId }` shape above for this slice's only consumer, `otherMutationTargetsRow`, which just needs tuple equality to detect same-row contention. `mutationQueue.ts` is not being changed to match this doc; instead this doc is amended to bless the shipped shape. Any M3 code that needs `reportId`, `section`, or a `report_weather`-specific target must derive them itself by splitting the composite id on `':'` — `const [reportId, section] = id.split(':')` — and, for the weather case, checking `section === 'weather'` since the mutation-queue layer does not distinguish it from any other section.

### Per-kind notes

**`create_report` — the re-parenting contract (02 §C, conflict surface 3).** The RPC returns `(report_id, was_created)`. When the returned id ≠ the payload's `reportId` (natural-key collision — another device or a pre-kill enqueue won the day), the handler calls `reparentReport(ctx, loserId, winnerId)`: in ONE SQLite transaction, rewrite `report_id` on every local `report_sections`/`report_weather`/`report_photos`/`report_amendments` (+ child-table) row, rewrite the embedded `reportId` (and `storagePath` for not-yet-pushed photos) inside every other queued mutation's payload, and delete the loser's local `daily_reports` row. The mutation is dequeued only after re-parenting commits; if re-parenting throws, the mutation stays `pending` (retryable) — safe because the RPC is idempotent and returns the same winner again.

**`update_section` — coalescing.** The repository coalesces repeated edits per `(reportId, section)`: enqueue replaces the still-pending mutation's payload in place (same `clientId`, synthesized as `${reportId}:${section}` since the composite key has no single UUID). One section = at most one queued mutation.

**`submit_report`/`lock_report` — replay semantics (amended 2026-07-29 to match the shipped RPCs).** Re-invoked on a report already in the target state, both RPCs return as **idempotent no-ops** (`submit_report` early-returns on `submitted`, `lock_report` on `locked`) — a lost-response retry succeeds cleanly rather than parking. `P0001` still fires for genuinely illegal transitions (e.g. submit on a `locked` report) → classified `permanent` → parked and surfaced, which remains correct per 04 §C.3.

**`create_amendment` — local optimistic rows.** Enqueue writes the local `report_amendments` row (`amendment_number` NULL until pull backfill, `_dirty = 1`) plus `report_amendment_changes` rows computed from local state; the pull later overwrites both with the server's authoritative snapshot.

**`add_photo` failure semantics.** Identical to PunchLog: offline exempt from the retry ceiling; RLS denial (403/42501) evicts the local row + outbox file; a parked `create_report` causes dependent kinds (including photos) for that report to be *skipped*, not burned.

**`update_photo_meta` / `remove_photo` — inverted evict.** These two kinds NEVER delete the local photo row on a permanent/RLS failure — the generic `evictLocal` would destroy evidence. Instead: park + surface, clear `_dirty` (meta) or restore visibility by nulling the local `deleted_at` (remove), and let the next pull's LWW restore the server's meta. `remove_photo`'s 403 surfaces "This report was already sent — the photo will stay in the report."

### Drain order (`orderForDrain` — copied verbatim, verified safe)

Two passes over one queue: **JSON kinds in `seq` order first** (`create_report`, `update_section`, `submit_report`, `lock_report`, `create_amendment`, `update_photo_meta`, `remove_photo`), **then `add_photo` in `seq` order**. Safety argument for the two new JSON photo kinds draining ahead of `add_photo`: both are only ever enqueued for an **already-synced** photo — an edit or removal of a `_pending` photo rewrites/cancels the queued `add_photo` locally instead (see `types.ts` doc comments) — so neither can precede its own `add_photo` by construction. The submit/photo race stays resolved by R6: `report_photos` INSERT survives `submitted`; only a straggler losing against `locked` parks, onto the "Add as amendment?" copy.

---

## B. Pull scopes, cursors, reconciliation

### Tier 1 — global reference data (PunchLog-style, no per-project keying)

| Table | Scope key | Pull shape | Notes |
|---|---|---|---|
| `projects` | `projects` | Snapshot by id (`selectAllById`), full replace | Now carries `timezone`/`lat`/`lng`/`geocode_source`/`geocoded_at` + the PunchLog columns (full shared-table parity) |
| `project_members` | `project_members` | Snapshot by composite key, full replace | Membership loss here drives the Tier-2 per-project eviction sweep |
| `profiles` | `profiles` | Snapshot by id | Mirrors the 9-column PunchLog snapshot; server-side notification prefs (notify_push/notify_digest/notify_mentions, migration 20260705000001) are never pulled into the SQLite mirror — they feed server notification triggers only and are instead served offline via the AsyncStorage account cache. |
| `report_member_prefs` | — (rides with `project_members`) | Snapshot, full replace in the same transaction | **Mirrored locally** (decision): the PM/super display title must resolve offline for the PDF signature block and `roles.ts`; the table has no `updated_at`, so it snapshots with its sibling rather than keyset-pulling |

**M3 brief — `profiles` column grant note.** Migration `20260707000001` revoked `expo_push_token` from the `profiles` SELECT grant (see `src/auth/AuthProvider.tsx`'s `PROFILE_COLUMNS`), so M3's `profiles` pull MUST enumerate columns explicitly — a `select('*')` pull would 403 — and the local SQLite mirror's `expo_push_token` column stays permanently NULL. The schema-parity guard cannot see column *grants* (only column existence), so it cannot catch a `select('*')` regression here; this note is the record of that gap for whoever builds the M3 pull.

Not mirrored, never pulled: `companies`, `company_members`, `company_branding`, `report_customization`, `report_distribution_lists` (online-only; AsyncStorage account cache covers offline restore), `report_signatures` (write-only via RPC payloads), `daily_report_audit_log` (server-only).

### Tier 2 — per-project report domain

Active project pulled eagerly every sync run; other member projects refreshed on project-switch plus a slow one-per-run background rotation (cadence = Phase 4 tuning; rotation bookkeeping lives in `sync_meta`).

| Table | Cursor scope key | Keyset | Rides along (no own cursor) | Tombstones | Reconcile |
|---|---|---|---|---|---|
| `daily_reports` | `reports:<projectId>` | `(updated_at, id)`, overlap floor | `report_weather` — the parent row's pull fetches the 1:1 weather row in the same transaction | none (reports are never deleted, only locked) | Per-project id-sweep (membership-loss cascade); skips `_dirty = 1`; `status` merged via `resolveReport` — server-governed, never LWW |
| `report_sections` | `report_sections:<projectId>` | `(updated_at, report_id, section)`, overlap floor | Relational child tables — the pull upsert re-explodes the pulled payload into `report_crew`/`report_equipment`/`report_work_performed`/`report_delays`/`report_safety_observations` (delete-and-insert per section) in the same SQLite transaction | none | Cascades with parent report eviction; a `_dirty = 1` section row (and therefore its children) is never replaced by a pull |
| `report_photos` | `report_photos_v1:<projectId>` (versioned from day one) | `(updated_at, id)`, overlap floor | — | **Non-null `deleted_at` ⇒ local hard `DELETE`** of the row (+ cached thumbnail file) [R5] | Per-project id-sweep excluding `_pending = 1` and `_dirty = 1`; pull upsert never touches `_pending`/`_dirty`/`local_uri`/`local_thumb_uri` |
| `report_amendments` | `report_amendments:<projectId>` | `(created_at, id)` — append-only | `report_amendment_changes` — fetched per pulled amendment id, replaced locally in the same transaction | none (amendments are immutable) | Cascades with parent report eviction only; `_dirty = 1` (unpushed local amendment) shielded from the sweep |

**Pull-upsert dirty-row rule (invariant 6, all tables):** a pulled row never overwrites a local row whose `_dirty = 1` (or, for photos, `_pending = 1`) — the queued mutation will re-assert the local state, and `clearDirtyIfUncontested` only clears the flag when no other queued mutation still targets that row.

**Weather ride-along correctness (server obligation):** riding on the report row is only sound if every `report_weather` write also bumps `daily_reports.updated_at`. Phase 3 backend contract: both the `update_section` weather branch and the weather-fetch edge function touch the parent report row in the same transaction as the `report_weather` write. Without this, another device's cursor never observes an override or auto-fill that didn't coincide with a report edit.

**Photo tombstone/meta propagation (server obligation):** the `report_photos` touch trigger (BEFORE UPDATE → `updated_at = now()`) is what pushes `update_photo_meta` edits and `remove_photo` tombstones past other devices' `report_photos_v1` cursors. The `_v1` suffix exists so a future pull-semantics change mints `_v2` instead of silently misreading stale cursors (PunchLog's photos→photos_v2 lesson).

### Other Phase-3 backend obligations referenced by these mappings

1. `reject_edit_if_locked` extended to `report_photos` INSERT/UPDATE (R6), service-role exempt.
2. Provenance-column protection trigger on `report_photos` UPDATE (only `caption`/`trade_tag`/`location_tag`/`deleted_at` may change from a client).
3. `report_photos` UPDATE grant/policy scoped per 04 §B.3 (`is_super(project_id)`); DELETE stays revoked — removal is the soft-delete UPDATE.
4. Draft-window enforcement for `remove_photo`'s row update (trigger variant: reject setting `deleted_at` unless parent status = 'draft'), matching the draft-only storage DELETE policy so the two halves can't disagree.
5. `update_section` RPC bumps the section row's `updated_at` (or `report_weather` + parent, weather branch) and recomputes `has_incident`/`has_delay` in-transaction.

---

## C. Deviations & decisions log (vs the track docs / PunchLog)

| # | Decision | Why |
|---|---|---|
| 1 | `update_section` has **no** `sectionId`; identity = `(reportId, section)`; `RowTarget` gains an optional `section` field | R2 approved: composite PK, one less id to mint and re-parent |
| 2 | 8 kinds, not 02 §C's 7: `update_photo_meta` added | R1 approved: queued, caption/trade_tag/location_tag only, draft window |
| 3 | Weather = 11th `SectionKind`; local `report_weather` table mirrors Postgres and carries its own `_dirty` | R3 approved; the queued override dirties a row `report_sections` doesn't hold |
| 4 | Photo tag column is **`trade_tag`** (04 §A.5 wrote `trade`) | R1's approved wording names `trade_tag`; symmetric with `location_tag`; reconciliations override track docs |
| 5 | `report_photos.exif_datetime_original` included (absent from 04 §A.5) | 03 §A.8 names it a Phase-3 schema obligation and the approved `add_photo` payload carries it; the parity test will force the Postgres migration to match |
| 6 | `report_photos` gains `_dirty` (PunchLog photos have only `_pending`) | Consequence of R1: a synced photo can hold an unpushed meta edit a pull must not clobber |
| 7 | `report_member_prefs` mirrored locally, snapshot-pulled with Tier 1 | PDF signature block + PM label must resolve offline; table has no `updated_at`, so no keyset |
| 8 | `report_amendments.amendment_number` nullable in SQLite (NOT NULL in Postgres); `report_amendments` carries `_dirty` | Number is RPC-assigned — an offline-created amendment holds NULL until pull backfill (provisional-code precedent); `_dirty` shields the unpushed row from the reconcile sweep |
| 9 | No `report_deliveries` child table (02 §C listed one) | 04 §A.3 is authoritative for the table set: deliveries/inspections/visitors/RFIs stay in `report_sections.payload` jsonb; the relational set is crew/equipment/work_performed/delays/safety |
| 10 | `daily_reports` natural key non-unique locally | The create_report collision path lets loser + winner coexist for one transaction during re-parenting; the server owns UNIQUE(project_id, report_date) |
| 11 | `RemovePhotoPayload` carries `storagePath` | The handler must hard-delete the storage object under the draft-only DELETE policy; deriving it from the row would break if the local row were already gone |
| 12 | Domain literal unions (`SectionKind`, `PhotoSource`) defined in `src/sync/types.ts`, not imported from `src/data/types` (PunchLog imports its literals from data) | `src/data/types.ts` doesn't exist yet (Phase 4) and `SectionKind` is a sync-level discriminator; the data layer re-exports, keeping the data → sync dependency direction |
| 13 | `update_photo_meta`/`remove_photo` invert evict semantics (park + restore instead of local delete) | Evidence preservation — extends 02 §C's approved `remove_photo` inversion to the meta kind for the same reason |
