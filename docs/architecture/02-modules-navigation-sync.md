# WorkLog — Phase 2 Architecture: Module Layout, Navigation Map, Sync Engine Design

> Phase 2 deliverable, produced by the architecture track. Built to mirror PunchLog (`C:\Users\kubik\PUNCH-LOG-NEW`) faithfully per `FABLE5-PROMPT-worklog.md` §4.3 and to implement `docs/PRD.md` (rev 3). §11 decisions from the spec are not relitigated. Every file below is named against the real PunchLog tree (read directly from the sibling repo) so WorkLog's layout is a mechanical mirror, not an approximation.

---

## A. Module layout

### Platform-split rule (hard, verbatim from spec §4.3)

Native-only code lives in `*.native.ts`. `src/db/` and every file under `src/sync/` that touches `expo-sqlite` or NetInfo is native-only; the pure modules (`types.ts`, `engineApi.ts`, `mutationQueue.ts`, `conflict.ts`, `cursors.ts`, `paginate.ts`) carry no native imports and are Jest-tested directly. After touching `src/data`/`src/sync`, this must return nothing:

```
grep -rln "from '.*\.native'\|expo-sqlite\|@react-native-community/netinfo" src app \
  --include='*.ts*' | grep -v test | grep -v '\.native\.'
```

