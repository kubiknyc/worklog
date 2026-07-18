# WorkLog — Phase 3 Adversarial Verification (08)

Verified 2026-07-17 against the actual working trees of `jobsight-backend` and
`WorkLog`. Read-only review of the 7 migrations (`20260717000002`–`000008`),
`worklog-weather/index.ts`, `delete-account/worklog-cascade.ts` + `index.ts`
diff, the `seed.sql` WorkLog section, and the app artifacts (`src/db/schema.ts`,
`src/sync/types.ts`, `docs/architecture/06-sync-mappings.md`), judged against
`00-README.md` (R1–R6 + approved decisions), `04-data-model.md`,
`02-modules-navigation-sync.md` §C, and the backend agent's own deviation log
`07-backend-verification.md`.

---

## Verdicts per check

### Check 1 — Column parity, both directions: **FAIL**

Method: hand-diffed every table in `DOMAIN_COLUMNS` (`WorkLog/src/db/schema.ts`)
against the union of CREATE TABLE / ALTER TABLE across all backend migrations
(init + companies + code_prefix + the seven new files). `_`-prefixed columns,
`local_uri`/`local_thumb_uri`, and `sync_*` tables excluded per design.

| Table | Result |
|---|---|
| `profiles` (9) | match |
| `projects` (12 = init 5 + `company_id` + `code_prefix` + 5 geo) | match |
| `project_members` (4) | match |
| `report_member_prefs` (3) | match |
| `daily_reports` (13) | match |
| `report_sections` (6) | match |
| `report_crew` / `report_equipment` / `report_work_performed` / `report_delays` / `report_safety_observations` | match |
| `report_weather` (11) | match |
| **`report_photos`** | **MISMATCH — server has `width`, `height`; app has neither** |
| `report_amendments` (7) | match (nullable-vs-NOT-NULL on `amendment_number` is a documented, name-only-irrelevant deviation, 06 §C #8) |
| `report_amendment_changes` (5) | match |

`20260717000004_worklog_photos.sql:32-33` creates `width integer, height integer`;
they are in the column-scoped INSERT grant (line 161) and the provenance guard
(lines 96-97), and `AddPhotoPayload` (`src/sync/types.ts:142-143`) pushes both.
`DOMAIN_COLUMNS.report_photos` (`src/db/schema.ts:59-64`) and the SQLite DDL
(lines 176-186) omit both. The backend agent's own hand-off note demands them:
07 §C — "`report_photos` columns are final as … + `width`/`height`/… — the app
SQLite schema must match column-for-column". The future parity Jest test fails
today. Reverse direction: no app-declared column missing on the server.

### Check 2 — No existing file damaged: **PASS**

`git status --porcelain` shows 32 "modified" entries, but `git diff --numstat`
proves only two files have content changes:

- `supabase/functions/delete-account/index.ts` — **+10 / −0**: one import line
  (`worklog-cascade.ts`) and one commented, awaited call inserted between the
  avatar wipe (step 1) and the profile tombstone (step 2) — exactly where
  sole-membership must still be computable (memberships deleted at step 3).
  The callee probes `daily_reports` and returns `{skipped: true}` on
  42P01/PGRST2xx, so behavior with WorkLog tables absent is unchanged.
- `supabase/seed.sql` — **+125 / −0**, purely appended after the last PunchLog
  statement (`alter table public.items enable trigger items_notify`), below the
  `punchlist.allow_demo_seed` gate whose `raise exception` aborts the whole
  script. Append-only confirmed. (Minor: the file's mode flipped 100755→100644.)

All other "modified" entries are 0/0 CRLF line-ending noise (confirmed with
`--numstat` and `--ignore-cr-at-eol`). **No pre-existing migration was edited.**
All seven `202607170000{02..08}` files plus `worklog-weather/` and
`worklog-cascade.ts` are new untracked files. `20260717000001_hot_path_indexes.sql`
pre-exists and was untouched (numbering claim in 07 verified).

### Check 3 — SQL sanity: **PASS with findings** (D2 below)

- **Idempotency**: DO-block enum guard (000003:27-32), `create table if not
  exists` throughout, drop-then-create for every policy/trigger, `create or
  replace` + same-migration grant re-assertion for every function, `on conflict
  do nothing` for buckets/config/seed, pg_cron schedule guarded on
  `pg_extension` existence. All seven files safely re-runnable.
- **RLS + policies + grants co-located**: every new table gets
  `enable row level security`, its policies, and its revoke/grant in the same
  migration that creates it (000003, 000004, 000005, 000006). `worklog_config`
  is correctly RLS-on with zero policies and zero client grants.
- **Helper names**: `private.is_super`, `private.is_member`,
  `private.is_company_member`, `private.is_company_admin` all exist
  (`20260712000001_companies.sql:74-103`); policies call them schema-qualified;
  RPCs call them unqualified under `set search_path = public, private` — both
  resolve. `touch_updated_at()` exists (init:78) and is reused, as claimed.
- **Locked-row coverage**: `worklog_reject_if_locked` is attached
  INSERT/UPDATE/DELETE to `report_sections`, all five child tables, and
  `report_weather` (000003:275-288). `report_photos` is covered by its own
  `worklog_photos_guard` BEFORE INSERT OR UPDATE (000004:129-131): INSERT
  rejected when locked (R6), UPDATE rejected when locked, `deleted_at` change
  rejected unless draft (R5), provenance columns pinned (R1). DELETE on photos
  is unreachable for clients (no grant, no policy). Trigger ordering
  (`_guard` < `_touch` alphabetically) is correct.
- **Weather→parent touch**: `report_weather_touch_parent` AFTER INSERT OR
  UPDATE exists (000003:226-228) and updates `daily_reports.updated_at` — the
  06 §B "weather ride-along" server obligation is met at the DB layer for both
  the RPC path and the edge function.
- **`create_report`**: catches `unique_violation`, returns the existing
  `(project_id, report_date)` winner's id with `was_created=false`; the
  same-client-id early return handles retries; cross-project id reuse is
  refused (P0001); the PK-vs-PK race raises 40001 (retryable). Correct — the
  sub-block exception also rolls back the partial weather/audit inserts.
- **`update_section`**: accepts exactly the 11 SectionKinds including
  `'weather'`; weather routes to `report_weather.override_*` + `weather_source
  = 'manual'` via `worklog_apply_section`; relational sections re-explode
  delete-and-insert with `has_incident`/`has_delay` recompute; rejects only
  `locked` (P0001) — documented deviation 07 §B.5, consistent with 02 §C's
  literal wording. Returns the section row's server `updated_at` (LWW stamp).
- **RPC grants**: `create_report`, `update_section`, `submit_report`,
  `lock_report`, `amend_report` — each `revoke from public, anon` + `grant to
  authenticated`. Internal functions (`worklog_section_rows`,
  `worklog_apply_section`, `worklog_lock_report_core`,
  `lock_stale_submitted_reports`, all trigger functions) revoked from
  `public, anon, authenticated`. Correct.
- **GUC bypass security assessment (the key question): SAFE.**
  `worklog.allow_locked_write` is set only inside `amend_report` via
  `set_config(..., true)` — transaction-local — *after* the is_super
  authorization check and the submitted/locked status check. A malicious
  authenticated client cannot reach it through PostgREST:
  1. PostgREST exposes only functions in the exposed schemas; `set_config` is
     `pg_catalog` and not callable as an RPC. No client-executable function in
     these migrations (or the pre-existing ones) sets a caller-named GUC.
  2. Request-derived GUCs land under the `request.*` namespace
     (`request.jwt.claims`, `request.headers`) — a client cannot mint a GUC
     named `worklog.allow_locked_write` via headers or claims.
  3. **Defense in depth holds even if the GUC were set**: clients hold zero
     INSERT/UPDATE/DELETE grants on `report_sections`, the child tables, and
     `report_weather` — the trigger is the *second* wall; grants are the first.
     Bypassing the trigger alone gains a client nothing.
  4. Because the bypass is transaction-local and one PostgREST call = one
     transaction, it cannot leak across requests. (Caveat noted as D9: within
     a single composed transaction it stays on after `amend_report` returns.)

### Check 4 — Reconciliation compliance: **PASS with one deviation** (D3)

- **R1**: client UPDATE grant is exactly `(trade_tag, location_tag, caption,
  deleted_at)` (000004:165-166); every provenance column is trigger-pinned
  (000004:92-106). ✔ — **but** the server accepts meta edits while `submitted`
  (guard rejects only `locked`), whereas R1's approved wording and
  `types.ts:168-174` say draft-window only. Undocumented deviation → D3.
- **R2**: composite PK `(report_id, section)` on both sides
  (000003:96, schema.ts:123). ✔
- **R3**: weather is the 11th kind in `SECTION_KINDS` (types.ts:19-31), in
  `update_section`'s allowlist and `amend_report`'s allowlist, routed to
  `report_weather.override_*`. Local `report_weather` mirror with own `_dirty`. ✔
- **R5**: soft delete = `deleted_at` UPDATE, grant present, draft-window
  enforced by the guard; storage DELETE policy draft-only (000008:53-64). ✔
- **R6**: photo INSERT allowed `draft`+`submitted`, rejected `locked`
  (000004:81-89); storage INSERT policy cross-validates segment-2 report status
  IN ('draft','submitted') (000008:41-51). ✔
- **Distribution lists project-scoped** (000006:67-99, seed rows project-keyed). ✔
- **24h tunable grace window**: `worklog_config` key `lock_grace_hours`
  default 24, read by `lock_stale_submitted_reports`, hourly pg_cron guarded. ✔
- **`trade_tag` + `exif_datetime_original` in both repos**: ✔ (migration
  000004:34,39; schema.ts:60-61; types.ts:147,155).

### Check 5 — types.ts consistency: **PASS with minors** (D4, D5)

Exactly 8 mutation kinds, matching 06 §A: `create_report`, `update_section`,
`submit_report`, `lock_report`, `create_amendment`, `add_photo`,
`update_photo_meta`, `remove_photo`. Payload fields cover the RPC/handler
needs: `create_report` carries the client UUID + project/date;
`submit_report` carries `signaturePngBase64` + `signerTitle` (RPC derives
`signer_name` from `profiles` — the payload's `signerName` is client-side
surplus, harmless); `add_photo` carries width/height/EXIF/GPS/meta trio, all
covered by the INSERT column grant; `update_photo_meta` carries only
caption/tradeTag/locationTag (+ ids) per R1; `remove_photo` carries
`storagePath` (06 deviation #11). Gaps: `CreateAmendmentPayload` has no
`signerTitle` though `amend_report` accepts `p_signer_title` (D4); weather
override content key `tempF` vs the RPC's `temp_f` (D5).

### Check 6 — Seed sanity: **PASS**

- Gated: appended below the `punchlist.allow_demo_seed` DO-block, which aborts
  the entire script — nothing runs unguarded. No second gate (correct).
- FKs resolve: profile `1111…` (created via `auth.users` + `handle_new_user`
  earlier in the file), company `…c0a1` (pre-existing seed), new projects
  d1/e1 inserted first; signatures inserted before the amendment that
  references `ba03`; child rows reference seeded reports.
- Constraints: enum `report_status` values `submitted`/`locked` valid;
  `unique(project_id, report_date)` satisfied (d1/07-16, d1/07-14); section
  names within the 10-name check; `source='camera'`, `weather_source`
  `auto`/`manual`, signature `kind` `submit`/`amendment`, audit `event`
  values all within their checks; `has_delay=true` on aa02 matches its
  seeded `report_delays` row; amendment before/after payloads consistent with
  the post-amendment `report_crew` row (6.5h).
- Trigger interaction: seeding runs with `auth.uid()` NULL → exempt from the
  locked-row and photo guards by design; audit-log inserts are dedup-guarded
  with `where not exists` (identity PK); the two photos on the *submitted*
  report include `width`/`height` — consistent with the server schema (and a
  second witness for D1).

---

## Defects, ranked

### Blocker

- **D1 — `report_photos` schema parity broken: `width` and `height` missing on
  the app side.**
  `jobsight-backend/supabase/migrations/20260717000004_worklog_photos.sql:32-33`
  vs `WorkLog/src/db/schema.ts:59-64` (DOMAIN_COLUMNS) **and** lines 176-186
  (SQLite DDL — both places need the fix). The parity test this map exists for
  fails on day one; `AddPhotoPayload` (types.ts:142-143) and the seed both
  carry the columns; 07 §C explicitly hands the app "must match
  column-for-column" including `width`/`height`. The app also needs them
  locally (pull upsert of pulled photo rows; PDF layout without downloading
  bytes).

### Major

- **D2 — `worklog-weather` has no report-status gate: it can rewrite the auto
  weather of a LOCKED report.**
  `supabase/functions/worklog-weather/index.ts:175-259` selects the report by
  (project, date) without reading `status`; the service-role UPDATE is exempt
  from `worklog_reject_if_locked` (auth.uid() NULL) and guarded only by
  `weather_source IN ('none','auto')`. Any super can re-invoke it for any past
  date and change `auto_condition`/`auto_temp_f` on a locked report — mutating
  the legal record outside the amendment path, with no audit row — and the
  `report_weather_touch_parent` trigger bumps the locked report's `updated_at`,
  pushing it back through every peer's pull. Allowing `submitted` is required
  (offline-morning fill-on-sync), but `locked` should be refused. Not logged
  in 07 §B.
- **D3 — `update_photo_meta` window: server permits caption/tag edits while
  `submitted`; the approved R1 wording and `types.ts:168-174` ("draft window
  only") say draft-only.**
  `20260717000004:117-122` rejects only `locked`. Harm is low (superset, same
  race-tolerance argument as 07 §B.5 makes for `update_section`) — but unlike
  B.5 this deviation is *not* recorded in 07's deviation log, and app comments
  now contradict server behavior. Either tighten the guard to draft-only or
  document the deviation and fix the types.ts comment.

### Minor

- **D4 — `CreateAmendmentPayload` lacks `signerTitle`** (types.ts:120-127)
  while `amend_report(p_signer_title …)` accepts it and `submit_report`'s
  payload carries it. As written, amendment signatures get
  `signer_title = NULL` unless the Phase-4 handler separately reads
  `report_member_prefs` — an asymmetry with submit that 06 §A row 6 doesn't
  resolve.
- **D5 — Weather payload key mismatch: `WeatherOverrideContent.tempF`
  (types.ts:52-55) vs the RPC's `p_payload->>'temp_f'`**
  (20260717000007:91). The Phase-4 push handler must translate; neither 06
  row 3 nor types.ts documents that obligation — a silent-null trap
  (`override_temp_f` would quietly be NULL if content is passed through).
- **D6 — `company_branding`/`report_customization` write policy uses
  `for all`** (20260717000006:55-58), deviating from the "purpose-specific
  policies (never `for all`)" house pattern 07 §A.5 itself cites; and
  `updated_by` is not pinned to `auth.uid()` (full-column INSERT/UPDATE
  grants), so a company admin can attribute writes to another user.
- **D7 — `worklog_apply_section` casts payload fields directly**
  (`::integer`, `::numeric`, `::uuid`, NOT NULL columns from `r->>'trade'`
  etc., 20260717000007:111-160): malformed relational rows raise
  22P02/23502 instead of the documented 22023 contract — the client's
  classifyError should treat those as permanent, worth a note in 06.
- **D8 — cosmetics**: `worklog_photos_guard` message `'report % is %— photos…'`
  missing a space (20260717000004:114); `supabase/seed.sql` lost its
  executable bit (100755→100644).
- **D9 — GUC scope caveat**: `set_config(…, true)` keeps
  `worklog.allow_locked_write='on'` until the end of the *enclosing*
  transaction, not the function call. Benign under PostgREST (one call = one
  transaction), but any future server-side SQL that composes `amend_report`
  with other writes in one transaction inherits the bypass. Worth a comment
  in 000007.

## Claims in 07-backend-verification.md — spot-check results

All verified true: helper names/schema (A.1), `touch_updated_at` reuse (A.3),
`is_super` widening (A.2), seed gate + `[db.seed] enabled=false` (A.8),
delete-account anonymize-and-detach mechanics and call placement (A.6/B.14),
storage `split_part(...)::uuid` precedent (A.5 — pattern identical to
`20260702000001`), migration numbering (000001 pre-exists), pg_cron guard
(B.12), no `report_deliveries` (B.9), `update_section` locked-only rejection
matching 02 §C's literal wording (B.5). The log is honest — its one blind spot
is the photo-meta window (D3) and the weather function's missing status gate
(D2), neither of which it records.

## Safe to commit?

**Not yet.** D1 is a hard gate: the schema-parity test the whole two-repo
discipline hangs on fails today — fix `DOMAIN_COLUMNS.report_photos` and the
SQLite DDL (add `width`, `height`) before anything merges. D2 deserves a
one-line status guard (`status <> 'locked'`) in `worklog-weather` before the
function is deployed. D3 needs a decision (tighten or document) but does not
block. With D1 fixed and D2 patched or explicitly accepted, the migration set,
RPCs, storage policies, cascade module, and seed are well-built, idempotent,
faithful to R1–R6 and the approved decisions, and safe against the GUC-bypass
attack surface examined in Check 3.

---

## Resolution addendum (2026-07-17, post-review fixes applied by the orchestrator)

- **D1 (blocker) — FIXED:** `width`/`height` added to both `DOMAIN_COLUMNS.report_photos` and the SQLite DDL in `WorkLog/src/db/schema.ts` (INTEGER). `tsc --strict --noEmit` green. Check 1 now passes: 16/16 tables parity-clean.
- **D2 (major) — FIXED:** `worklog-weather/index.ts` now selects `status` with the report row and returns `{ status: "report_locked" }` before any write when the report is locked — the service-role path can no longer rewrite a locked report's weather. (Residual millisecond check-then-write race vs a concurrent lock accepted; locking is a manual/cron action.)
- **D3 (major) — FIXED:** `worklog_photos_guard` UPDATE branch tightened from rejects-only-`locked` to `v_status <> 'draft'` (draft-window only, matching approved R1 and `types.ts`/06). Header comment updated to match.
- **D4 (minor) — FIXED:** `CreateAmendmentPayload.signerTitle: string | null` added in `src/sync/types.ts`.
- **D5–D9 (minors) — DEFERRED to Phase 4** with owners: the `tempF`/`temp_f` key translation lands in the Phase 4 push handler (M3/M9); the company-singleton `for all` policy + `updated_by` pinning and the payload-cast errcode contract are Phase 4 backend polish items; the seed exec-bit/typo are cosmetic.

**Safe to commit:** yes, with D5–D9 tracked as Phase 4 items.

## Post-merge addendum (2026-07-18)

- PR review of #2 upgraded the documented `update_section` deviation to a
  defect and fixed it in `acc79fd` (squashed into `6d44c96`): the RPC is now
  **draft-window only** (P0001 once submitted/locked), restoring PRD
  assumption #19 — signed content can no longer change without an amendment
  trail. 07 §5's rationale is superseded accordingly; 06's mapping row updated.
- PR #2 (WorkLog Phase 3 schema) and PR #3 (line-ending normalization)
  are both squash-merged to `main` in `jobsight-backend`.
