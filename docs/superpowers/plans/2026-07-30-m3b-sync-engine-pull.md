# M3b — Sync Engine Pull Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use `- [ ]` checkboxes.

**Goal:** The sync engine pulls server truth into the SQLite mirror — Tier-1 reference snapshots, Tier-2 per-project keyset feeds with ride-alongs, dirty-shielded LWW appliers, membership/id reconcile sweeps — and publishes a live `completedPulls` that screens consume.

**Architecture:** Pure policy (`pullCore.ts` planner, `conflict.resolveReport`, `paginate` 3-col keyset) + native IO (`pullTables.native.ts` appliers, `pullSweep.native.ts` sweeps, `pull.native.ts` orchestrator) injected into the engine as one `Puller` seam, mirroring the push path's DI style. Pull runs as a phase inside `run()`'s cycle loop — after each drain settles, before the `while (dirty)` re-check — and `runOnce()` stays byte-identical.

**Tech stack:** Expo/RN (Hermes), TypeScript strict, supabase-js v2 (PostgREST reads), expo-sqlite via the `Db` seam, Jest (jest-expo).

**Scope cuts (deliberate, recorded):**

- Photo FILE/thumbnail download+cache, outbox upload UX, tombstone-driven cached-file cleanup → **M5**. M3b pulls photo ROWS only (meta + tombstones); `deleted_at` non-null hard-DELETEs the local row and nothing else (no cached files exist before M5).
- Rotation/sweep cadence tuning beyond the defaults here, Tier-1 throttling, realtime channels, per-feed telemetry → **M4+**.
- Web (`supabaseRepo.ts`) unchanged except the additive `setActiveProject` no-op — pull is native-only; web stays live-query.
- `didFallBackToOnlineOnly` surface is banner copy only — no new screens.

## Global Constraints

