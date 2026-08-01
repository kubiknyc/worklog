# M4a — Report lifecycle in UI (submit / lock), guards, clientId scheme

Design spec, approved 2026-07-31. Implementation plan:
`docs/superpowers/plans/2026-07-31-m4a-lifecycle.md`.

## Context

M3 (sync engine push + pull) is complete on local main @ `b63d8dd`. The roadmap's M4
(01-work-plan §C) is "lifecycle + amendments in UI + locked-row rejection". M4 splits like
M3 did: **M4a = submit/lock lifecycle** (this spec); M4b = amendments UI; the global
coverage raise and cadence tuning are separate later work.

Recon established that the sync layer is already M4-ready — mutation kinds,
`SubmitReportPayload`/`LockReportPayload`, `rpcMap.ts` handlers with bytea signature
encoding, `rowTargetOf`, and error classification all exist, as do the server RPCs
(`submit_report`, `lock_report`), the locked-row rejection trigger on all 7 section tables,
and the pg_cron auto-lock sweeper (24h grace, `worklog_config.lock_grace_hours`). The gap:
repository seam methods, enqueue clientIds, lifecycle guards, signature/submit/lock UI,
issue #26 hook wiring, and a greenfield pgTAP harness in `../jobsight-backend`.

Decisions made during brainstorming:

- **Split M4a/M4b** — lifecycle first, amendments later.
- **Signature capture is in scope** for the submit flow. `react-native-signature-canvas`
  and `react-native-webview` are already dependencies; the submit payload contract stays
  final (no post-ship RPC/queue shape change, which would be OTA-hostile).
- **One plan, one branch**, executed via subagent-driven development in a worktree.

## Design

### 1. clientId scheme (M3a final-review obligation)

`store.native.ts#enqueue` uses `INSERT OR IGNORE` on `client_id UNIQUE`, so a submit
enqueued with `clientId = reportId` would silently collide with the queued `create_report`
row — whose clientId MUST remain the bare report UUID because the RPC's idempotency key
`p_client_id` equals it.

Scheme: **namespaced clientIds** — `submit:<reportId>` and `lock:<reportId>`, mirroring the
existing `update_section` composite `<reportId>:<section>`. A small pure helper plus a
convention note lands in `src/sync/types.ts`. Re-enqueue of the same lifecycle action stays
an idempotent no-op by design. JSON kinds drain in `seq` order, so
create → sections → submit → lock ordering holds naturally.

### 2. Lifecycle guards (pure)

New `src/data/lifecycleGuards.ts` per test-architecture §B.7:

- `canEditSection(status)` — true only for `draft`.
- `canSubmit(status)` / `canLock(status)` — legal transitions only (draft→submitted,
  submitted→locked). Role gating (`is_super`) is a UI-layer concern fed by membership data.
- Full `lifecycleGuards.test.ts` parametrized over all 11 sections; the module joins the
  per-file coverage-pin ladder (~90%+).

### 3. Repository seam

`Repository` (src/data/types.ts) gains:

- `submitReport(reportId, { signerTitle, signaturePngBase64 })`
- `lockReport(reportId)`

Implementations: `sqliteRepo.native.ts` does an optimistic local `status` write plus
enqueue with the namespaced clientId; `supabaseRepo.ts` (web, online-only) calls the RPCs
directly.

Status-regression shield: `conflict.ts#resolveReport` always adopts server status, so a
pull racing ahead of the push drain would flip an optimistic `submitted` back to `draft`.
When a pending lifecycle mutation exists for the report, the optimistic status wins; the
plan picks the minimal seam (likely the pull applier's existing dirty-shield path).

### 4. UI

- **Read-only mode**: report screen and section sheets consult `canEditSection`; rows stay
  viewable, `useSectionDraft` refuses writes / sheets open read-only when not draft.
- **Submit flow**: submit button on the report screen (visible for draft + super role) →
  submit sheet with signer title (prefilled from `MemberRow.title`) and a signature canvas
  (`react-native-signature-canvas`; native-only, lives in `*.native.tsx`, added to
  `platformSplit` `NATIVE_ONLY_MODULES` if reachable from the web graph).
- **Lock action**: supers on `submitted` reports, behind a confirm step. Auto-lock needs no
  client work — display only.
- `ReportStatusChip` already covers all states. Every new control gets a `testID` per
  `.maestro/README.md` conventions.

### 5. Issue #26 (report screen refetch)

Wire `useRefreshOnFocusAndSync` into `app/report/[id]/index.tsx` (same pattern as
`app/(tabs)/index.tsx`). No sheet-open guard is needed: section sheets seed their draft
once at mount (`useSectionDraft`) and key off route state, and `reload()` is the silent
mode that never nulls `data`, so a background refetch cannot reset an open sheet. The plan
decides whether `useRefreshOnQueueChange` also lands so a parked submit surfaces
immediately.

### 6. pgTAP harness (cross-repo gate, greenfield)

In `../jobsight-backend`: `supabase/tests/` with pgTAP, run via `supabase test db`.
Coverage: locked-row rejection on all 7 guarded tables, illegal transitions (`P0001`),
permission denials (`42501`), submit idempotent replay, signature validation (`22023`),
grace-window sweeper core. Per test-architecture doc, M4 sign-off requires this DB-level
gate — client tests alone do not close M4a.

## Out of scope (M4b+)

Amendments UI/UX, global coverage raise (72/62/74/72) + test backfill, rotation/sweep
cadence tuning + Tier-1 throttle, pull telemetry, quarantine surface.

## Verification

- `npm run verify`; `npm run check:web` (flat worktree); `npm run check:parity`.
- `supabase test db` green in jobsight-backend (new pgTAP suite).
- Maestro/on-device: draft → submit (signature) → chip shows Submitted → drain → server
  rows (`report_signatures`, audit log) verified via psql; a locked report refuses section
  edits on-device.
- Issue #26 closes on merge (`Closes #26`).
