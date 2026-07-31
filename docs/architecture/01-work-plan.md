# WorkLog — Phase 2→4 Work Plan (Architecture · Data Model · Code Sequencing · Risk · DoD)

> Phase 2 deliverable, produced by the planning track. Source of truth: `FABLE5-PROMPT-worklog.md` (§9 phased deliverables, §10 quality bar, §11 locked decisions) and `docs/PRD.md` rev 3. §11 decisions are treated as settled and are not relitigated below. Every §15 open item and §14 assumption is carried into the correct phase.

---

## A. Phase 2 — Architecture work breakdown

Phase 2 produces **design artifacts only** — no migrations, no app code. Each artifact is a document/spec that Phase 3 (schema) or Phase 4 (code) implements verbatim. Deliverables map to spec §9 Phase 2 and PRD §15.

### A.1 Artifacts to produce

| # | Artifact | Contents | Consumed by | Depends on |
|---|---|---|---|---|
| P2-1 | **Sync design spec** | Final mutation-kind union (`create_report`, `update_section`, `update_report_meta`, `submit_report`, `lock_report`, `create_amendment`, `add_photo`, `remove_photo`); per-kind push handler target table; pull scopes + cursor-key grammar (`reports:<projectId>`, `sections:<projectId>`, `photos:<projectId>`); conflict surfaces (per-section version row LWW, dirty-row protection, grouped park surface). | M1, M3, Phase 3 sync-mapping table | PRD §11.7, §15 #1/#6 |
| P2-2 | **Photo pipeline + EXIF provenance mechanism** | Ordered pipeline: shutter → clock + `expo-location.getLastKnownPositionAsync` (3–5s timeout, non-blocking) → first-class columns (`captured_at`,`gps_lat`,`gps_lng`,`gps_accuracy`) → `expo-image-manipulator` re-encode ≤1280px/~0.6 → move to durable `captures/` → `_pending=1` + outbox URI. Placement of optional piexifjs re-injection (pre-outbox). Wrong-project GPS guard threshold. Library-import "taken vs added" distinction. | M5, M7, Phase 3 photo columns | PRD §11.2, §8, §15 #3 |
| P2-3 | **Weather edge function contract** | Open-Meteo request/response field map; snapshot schema stored on report; fetch-timestamp; `weather_source` semantics (`auto`/`manual`, fill-only-when-null, never overwrites manual); fill-on-next-sync trigger; keyless geocode of `projects.address` → coordinates. | M9, Phase 3 (weather columns, edge fn), Phase 5 | PRD §15 #5/#11 |
| P2-4 | **PDF pipeline + dual-renderer consistency contract** | Shared layout constants module; routing rule (on-device `expo-print` ≤40 source photos → share; server pdf-lib for distribution + >40-photo fallback); golden-output comparison test spec on a reference report; amendment rendering (original unaltered + "Amended" stamp + appendix pages); provenance caption format; server-side signature dependency. | M7, M11, Phase 3 (signature persistence) | PRD §11.4, §15 #4/#13/#15 |
| P2-5 | **Navigation map** | Confirms PRD §4/§5 route tree: `(auth)`, `(onboarding)/permissions/*`, `(tabs)` 5-slot with raised camera action, `report/[id]` + section/amendment/signature sheets, `project/[id]/members`, `settings/*`, `rollup/[projectId]/[week]`, lightbox as route. Sheets-vs-routes decisions. | M0–M11 screens | PRD §4/§5, spec §6 |
| P2-6 | **Module layout** | `src/theme`, `src/data` (repository seam), `src/db` (`*.native.ts`), `src/sync` (pure + native adapters per spec §4.3 file list), `src/report` (PDF), `src/photos`, `src/weather`, `src/voice`. Platform-split grep-guard rule documented. | All Phase 4 | spec §4.3 |
| P2-7 | **State-machine + RPC enforcement matrix** | Full lifecycle FSM (`draft→submitted→locked`, `amended` as derived display state); legal-transition table for `submit_report`/`lock_report`/`amend_report`; submitted→locked grace window + auto-lock timing; amendment atomicity (locked-on-save); locked-row rejection trigger + narrow service-role bypass for deletion anonymization. | M3, M4, Phase 3 RPCs | PRD §15 #2/#10/#14/#16, §14 #19/#23/#24 |
| P2-8 | **Signature persistence design** | Recommend base64 PNG on `submit_report` payload → `report_signatures` row (atomic with submit); amendment signatures included. | M7, M11, Phase 3 | PRD §15 #13, §14 #22 |
| P2-9 | **Invite-acceptance mechanics** | Acceptance flow compatible with `detectSessionInUrl:false` (OTP code or deep link handled outside supabase-js). | M2, Phase 5 | PRD §15 #12 |
| P2-10 | **Report-customization enforcement split** | Client hints vs `submit_report` server enforcement against stale config. | M11, Phase 3 RPC | PRD §15 #8 |

