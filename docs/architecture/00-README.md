# WorkLog — Phase 2 Architecture (Synthesis & Index)

**Status: DRAFT — awaiting approval.** Produced 2026-07-17 by a five-track parallel design team (planning, modules/nav/sync, mobile subsystems, data model, testing) working from `FABLE5-PROMPT-worklog.md` (final spec) and `docs/PRD.md` rev 3. Per spec §9, Phase 2 is design-only: no app code, no SQL migrations were produced. Phase 1 (PRD rev 3) approval + this document's approval together gate Phase 3.

## Documents

| Doc | Track | Covers |
|---|---|---|
| [`01-work-plan.md`](01-work-plan.md) | Planning | Phase 2→4 work breakdown, M0–M12 dependency graph, risk register (top 10), per-phase Definition of Done |
| [`02-modules-navigation-sync.md`](02-modules-navigation-sync.md) | Architecture | Full `src/`+`app/` module layout (named against the real PunchLog tree), navigation map, sync engine domain adaptation (mutation kinds, pull scopes, conflict surfaces, 8 invariants) |
| [`03-photo-voice-pdf.md`](03-photo-voice-pdf.md) | Mobile subsystems | Photo pipeline + EXIF/GPS provenance mechanism, voice-to-text capability gating, dual-renderer PDF pipeline + consistency contract |
| [`04-data-model.md`](04-data-model.md) | Database | All new tables (sketch DDL), RLS design, PM-role resolution, lifecycle RPCs, storage buckets, weather edge function contract, account-deletion extension |
| [`05-test-architecture.md`](05-test-architecture.md) | Testing | Pure/native test split, per-module test plans, schema-parity test design, per-milestone gates, coverage targets |

## Where the tracks agree (consensus — treat as settled unless you object)

1. **PM-role mapping:** PM → existing `project_members.role = 'super'`; display title in new `report_member_prefs` table. No enum surgery on the shared production DB. (Confirms PRD §10.)
2. **Signatures:** base64 PNG rides the `submit_report`/`amend_report` RPC payload into a `report_signatures` row (`bytea` in-row) — atomic with the transition, no storage round-trip. Signatures are never pulled to devices.
3. **Weather:** server-side fill via a keyless Open-Meteo edge function; **not** a sync mutation kind; never overwrites a manual override (`weather_source` guard); fill-on-sync sweep covers offline mornings.
4. **Project geolocation + timezone:** additive nullable `projects.lat`/`lng`/`timezone` columns (not a separate table); every dependent feature (GPS guard, weather, report_date boundary) no-ops gracefully while null. Closes PRD §15 #9/#11.
5. **`create_report` collision:** get-or-create RPC returns the existing report id on a same-day `UNIQUE(project_id, report_date)` conflict; the client re-parents queued sections/photos onto the winner inside one SQLite transaction. Closes PRD §15 #1.
6. **EXIF mechanism (closes spec §4.4 ASSUMPTION):** provenance = first-class columns as system of record (location-at-shutter via a warmed `expo-location` watch, EXIF read before compression); piexifjs re-injection stays Should-tier and severable.
7. **PDF (closes spec §6 threshold question):** `ON_DEVICE_PHOTO_CEILING = 40` (tunable); pdf-lib edge function for >40 photos and ALL distribution renders; offline-heavy degrades explicitly (600px, confirm dialog) rather than dead-ending; dual-renderer **information-parity** golden test + `LAYOUT_VERSION` stamping.
8. **Enforcement model:** report tables are SELECT-only to clients; all lifecycle writes via SECURITY DEFINER RPCs; grants are the enforcement, the locked-row trigger is defense-in-depth; service-role bypass exists solely for deletion anonymization.
9. **Sync invariants:** all 8 preserved; `orderForDrain` unchanged; the submit/photo race resolved by making **locked** (not submitted) the photo-attachment cutoff; per-project Tier-2 pull cursors (`reports:<projectId>` etc.) with active-project-eager scheduling; photo pull scope pre-versioned (`report_photos_v1`).
10. **Testing:** `mutationQueue.ts` at 100% coverage is the quality spine; schema-parity test both directions; platform-split grep guard as a required CI gate from M1; two cross-repo test gates (locked-row rejection, deletion cascade) explicitly owned by `jobsight-backend`.

## Reconciliations — conflicts between tracks (RESOLVED BY SHIPPED CODE, verified 2026-08-27 for v1.0.0 — see per-item evidence)

### R1 — Photo tag/caption edits after upload (SETTLED BY CODE)
Three designs were proposed independently:
- **Mobile track (03 §A.8):** queued `update_photo_meta` mutation — offline-capable, coalesced, draft-window only.
- **Data track (04 §B.3):** direct client UPDATE allowed by RLS (tags/caption only; a trigger protects provenance columns).
- **Modules track (02 §C):** online-only `update_photo_tags` RPC, mirroring PunchLog's markup-edit precedent (no UPDATE grant at all).