- `npm run verify` green before claiming done; `npm run check:web` green.
- `src/sync/` pure and IO-free except `*.native.ts` and the sanctioned stateful `statusHub.ts`/`engineCore.ts` closures. Timers only in the native shell.
- **Never create `foo.ts` beside `foo.native.ts`** (tsconfig `moduleSuffixes` + jest-expo haste resolve bare specifiers to `.native` everywhere).
- New native-only imports go in `*.native.ts(x)` AND `NATIVE_ONLY_MODULES` (`src/platformSplit.test.ts`). M3b adds NO new native dependency — the check is that nothing new leaks into the web graph.
- Coverage pins never lowered. Existing: mutationQueue 100/100/100/100; conflict, statusHub, cursors, engineCore, rpcMap 95/100/95/95; paginate 88/100/95/95; db/schema 90/100/90/90. Task 12 ADDS `src/sync/pullCore.ts` at 95/100/95/95 and raises global to 65/55/68/65 (doc 05 §"M3 ladder").
- Report tables are SELECT-only to clients — the pull path performs ONLY local SQLite writes; every server write stays in the five `SECURITY DEFINER` RPCs.
- **Dirty shield (invariant 6, doc 06 §B) — three explicit gates, stated once here and applied verbatim by the tasks:** (1) a pulled ROW never overwrites a local row whose OWN `_dirty = 1` (photos: or `_pending = 1`) — this governs `daily_reports` (content columns; `status` is still server-adopted via `resolveReport`), `report_sections`, `report_weather` (weather has its OWN `_dirty`; it rides the parent's fetch but is gated by its own flag — a queued manual override survives a clean parent), `report_photos`, `report_amendments`; (2) EXPLODED CHILDREN of a section follow their parent section row's verdict (children have no `_dirty`; schema.ts:196 rationale); (3) `report_amendment_changes` follow their parent amendment's `_dirty`.
- **`profiles` pull MUST enumerate columns explicitly** — migration 20260707000001 revoked `expo_push_token` from the SELECT grant; `select('*')` 403s at runtime and schema-parity CANNOT catch it (grants are invisible to column parity). Local mirror's `expo_push_token` stays NULL forever.
- **Cursor rule:** a feed's cursor is computed ONLY from rows the applier COMMITTED or deliberately SHIELDED (dirty-skip is safe to pass — the queued mutation re-asserts local state to the server, which re-bumps `updated_at`; this consequence is already recorded for discarded-parked rows in M3a). If ANY row in a batch was hard-skipped (unparseable payload, unknown section kind), the cursor does NOT advance for that feed this run — the rows re-fetch next pull via the unchanged cursor, and the failure is recorded in the outcome. Cursors are written only after the applier transaction commits, never on fetch success.
- **Deletion floors:** every deletion path is gated on provably-complete server reads (`selectAllById`/`selectAllKeyset*` throw on any page error — a short read never evicts). ADDITIONALLY, membership eviction and the Tier-1 full replace are gated on a NON-EMPTY sanity floor (Task 9): a complete-but-empty `project_members` read while local membership is non-empty is treated as a feed FAILURE (grant/RLS/JWT regressions return 200 + `[]` — the same failure class as the profiles grant trap), never as truth.
- No `console.log`; use `src/lib/observability*` (precedent: `store.native.ts` already imports it — sanctioned for `.native` sync modules). Conventional commits; no attribution.
- OTA rule: no queued-mutation payload shape changes; no SQLite schema change at all in M3b (`sync_cursors`/`sync_meta` already exist).
- `db.tx` is zero-arg; nested `tx` deadlocks. One transaction per applier call.

## Design references (read before each task)

`docs/architecture/06-sync-mappings.md` §B (authoritative pull table: scopes, keysets, ride-alongs, tombstones, reconcile column — NOTE: it specifies `project_members` as a "snapshot by composite key", NOT by id), `02-modules-navigation-sync.md` §C (two tiers, rotation seam), `04-data-model.md` §D (server pull indexes: `daily_reports (updated_at, id)`, `report_sections (updated_at, report_id, section)`, `report_photos (updated_at, id)`, `report_amendments (created_at, id)`). Existing seams: `src/sync/cursors.ts` (SCOPES, `OVERLAP_MS = 10_000`, `overlapFloor`, `nextCursor` — `nextCursor(current, [])` returns `current`, pinned in its tests), `src/sync/paginate.ts` (`selectAllById` — REQUIRES an `id` column; `selectAllKeyset` — its own doc at :113 names "(project_id, user_id) for a table whose primary key is composite" as the intended use; `keysetAfter`, `quoteOrValue`, `PAGE_SIZE = 1000`, throw-on-page-error), `src/sync/conflict.ts` (`isServerNewer`/`mergeItem`/`resolveItem`, H2 rule), `src/db/schema.ts` (`DOMAIN_COLUMNS` — the export the column manifests derive from; `SCHEMA_V1` local-only columns), `src/sync/store.native.ts` (`createCursorStore` — exists, currently uninstantiated; `clearDirty`; `REPORT_CHILD_TABLES`; `deleteLocalReport`), `src/data/sqliteRepo.native.ts` (`explode()` closure at ~:135, upsert idioms, `asRecord`/`str`/`num`/`boolInt`/`rowId` coercers), `src/data/platformRepo.native.ts` (`seedReferenceMirror` :108-164 — retired in Task 12; `createPlatformRepository` :166-182), `src/sync/engineCore.ts` (EngineDeps, `run()` cycle loop at ~:239-257, publishes with hardcoded `completedPulls: 0` at ~:117/~:235, never-rejects contract), `src/sync/engine.native.ts` (dep wiring, single documented cast site), `src/data/RepositoryProvider.tsx` (`didFallBackToOnlineOnly()` :59-69, fallback catch :121-137, `syncActions` memo :153-159 — deps are `[]` today), `src/project/ActiveProjectProvider.tsx` (`setActiveProject` :78 — the active-project seam), `src/lib/observabilityTypes.ts` (`SyncIncidentDetail` — `kind` + REQUIRED `attempts` + optional `errorCode`/`errorStatus`), `src/sync/types.ts` (payload shapes: ONLY `create_report` and `add_photo` carry `projectId`; every report-scoped kind carries `reportId`). Backend obligations satisfied: `worklog_apply_section` bumps `daily_reports.updated_at` (20260729000001); `create_report` ambiguity fixed (20260729000002). `report_photos` touch-trigger propagates meta/tombstones (existing).

---

### Task 1: `resolveReport` — status is server-governed, never LWW

**Files:** Modify `src/sync/conflict.ts`, `src/sync/conflict.test.ts`.

**Produces (consumed by Task 6):**

```ts
export interface ReportLike extends MergeableItem {
  readonly status: string;
}
export function resolveReport<T extends ReportLike>(
  local: T | null,
  server: T,
  localDirty: boolean,
): ResolvedItem<T>;
```

Semantics: identical to `resolveItem` for every column EXCEPT `status`, which is ALWAYS adopted from the server row — even when the dirty-local-newer branch keeps the rest of the local row (lifecycle transitions happen only via RPC; doc 02 invariant 8). `dirty` output: 1 iff local non-status content survived — derive it from WHICH branch won the merge (local-won vs server-won), mirroring `resolveItem`'s H2 rule; do NOT derive it from object identity of the composed result (`{...local, status: server.status}` is always a fresh object, so identity would always read "local survived"). No existing export changes.

- [ ] Failing tests: server-newer → server row verbatim, dirty 0; local-dirty-newer → local content + `status: server.status`, dirty 1; tie → server, dirty 0; null local → server, dirty 0; non-dirty local-newer → server (same as `resolveItem` — `mergeItem` only prefers local when dirty), dirty 0; status adoption asserted with differing statuses on BOTH the local-wins and server-wins branches.
- [ ] `npx jest src/sync/conflict.test.ts` → RED; implement; → GREEN (conflict.ts pin 95/100/95/95 holds).
- [ ] Commit `feat(sync): resolveReport — status server-governed, content LWW`.

### Task 2: 3-column keyset — additive `paginate.ts` extension

**Files:** Modify `src/sync/paginate.ts`, `src/sync/paginate.test.ts`.

**Produces (consumed by Task 9 for `report_sections`):**

```ts
export interface TripleKey {
  readonly primary: string;
  readonly second: string;
  readonly third: string;
}
export function keysetAfter3(cols: TripleKey, vals: TripleKey): string;
// primary.gt."p",and(primary.eq."p",second.gt."s"),and(primary.eq."p",second.eq."s",third.gt."t")
// — every value through quoteOrValue, exactly like keysetAfter.
export async function selectAllKeyset3<T>(
  make: () => KeysetPageQuery<T>,
  columns: TripleKey, // column NAMES, e.g. {primary:'updated_at', second:'report_id', third:'section'}
  keyOf: (row: T) => TripleKey, // VALUES from the last row of each page
  floor?: string | null, // overlapFloor(cursor) — .gte(columns.primary, floor) when non-null
): Promise<T[]>;
```

`CompoundKey`/`keysetAfter`/`selectAllKeyset` are untouched (their pinned tests stay byte-identical). `selectAllKeyset3` mirrors `selectAllKeyset`'s protocol: `.order` on all three columns ascending, `.gte` floor on primary when given, `.or(keysetAfter3(...))` after the first page, `.limit(PAGE_SIZE)`, throw on the first page error, terminate on short page. Paginate's branch pin is 88 — new code must not drop it (the new helpers are near-branchless; add tests to cover what branches exist).

- [ ] Failing tests (paginate.test.ts's semantic-fake idiom — fakes `expect()` their own order/gt/gte/or arguments and record pages): `keysetAfter3` exact filter string incl. quoting of reserved chars; first page has floor+no-or, second page has or-filter from page-1's last row; colliding `updated_at` across a page boundary neither skips nor duplicates; throw-on-page-error; short-page termination.
- [ ] RED → GREEN → commit `feat(sync): additive 3-column keyset pagination for section pulls`.

### Task 3: Pure pull planner — `src/sync/pullCore.ts`

**Files:** Create `src/sync/pullCore.ts`, `src/sync/pullCore.test.ts`.

**Produces (consumed by Tasks 5-10):**

```ts
export const ROTATION_MIN_INTERVAL_MS = 300_000; // 5 min — tuning constant, doc 02 §C cadence seam
export const ACTIVE_SWEEP_MIN_INTERVAL_MS = 21_600_000; // 6 h — active-project id-sweep staleness
export const IN_CHUNK_SIZE = 200; // max ids per .in() request (URL-length safety)
export const PROFILE_PULL_COLUMNS =
  'id, full_name, email, phone, company, trade, avatar_url, created_at' as const; // hand-pinned: NO expo_push_token — grant revoked (20260707000001); NEVER '*'
export const MEMBER_PULL_COLUMNS = 'project_id, user_id, role, created_at' as const; // hand-pinned: full DOMAIN_COLUMNS.project_members
export const PREFS_PULL_COLUMNS = 'project_id, user_id, title' as const; // hand-pinned: full DOMAIN_COLUMNS.report_member_prefs
// Derived manifests — DOMAIN_COLUMNS[table].join(', ') from src/db/schema.ts, so a new
// server column flows into pulls via the parity snapshot automatically:
export const PROJECT_PULL_COLUMNS: string; // DOMAIN_COLUMNS.projects
export const REPORT_PULL_COLUMNS: string; // DOMAIN_COLUMNS.daily_reports
export const WEATHER_PULL_COLUMNS: string; // DOMAIN_COLUMNS.report_weather
export const SECTION_PULL_COLUMNS: string; // DOMAIN_COLUMNS.report_sections (includes updated_by — full parity; no hand-pin needed, no grant trap here)
export const PHOTO_PULL_COLUMNS: string; // DOMAIN_COLUMNS.report_photos
export const AMENDMENT_PULL_COLUMNS: string; // DOMAIN_COLUMNS.report_amendments
export const AMENDMENT_CHANGES_PULL_COLUMNS: string; // DOMAIN_COLUMNS.report_amendment_changes

export function chunk<T>(items: readonly T[], size: number): readonly (readonly T[])[]; // for .in() batching; chunk([], n) === []

export interface RotationState {
  readonly lastProjectId: string | null;
  readonly lastAt: string | null; // ISO
}
export interface PullPlan {
  readonly activeProjectId: string | null; // pulled every run when member
  readonly rotationPick: string | null; // one non-active project, or null (interval not elapsed / none)
  readonly sweepProjects: readonly string[]; // id-sweep targets this run (deduped, subset of member projects)
  readonly nextRotationState: RotationState;
}
export function planPullRun(input: {
  readonly activeProjectId: string | null;
  readonly memberProjectIds: readonly string[]; // AFTER Tier-1 replace
  readonly rotation: RotationState;
  readonly sweepDueProjectIds: readonly string[]; // pull_sweep_due:* flags (403-evict recovery)
  readonly sweepLastByProject: Readonly<Record<string, string | null>>; // pull_sweep_last:* stamps
  readonly nowIso: string;
}): PullPlan;
// Rules: active project (if member) always pulled. rotationPick = next member project after
// rotation.lastProjectId in sorted order, excluding active, only when nowIso - rotation.lastAt
// >= ROTATION_MIN_INTERVAL_MS (or lastAt null); wraps around; null when no candidates.
// sweepProjects = dedupe(sweepDueProjectIds ∩ members) ∪ (rotationPick ? [rotationPick] : [])
//   ∪ (active when member && (sweepLast null or older than ACTIVE_SWEEP_MIN_INTERVAL_MS)).
// nextRotationState advances only when rotationPick non-null; unparseable lastAt → treat as null.

export function diffMembership(
  beforeProjectIds: readonly string[],
  afterProjectIds: readonly string[],
): readonly string[]; // evicted = before − after; empty before-set → empty (first-sync safety).
// NOTE: the empty-AFTER floor is NOT here — it is the orchestrator's pre-check (Task 9):
// a complete-but-empty members read is treated as feed failure BEFORE diffing.

export interface PullOutcome {
  readonly ok: boolean; // every attempted feed succeeded (incl. no hard-skipped rows)
  readonly appliedFeeds: number; // feeds whose applier committed AT LEAST ONE row (completedPulls bumps when > 0; a zero-row steady-state pull does not re-fire screens)
  readonly offline: boolean; // first failure classified offline (isLikelyOffline) — engine publishes online:false, lastError:null
  readonly error: string | null; // first non-offline feed error message; null when ok or offline-only
}
```

Pure module: imports only from `../db/schema` and `../lib/errors` (`isLikelyOffline` is pure).

- [ ] Failing tests: PROFILE_PULL_COLUMNS excludes `expo_push_token` and never contains `*`; SECTION_PULL_COLUMNS contains `updated_by` (derivation proof); `chunk` — empty/exact/remainder; rotation — interval gate (elapsed/not/lastAt null), active excluded, sorted-order wraparound, single-member → null pick, unparseable lastAt treated as null; sweepProjects union incl. dedupe when rotationPick is also sweep-due, non-member sweep-due dropped; diffMembership basic/empty-before/no-change; PullPlan never sweeps a non-member.
- [ ] RED → GREEN → commit `feat(sync): pure pull planner, rotation and column manifests`.

### Task 4: Extract `explodeSection` + coercers — mechanical, behavior-identical

**Files:** Create `src/data/sectionExplode.native.ts`, `src/data/sectionExplode.native.test.ts`. Modify `src/data/sqliteRepo.native.ts` (delegate; delete the closure). Existing `src/data/sqliteRepo.native.test.ts` must stay green UNCHANGED — that is the proof of mechanical extraction.

**Produces (consumed by Task 6):**

```ts
export async function explodeSection(
  db: Db,
  reportId: string,
  section: SectionKind,
  content: Json,
): Promise<void>;
// Exactly today's explode(): delete-and-insert child rows for crew/equipment/
// work_performed/delays/safety incl. has_delay/has_incident recomputes; no-op for
// non-relational sections. Runs INSIDE the caller's transaction — it must NOT open its own tx.
export { asRecord, str, num, boolInt, rowId }; // moved coercers, re-imported by sqliteRepo — no duplication
export function parseSectionKind(value: unknown): SectionKind | null; // narrows a server-provided
// section string against the SectionKind union (source: src/sync/types.ts / sectionMeta's
// canonical list); null for unknown — pull appliers skip-and-count those rows.
```

- [ ] Extract; sqliteRepo delegates. `npx jest src/data/sqliteRepo.native.test.ts` green with zero test edits.
- [ ] New direct tests (fake-Db idiom): one relational section explodes rows + recompute; weather/notes no-op; delete-before-insert order; `parseSectionKind` accepts every canonical kind, rejects unknown/non-string.
- [ ] `npx tsc --noEmit` clean → commit `refactor(data): extract explodeSection and coercers for pull re-explosion`.

### Task 5: Tier-1 snapshot applier

**Files:** Create `src/sync/pullTables.native.ts`, `src/sync/pullTables.native.test.ts`.

**Produces (consumed by Task 9):**

```ts
export interface ReferenceSnapshot {
  readonly projects: readonly Record<string, unknown>[];
  readonly members: readonly Record<string, unknown>[];
  readonly prefs: readonly Record<string, unknown>[];
  readonly profiles: readonly Record<string, unknown>[];
}
export interface MembershipDiff {
  readonly beforeProjectIds: readonly string[]; // local project_members rows for the session user, pre-replace
  readonly afterProjectIds: readonly string[];
}
export async function applyReferenceSnapshot(
  db: Db,
  sessionUserId: string,
  snap: ReferenceSnapshot,
): Promise<MembershipDiff>;
```

ONE transaction: capture `beforeProjectIds` (`SELECT project_id FROM project_members WHERE user_id = ?`), then full-replace all four tables (`DELETE FROM x` + INSERT per row — doc 06 §B "snapshot, full replace"; `report_member_prefs` rides in the same tx as `project_members`). Column writes use the snapshot rows' keys filtered to `DOMAIN_COLUMNS[table]` (unknown keys dropped, missing → NULL; `profiles.expo_push_token` never present → stays NULL). No `_dirty` columns exist on Tier-1 tables — no shield needed. This applier is a MECHANICAL executor: the empty-members sanity floor lives in the orchestrator (Task 9), which must never call this with a suspicious snapshot. Returns before/after for the Task 8 sweep.

- [ ] Failing tests (fake-Db): full replace removes stale local rows; prefs replaced in same tx as members; before/after diff correct incl. first-sync empty-before; unknown server key dropped; missing column → NULL.
- [ ] RED → GREEN → commit `feat(sync): tier-1 reference snapshot applier with membership diff`.

### Task 6: Reports + sections appliers (dirty shield + ride-alongs)

**Files:** Modify `src/sync/pullTables.native.ts` + test.

**Produces (consumed by Task 9):**

```ts
export interface ApplyResult {
  readonly applied: number; // rows committed by this applier call
  readonly cursorKeys: readonly string[]; // cursor timestamps of rows SAFE to advance past:
  //   committed rows + dirty-SHIELDED rows (shield-pass is safe — the queued mutation
  //   re-asserts local state and re-bumps server updated_at; recorded M3a consequence).
  readonly hardSkipped: number; // unparseable payload / unknown section kind — cursor MUST NOT
  //   advance this feed when > 0 (Global Constraints cursor rule).
}
export interface PulledReportBundle {
  readonly report: Record<string, unknown>; // REPORT_PULL_COLUMNS shape
  readonly weather: Record<string, unknown> | null; // ride-along, fetched with the same feed
}
export async function applyReports(db: Db, rows: readonly PulledReportBundle[]): Promise<ApplyResult>;
export interface PulledSection {
  readonly report_id: string;
  readonly section: string; // narrowed via parseSectionKind — unknown ⇒ hardSkipped
  readonly payload: unknown; // server jsonb — parsed to Json; unparseable ⇒ hardSkipped
  readonly is_complete: unknown;
  readonly updated_at: string | null;
}
export async function applySections(db: Db, rows: readonly PulledSection[]): Promise<ApplyResult>;
```

`applyReports`, one tx per CALL (not per row): per bundle, coerce the raw record to the local row shape via Task 4's coercers (`str`/`num`/`boolInt` per `DOMAIN_COLUMNS.daily_reports`; a row missing a string `id` or `updated_at` ⇒ hardSkipped); read local row + `_dirty`; `resolveReport(local, server, dirty)` (both typed via the coerced shape — `ReportLike` satisfied by construction); upsert the resolved item by id with the resolved `dirty`. Weather ride-along in the SAME tx, gated by the WEATHER row's OWN `_dirty` (Global Constraints gate 1): local `report_weather._dirty = 0` → `INSERT ... ON CONFLICT (report_id) DO UPDATE` over `WEATHER_PULL_COLUMNS`, `_dirty` untouched; `_dirty = 1` → weather untouched while the parent report still applies. `applySections`: per row, `parseSectionKind(row.section)` — null ⇒ hardSkipped; parse payload — unparseable ⇒ hardSkipped; read local `(report_id, section)` + `_dirty`; `resolveItem`; server-win → upsert section row (`_dirty = 0`) AND `explodeSection(db, reportId, kind, parsedPayload)` in the same tx (children follow the parent verdict — gate 2); local-win (dirty) → touch NOTHING, count the row's timestamp into `cursorKeys` (shield-pass).

- [ ] Failing tests: dirty report keeps local content but ADOPTS server status (resolveReport wired, both branches); clean report replaced verbatim; weather rides same tx on clean weather; dirty weather row untouched while the parent report still applies; dirty section + its children untouched AND its timestamp still in cursorKeys; clean section upsert + re-explode in same tx (fake-Db records tx boundaries); unparseable payload ⇒ hardSkipped > 0, other rows still commit; unknown section kind ⇒ hardSkipped; malformed report row (no id) ⇒ hardSkipped.
- [ ] RED → GREEN → commit `feat(sync): report and section pull appliers with dirty shield and ride-alongs`.

### Task 7: Photos + amendments appliers

**Files:** Modify `src/sync/pullTables.native.ts` + test.

**Produces (consumed by Task 9):**

```ts
export async function applyPhotos(db: Db, rows: readonly Record<string, unknown>[]): Promise<ApplyResult>;
export interface PulledAmendment {
  readonly amendment: Record<string, unknown>;
  readonly changes: readonly Record<string, unknown>[]; // fetched per amendment id, replaced locally
}
export async function applyAmendments(db: Db, rows: readonly PulledAmendment[]): Promise<ApplyResult>;
```

`applyPhotos`: per row — malformed (no string `id`/`updated_at`) ⇒ hardSkipped. Local `_dirty = 1` OR `_pending = 1` → untouched, timestamp into `cursorKeys` (shield-pass; the unpushed local state wins until its push resolves — the next pull re-delivers a missed tombstone via the push-echo bump). Non-null `deleted_at` → hard `DELETE` the local row (row only — cached files are M5), counts as committed. Else upsert over `PHOTO_PULL_COLUMNS`; NEVER write `_pending`/`_dirty`/`local_uri`/`local_thumb_uri` (the SET list omits them; the INSERT branch sets `_pending = 0, _dirty = 0` for a brand-new server row). `applyAmendments` (cursor timestamps come from `created_at` — append-only feed): per bundle — malformed ⇒ hardSkipped; local `_dirty = 1` → untouched (row + changes — gate 3), `created_at` into `cursorKeys`. Else upsert amendment over `AMENDMENT_PULL_COLUMNS` (overwrites the local NULL `amendment_number` with the server's assigned integer — the backfill) and full-replace its `report_amendment_changes` (`DELETE WHERE amendment_id = ?` + INSERT) in the same tx.

- [ ] Failing tests: tombstone hard-deletes clean row; tombstone + `_pending = 1` → row survives, timestamp in cursorKeys; upsert leaves `_pending`/`_dirty`/`local_uri`/`local_thumb_uri` untouched on existing row; new server photo row inserts with `_pending = 0`; dirty amendment fully shielded (row + changes) with `created_at` in cursorKeys; clean amendment upsert backfills NULL `amendment_number` + replaces changes same tx; malformed row ⇒ hardSkipped.
- [ ] RED → GREEN → commit `feat(sync): photo and amendment pull appliers — tombstones and number backfill`.

### Task 8: Reconcile sweeps — `src/sync/pullSweep.native.ts`

**Files:** Create `src/sync/pullSweep.native.ts`, `src/sync/pullSweep.native.test.ts`.

**Produces (consumed by Task 9):**

```ts
export type SweepIncident = (reportId: string) => void; // Task 9 maps → reportSyncIncident
export async function evictProjects(
  db: Db,
  projectIds: readonly string[],
  onEvicted: SweepIncident,
): Promise<void>;
export async function sweepProject(
  db: Db,
  projectId: string,
  serverReportIds: readonly string[], // COMPLETE set — caller guarantees (throw-on-partial upstream)
  serverPhotoIds: readonly string[],
): Promise<void>;
```

`evictProjects` (membership loss — the orchestrator has ALREADY applied both the throw-on-partial gate and the non-empty floor before calling; this module is a mechanical executor): per project — enumerate `SELECT id FROM daily_reports WHERE project_id = ?`; for each report: delete queued mutations whose payload `reportId` matches (raw SQL over `sync_mutations` payload, the reparent.native.ts precedent — INCLUDING parked `create_report` rows; approved decision: membership is gone, every future push 403-evicts anyway; fire `onEvicted(reportId)` per affected report), then `deleteLocalReport(db, reportId)`. Then delete the project's four cursor scopes from `sync_cursors` (`reports:`, `report_sections:`, `report_photos_v1:`, `report_amendments:` + projectId) and its `pull_sweep_last:`/`pull_sweep_due:` keys from `sync_meta`. `sweepProject` (id-sweep, doc 06 §B — `daily_reports` and `report_photos` only; sections/amendments cascade with the parent): candidates `SELECT id FROM daily_reports WHERE project_id = ? AND _dirty = 0` minus `serverReportIds` → `deleteLocalReport` each; photos `SELECT id FROM report_photos WHERE report_id IN (SELECT id FROM daily_reports WHERE project_id = ?) AND _dirty = 0 AND _pending = 0` minus `serverPhotoIds` → plain `DELETE`. A `_dirty`/`_pending` row is structurally invisible to the id-sweep (a parked-create report keeps `_dirty = 1`, so it survives id-sweeps by construction; only membership eviction removes it, deliberately). An empty `serverReportIds` IS honored (a project can genuinely have zero server reports while stale clean local rows exist) — the caller-side floors are what make this safe.

- [ ] Failing tests: eviction removes subtree + queue rows + cursors + meta, fires one incident per affected report, other projects untouched; parked create_report evicted WITH incident; id-sweep deletes server-absent clean report via cascade, keeps `_dirty = 1` report, keeps `_pending = 1` photo; empty `serverReportIds` with clean local rows deletes them ALL (pins the behavior so the ORCHESTRATOR's floors — Task 9 — stay visibly necessary); sweep of unknown project no-ops.
- [ ] RED → GREEN → commit `feat(sync): membership eviction and id-reconcile sweeps`.

### Task 9: Pull orchestrator — `src/sync/pull.native.ts`

**Files:** Create `src/sync/pull.native.ts`, `src/sync/pull.native.test.ts`. Modify `src/lib/observabilityTypes.ts` (additive: `SyncIncidentDetail.kind` union gains `'membership_sweep'`; `attempts` stays required — the sweep passes `0`).

**Produces (consumed by Task 10):**

```ts
export interface PullQueryBuilder<T> extends KeysetPageQuery<T> {
  select(columns: string): this;
  eq(column: string, value: string): this;
  in(column: string, values: readonly string[]): this;
}
export interface PullClient {
  from<T = Record<string, unknown>>(table: string): PullQueryBuilder<T>;
} // structurally satisfied by supabase-js; generic so selectAllById<T extends {id: string}>
//   type-checks without per-call casts. The ONE documented cast site (supabase → PullClient)
//   lives in engine.native.ts (Task 10).
export type Puller = (input: { readonly sessionUserId: string }) => Promise<PullOutcome>;
export function createPuller(client: PullClient, db: Db): Puller;
```

Flow (never throws; every feed independently try/caught; first `isLikelyOffline`-classified failure → `offline: true` and short-circuit the remaining feeds — no radio-burn on a dead link):

1. Read `sync_meta`: `active_project_id`, `pull_rotation_v1` (JSON, unparseable → nulls), all `pull_sweep_due:*` keys, `pull_sweep_last:*` stamps. Build `CursorStore` via `createCursorStore(db)`.
2. **Tier 1 fetches:** `projects` and `profiles` via `selectAllById` (both have `id` PKs); `project_members` and `report_member_prefs` via `selectAllKeyset` with `{primary: 'project_id', tiebreak: 'user_id'}` and NO floor (full snapshot — composite-PK tables have no `id`; doc 06 §B "snapshot by composite key"; paginate.ts:113 names exactly this use).
3. **Tier-1 floor (Global Constraints "Deletion floors"):** if the members fetch succeeded but returned ZERO rows while `SELECT COUNT(*) FROM project_members` is non-zero locally → treat Tier 1 as FAILED (`error: 'tier1 members empty — refusing replace'`), skip the apply, the eviction, and ALL Tier-2. Otherwise `applyReferenceSnapshot` → `diffMembership` → evicted non-empty AND `afterProjectIds` non-empty-or-before-empty → `evictProjects(db, evicted, onEvicted)` where `onEvicted = (reportId) => reportSyncIncident('evicted', { kind: 'membership_sweep', attempts: 0 })` (fire-and-forget; `reportId` is not part of `SyncIncidentDetail` — do not add it). The belt-and-suspenders second floor: when `afterProjectIds` is empty while `beforeProjectIds` was not, skip eviction even though the diff is non-empty (the Tier-1 floor should already have caught it; pin both).
4. `planPullRun` with the post-replace member set.
5. **Tier 2 per planned project** (active first, then rotationPick), feeds in order reports → sections → photos → amendments:
   - Scoping WITHOUT id-lists: every child feed joins to the parent project via a PostgREST embedded inner-join filter — `.select(FEED_COLUMNS + ', daily_reports!inner(project_id)').eq('daily_reports.project_id', projectId)` for sections/photos/amendments (their tables carry `report_id`, not `project_id`; the embed column is STRIPPED from each row before the applier sees it); reports feed scopes directly with `.eq('project_id', projectId)`. This avoids unbounded `.in()` URL growth and the `in.()` empty-list 400 entirely.
   - Fetch via `selectAllKeyset` (reports `(updated_at, id)`, photos `(updated_at, id)`, amendments `(created_at, id)`) / `selectAllKeyset3` (sections `(updated_at, report_id, section)`) with `overlapFloor(cursor)`.
   - Ride-along lookups keep `.in()` but CHUNKED via `chunk(ids, IN_CHUNK_SIZE)` and SKIPPED when the id set is empty: reports feed fetches `report_weather` for the pulled report ids (`WEATHER_PULL_COLUMNS`) to build `PulledReportBundle`s; amendments feed fetches `report_amendment_changes` per pulled amendment ids (`AMENDMENT_CHANGES_PULL_COLUMNS`). A chunk failure fails that FEED (no partial apply, cursor untouched).
   - Apply via Tasks 5-7 appliers. Cursor advance per the Global Constraints cursor rule: `result.hardSkipped === 0` → `cursors.set(scope, nextCursor(cursor, result.cursorKeys))` (committed + shielded rows only; `nextCursor(cursor, [])` returns `cursor` — steady-state no-op, pinned in cursors.test); `hardSkipped > 0` → cursor UNTOUCHED, feed error recorded, `ok: false`. Applier throw → cursor untouched, feed error recorded.
6. **Sweeps:** for each `PullPlan.sweepProjects` project: fetch complete id sets — reports via `selectAllById` on `.select('id').eq('project_id', ...)`, photos via `selectAllById` on `.select('id, daily_reports!inner(project_id)').eq('daily_reports.project_id', ...)`; BOTH complete → `sweepProject`, stamp `pull_sweep_last:<id>`, delete its `pull_sweep_due:<id>`; either throws → skip that project's sweep, record error.
7. Write back `pull_rotation_v1 = nextRotationState`. Return `PullOutcome` (`appliedFeeds` = applier calls that committed ≥ 1 row).

- [ ] Failing tests (semantic fakes for client + fake-Db, per paginate.test idiom): members/prefs fetched via selectAllKeyset composite key, NOT selectAllById; Tier-1 empty-members floor refuses replace + eviction + Tier-2; belt-and-suspenders empty-after floor skips eviction; cursor NOT advanced when hardSkipped > 0; cursor advanced only post-commit with nextCursor of cursorKeys; overlap floor passed to the query; child feeds scoped via `daily_reports!inner` + `.eq('daily_reports.project_id', …)` with the embed stripped before apply; ride-along `.in()` chunked at IN_CHUNK_SIZE and skipped when empty; offline-classified first failure short-circuits with `offline: true`; sweep runs only when BOTH id-fetches complete, stamps + consumes meta keys; rotation state written back; `appliedFeeds` counts ≥1-row applier commits only; never rejects (client throwing everywhere still resolves an outcome); incident fired as `('evicted', {kind: 'membership_sweep', attempts: 0})`.
- [ ] RED → GREEN → commit `feat(sync): pull orchestrator — cursored feeds, floored eviction, gated sweeps, rotation`.

### Task 10: Engine integration — pull phase, `completedPulls`, shell wiring

**Files:** Modify `src/sync/engineCore.ts` + test, `src/sync/engine.native.ts` + test, `src/data/platformRepo.native.ts` + its tests (signature change), `src/data/RepositoryProvider.tsx` (pass userId through), `src/sync/statusHub.test.ts` (one passthrough assertion if absent).

**Contract (engineCore):** `EngineDeps` gains `readonly pull?: (input: { sessionUserId: string }) => Promise<PullOutcome>` and `readonly sessionUserId?: string`. `run()`'s cycle loop (currently `do { dirty = false; await runOnce(); } while (dirty)`) becomes:

```ts
do {
  do {
    dirty = false;
    await runOnce(); // byte-identical — untouched
  } while (dirty);
  await pullOnce(); // new phase, after each settled drain
} while (dirty); // an enqueue DURING pull re-drains (and then re-pulls)
```

`pullOnce()` skips (publishing nothing) when: `deps.pull` or `deps.sessionUserId` undefined; the just-published cycle-end state has `online === false` (the drain's offline stop is visible via `getState()` — `runOnce` stays untouched; this is the specified source of the offline signal); or `dirty` is already true (reparent abort — the outer loop re-drains first; a pull can never observe a half-rewritten loser id; the loser id never exists server-side, so no feed can resurrect it). Otherwise: publish `{...state, syncing: true}`; `await deps.pull({sessionUserId})` inside try/catch (a throw is treated as `{ok:false, appliedFeeds:0, offline:false, error: message}` — never-rejects stays absolute); end-publish folds the outcome — `completedPulls` bumps by 1 when `outcome.appliedFeeds > 0` (monotone counter beside `reparentsCount`; replaces BOTH hardcoded `0`s at ~:117/~:235), `outcome.offline` → `online: false, lastError: null` (never-alarm); otherwise `lastError` = the drain's lastError when non-null, else `outcome.error` (push failures always win; a pull failure lands only when the push phase was clean).

**Shell:** `createSyncEngine(db: Db, sessionUserId: string): SyncEngineApi` — new required param. Its single caller `createPlatformRepository()` (platformRepo.native.ts:166) gains the same param, threaded from `RepositoryProvider` which ALREADY holds the authenticated `userId` it keys the whole provider on (the provider rebuilds on account switch, which also re-arms pull when a session appears after a signed-out cold start — no extra re-arm logic needed; update `platformRepo`'s tests for the signature). Shell wires `createPuller(supabase as unknown as PullClient, db)` — cast documented at the SAME comment block as the existing rpc cast. **403-evict sweep-due flag:** in the shell's `onIncident`, when `kind === 'evicted'`, resolve the project fire-and-forget: payload carries `projectId` (create_report/add_photo) → use it; otherwise every report-scoped payload carries `reportId` → `SELECT project_id FROM daily_reports WHERE id = ?` (try/caught; row may be gone — then skip). Write `sync_meta['pull_sweep_due:<projectId>']` = now.

- [ ] Failing engineCore tests: pull runs after clean drain; skipped when offline-stop (cycle-end published online:false) / no dep / reparent-dirty; enqueue-during-pull re-drains then re-pulls; `completedPulls` bumps only on `appliedFeeds > 0`, monotone across cycles; push lastError not masked by pull error; pull offline → `online: false, lastError: null`; pull dep throwing → cycle still publishes end-state (never rejects). ALL existing engineCore tests pass UNMODIFIED (pin holds).
- [ ] Failing shell tests: puller wired; evicted incident with projectId-less payload resolves project via daily_reports lookup and writes sweep-due meta; missing local row → no write, no throw.
- [ ] statusHub passthrough: a mirrored engine publish carrying `completedPulls: 2` reaches subscribers verbatim (add only if this exact assertion is absent).
- [ ] `npm run verify` → commit `feat(sync): engine pull phase — completedPulls live, offline folding, shell wiring`.

### Task 11: UI surface — refetch hook, banner states, active-project bridge

**Files:** Create `src/hooks/useRefreshOnFocusAndSync.ts` + test, `src/hooks/useActiveProjectSync.ts` + test. Modify `src/components/SyncStatusBanner.tsx` + test; `src/data/RepositoryProvider.tsx` — `degraded` exposed as REACT STATE set in the fallback catch (`:121-137`) beside `setResolved(supabaseRepository)`, included in the sync context value AND its memo deps (the current `useMemo(..., [])` at :153-159 would freeze it — extend the deps); `src/data/types.ts` + `sqliteRepo.native.ts` + `supabaseRepo.ts` — additive `setActiveProject(projectId: string): Promise<void>` (native: `INSERT INTO sync_meta(key, value) VALUES ('active_project_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value` then `nudge()`; web: resolved no-op); `app/(tabs)/_layout.tsx` mounts the bridge hook.

**Contract:** `useRefreshOnFocusAndSync(refetch: () => void)` — calls `refetch` on screen focus (`useFocusEffect` from expo-router) and whenever `useSyncStatus().completedPulls` CHANGES (ref-diffed; not on unrelated publishes; not on mount before any bump). `useActiveProjectSync()` — bridge mounted once in `app/(tabs)/_layout.tsx`: effect on `useActiveProject().activeProjectId` (`src/project/ActiveProjectProvider.tsx` — the existing seam; its `setActiveProject` at :78 stays untouched) → non-null → `void repo.setActiveProject(id)` with a `.catch` that swallows (sync bookkeeping must never break navigation). Banner precedence (EXTEND the pinned test, don't rewrite): **parked > degraded > offline > syncing > countError > lastError > pending > synced** — `degraded` when the provider's context reports fallback (copy: "Offline features unavailable — using online mode"), `offline` when `!online && pending > 0` (copy carries the queued count — the count IS the message, never-alarm; muted styling, not error-colored). `SyncState.online` finally has its consumer.

- [ ] Failing tests: refetch hook — on completedPulls bump, not on same-value publish, not on mount, plus on focus (mock expo-router); bridge hook — writes on id change, swallows rejection, no write on null; banner precedence table extended with degraded and offline rows in the pinned order; degraded copy exact and REACTIVE (flips after the provider's catch fires — test via provider state, not the module flag); offline copy carries the count; ThemeProvider-wrapped; `src/maestroSelectors.test.ts` green (no new testIDs expected; if any added, inventory in `.maestro/README.md`).
- [ ] RED → GREEN → `npx jest src/hooks src/components src/maestroSelectors.test.ts` → commit `feat(sync): completedPulls refetch hook, degraded and offline banner states, active-project bridge`.

### Task 12: Retire `seedReferenceMirror`, raise pins, docs

**Files:** Modify `src/data/platformRepo.native.ts` (delete `seedReferenceMirror` + call site — Tier-1 pull owns the mirror now; the engine's `start()` initial kick performs the first pull, and hydration never awaits it — same non-blocking posture as today), `package.json` (`coverageThreshold`: global → `{branches: 65, functions: 55, lines: 68, statements: 65}`; add `src/sync/pullCore.ts` at `{branches: 95, functions: 100, lines: 95, statements: 95}`), `docs/architecture/06-sync-mappings.md` §C (record: pull follows push's DI style, not doc 05's SyncContext; sweep semantics as built — triggers, floors, gates, parked-create eviction decision; the `daily_reports!inner` Tier-2 scoping choice; the cursor hard-skip hold-back rule), `docs/architecture/01-work-plan.md` (tick M3b).

- [ ] Delete + wire; full suite. If the raised global pins fail, the shortfall will be in `src/` UI files the new sync tests don't reach — add behavioral tests to the LOWEST-covered files shown in the coverage report until global passes (never lower a pin, never add istanbul-ignores).
- [ ] `npm run verify && npm run check:parity && npm run check:web` all green.
- [ ] Commit `feat(sync): tier-1 pull replaces reference seeding; M3b coverage floor`.

## Follow-ups (recorded, not this plan)

- **M4:** submit UI signature pre-check (>1 MB → 22023); rotation/sweep cadence tuning; amendment UX consuming pulled `amendment_number`s; submit/lock enqueue clientId scheme (MUST be decided — clientId = reportId collides with a queued create_report PK; `OR IGNORE` would silently drop the submit).
- **M5:** photo kinds + outbox; photo file/thumb download-cache (incl. tombstone file cleanup; reparent's `storage_path` local-row rewrite obligation).
- **M4+:** pull-cycle telemetry (per-feed durations/counts); a quarantine/alert surface for persistently hard-skipped rows (M3b holds the cursor and records the error — visible via lastError — but no dedicated UI).

## Verification (plan-level)

Docs-only on approval: prettier check on this file; structural self-check (every interface consumed by Task N is produced by a Task ≤ N or verified in Design references; dirty-shield tests present for every applier; cursor hard-skip hold-back test present; Tier-1 empty-members floor test present; sweep gating tests present; no `select('*')` anywhere in the plan's column manifests).