### A.2 Dependency edges within Phase 2

- P2-7 (state machine) is the **spine** — P2-1 (submit/lock/amend mutation kinds), P2-4 (amendment PDF rendering), P2-8 (signature timing) all consume it. Do P2-7 first.
- P2-11 project-geolocation decision (below) is a **prerequisite** for P2-2 (GPS guard) and P2-3 (weather geocode). Resolve early.
- P2-4 depends on P2-8 (server renderer needs persisted signature).

### A.3 Open questions Phase 2 must CLOSE

The spec flags four items as requiring an ASSUMPTION-decision. Status against what the PRD already resolved:

| Spec-flagged item | Where flagged | Status entering Phase 2 | Phase 2 action |
|---|---|---|---|
| **PM-role mapping** | spec §4.2 | **RESOLVED in PRD §10** — PM → `project_members.role='super'`, no `'pm'` enum; label stored WorkLog-side. | Confirm only; no work. Record `report_member_prefs(project_id,user_id,title)` for Phase 3. |
| **Tab layout** | spec §6 | **RESOLVED in PRD §4** — 5 slots, raised center camera action. | Confirm in navigation map P2-5; no reopening. |
| **EXIF mechanism** | spec §4.4 (ASSUMPTION required) | **Direction set in PRD §11.2** (location-at-shutter, not picker EXIF) but the exact re-injection placement + piexifjs adoption call is OPEN. | **Must close** in P2-2: state the ASSUMPTION, fix piexifjs Should-tier adoption, define re-injection step position. |
| **PDF fallback threshold** | spec §6 (~40 photos "tunable") | Direction set (~40) in PRD §11.4 but exact routing rule + consistency contract OPEN. | **Must close** in P2-4: tunable constant value, routing rule, golden-test spec. |