**Shipped: the mobile track's queued `update_photo_meta` mutation.** `MutationPayload` in `WorkLog/src/sync/types.ts:204` includes `{ kind: 'update_photo_meta'; data: UpdatePhotoMetaPayload }` (payload shape at types.ts:172–178). Server-side, the draft-window-only guard from the data track's recommendation is enforced by `worklog_photos_guard()` in `jobsight-backend/supabase/migrations/20260717000004_worklog_photos.sql:118–124`: `if v_status <> 'draft' then raise exception ... photo details can no longer be edited; use an amendment`. Note: the client-side network push for this mutation kind is not yet implemented — `rpcMap.ts:140–143` still throws `'photo kinds are M5'` (a future milestone) — but the *design decision* (queued mutation, not RPC or unguarded UPDATE) is settled.

### R2 — `report_sections` key shape (SETTLED BY CODE: composite PK)
Data track: composite PK `(report_id, section)`. Modules track: client-minted `sectionId` uuid. **Shipped: composite PK.** `WorkLog/src/db/schema.ts:189–195` — `CREATE TABLE ... report_sections (report_id TEXT NOT NULL, section TEXT NOT NULL, ... PRIMARY KEY (report_id, section))`. `types.ts:82–85` confirms in comment: "sections have a composite PK (report_id, section), no minted sectionId."

### R3 — Weather manual-override write path (SETTLED BY CODE)
`report_weather` is its own table and `update_section`'s section list excluded weather, leaving no mutation path. **Shipped: weather as an eleventh `SectionKind`.** `WorkLog/src/sync/types.ts:19–31` — `SECTION_KINDS` ends with `'weather'`. The wire translation lives in `WorkLog/src/sync/rpcMap.ts:58–73` (`sectionWirePayload()`, translating `{condition, tempF}` → `{condition, temp_f}` for the weather branch only). Server columns confirmed at `WorkLog/src/db/schema.ts:233–239`: `report_weather` has `override_condition`, `override_temp_f`, `override_at`, `override_by`.

### R4 — Module placement of photo helpers (cosmetic — not re-verified in this pass)
Mobile track proposed `src/photos/`; modules track (which read the real PunchLog tree) placed the same behaviors in `src/data/` (`geoGuard.ts`, `photoProvenance.ts`, `photoDelete.ts`). **Recommendation: follow the modules track** — PunchLog fidelity governs folder layout. The pure/native split of each behavior is identical in both proposals and is what actually matters.

### R5 — `remove_photo` mechanism (SETTLED BY CODE: UPDATE, not an RPC)
Both tracks agreed on the outcome (draft-window-only, soft-delete tombstone); the only open question was UPDATE-setting-`deleted_at` vs a small RPC. **Shipped: UPDATE.** `jobsight-backend/supabase/migrations/20260717000004_worklog_photos.sql` grants SELECT/INSERT/UPDATE on `report_photos` but no DELETE; the guard trigger explicitly handles the tombstone toggle as an UPDATE (`if new.deleted_at is distinct from old.deleted_at and v_status <> 'draft' then raise exception`, line 113). As with R1, the client-side push for `remove_photo` is still milestone M5 (`rpcMap.ts:140–143`) — the mechanism is settled, the wiring isn't built yet.

### R6 — Photo INSERT window vs the locked cutoff (SETTLED BY CODE)
Modules track required `report_photos` INSERT to succeed while `status IN ('draft','submitted')` and fail once `locked`. **Shipped exactly as recommended**, via `worklog_photos_guard()` (not a `reject_edit_if_locked` trigger — the actual name shipped is `worklog_photos_guard`) at `20260717000004_worklog_photos.sql:81–88`: "R6: draft AND submitted accept photo inserts (submit/photo race); locked is the true attachment cutoff" — `if v_status = 'locked' then raise exception`.

## Decisions needed from you before Phase 3

1. **Approve PRD rev 3** (Phase 1 gate — still formally open).
2. **Approve this Phase 2 architecture** (with or without changes).

Resolved by shipped code, no longer open (verified 2026-08-27):
- **Distribution lists scope:** shipped project-scoped. `jobsight-backend/supabase/migrations/20260717000006_worklog_company_settings.sql:64` — `-- report_distribution_lists — PROJECT-scoped (approved 2026-07-17)`; the table (line 67) keys on `project_id`.
- **Lock grace window:** shipped as 24h default, tunable via `worklog_config` key `lock_grace_hours`, enforced by a live `pg_cron` job. `jobsight-backend/supabase/migrations/20260717000007_worklog_rpcs.sql:384–385` — "Grace-window sweeper (pg_cron-callable; approved default 24h, TUNABLE via worklog_config key 'lock_grace_hours')"; the job `worklog-lock-stale-reports` is scheduled at lines 419–423. Auto-lock was in fact built — contrary to this doc's prior framing that a number was still needed.

## Consolidated open items for Phase 3 (verification work, no decision needed)

- Verify against live `jobsight-backend`: existing company-admin helper name; PunchLog's `delete-account` anonymization mechanics; `invite-user` acceptance contract (OTP vs deep link); PunchLog's `push/pull.native.ts` injection style; `transformIgnorePatterns`; PunchLog's UUID library (v4 vs v7); `expo-file-system` API generation used by `outbox.native.ts`.
- Specify: `report_amendment_changes` jsonb snapshot shape for relational sections; schema-parity test's cross-repo migration access (vendored copy vs CI checkout); multi-project pull rotation cadence.
