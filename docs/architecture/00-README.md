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

## Reconciliations — conflicts between tracks (R1 needs your call; R2–R6 have recommendations)

### R1 — Photo tag/caption edits after upload (OPEN — needs a decision)
Three designs were proposed independently:
- **Mobile track (03 §A.8):** queued `update_photo_meta` mutation — offline-capable, coalesced, draft-window only.
- **Data track (04 §B.3):** direct client UPDATE allowed by RLS (tags/caption only; a trigger protects provenance columns).
- **Modules track (02 §C):** online-only `update_photo_tags` RPC, mirroring PunchLog's markup-edit precedent (no UPDATE grant at all).

**Recommendation:** the mobile track's queued `update_photo_meta` mutation, backed by the data track's guarded UPDATE policy. The Photos tab is explicitly the tag-cleanup surface and tag cleanup happens in the field — an online-only path contradicts "offline is a normal state." Cost: one deliberate divergence from PunchLog's markup-edit precedent, documented here. If you prefer strict PunchLog fidelity, choose the RPC and accept online-only tag edits.

### R2 — `report_sections` key shape (recommendation: composite PK)
Data track: composite PK `(report_id, section)` (natural key, upsert-shaped, zero collision risk). Modules track: client-minted `sectionId` uuid. **Recommendation: composite PK** — `update_section` payloads carry `(reportId, section)` as the identity and `rowTargetOf` uses the tuple; invariant 1 is untouched (`report_id` is still the client UUID). One less id to mint and re-parent.

### R3 — Weather manual-override write path (gap both tracks left open)
`report_weather` is its own table (04 §A.4) and `update_section`'s section list excludes weather — so the manual override had no mutation path. **Resolution:** treat weather as an eleventh `SectionKind` whose push handler writes the `override_*` columns of `report_weather` (and sets `weather_source = 'manual'`), rather than adding a new mutation kind. Keeps the kind list stable and the override offline-capable. Fold into the Phase 3 sync-mapping table.

### R4 — Module placement of photo helpers (cosmetic)
Mobile track proposed `src/photos/`; modules track (which read the real PunchLog tree) placed the same behaviors in `src/data/` (`geoGuard.ts`, `photoProvenance.ts`, `photoDelete.ts`). **Recommendation: follow the modules track** — PunchLog fidelity governs folder layout. The pure/native split of each behavior is identical in both proposals and is what actually matters.

### R5 — `remove_photo` mechanism (converged, one detail to fix in Phase 3)
Both tracks agree on the outcome: draft-window-only removal, soft-delete tombstone (`deleted_at`) pulled by other devices, storage object hard-deleted under the draft-only storage DELETE policy, and inverted evict semantics on a 403 (restore local visibility — never destroy evidence). Since direct DELETE is revoked from clients, the row-side write is an UPDATE setting `deleted_at` (or a small RPC) — pick in Phase 3 when grants are authored.

### R6 — Photo INSERT window vs the locked cutoff
Modules track requires `report_photos` INSERT to succeed while `status IN ('draft','submitted')` (the submit/photo race) and fail once `locked`; the data track's INSERT policy checks only `is_super`. **Resolution:** extend the `reject_edit_if_locked` trigger to cover `report_photos` INSERT/UPDATE (reject when parent report is `locked`, service-role exempt). Drafted into the Phase 3 migration spec.

## Decisions needed from you before Phase 3

1. **Approve PRD rev 3** (Phase 1 gate — still formally open).
2. **Approve this Phase 2 architecture** (with or without changes).
3. **Distribution lists scope:** project-scoped (recommended in 04 §A.7) vs company-scoped.
4. **Lock grace window:** how long after submit does auto-lock fire (product policy — e.g. 24h)? The design supports any value; the pg_cron job needs a number.

## Consolidated open items for Phase 3 (verification work, no decision needed)

- Verify against live `jobsight-backend`: existing company-admin helper name; PunchLog's `delete-account` anonymization mechanics; `invite-user` acceptance contract (OTP vs deep link); PunchLog's `push/pull.native.ts` injection style; `transformIgnorePatterns`; PunchLog's UUID library (v4 vs v7); `expo-file-system` API generation used by `outbox.native.ts`.
- Specify: `report_amendment_changes` jsonb snapshot shape for relational sections; schema-parity test's cross-repo migration access (vendored copy vs CI checkout); multi-project pull rotation cadence.