Additional §15 blockers Phase 2 must close (rev-3, all sit where WorkLog touches shared infra it doesn't own):

- **P2-11 Project geolocation** (§15 #11, rev-3 blocker): decide additive nullable `projects.lat`/`lng` vs WorkLog-side `project_sites` table; population = server-side Open-Meteo keyless geocode at create/edit + optional manual pin; guard distance threshold. **Both weather (M9) and GPS guard (M5) block on this.** Recommend additive nullable columns + `projects.timezone` (IANA) for the day boundary (§15 #9).
- **P2-12** `create_report` get-or-create RPC contract + client re-parenting + grouped park-surface UX (§15 #1).
- **P2-13** `report_date` day boundary in project-local timezone — the natural key, collision handling, carry-forward, and calendar all hang on it (§15 #9).

Everything in P2 is a document. **No SQL, no `.ts` app code leaves Phase 2** — that is the approval boundary per spec §9.

---

## B. Phase 3 — Data model work breakdown

All schema deliverables target the **`jobsight-backend` repo** (`supabase/migrations/`, `supabase/functions/`); the WorkLog app repo keeps **reference copies only** (spec §4.2). Migrations are additive-only, idempotent-guarded, RLS-in-same-migration, plain SQL compatible with `supabase migration up`.

### B.1 Postgres migrations (additive-only, timestamp-named)

| # | Migration | Contents | Rules honored |
|---|---|---|---|
| M3-DB-1 | `projects` additive columns | `alter table projects add column if not exists lat double precision`, `lng`, `timezone text` (IANA). Nullable — degrade gracefully while null. | Additive; never alters PunchLog reads |
| M3-DB-2 | `daily_reports` | PK = client UUID; `project_id`, `report_date` (project-TZ), `status ReportStatus`, `weather_source`, snapshot cols, `created_at`/`updated_at`; **`UNIQUE(project_id, report_date)`**; RLS on `is_super(project_id)` (NOT `is_member` — subs excluded, §10); index `(project_id, report_date)`. | RLS same migration; helper pattern |
| M3-DB-3 | `report_sections` | `(report_id, section, updated_at, payload jsonb)` — the per-section concurrency/version unit. | LWW by server `updated_at` |
| M3-DB-4 | Relational child tables | `report_crew(report_id,trade,headcount,hours)`, `report_equipment`, `report_deliveries`, `report_delays`, `report_work` — exploded from section payload transactionally (delete-and-insert; no independent `updated_at`). Non-aggregated (notes, visitors) stay JSON on the section row. | §11.6/§11.7 reconciliation |
| M3-DB-5 | `report_photos` | client-UUID PK; first-class provenance `captured_at`,`gps_lat`,`gps_lng`,`gps_accuracy`; `trade_tag`,`location_tag`,`caption`; storage path. | Provenance as columns (§11.2) |
| M3-DB-6 | `report_amendments` | client-UUID PK (idempotent), section-structured content, author FK, timestamps, original preserved. | §15 #10 atomicity |
| M3-DB-7 | `report_signatures` | small row, base64/bytes PNG + signer name + timestamp; amendment signatures covered. | §15 #13 |
| M3-DB-8 | `report_member_prefs` | `(project_id,user_id,title)` — PM/super display label, admin-editable, NOT an auth boundary. | §10 |
| M3-DB-9 | Enum value | `ReportStatus` type (draft/submitted/locked) via DO-block guard; `amended` is a derived display state, not an enum value. | Idempotent guard |

### B.2 RPCs (server-governed lifecycle writes)

- `create_report` — **get-or-create**: returns existing report id on `UNIQUE(project_id,report_date)` conflict so client re-parents sections/photos (§15 #1).
- `submit_report` — enforces `draft→submitted`; validates required-fields against customization config (§15 #8); accepts signature payload; server-side `report_date` in project TZ.
- `lock_report` — `submitted→locked`; grace-window/auto-lock per P2-7.
- `amend_report` — idempotent on amendment client UUID; enforces amendable states (submitted + locked per §14 #24); writes audit row.
- All raise `P0001` on illegal transition (→ `permanent`, parks + surfaces). `revoke execute` on helper functions from clients (spec §4.2 pattern).

### B.3 SQLite schema + parity

- `src/db/schema.ts` pure strings (no native imports): `SCHEMA_VERSION` + `MIGRATIONS[n]` via `PRAGMA user_version`; type mapping uuid/date/timestamptz→TEXT; local-only `_dirty`/`_pending`; `DOMAIN_COLUMNS` map.
- **Two-level shape mirrors server**: section row + exploded child rows written in one local transaction so local/server never disagree on where section data lives.
- Sync bookkeeping tables verbatim (`sync_mutations`, `sync_cursors`, `sync_meta`).
- **Column-parity jest test** between `schema.ts` and `supabase/migrations/*` (ship PunchLog's test).

### B.4 Sync mappings (mutation kind → push handler → table)

Deliver the table binding each mutation kind to its push handler and target table(s), plus pull scopes/cursor keys from P2-1. This is the Phase 3 artifact that makes P2-1 concrete.

### B.5 Storage policies

- `worklog-photos` private bucket, paths `<projectId>/<reportId>/<photoId>.jpg`, path-encoding RLS via `split_part`.
- **No UPDATE policy** (preserves the 409-duplicate→success invariant, spec §4.3 #7).
- **`remove_photo` DELETE policy** — owner-scoped, draft-window only (§15 #7).

### B.6 Edge functions (into `jobsight-backend/supabase/functions/`)

- New: `worklog-weather` (Open-Meteo fetch + geocode), `worklog-pdf` (pdf-lib server render).
- Extend `delete-account` behind a **WorkLog-scoped code path**, PunchLog path untouched; cascade every WorkLog table + `worklog-photos`; anonymize (not delete) locked-report author FKs → tombstone per §12.1.

### B.7 Seed (demo/review accounts)

Primary `super` credential (2 NYC projects, yesterday's submitted report, one locked+amended, GPS photos) + disposable nightly-reprovisioned deletion-test credential (§12.5). Guarded `seed.sql`.

---

## C. Phase 4 — Code sequencing (M0–M11+M12)

Maps PRD §3 milestones to execution order with dependency edges and parallelism. **Verification gate on every milestone: `tsc --noEmit` green under strict + jest green (incl. schema-parity + sync-policy tests) + platform-split grep returns nothing** before the next milestone starts.

### C.1 Dependency graph (edges = "must precede")

```
M0 theme/auth/tab shell
 └─> M1 SQLite schema + repository seam + parity test + grep guard
      ├─> M2 project bootstrap + report CRUD + 11 section sheets (local-only)
      │    ├─> M6 carry-forward (needs a prior report)
      │    ├─> M7 PDF export (renders what M2 produces)
      │    ├─> M10 history (needs multiple reports)
      │    └─> M11 rollups + branding + customization + distribution
      └─> M3 sync engine (pure modules + native adapters + lifecycle RPCs)
           ├─> M4 lifecycle+amendments in UI + locked-row rejection
           │    └─> (feeds M7 amendment rendering, M11 distribution)
           └─> M5 photo pipeline (add_photo drained last)
                └─> M7 PDF photo sheets, provenance
M8 voice-to-text ── attaches to M2 section sheets (risk-isolated, parallel-safe)
M9 weather auto-fetch ── attaches to weather section (edge fn; parallel after M3)
M12 account deletion ── LAST: built against the COMPLETE schema (deletion must
                        provably cascade every table in the final model)
```

### C.2 Parallel-safe vs serialized

**Serialized (hard sequence):** M0 → M1 → {M2, M3}. M1 is the gate for all data work; M0 is the gate for all screens.

**Parallel-safe:**
- **`src/sync` pure modules** (`types`, `engineApi`, `mutationQueue`, `conflict`, `cursors`, `paginate`) can be built and **fully jest-tested before any native adapter or SQLite exists** — they import nothing native (spec §4.3). Start these in parallel with M2 immediately after P2-1/P2-7 land. Native adapters (`engine.native`, `push.native`, `pull.native`, `store.native`, `outbox.native`) serialize after M1 (need SQLite) — this is M3's native half.
- **M2 section sheets** parallelize across the 11 sections once the report CRUD + repository seam exist (each sheet is independent).
- **M8 voice** and **M9 weather** are leaf features attaching to existing section sheets — parallel after M3, isolated so `expo-speech-recognition` maturity risk can't block the skeleton.
- **M7 PDF on-device** (client) and **M11 server pdf-lib** (edge fn) parallelize but share the P2-4 layout constants + golden test (consistency contract).

**Must serialize despite looking parallel:**
- M4 (lifecycle wired) before M11 distribution — distribution emails a locked/submitted report's server-rendered PDF.
- M5 (provenance columns populated) before M7 photo sheets and before Phase 5 privacy declarations.
- **M12 dead last** — deletion cascade must be authored against the final schema, so it follows even Could-tier M11 (PRD §3 note).

### C.3 Per-milestone verification gates (additions beyond tsc+jest)

- **M1:** schema-parity test green; platform-split grep empty.
- **M3:** all `mutationQueue.ts` pure-policy tests green (classifyError, applyOutcome, orderForDrain, retry-ceiling, offline-exemption); single-flight/coalescing tested.
- **M5:** provenance columns populated end-to-end; wrong-project GPS guard no-ops on null coords.
- **M7/M11:** golden-output PDF comparison test on the reference report passes across both renderers.
- **M12:** seeded-account test proves cascade of every WorkLog table + storage path; sign-in fails in both apps.
- **AC-O1 airplane-mode E2E** (create→fill→photo→submit→queue) is a standing gate from M3 onward.

---

## D. Risk register (top 10, ranked)

| # | Risk | Mitigation | Retired in |
|---|---|---|---|
| 1 | **`expo-speech-recognition` maturity** — only unproven dep; on-device is Android 13+ only (~10–15% of devices excluded), per-locale model download, iOS ≤17 3s-silence stops. | Isolate in M8; capability-gate via `supportsOnDeviceRecognition()` (mic hidden where unsupported, keyboard always present); per-field short-burst dictation; `contextualStrings` with trades/vendors; fetch current API docs before wiring; verify on real iOS 26 + Android. | **M8** (feature contained; skeleton unaffected) |
| 2 | **EXIF/GPS capture variance across devices** — `exif:true` does NOT yield GPS (iOS camera case no GPS tags, PHPicker strips, expo-camera no geotag); approximate-location grants. | Mechanism is location-at-shutter → first-class columns, NOT picker EXIF; `getLastKnownPositionAsync` fast path never blocks shutter; GPS-denied → null cols + "location not recorded"; `gps_accuracy` carries truth, PDF prints ±accuracy; piexifjs re-injection severable Should. | **M5** (columns populated + graceful null verified) |
| 3 | **Shared-production-DB migration safety** — PunchLog mid-submission; enum surgery on `project_role` has high blast radius. | Additive-only, idempotent guards, RLS in same migration, delivered to `jobsight-backend` not app repos; PM=`super` avoids enum change entirely (PRD §10); never alter/drop anything PunchLog reads. | **Phase 3** (migrations applied + PunchLog regression-tested) |
| 4 | **PDF memory ceiling** — on-device `expo-print` unsafe past ~40 source photos on low-end Android; two renderers risk divergent legal records. | ~40-photo tunable threshold → pdf-lib edge fallback; ~800px print renditions; shared layout constants + golden-output comparison test (P2-4 consistency contract); progress UI; test 50+ photo reports on real low-end Android. | **M7 / M11** (golden test green both renderers) |
| 5 | **Store rejection vectors (§8)** — Apple 2.1 reviewer reachability (#1 statistical), precise-location scrutiny (diverges from PunchLog), 5.1.1 mic/speech metadata rejection, account-deletion 5.1.1(v). | Demo account is a Phase 1 requirement (seeded Phase 3); consistent location story across strings/labels/Data Safety/policy; both mic+speech strings; deny-paths fully functional; two-tier deletion; TestFlight external beta ≥5 business days; iOS 26 SDK verified at build. | **Phase 5** (dry-run walkthrough with no dead ends) |
| 6 | **One-report-per-day collision** — `UNIQUE(project_id,report_date)` vs client-UUID offline inserts could cascade-park a full day of downstream mutations. | Get-or-create `create_report` RPC returns existing id on same-day conflict; client re-parents sections/photos so collision dissolves at push time; grouped park surface for residuals; single-device double-create impossible (Today reads local row first); assisted-merge UI stays Should. | **M3** (RPC + re-parenting tested) |
| 7 | **Sync correctness under offline abuse** — never silently lose field data; a week off-grid must not park valid writes. | Replicate `mutationQueue.ts` verbatim; jest-cover every pure module; offline exempt from retry ceiling; every failure path → retry / park-with-surface / user decision; RLS denial evicts, deterministic rejection parks. | **M3** (pure-policy tests green) |
| 8 | **Platform-split leakage** — a static native import in the web graph breaks the web bundle; Metro resolves regardless of `Platform.OS`. | `*.native.ts` discipline; repository seam is the only screen-facing surface; grep guard in CI on every data/sync touch (returns nothing). | **M1** (guard wired) then standing |
| 9 | **`report_date` day-boundary / project timezone** — natural key, carry-forward, calendar, collision all hang on it; shared `projects` has no TZ. | Additive nullable `projects.timezone` (IANA), device-TZ fallback; `report_date` computed server-side in project TZ; designed in P2-13, implemented Phase 3. | **Phase 3** (TZ column + server computation) |
| 10 | **Shared `delete-account` edge-function change while PunchLog is mid-review** — additive migrations protect schema, not function code. | Extend behind WorkLog-scoped code path, PunchLog path untouched; regression-test PunchLog deletion before deploy; coordinate deploy window with PunchLog review status; shared-record policy (anonymize locked reports, never destroy). | **M12 / Phase 5** (seeded cascade test + PunchLog regression green) |

---

## E. Definition of Done per phase (approval checklists)

### Phase 2 — Architecture DoD
- [ ] Sync design spec: mutation kinds, per-kind push target, pull scopes + cursor keys, conflict surfaces documented (P2-1).
- [ ] Photo pipeline + EXIF provenance mechanism written **with the ASSUMPTION stated** and piexifjs adoption call made (P2-2, closes spec §4.4 EXIF question).
- [ ] Weather edge function contract: Open-Meteo fields, snapshot schema, `weather_source` semantics, fill-on-sync trigger, geocode source (P2-3).
- [ ] PDF pipeline: routing rule + **tunable fallback threshold value** + consistency contract (shared constants + golden-test spec) + amendment rendering (P2-4, closes spec §6 PDF-threshold question).
- [ ] Navigation map confirms PRD §4/§5 (5-tab + raised camera action; sheets vs routes) — no reopening resolved questions.
- [ ] Module layout mirrors PunchLog `src/` with platform-split rule (P2-6).
- [ ] Full state machine + RPC enforcement matrix incl. `amended` derived state, grace window/auto-lock, locked-row bypass for anonymization (P2-7).
- [ ] Signature persistence, invite-acceptance, customization-enforcement split designed (P2-8/9/10).
- [ ] Rev-3 blockers closed: project geolocation (P2-11), get-or-create contract (P2-12), `report_date` TZ boundary (P2-13).
- [ ] **PM-role and tab-layout confirmed as already-resolved (no work), EXIF and PDF-threshold newly closed** — all four spec-flagged ASSUMPTION items accounted for.
- [ ] Zero app code or SQL produced (Phase 2 is design-only).

### Phase 3 — Data model DoD
- [ ] All migrations additive-only, idempotent-guarded, RLS-in-same-migration, plain SQL — delivered to `jobsight-backend`, reference copies in app repo.
- [ ] `daily_reports` + `report_sections` + relational child tables + `report_photos` (provenance columns) + amendments + signatures + member_prefs created; `UNIQUE(project_id,report_date)`; indexes present.
- [ ] `projects` additive `lat`/`lng`/`timezone` (nullable, graceful-null).
- [ ] RPCs `create_report` (get-or-create), `submit_report`, `lock_report`, `amend_report` enforce legal transitions server-side; helper execute revoked from clients.
- [ ] `worklog-photos` bucket + path-encoding RLS + `remove_photo` DELETE policy (draft-only); no UPDATE policy.
- [ ] `delete-account` extended behind WorkLog-scoped path; PunchLog path untouched + regression-tested.
- [ ] SQLite `schema.ts` + `DOMAIN_COLUMNS` + versioned migrations; two-level section shape mirrors server.
- [ ] **Column-parity jest test green**; sync-mapping table (kind→handler→table) delivered.
- [ ] Seed: demo `super` + disposable deletion-test credentials.

### M3 status (post-hoc, recorded by the M3b pull-path plan)

M3 shipped in two sub-milestones: **M3a** (push path — mutation queue drain,
lifecycle RPCs, re-parenting; landed on `main`) and **M3b** (pull path — Tier-1
reference snapshot, Tier-2 per-project cursored feeds, dirty-shielded
appliers, membership/id reconcile sweeps, `completedPulls` UI refetch signal).

- [x] **M3a** — push path complete.
- [x] **M3b** — pull path complete (`docs/superpowers/plans/2026-07-30-m3b-sync-engine-pull.md`, Tasks 1–12). `seedReferenceMirror`'s best-effort network seed retired; Tier-1 pull owns the reference mirror; `pullCore.ts` added to the per-file coverage-pin ladder (95/100/95/95).
- [ ] **Deferred to M4:** the doc-05 global coverage-threshold raise (65/55/68/65) is NOT taken as part of M3b — `collectCoverageFrom` excludes every `*.native.ts` module, so M3b's four new native pull modules sit outside the global denominator entirely, and `pullCore.ts` carries its own pin instead of moving the global floor. ~31 of the 71 files in the global coverage pool currently lack sibling tests, so the raise needs its own dedicated test-backfill task rather than riding on M3b. Tracked alongside the other M4 follow-ups in the M3b plan doc (submit UI signature pre-check, rotation/sweep cadence tuning, amendment UX, submit/lock clientId scheme).

### Phase 4 — Code DoD
- [ ] Every milestone M0–M12 landed; no placeholders, no TODOs, no pseudo-code (spec §10).
- [ ] `tsc --noEmit` green under strict; jest green incl. schema-parity + all `mutationQueue` pure-policy tests.
- [ ] Platform-split grep returns nothing across `src`/`app`.
- [ ] Sync pure modules 100% behavior-covered before native adapters; every failure path ends in retry/park/decision — no silent drops.
- [ ] AC-O1 airplane-mode E2E passes (create→fill→photo→submit→queue→drain-on-reconnect).
- [ ] Photo provenance columns populated end-to-end; GPS guard no-ops on null coords.
- [ ] Golden-output PDF test green across on-device and server renderers.
- [ ] Lifecycle immutability enforced at DB level (locked-row rejection trigger); amendments audited.
- [ ] M12 seeded-account test proves cascade of every WorkLog table + storage path; sign-in fails in both apps.
- [ ] All field-condition ACs (§9: touch ≥48px, WCAG-AA all three themes, one-handed reach, offline-as-normal-state) verified.