CI runs this as a required check (mirrors PunchLog; the web build's import graph must never reach `src/db` or the native sync engine).

### `src/theme/` — copied verbatim (spec §4.1)

| File | Responsibility |
|---|---|
| `tokens.ts` | Palettes, `STATUS_COLORS`→`ReportStatus`-keyed map (`draft`→in_progress blue, `submitted`→review amber, `locked`→closed green, `amended`→open red attention state — derived display state, not a 4th enum value per PRD assumption #23), spacing/radii/sizes, densities. Copied verbatim except the `ItemStatus`→`ReportStatus` rename. |
| `fonts.ts` | `FONT_MAP` / `FONTS` — copied verbatim, unchanged deps. |
| `ThemeProvider.tsx` | Copied verbatim: `isHydrated` splash gate, `touchedRef` hydration-race guard, write-through persistence. |
| `appearanceStorage.ts` | AsyncStorage read/write of theme+density — copied verbatim. |
| `index.ts` | Barrel re-export. |

### `src/auth/`

| File | Responsibility |
|---|---|
| `AuthProvider.tsx` | Session state via `supabase.auth`; mirrors PunchLog's provider (offline token-refresh failure never force-logs-out — spec §4.2). |
| `authLink.ts` | Invite-acceptance mechanics (PRD §15 #12): since `detectSessionInUrl: false`, this resolves the `invite-user` email link via an OTP/code exchange rather than URL session detection. **ASSUMPTION:** OTP-code acceptance (Supabase `verifyOtp`), confirmed in Phase 3 against the existing `invite-user` function contract. |
| `accountCaches.ts` | Offline-restore cache for account/company display data (mirrors PunchLog; companies are NOT mirrored into SQLite — online-only, same rule). |
| `roles.ts` | `is_super`/`is_admin`-shaped client helpers; PM label resolution (reads `report_member_prefs`, PRD §10) — display-only, never an authorization boundary. |
| `index.ts` | Barrel. |

### `src/supabase/`

| File | Responsibility |
|---|---|
| `client.ts` | Copied verbatim from spec §4.2 (chunked `SecureStoreAdapter`, web `localStorage` fallback, foreground auto-refresh). |
| `types.ts` | Generated `Database` types — additive over the shared project's generated types (new tables only). |
| `weather.ts` | Thin wrapper invoking the weather edge function (mirrors `aiDescribe.ts`'s split). |
| `weatherCore.ts` | Pure parsing/validation of the Open-Meteo response shape returned by the edge function — Jest-tested, no native imports (mirrors `aiDescribeCore.ts`). |

### `src/project/`

| File | Responsibility |
|---|---|
| `ActiveProjectProvider.tsx` | Active-project context + switcher state; extended to carry the project's `lat`/`lng`/`timezone` (PRD §15 #9, #11) once pulled. |
| `resolveActiveProject.ts` | Pure resolution of "which project is active" on cold start (mirrors PunchLog). |
| `index.ts` | Barrel. |

### `src/data/` — repository seam (screens talk ONLY to this)

| File | Responsibility |
|---|---|
| `repository.ts` | `WorkLogRepository` interface — the sole screen-facing surface (mirrors `PunchLogRepository` exactly in shape). |
| `RepositoryProvider.tsx` | Context wiring the platform repo in. |
| `platformRepoTypes.ts` | Shared input/output DTOs referenced by both native and web repos. |
| `platformRepo.native.ts` | Selects `sqliteRepo.native.ts`. |
| `platformRepo.web.ts` | Selects `supabaseRepo.ts` (online-only). |
| `sqliteRepo.native.ts` | Device implementation: writes locally, enqueues mutations, nudges the sync engine. |
| `supabaseRepo.ts` | Web implementation: direct Supabase reads/writes, no queue. |
| `types.ts` | `ReportSummary`, `ReportDetail`, per-section content types (`WeatherContent`, `CrewContent`, …), `PhotoProvenance`, `AmendmentView`, `CarryForwardCandidate`, `WeatherSnapshot`, `ProjectSummary` (extended with `lat`/`lng`/`timezone`). |
| `mappers.ts` | Row ↔ DTO mapping. |
| `scope.ts` | Active-project + `report_date` resolution glue (mirrors PunchLog's `scope.ts`). |
| `reportDate.ts` | Project-timezone day-boundary calc (PRD §15 #9): `computeReportDate(projectTimezone, deviceNow)`; falls back to device TZ when `projects.timezone` is null. Pure, Jest-tested. |
| `transitions.ts` | Client-side mirror of the legal report-lifecycle transition table (draft→submitted→locked, amend on submitted\|locked) — a *hint* for UI gating; the RPCs are the enforcement (mirrors PunchLog's `transitions.ts` pattern exactly). |
| `carryForward.ts` | Pure composition: reads the **last report** (not calendar-yesterday), produces a pre-checked, individually-editable draft (crew, equipment, open delays, open RFIs — never descriptions/notes, PRD §13 risk #9). Zero sync-engine impact (PRD §11.7). |
| `geoGuard.ts` | Pure distance-threshold check between a photo's captured GPS and the active project's `lat`/`lng` — the wrong-project photo guard (PRD M5, §15 #11). No-ops (never flags) while project coordinates are null. |
| `photoProvenance.ts` | Native: location-at-shutter capture (`getLastKnownPositionAsync`, 3–5s timeout, never blocks the shutter) + EXIF `DateTimeOriginal` read pre-compression; produces the first-class provenance fields written to the photo row (PRD §11 item 2). |
| `imageBody.native.ts` | Reused verbatim from PunchLog: reads a captured file into bytes for the outbox. |
| `photoUrls.ts` | `worklog-photos` bucket helpers — path builder `<projectId>/<reportId>/<photoId>.jpg`, signed-URL fetch. |
| `photoDelete.ts` | Repository's `removePhoto`: branches on local `_pending` (pure local cancel — dequeue `add_photo`, delete local row + outbox file, no server call, mirrors PunchLog's `deletePhoto` pending-photo path exactly) vs already-synced (enqueues `remove_photo`). |
| `createProject.ts` | Project bootstrap write (PRD Must, M2): create-project sheet → insert row + geocode-on-create hook (server-side Open-Meteo keyless geocode of `address` → `lat`/`lng`, PRD §15 #11) — **online-only**, same rule PunchLog applies to `createProjectWithFloors`. |
| `avatar.ts` / `useAvatarUrl.ts` | Reused verbatim (suite-shared avatar plumbing). |

### `src/db/` — native-only

| File | Responsibility |
|---|---|
| `schema.ts` | Pure DDL strings + `SCHEMA_VERSION` + `MIGRATIONS[n]` + `DOMAIN_COLUMNS` (parity map against `jobsight-backend`'s migrations). No native imports — Jest asserts column parity without opening a DB (mirrors PunchLog exactly). |
| `open.native.ts` | Opens the DB, applies `MIGRATIONS` in one transaction per version bump via `PRAGMA user_version`. |
| `rows.native.ts` | `run`/`all`/`first`/`tx` helpers over `expo-sqlite`. |

### `src/sync/` — pure logic + native adapters

| File | Layer | Responsibility |
|---|---|---|
| `types.ts` | pure | `MutationPayload` union (7 daily-report kinds, §C below), `Mutation`, `MutationStatus`, `ErrorClass`, `MutationStore`/`CursorStore` seams. |
| `engineApi.ts` | pure | `SyncState`/`SyncEngineApi` — copied verbatim, unchanged. |
| `mutationQueue.ts` | pure | `classifyError`, `normalizeStorageError`, `isDuplicateUpload`, `orderForDrain`, `newMutation`, `applyOutcome` — copied verbatim. Only `RowTarget`/`rowTargetOf`/`otherMutationTargetsRow` are domain-adapted (§C). |
| `conflict.ts` | pure | Generalized `mergeItem`/`resolveItem` → `mergeReport`/`resolveReport` covering `daily_reports.status` (server-governed, never LWW) the same way PunchLog protects `items.status`. |
| `cursors.ts` | pure | `overlapFloor`/`nextCursor` — copied verbatim. `SCOPES` map extended with the per-project-keyed scopes (§C). |
| `paginate.ts` | pure | `selectAllById`/`selectAllKeyset` — copied verbatim, unchanged. |
| `engine.native.ts` | native | Orchestrator — **copied verbatim, zero domain logic** (per spec: "it is domain-agnostic"). |
| `push.native.ts` | native | Per-kind push handlers → Supabase/RPCs (§C). |
| `pull.native.ts` | native | Keyset pulls → SQLite upserts, per-project reconciles (§C). |
| `store.native.ts` | native | `MutationStore`/`CursorStore` over SQLite — copied verbatim. |
| `outbox.native.ts` | native | Durable photo-bytes outbox (app-document dir) — copied verbatim. |
| `context.native.ts` | native | `SyncContext = { db, mutations, cursors }` — copied verbatim. |

### `src/report/` — PDF pipeline (mirrors PunchLog's `src/report/` shape, spec §6)

| File | Responsibility |
|---|---|
| `types.ts` | Shared report-data shape consumed by the renderer. |
| `buildReportData.ts` | Assembles one report's full DTO (sections + child rows + photos + amendments + signature) from the repository for rendering. |
| `assembleReport.ts` | Orchestrates `buildReportData` → `renderReportHtml` → `printReport`. |
| `renderReportHtml.ts` | HTML template: branded header/footer, all 11 sections, photo sheets with the provenance caption line ("Captured … · lat, lng (±accuracy m)"), amendment appendix pages, signature block, page numbers. |
| `reportLayoutConstants.ts` | Shared layout constants (margins, font sizes, photo-grid geometry) referenced by both the on-device HTML renderer and documented for the `jobsight-backend` pdf-lib fallback. **ASSUMPTION:** because the pdf-lib renderer lives in the separate `jobsight-backend` repo, this file cannot be a true shared import across repos; it is the single source of truth copied (not hand-retyped) into the edge function at deploy time, verified by a golden-output comparison test run in CI against a checked-in reference-report fixture. Flagged as a cross-repo contract risk per PRD §15 #4. |
| `escapeHtml.ts` | Reused verbatim. |
| `embedPhotoTypes.ts` / `embedPhoto.native.ts` / `embedPhoto.web.ts` | Photo-sheet embedding, platform-split (mirrors PunchLog). |
| `printReportTypes.ts` / `printReport.native.ts` / `printReport.web.ts` | `expo-print` + `expo-sharing` on native (≤40-photo ceiling, PRD §11 item 4); web builds clean but ships no user-facing surface (PRD §5, "web companion scope"). |
| `signatureBlock.ts` | Renders the persisted signature PNG + signer name/title/timestamp into the HTML template. |
| `renderReportHtml.test.ts`, `goldenReport.test.ts` | Unit test + golden-output test (PRD §15 #4's "core, not edge-case" consistency contract) against a fixed reference report fixture. |

### `src/components/`

| Path | Responsibility |
|---|---|
| `BottomSheet.tsx`, `ConfirmSheet.tsx`, `SheetRow.tsx`, `EmptyState.tsx`, `ErrorState.tsx`, `Skeleton.tsx`, `ToastProvider.tsx`, `SplashGate.tsx`, `AuthSplash.tsx`, `AnimatedSplash.tsx`, `BrandFooter.tsx`, `BrandMark.tsx`, `Stagger.tsx` | Reused verbatim (suite-shared chrome). |
| `SyncStatusBanner.tsx` | Extended: global pill (PRD AC-O3 copy: "All saved to the cloud" / "N changes waiting to send" / "Sending…" / "N changes need attention") + entry point into the grouped park surface. |
| `ReportStatusChip.tsx` | Renamed/adapted from `StatusChip.tsx` for `ReportStatus`. |
| `report/` | `ReportDetailSections.tsx` (mirrors `ItemDetailSections.tsx`), one editor sheet per section (`WeatherSectionSheet.tsx`, `CrewSectionSheet.tsx`, `WorkPerformedSectionSheet.tsx`, `DeliveriesSectionSheet.tsx`, `EquipmentSectionSheet.tsx`, `InspectionsSectionSheet.tsx`, `SafetySectionSheet.tsx`, `DelaysSectionSheet.tsx`, `VisitorsSectionSheet.tsx`, `RfisSectionSheet.tsx`, `NotesSectionSheet.tsx`), `CarryForwardReviewSheet.tsx`, `ReviewSubmitSheet.tsx`, `AmendmentEditorSheet.tsx`, `SignatureCaptureSheet.tsx`. |
| `photo/` | `BatchCaptureSheet.tsx`, `PhotoTagSheet.tsx`, `PhotoLightbox.tsx`, `PhotoStrip.tsx`, `WrongProjectGuardBanner.tsx` (surfaces `geoGuard.ts` results before attach). |
| `project/` | `CreateProjectSheet.tsx`, `ProjectSwitcherSheet.tsx`, `ProjectMembersScreenParts.tsx` (invite form over `invite-user`). |
| `rollup/` | `WeeklyRollupCard.tsx` (Could, M11). |

### `src/hooks/`, `src/lib/`, `src/notifications/`, `src/observability/`

| File | Responsibility |
|---|---|
| `hooks/useAsyncData.ts`, `hooks/useReducedMotion.ts`, `hooks/useRefreshOnFocusAndSync.ts` | Reused verbatim (the last subscribes to `SyncState.completedPulls`, unchanged contract). |
| `hooks/useVoiceDictation.ts` | New: wraps `expo-speech-recognition`, `supportsOnDeviceRecognition()` capability gate, `contextualStrings` fed from project trades/vendors (PRD §11 item 1). Isolated per M8 risk containment. |
| `lib/base64.ts`, `lib/color.ts`, `lib/errors.ts`, `lib/status.ts`, `lib/strings.ts`, `lib/uuid.ts` | Reused verbatim. `lib/time.ts` was **deleted** 2026-08-04 (#22): it had no importers, and its `todayIso()` returned the naive device day under a canonical-looking name — exactly what `data/reportDate.ts` forbids for `report_date`. Any calendar date for a report comes from `computeReportDate`, in the project's timezone. |
| `notifications/*` | Reused verbatim — WorkLog wires the existing `send-push` function for the M11 "report submitted" notification. |
| `observability/sentry.ts` | Reused verbatim (own DSN/project per app). |

---

## B. Navigation map

Routes in `app/`; creation/editor flows are **sheets, not routes** (spec §6, PRD §5). Mirrors PunchLog's root shape (`app/_layout.tsx`, `app/index.tsx` resolver, `(auth)`, `(tabs)`).

```
app/
  _layout.tsx                        # Theme/Auth/ActiveProject/Repository/
                                      # SyncEngine/Toast/Sentry providers;
                                      # splash held on isHydrated
  index.tsx                          # redirect resolver: session? → (tabs) : (auth)/login

  (auth)/
    _layout.tsx
    login.tsx                        # always Blueprint theme
    register.tsx                     # register/company-join
    reset-password.tsx               # ASSUMPTION: standard Supabase reset flow,
                                      # not explicitly locked by the PRD; mirrors
                                      # PunchLog's set-password.tsx — confirm scope
                                      # in Phase 3, low risk either way

  (onboarding)/
    permissions/
      camera.tsx
      location.tsx
      speech.tsx
      photos.tsx

  (tabs)/
    _layout.tsx                      # 5-slot bar, raised center camera ACTION
                                      # (opens BatchCaptureSheet — not a route)
    index.tsx                        # Today
    history.tsx                      # History: calendar + filterable list
    photos.tsx                       # Photos wall
    settings.tsx                     # Settings hub (links into app/settings/*)

  project/
    [id]/
      members.tsx                   # member list + invite-by-email

  report/
    [id]/
      index.tsx                     # Report detail: sections, status chip,
                                      # submit/lock/amend actions, photo strip
      pdf.tsx                       # PDF preview → OS share sheet
      photo/
        [photoId].tsx               # Lightbox (routed, deep-linkable — PRD ASSUMPTION)

  rollup/
    [projectId]/
      [week].tsx                    # Could, M11 — Monday–Sunday project-TZ summary

  settings/
    appearance.tsx
    branding.tsx                    # admin-only
    customization.tsx               # admin-only
    notifications.tsx               # push opt-in; point-of-use API 33+ prompt
    sync.tsx                        # global status + grouped park surface + conflict surface
    account/
      index.tsx
      delete.tsx                   # two-tier deletion (PRD §12.1)
```

**Sheets (components, not routes)** — presented from within the screen that opens them via `BottomSheet.tsx`, mirroring `CreateItemSheet.tsx`: `CreateProjectSheet`, `ProjectSwitcherSheet`, `CarryForwardReviewSheet`, the 11 section editor sheets, `AmendmentEditorSheet`, `ReviewSubmitSheet`, `SignatureCaptureSheet`, `BatchCaptureSheet`, `PhotoTagSheet`. The raised center tab is an **action**, not a route: it mounts `BatchCaptureSheet` pre-scoped to the active project's today draft from any tab.

**Web companion scope (v1):** builds clean (repository seam + platform-split grep guard honored) but ships no user-facing route tree — per PRD §5, the web target is not a v1 surface.

---

## C. Sync engine design

### Mutation kinds (7)

All payloads carry the client UUIDs they mint as the row's final server primary key (invariant 1). `reportId` threads every payload so the per-report conflict/park surface (below) can group across tables without a join.

| Kind | Payload (client UUIDs bold) | Target table | Push handler behavior | `rowTargetOf` |
|---|---|---|---|---|
| `create_report` | **reportId**, projectId, reportDate (project-tz, `reportDate.ts`), carryForwardSourceReportId? | `daily_reports` | Calls the **get-or-create `create_report` RPC**. On a same-day `UNIQUE(project_id, report_date)` conflict the RPC returns the *existing* report id instead of raising; the handler then re-parents (below) rather than treating this as a normal failure. | `{ table: 'daily_reports', id: reportId }` |
| `update_section` | reportId, **sectionId** (minted client-side on first local touch — same "own UUID PK, business key is elsewhere" pattern as PunchLog's `items.id`/`items.code`), section (`SectionKind`), content (JSON) | `report_sections` (+ server-exploded child tables for aggregated sections: `report_crew`, `report_equipment`, `report_deliveries`, `report_delays` — delete-and-insert in the same transaction that bumps the section row, per PRD §11.7) | Upserts the section row (uses `upsert` with `onConflict: 'id'` and no `ignoreDuplicates`, matching PunchLog's non-append-only handling); rejected server-side once `daily_reports.status = 'locked'`. | `{ table: 'report_sections', id: sectionId, reportId }` |
| `submit_report` | reportId, signaturePngBase64, signerName, signerTitle | `daily_reports` (+ writes `report_signatures`) | Calls `submit_report` RPC: enforces `draft → submitted` server-side, persists the signature row (PRD §15 #13), triggers the M11 distribution email (server-rendered pdf-lib) and the "report submitted" push. Client never sends a timestamp. | `{ table: 'daily_reports', id: reportId }` |
| `lock_report` | reportId | `daily_reports` | Calls `lock_report` RPC for the **explicit** PM/admin "Lock now" tap only. The grace-window auto-lock timer (PRD §15 #2) is a server-side scheduled job calling the same RPC service-role-side — **not** a client mutation. **ASSUMPTION:** implemented as `pg_cron` or a scheduled edge function in `jobsight-backend`; exact grace-window duration confirmed in Phase 3. | `{ table: 'daily_reports', id: reportId }` |
| `create_amendment` | **amendmentId**, reportId, sections (`SectionKind[]`), content per amended section, summary, signaturePngBase64? | `report_amendments` | Calls `amend_report` RPC: server atomically snapshots the *current* section content into the amendment's `before` blob, applies the proposed `after` content to `report_sections`, and requires `daily_reports.status IN ('submitted','locked')` (PRD assumption #24). Idempotent on `amendmentId`. **ASSUMPTION:** amendment signature is optional-by-default-required, admin-toggleable, mirroring assumption #4. | `{ table: 'report_amendments', id: amendmentId, reportId }` |
| `add_photo` | **photoId**, reportId, projectId, storagePath, localUri (outbox URI), width, height, capturedAt, gpsLat/gpsLng/gpsAccuracy (nullable), exifDateTimeOriginal (nullable corroboration), tradeTag, locationTag, caption, source (`'camera' \| 'library'`) | `report_photos` | Bytes-then-row, identical shape to PunchLog's `pushAddPhoto`: upload to `worklog-photos/<projectId>/<reportId>/<photoId>.jpg` (409 duplicate ⇒ treated as success), then upsert the row; **insert allowed while `daily_reports.status IN ('draft','submitted')`** — see "submit/photo race" below — rejected only once `'locked'`. Clears `_pending`/`local_uri` on success, mirrors PunchLog exactly. | `{ table: 'report_photos', id: photoId, reportId }` |
| `remove_photo` | photoId, reportId | `report_photos` | **Only enqueued for an already-synced photo** — an unsynced (`_pending=1`) photo is removed by a pure local cancel in `photoDelete.ts` (dequeue `add_photo`, delete local row + outbox file, no network call). For a synced photo: issues a real delete, gated server-side by a policy restricting deletes to the draft window (PRD §15 #16). **Adapted evict semantics:** on a 403 (report left the draft window before the delete landed), the generic `evictLocal` behavior is *inverted* — instead of deleting the local row (which would destroy evidence), the handler restores the photo's local visibility and surfaces "This report was already sent — the photo will stay in the report." | `{ table: 'report_photos', id: photoId, reportId }` |

**Photo tag edits after the fact** (Photos tab tag-cleanup pass, PRD §5): this track proposes an **online-only `update_photo_tags` RPC** called directly by the repository, mirroring PunchLog's markup-edit path (no UPDATE grant to race against). *Note: the photo-pipeline track proposes a queued `update_photo_meta` mutation instead — see `00-README.md`, Reconciliation R1, for the open decision.*

### Drain order (`orderForDrain`) — unchanged, verified safe

`orderForDrain` is copied **verbatim** (JSON mutations oldest-first, then `add_photo` oldest-first). No code change is needed because `remove_photo` — the only new kind that could plausibly precede its own `add_photo` — is proven never to, by construction: a not-yet-synced photo's removal never produces a `remove_photo` mutation at all (it's a pure local cancel, above); a `remove_photo` mutation can only exist once its `add_photo` has already drained and been dequeued. `create_report`, `update_section`, `submit_report`, `lock_report`, and `create_amendment` are all JSON-class and drain oldest-first ahead of every `add_photo`, which still satisfies PunchLog's original invariant: "no mutation ever depends on a photo."

**The submit/photo race (new, resolved here):** because JSON mutations (including `submit_report`) drain *before* `add_photo`, a superintendent who captures photos and taps Submit before those photos have physically uploaded will have `submit_report` land first. If `report_photos` inserts were rejected once `status != 'draft'`, every straggler `add_photo` enqueued *before* submit would then fail. Resolved by making **`locked`** — not `submitted` — the true photo-attachment cutoff: `report_photos` INSERT is allowed while `status IN ('draft', 'submitted')`. This is consistent with PRD assumption #19 ("submitted is author-immutable for *sections*; the grace window governs auto-lock timing, not editability") extended one step further to say photos-in-flight from before submit are part of that same grace window, not a violation of it. Only a straggler that loses the race against **lock** (rare — the grace window is measured in hours) parks permanently and surfaces the same "Add as amendment?" copy the camera flow already uses for the explicit already-submitted case (PRD §5), unifying the async-race and user-visible-timing paths onto one UX.

### Pull scopes and cursor keys

PunchLog's convention is a single **global** cursor per table (every pull is already RLS-scoped, so one high-water mark per feed suffices). The spec explicitly calls for **per-project** cursor scoping for the report domain (§4.3: `reports:<projectId>`) — a deliberate divergence, motivated by WorkLog's no-offline-cap multi-project requirement: a superintendent on a dozen projects must not re-scan every project's full report history on every foreground/reconnect trigger. WorkLog therefore runs **two pull tiers**:

**Tier 1 — global reference data (unchanged from PunchLog):** `projects`, `project_members`, `profiles`. Companies/`company_members` are **not** mirrored locally (same rule as PunchLog — online-only account data; branding/customization screens read live).

**Tier 2 — per-project report domain (new):**

| Table | Cursor scope key | Pull shape | Reconcile |
|---|---|---|---|
| `daily_reports` | `reports:<projectId>` | Keyset `(updated_at, id)`, overlap floor. `status` merged via `resolveReport` (server-governed, never LWW) — generalized `conflict.ts`. | Id-sweep per project (membership-loss / access-revoked cascade). |
| `report_sections` | `report_sections:<projectId>` | Keyset `(updated_at, id)`, overlap floor. Pull upsert **also explodes** the pulled JSON into local relational child tables (`report_crew`, `report_equipment`, `report_deliveries`, `report_delays`) in the same transaction as the push-side explosion — local and server never disagree about where section data lives (PRD §11.7). | Cascades with parent report eviction. |
| `report_photos_v1` | `report_photos_v1:<projectId>` | Keyset `(updated_at, id)`, overlap floor. Non-null `deleted_at` = tombstone → local `DELETE` (mirrors PunchLog's photo tombstone handling). **Versioned key from day one** (`_v1`, not bare `report_photos`) — PunchLog's own `photos`→`photos_v2` migration pain (a stale cursor semantics change silently skipping rows) is the reason this ships pre-versioned rather than retrofitted later. | Id-sweep per project, excludes `_pending=1`. |
| `report_amendments` | `report_amendments:<projectId>` | Append-only: keyset `(created_at, id)`, overlap floor (mirrors `comments`/`item_history`). | Cascades with parent report eviction only. |
| `report_signatures` | — **not pulled** | Write-only via `submit_report`/`amend_report` RPC payloads. **ASSUMPTION:** the device never needs to read a signature back — the local PDF is regenerated on demand from local report data plus the signature bytes captured at submit time in the same session; server-side regeneration (M11 distribution) reads it directly from Postgres, not from a device pull. | n/a |

**Multi-project pull scheduling (new policy, PRD §15 #6):** on every sync run, the engine eagerly pulls Tier 2 for the **active** project only; other member projects' Tier-2 cursors are refreshed lazily — on explicit project-switch, and on a slow background rotation (one not-recently-pulled project per sync run) so a superintendent's other projects stay bounded-stale rather than fully cold. **ASSUMPTION:** exact rotation cadence (e.g., one stale project per foreground trigger, capped) is a Phase 3 tuning parameter, not an architectural one — the seam (`cursors.get('reports:<projectId>')` per project) is what matters here and is fixed now.

### Conflict surfaces

1. **Per-report + global sync status indicators (Must).** `RowTarget` carries an optional `reportId` (new field vs PunchLog's plain `{table, id}`), so every mutation targeting `daily_reports`, `report_sections`, `report_photos`, or `report_amendments` can be grouped by the report it belongs to without a join. `report/[id]`'s status chip and every `history` list row derive: any queued (`pending`) mutation in the group ⇒ "syncing/pending"; any `parked` mutation in the group ⇒ "needs attention"; otherwise "synced." The global `SyncStatusBanner` remains the flat PunchLog-style pill (PRD AC-O3 copy).

2. **Grouped park surface (Must).** `settings/sync.tsx` groups parked mutations **by `reportId`** (project + date), not as a flat list — a superintendent with residual failures across three reports needs to know which report needs attention, and "Retry this report" unparks only that group's mutations (`unpark` per `clientId`), alongside a global "Retry all" (existing `retryParked()`, unchanged).

3. **`create_report` get-or-create collision path (Must).** Two devices (or one device across an app-kill) can each mint a local `create_report` with a different client UUID for the same `(project_id, report_date)`. The RPC catches the `UNIQUE` violation server-side and returns the **existing** report id instead of raising. The push handler then calls a new `reparentReport(ctx, loserId, winnerId)`: inside one SQLite transaction, every local `report_sections`/`report_photos`/`report_amendments` row and every *other* queued mutation's embedded `reportId` referencing the loser is rewritten to the winner, and the loser's local `daily_reports` row is deleted. `create_report`'s mutation is only dequeued once re-parenting fully commits; if re-parenting throws mid-transaction, the mutation is left `pending` (treated as `retryable` regardless of the RPC's own success) so the next sync retries the *local* re-parent step against the now-known winner id — safe, since the RPC returning "existing row" again is idempotent. Single-device double-create can't occur (Today reads the local row first, PRD §11.7). The rich assisted-merge UI (Should, deferred) sits on top of this same primitive.

4. **The submit/photo race** — resolved above under drain order, not a UI-facing conflict, but surfaced through the same "Add as amendment?" park-and-prompt path when a straggler photo genuinely loses the race against `lock_report`.

### The 8 core invariants — preserved, explicitly

| # | Invariant | WorkLog realization |
|---|---|---|
| 1 | Client UUID = final server id | `reportId`/`sectionId`/`photoId`/`amendmentId` all client-minted, used as server PK. The **one** deliberate, handled exception is the `create_report` natural-key collision — resolved by explicit re-parenting (above), not by silently violating the invariant. |
| 2 | Push-then-pull | `engine.native.ts` copied verbatim; no orchestration change. |
| 3 | Single-flight + coalescing | `engine.native.ts` copied verbatim. |
| 4 | Offline is not failure | `classifyError`/`applyOutcome` copied verbatim, domain-agnostic. Weather auto-fill is server-side fill, not a client mutation (PRD §11.7), so it can never pollute this queue's retry accounting. |
| 5 | Retry ceiling parks, never drops | `RETRY_CEILING = 5` unchanged. RLS denial classifies `evict` — which, as shipped, parks and raises an `'evicted'` incident but deletes **no** local row (corrected 2026-08-04, #22; local deletion is M3b's membership sweep, per the M3a plan). `remove_photo`'s inverted semantics (above) therefore describe the intended M5 contract, not a deviation from current behaviour. |
| 6 | Dirty-row protection | `_dirty` on `daily_reports`/`report_sections`; `report_photos` uses `_pending` (mirrors PunchLog's photo precedent exactly). `rowTargetOf`/`otherMutationTargetsRow` extended to the 4-table union with the added `reportId` grouping field. |
| 7 | Photos ride the same queue, drained last | `orderForDrain` unchanged; `remove_photo` proven never to precede its own `add_photo` by construction (above). |
| 8 | Non-status LWW by server `updated_at`; no client timestamps | `report_sections` content is LWW by the section row's server `updated_at` via generalized `mergeReport`/`resolveReport`; `daily_reports.status` is 100% RPC-governed (`submit_report`/`lock_report`/`amend_report`), never touched by `update_section` or any merge path — mirrors how PunchLog's `conflict.ts` protects `items.status`. |

### New/additive schema surface referenced above (Phase 3 detail, named here for traceability)

`daily_reports`, `report_sections` (+ exploded `report_crew`, `report_equipment`, `report_deliveries`, `report_delays`; non-aggregated sections stay JSON on the section row per PRD §11.6/§11.7), `report_photos`, `report_amendments`, `report_signatures`, `report_member_prefs` (PM/super title label, PRD §10); additive nullable `projects.lat`/`projects.lng` (**ASSUMPTION**, chosen over a separate `project_sites` table per PRD §15 #11's stated preference for the simpler option) and `projects.timezone` (IANA name, nullable, PRD §15 #9). `worklog-photos` storage bucket, paths `<projectId>/<reportId>/<photoId>.jpg`, same path-encoding RLS pattern as `punch-photos`.

---

### Sources consulted

- `FABLE5-PROMPT-worklog.md`, `docs/PRD.md`
- PunchLog repo (`C:\Users\kubik\PUNCH-LOG-NEW`): `src/sync/*` (mutationQueue, conflict, cursors, context, push, pull, store), `src/db/schema.ts`, `src/data/repository.ts`, full `src`/`app` directory listings
