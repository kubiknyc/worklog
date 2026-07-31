# M3b — Sync Engine Pull Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use `- [ ]` checkboxes.

**Goal:** The sync engine pulls server truth into the SQLite mirror — Tier-1 reference snapshots, Tier-2 per-project keyset feeds with ride-alongs, dirty-shielded appliers, membership/id reconcile sweeps — and publishes a live `completedPulls` that screens consume.

**Architecture:** Pure policy (`pullCore.ts` planner, `conflict.resolveReport`, `paginate` 3-col keyset) + native IO (`pullTables.native.ts` appliers, `pullSweep.native.ts` sweeps, `pull.native.ts` orchestrator) injected into the engine as one `Puller` seam, mirroring the push path's DI style. Pull runs as a phase inside `run()`'s cycle loop — after each drain settles, before the outer `while (dirty)` re-check — and `runOnce()` stays byte-identical.

**Tech stack:** Expo/RN (Hermes), TypeScript strict, supabase-js v2 (PostgREST reads), expo-sqlite via the `Db` seam, Jest (jest-expo).

**Scope cuts (deliberate, recorded):**

- Photo FILE/thumbnail download+cache, outbox upload UX, tombstone-driven cached-file cleanup → **M5**. M3b pulls photo ROWS only (meta + tombstones); `deleted_at` non-null hard-DELETEs the local row and nothing else (no cached files exist before M5).
- Rotation/sweep cadence tuning beyond the defaults here, Tier-1 throttling, realtime channels, per-feed telemetry → **M4+**.
- Web (`supabaseRepo.ts`) unchanged except the additive `setActiveProject` no-op — pull is native-only; web stays live-query.
- `didFallBackToOnlineOnly` surface is banner copy only — no new screens.
- Stale clean local rows in a project whose server-side report set is legitimately EMPTY are not swept until the server set becomes non-empty (deliberate residue of the sweep floor below; self-heals on the first server report).

## Global Constraints

- `npm run verify` green before claiming done; `npm run check:web` green.
- `src/sync/` pure and IO-free except `*.native.ts` and the sanctioned stateful `statusHub.ts`/`engineCore.ts` closures. Timers only in the native shell.
- **Never create `foo.ts` beside `foo.native.ts`** (tsconfig `moduleSuffixes` + jest-expo haste resolve bare specifiers to `.native` everywhere).
- New native-only imports go in `*.native.ts(x)` AND `NATIVE_ONLY_MODULES` (`src/platformSplit.test.ts`). M3b adds NO new native dependency — the check is that nothing new leaks into the web graph.
- Coverage pins never lowered. Existing: mutationQueue 100/100/100/100; conflict, statusHub, cursors, engineCore, rpcMap 95/100/95/95; paginate 88/100/95/95; db/schema 90/100/90/90. Task 12 ADDS `src/sync/pullCore.ts` at 95/100/95/95. The doc-05 "M3 ladder" GLOBAL raise (65/55/68/65) is NOT taken in M3b: `collectCoverageFrom` excludes every `*.native.ts` module, so all four new native pull modules sit outside the global denominator and `pullCore.ts` leaves the pool via its own pin — M3b's code cannot carry the raise (31 of 71 pool files currently lack sibling tests). The raise is recorded as a dedicated test-backfill follow-up instead (deliberate deviation from doc 05; Task 12 records it).
- Report tables are SELECT-only to clients — the pull path performs ONLY local SQLite writes; every server write stays in the five `SECURITY DEFINER` RPCs.
- **Dirty shield (invariant 6, doc 06 §B) — ABSOLUTE, three explicit gates, applied verbatim by the tasks:** (1) a pulled ROW never overwrites a local row whose OWN `_dirty = 1` (photos: or `_pending = 1`) — NO LWW on dirty rows; an offline device's local `updated_at` is meaningless, and doc 06 §B's reconcile column says a dirty row "is never replaced by a pull". The ONE narrow exception: `daily_reports.status` is server-adopted even on a dirty row (`resolveReport`, Task 1 — lifecycle is RPC-governed). Clean rows (`_dirty = 0`) always adopt the server row verbatim — no timestamp comparison on the pull path at all. This SUPERSEDES doc 02 invariant 8's "LWW by server updated_at" wording for M3b; Task 12 records the supersession in doc 06 §C. (2) EXPLODED CHILDREN of a section follow their parent section row's verdict (children have no `_dirty`; schema.ts:196 rationale). (3) `report_amendment_changes` follow their parent amendment's `_dirty`.
- **`profiles` pull MUST enumerate columns explicitly** — migration 20260707000001 revoked `expo_push_token` from the SELECT grant; `select('*')` 403s at runtime and schema-parity CANNOT catch it (grants are invisible to column parity). Local mirror's `expo_push_token` stays NULL forever.
- **Cursor rule:** a feed's cursor advances ONLY when the applier reports `hardSkipped === 0 && heldBack === 0`; it then folds `nextCursor(cursor, cursorKeys)` over committed + plain-shielded rows. `heldBack` counts SHIELDED TOMBSTONES (photo row with non-null `deleted_at` skipped for `_dirty`/`_pending`): a deleted server row can never re-bump `updated_at`, so a max-fold that merely omitted its timestamp would still advance past it on any later-timestamped row in the batch — therefore ANY held-back row FREEZES the whole feed's cursor this run (same rule as hard-skips), and the frozen cursor re-delivers the tombstone every pull until the shield lifts. Plain shield-passes ARE credited (the queued mutation re-asserts local state and re-bumps server `updated_at`; recorded M3a consequence). Hard-skips (unparseable payload, unknown section kind, malformed row) freeze the cursor identically. `nextCursor` returns `string | null` — when it returns null (nothing creditable over a null cursor), SKIP the `cursors.set` write entirely (`CursorStore.set` takes a non-null string). Cursors are written only after the applier transaction commits, never on fetch success.
- **Deletion floors:** every deletion path is gated on provably-complete server reads (`selectAllById`/`selectAllKeyset*` throw on any page error — a short read never evicts) AND a NON-EMPTY sanity floor: a complete-but-empty read of a set that is non-empty locally is treated as FAILURE, never truth (grant/RLS/JWT regressions return 200 + `[]` — the profiles-grant failure class). Concretely: (a) Tier-1 replace refuses when `projects`, `project_members`, or `profiles` returns 0 rows while its local table is non-empty (`report_member_prefs` is exempt — an empty prefs table is legitimate); (b) membership eviction additionally refuses when `afterProjectIds` is empty while `beforeProjectIds` was not; (c) an id-sweep refuses when `serverReportIds` is empty while the project has ≥1 clean local report (photos likewise) — the legitimate-zero case defers to the Scope cuts residue note.
- No `console.log`; use `src/lib/observability*` (precedent: `store.native.ts` already imports it — sanctioned for `.native` sync modules). Conventional commits; no attribution.
- OTA rule: no queued-mutation payload shape changes; no SQLite schema change at all in M3b (`sync_cursors`/`sync_meta` already exist).
- `db.tx` is zero-arg; nested `tx` deadlocks. One transaction per APPLIER call. `deleteLocalReport` opens its OWN tx (store.native.ts:281) — sweep loops therefore run WITHOUT an outer transaction (Task 8).

## Design references (read before each task)

`docs/architecture/06-sync-mappings.md` §B (authoritative pull table: scopes, keysets, ride-alongs, tombstones, reconcile column — NOTE: `project_members` is a "snapshot by composite key", NOT by id), `02-modules-navigation-sync.md` §C (two tiers, rotation seam), `04-data-model.md` §D (server pull indexes: `daily_reports (updated_at, id)`, `report_sections (updated_at, report_id, section)`, `report_photos (updated_at, id)`, `report_amendments (created_at, id)`). Existing seams: `src/sync/cursors.ts` (`SCOPES` — the ONLY source of scope strings; `OVERLAP_MS = 10_000`; `overlapFloor` — `overlapFloor(null)` returns null, so a first pull has NO `.gte` floor and reads full history; `nextCursor(current, [])` returns `current`; `nextCursor` returns `string | null`), `src/sync/paginate.ts` (`selectAllById` — REQUIRES an `id` column; `selectAllKeyset`; `KeysetPageQuery`/`IdPageQuery` interfaces; `CompoundKey` — field names are `{primary, tiebreak}`; `keysetAfter`, `quoteOrValue`, `PAGE_SIZE = 1000`, throw-on-page-error; :113 names "(project_id, user_id) for a table whose primary key is composite" as the composite-key use), `src/sync/conflict.ts` (`isServerNewer`/`mergeItem`/`resolveItem` exist for the PUSH-era generic contract and stay untouched; the pull path does NOT use them — see the dirty-shield gate), `src/db/schema.ts` (`DOMAIN_COLUMNS` — the export the column manifests derive from; `report_photos` HAS `project_id` locally AND server-side — :109/:248/:260 + serverColumns.generated.json), `src/sync/store.native.ts` (`createCursorStore` — exists, currently uninstantiated; `CursorStore.set(scope: string, value: string)` — non-null; `clearDirty`; `deleteLocalReport` — opens its own tx; NOTE `REPORT_CHILD_TABLES` is module-PRIVATE, not importable — child-table cleanup goes through `deleteLocalReport`, never a re-declared table list), `src/data/sqliteRepo.native.ts` (`explode()` closure at ~:136; coercers `asRecord`/`str`/`num`/`boolInt`/`rowId` typed over `Json` today — Task 4 widens to `unknown`), `src/data/platformRepo.native.ts` (`seedReferenceMirror` :108-164 — retired in Task 12; `createPlatformRepository` :166-182), `src/sync/engineCore.ts` (EngineDeps, `run()` cycle loop at ~:239-257, publishes with hardcoded `completedPulls: 0` at ~:117/~:235, never-rejects contract; `discardParked`'s cascade-failure path also fires `onIncident('evicted', …)` at ~:307), `src/sync/engine.native.ts` (dep wiring, single documented cast site; its `onIncident` is currently module-level WITHOUT `db` in scope — Task 10 moves it inside `createSyncEngine`), `src/data/RepositoryProvider.tsx` (`didFallBackToOnlineOnly()` :59-69, fallback catch :121-137, `syncActions` memo :153-159 — deps are `[]` today; the provider mounts at the app root and runs for `userId === null` too), `src/auth/AuthProvider.tsx` (`useAuth().userId: string | null`), `src/project/ActiveProjectProvider.tsx` (`setActiveProject` :78 — the active-project seam), `src/lib/observabilityTypes.ts` (`SyncIncidentDetail.kind` is ALREADY `string` — no type change needed to pass `'membership_sweep'`; `attempts` required), `src/sync/types.ts` (payload shapes: ONLY `create_report` and `add_photo` carry `projectId`; every report-scoped kind carries `reportId`; `SectionKind` union — the `parseSectionKind` source of truth). Backend obligations satisfied: `worklog_apply_section` bumps `daily_reports.updated_at` (20260729000001); `create_report` ambiguity fixed (20260729000002). `report_photos` touch-trigger propagates meta/tombstones (existing).

---

### Task 1: `resolveReport` — status is server-governed; content shielded when dirty

**Files:** Modify `src/sync/conflict.ts`, `src/sync/conflict.test.ts`.

**Produces (consumed by Task 6):**

```ts
export interface ReportLike {
  readonly status: string;
}
export interface ResolvedReport<T extends ReportLike> {
  readonly item: T;
  readonly dirty: 0 | 1;
}
export function resolveReport<T extends ReportLike>(
  local: T | null,
  server: T,
  localDirty: boolean,
): ResolvedReport<T>;
```

Pull-path semantics (the ABSOLUTE dirty shield — deliberately NOT the push-era `resolveItem` LWW; existing `isServerNewer`/`mergeItem`/`resolveItem` stay byte-identical for their existing callers): `local === null` OR `localDirty === false` → `{item: server, dirty: 0}` (clean rows adopt the server verbatim; no timestamp comparison — an offline device's local `updated_at` is meaningless). `localDirty === true` → `{item: {...local, status: server.status}, dirty: 1}` — content shielded, `status` server-adopted (lifecycle is RPC-governed; doc 02 invariant 8's status rule survives even though its LWW wording is superseded). NOTE: the existing `ResolvedItem<T extends MergeableItem>` CANNOT be reused — its constraint requires `updated_at`, which `ReportLike` deliberately lacks; `ResolvedReport` is the new, unconstrained-by-`updated_at` result type, and `ResolvedItem` stays untouched.

- [ ] Failing tests: null local → server, dirty 0; clean local (any timestamps) → server verbatim, dirty 0; dirty local → local content + `status: server.status`, dirty 1 — asserted with server BOTH newer and older than local (timestamps must not matter — the discriminating test the shield demands); differing statuses asserted on both branches; existing `resolveItem`/`mergeItem` tests untouched and green.
- [ ] `npx jest src/sync/conflict.test.ts` → RED; implement; → GREEN (conflict.ts pin 95/100/95/95 holds).
- [ ] Commit `feat(sync): resolveReport — absolute dirty shield with server-governed status`.

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
  'id, full_name, email, phone, company, trade, avatar_url, created_at' as const; // the ONLY hand-pinned manifest: NO expo_push_token — grant revoked (20260707000001); NEVER '*'
// Derived manifests — DOMAIN_COLUMNS[table].join(', ') from src/db/schema.ts, so a new
// server column flows into pulls via the parity snapshot automatically (only profiles
// has a documented grant reason to be hand-pinned):
export const MEMBER_PULL_COLUMNS: string; // DOMAIN_COLUMNS.project_members
export const PREFS_PULL_COLUMNS: string; // DOMAIN_COLUMNS.report_member_prefs
export const PROJECT_PULL_COLUMNS: string; // DOMAIN_COLUMNS.projects
export const REPORT_PULL_COLUMNS: string; // DOMAIN_COLUMNS.daily_reports
export const WEATHER_PULL_COLUMNS: string; // DOMAIN_COLUMNS.report_weather
export const SECTION_PULL_COLUMNS: string; // DOMAIN_COLUMNS.report_sections (includes updated_by — full parity; no grant trap here)
export const PHOTO_PULL_COLUMNS: string; // DOMAIN_COLUMNS.report_photos (includes project_id — the feed scopes on it directly)
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
// The empty-AFTER floor is the orchestrator's pre-check (Task 9), not here.

export interface PullOutcome {
  readonly ok: boolean; // every attempted phase succeeded (Tier-1, feeds — incl. zero hard-skipped/
  //   held-back rows — sweeps, rotation write-back). completedPulls bumps IFF ok (Task 10) —
  //   engineApi.ts's documented contract is "bumped after every successful pull", which also
  //   covers Tier-1 replaces and sweep deletions that per-feed row counts would miss.
  readonly offline: boolean; // first failure classified offline (isLikelyOffline) — engine publishes online:false, lastError:null
  readonly error: string | null; // first non-offline feed error message; null when ok or offline-only
}
```

Pure module: imports only from `../db/schema` and `../lib/errors` (`isLikelyOffline` is pure).

- [ ] Failing tests: PROFILE_PULL_COLUMNS excludes `expo_push_token` and never contains `*`; SECTION_PULL_COLUMNS contains `updated_by` and PHOTO_PULL_COLUMNS contains `project_id` (derivation proofs); `chunk` — empty/exact/remainder; rotation — interval gate (elapsed/not/lastAt null), active excluded, sorted-order wraparound, single-member → null pick, unparseable lastAt treated as null; sweepProjects union incl. dedupe when rotationPick is also sweep-due, non-member sweep-due dropped; diffMembership basic/empty-before/no-change; PullPlan never sweeps a non-member.
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
export { asRecord, str, num, boolInt, rowId };
// Moved coercers, re-imported by sqliteRepo — no duplication. Their parameter types WIDEN
// from `Json` to `unknown` in the move (behavior-identical: every existing call site passes
// a Json, and Json ⊆ unknown, so sqliteRepo compiles and its tests stay byte-green; the
// widening is what lets Task 6 feed raw PostgREST `Record<string, unknown>` values through).
export function parseSectionKind(value: unknown): SectionKind | null; // narrows a server-provided
// section string against the SectionKind union (source of truth: src/sync/types.ts) MINUS
// 'weather': weather lives in report_weather locally, never report_sections — a server
// report_sections row claiming section='weather' would write into the wrong table, so it
// returns null (hard-skip) for 'weather' too, and the server invariant (worklog_apply_section
// routes weather away from report_sections) is recorded in the function comment.
```

- [ ] Extract; sqliteRepo delegates. `npx jest src/data/sqliteRepo.native.test.ts` green with zero test edits.
- [ ] New direct tests (fake-Db idiom): one relational section explodes rows + recompute; weather/notes no-op; delete-before-insert order; `parseSectionKind` accepts every canonical kind, rejects unknown/non-string; coercers accept `unknown` inputs (one case each).
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

ONE transaction: capture `beforeProjectIds` (`SELECT project_id FROM project_members WHERE user_id = ?`), then full-replace all four tables (`DELETE FROM x` + INSERT per row — doc 06 §B "snapshot, full replace"; `report_member_prefs` rides in the same tx as `project_members`). Column writes use the snapshot rows' keys filtered to `DOMAIN_COLUMNS[table]` (unknown keys dropped, missing → NULL; `profiles.expo_push_token` never present → stays NULL). No `_dirty` columns exist on Tier-1 tables — no shield needed. This applier is a MECHANICAL executor: the non-empty floors (Global Constraints "Deletion floors" (a)) live in the orchestrator (Task 9), which must never call this with a suspicious snapshot. Returns before/after for the Task 8 sweep.

- [ ] Failing tests (fake-Db): full replace removes stale local rows; prefs replaced in same tx as members; before/after diff correct incl. first-sync empty-before; unknown server key dropped; missing column → NULL.
- [ ] RED → GREEN → commit `feat(sync): tier-1 reference snapshot applier with membership diff`.

### Task 6: Reports + sections appliers (dirty shield + ride-alongs)

**Files:** Modify `src/sync/pullTables.native.ts` + test.

**Produces (consumed by Task 9):**

```ts
export interface ApplyResult {
  readonly applied: number; // rows committed by this applier call
  readonly cursorKeys: readonly string[]; // cursor timestamps of committed + plain dirty-SHIELDED rows
  readonly hardSkipped: number; // unparseable payload / unknown section / malformed row (no
  //   string id or updated_at)
  readonly heldBack: number; // shielded TOMBSTONES (photos only; 0 elsewhere). The cursor
  //   advances ONLY when hardSkipped === 0 && heldBack === 0 — a max-fold that merely
  //   omitted a held-back timestamp would still pass it on any later committed row, so any
  //   held-back row FREEZES the feed cursor this run (Global Constraints cursor rule).
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
  readonly updated_at: unknown; // non-string ⇒ hardSkipped (same malformed-row rule as reports/photos)
}
export async function applySections(db: Db, rows: readonly PulledSection[]): Promise<ApplyResult>;
```

`applyReports`, one tx per CALL (not per row): per bundle, coerce the raw record via Task 4's widened coercers per `DOMAIN_COLUMNS.daily_reports` (a row missing a string `id`, `status`, or `updated_at` ⇒ hardSkipped); read local row + `_dirty`; `resolveReport(local, server, dirty)` — clean → server verbatim (`_dirty = 0`); dirty → local content + server `status` (`_dirty` stays 1), upsert either way. Weather ride-along in the SAME tx, gated by the WEATHER row's OWN `_dirty` (gate 1): local `report_weather._dirty = 0` → `INSERT ... ON CONFLICT (report_id) DO UPDATE` over `WEATHER_PULL_COLUMNS`, `_dirty` untouched; `_dirty = 1` → weather untouched while the parent report still applies. `applySections`: per row, `parseSectionKind(row.section)` — null ⇒ hardSkipped; non-string `updated_at` ⇒ hardSkipped; parse payload — unparseable ⇒ hardSkipped; read local `(report_id, section)` + `_dirty`; `_dirty = 1` → touch NOTHING, timestamp into `cursorKeys` (shield-pass; children shielded by the parent's verdict — gate 2); `_dirty = 0` → upsert section row (`_dirty = 0`) AND `explodeSection(db, reportId, kind, parsedPayload)` in the same tx.

- [ ] Failing tests: dirty report keeps local content but ADOPTS server status — with server timestamp BOTH newer and older than local (the discriminating pair; timestamps must not matter); clean report replaced verbatim regardless of timestamps; weather rides same tx on clean weather; dirty weather row untouched while the parent report still applies; dirty section + its children untouched AND its timestamp still in cursorKeys; clean section upsert + re-explode in same tx (fake-Db records tx boundaries); unparseable payload ⇒ hardSkipped > 0, other rows still commit; unknown section kind ⇒ hardSkipped; non-string section `updated_at` ⇒ hardSkipped; malformed report row (no id/status) ⇒ hardSkipped.
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

`applyPhotos`: per row — malformed (no string `id`/`updated_at`) ⇒ hardSkipped. Local `_dirty = 1` OR `_pending = 1`: if the server row is a TOMBSTONE (non-null `deleted_at`) → untouched AND counted into `heldBack` (which FREEZES the feed cursor this run per the Global Constraints cursor rule; the frozen cursor re-delivers the tombstone every pull until the pending push resolves and the shield lifts); otherwise → untouched, timestamp into `cursorKeys` (plain shield-pass — still credited). Clean rows: non-null `deleted_at` → hard `DELETE` the local row (row only — cached files are M5), counts as committed; else upsert over `PHOTO_PULL_COLUMNS`; NEVER write `_pending`/`_dirty`/`local_uri`/`local_thumb_uri` (the SET list omits them; the INSERT branch sets `_pending = 0, _dirty = 0` for a brand-new server row). `applyAmendments` (cursor timestamps from `created_at` — append-only feed): per bundle — malformed ⇒ hardSkipped; local `_dirty = 1` → untouched (row + changes — gate 3), `created_at` into `cursorKeys`. Else upsert amendment over `AMENDMENT_PULL_COLUMNS` (overwrites the local NULL `amendment_number` with the server's assigned integer — the backfill) and full-replace its `report_amendment_changes` (`DELETE WHERE amendment_id = ?` + INSERT) in the same tx.

- [ ] Failing tests: tombstone hard-deletes clean row; tombstone + `_pending = 1` → row survives AND `heldBack > 0` (feed cursor frozen); non-tombstone + `_dirty = 1` → row survives, `heldBack === 0`, timestamp IS in cursorKeys (plain shield still credits); upsert leaves `_pending`/`_dirty`/`local_uri`/`local_thumb_uri` untouched on existing row; new server photo row inserts with `_pending = 0`; dirty amendment fully shielded (row + changes) with `created_at` in cursorKeys; clean amendment upsert backfills NULL `amendment_number` + replaces changes same tx; malformed row ⇒ hardSkipped.
- [ ] RED → GREEN → commit `feat(sync): photo and amendment pull appliers — tombstones and number backfill`.

### Task 8: Reconcile sweeps — `src/sync/pullSweep.native.ts`

**Files:** Create `src/sync/pullSweep.native.ts`, `src/sync/pullSweep.native.test.ts`.

**Produces (consumed by Task 9):**

```ts
export type SweepIncident = (projectId: string) => void; // Task 9 maps → reportSyncIncident
export async function evictProjects(
  db: Db,
  projectIds: readonly string[],
  onEvicted: SweepIncident, // fired ONCE per evicted PROJECT (not per report)
): Promise<void>;
export async function sweepProject(
  db: Db,
  projectId: string,
  serverReportIds: readonly string[], // COMPLETE + floor-checked — caller guarantees (Task 9)
  serverPhotoIds: readonly string[],
): Promise<void>;
```

**Transaction posture (both functions): NO outer transaction.** `deleteLocalReport` opens its OWN tx per call (store.native.ts:281); wrapping the loop would nest and deadlock (Global Constraints). Queue-row, cursor, and meta deletes are plain `run` statements. Eviction is idempotent and resumable — a crash mid-eviction leaves a partially-evicted project that the next eviction call (same diff, membership still gone) finishes; re-eviction of missing rows no-ops.

`evictProjects` (membership loss — the orchestrator has ALREADY applied the throw-on-partial gate and BOTH floors before calling; this module is a mechanical executor): per project — enumerate `SELECT id FROM daily_reports WHERE project_id = ?`; for each report: delete queued mutations whose payload `reportId` matches (raw SQL over `sync_mutations` payload, the reparent.native.ts precedent — INCLUDING parked `create_report` rows; approved decision: membership is gone, every future push 403-evicts anyway), then `deleteLocalReport(db, reportId)`; after the project's subtree is gone, fire `onEvicted(projectId)` ONCE for the project. Then delete the project's four cursor scopes from `sync_cursors` — the scope strings come from `SCOPES` (`cursors.ts`): `SCOPES.reports(id)`, `SCOPES.sections(id)`, `SCOPES.photos(id)`, `SCOPES.amendments(id)` — NEVER hand-built literals (the `_v1` suffix lives in SCOPES alone) — and its `pull_sweep_last:`/`pull_sweep_due:` keys from `sync_meta`. `sweepProject` (id-sweep, doc 06 §B — `daily_reports` and `report_photos` only; sections/amendments cascade with the parent): candidates `SELECT id FROM daily_reports WHERE project_id = ? AND _dirty = 0` minus `serverReportIds` → `deleteLocalReport` each; photos `SELECT id FROM report_photos WHERE project_id = ? AND _dirty = 0 AND _pending = 0` (the table carries `project_id` directly) minus `serverPhotoIds` → plain `DELETE`. A `_dirty`/`_pending` row is structurally invisible to the id-sweep (a parked-create report keeps `_dirty = 1`, so it survives id-sweeps by construction; only membership eviction removes it, deliberately).

- [ ] Failing tests: eviction removes subtree + queue rows + cursors (SCOPES-derived keys incl. the `_v1` photo scope) + meta, fires ONE incident per evicted project (multi-report project → exactly one call), other projects untouched; parked create_report queue row evicted (project incident still fires); id-sweep deletes server-absent clean report via cascade, keeps `_dirty = 1` report, keeps `_pending = 1` photo; sweep of unknown project no-ops; no outer tx opened (fake-Db asserts `deleteLocalReport`'s own tx is the only tx boundary).
- [ ] RED → GREEN → commit `feat(sync): membership eviction and id-reconcile sweeps`.

### Task 9: Pull orchestrator — `src/sync/pull.native.ts`

**Files:** Create `src/sync/pull.native.ts`, `src/sync/pull.native.test.ts`.

**Produces (consumed by Task 10):**

```ts
export interface PullQueryBuilder<T> extends KeysetPageQuery<T>, IdPageQuery<T> {
  // IdPageQuery contributes `gt` — selectAllById requires it (Tier-1 + sweep id-fetches).
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
3. **Tier-1 floors (Global Constraints "Deletion floors" (a)):** for EACH of `projects`, `project_members`, `profiles`: fetched 0 rows while the corresponding local table is non-empty (`SELECT COUNT(*)`) → treat Tier 1 as FAILED (`error: 'tier1 <table> empty — refusing replace'`), skip the apply, the eviction, and ALL Tier-2 (`report_member_prefs` exempt — legitimately empty). Floors pass → `applyReferenceSnapshot` → `diffMembership` → evicted non-empty AND floor (b) passes (`afterProjectIds` non-empty OR `beforeProjectIds` was empty) → `evictProjects(db, evicted, onEvicted)` where `onEvicted = (projectId) => reportSyncIncident('evicted', { kind: 'membership_sweep', attempts: 0 })` — ONE incident per evicted PROJECT, a DIRECT `src/lib/observability.native` call (store.native.ts precedent); it does NOT pass through `EngineDeps.onIncident`, so Task 10's shell logic never sees it (`SyncIncidentDetail.kind` is already `string` — no type change; `projectId` is not part of the detail type — do not add it).
4. `planPullRun` with the post-replace member set.
5. **Tier 2 per planned project** (active first, then rotationPick), feeds in order reports → sections → photos → amendments:
   - Scoping: `daily_reports` and `report_photos` BOTH carry `project_id` (schema.ts:109 + serverColumns snapshot) → plain `.eq('project_id', projectId)`. `report_sections` and `report_amendments` carry only `report_id` → PostgREST embedded inner-join filter `.select(FEED_COLUMNS + ', daily_reports!inner(project_id)').eq('daily_reports.project_id', projectId)`, with the embedded `daily_reports` key STRIPPED from each row before the applier sees it. (RLS alone would cross-contaminate per-project cursors; unbounded `.in()` id-lists would exceed URL limits — this avoids both.)
   - Fetch via `selectAllKeyset` (reports `(updated_at, id)`, photos `(updated_at, id)`, amendments `(created_at, id)`) / `selectAllKeyset3` (sections `(updated_at, report_id, section)`) with `overlapFloor(cursor)` (null cursor → null floor → full-history first pull — by design).
   - Ride-along lookups keep `.in()` but CHUNKED via `chunk(ids, IN_CHUNK_SIZE)` and SKIPPED when the id set is empty: reports feed fetches `report_weather` for the pulled report ids (`WEATHER_PULL_COLUMNS`) to build `PulledReportBundle`s; amendments feed fetches `report_amendment_changes` per pulled amendment ids (`AMENDMENT_CHANGES_PULL_COLUMNS`). A chunk failure fails that FEED (no partial apply, cursor untouched).
   - Apply via Tasks 5-7 appliers. Cursor advance per the Global Constraints cursor rule: `result.hardSkipped === 0 && result.heldBack === 0` → compute `next = nextCursor(cursor, result.cursorKeys)`; `next !== null` → `cursors.set(scope, next)`; `next === null` → skip the write (`CursorStore.set` is non-null; `nextCursor(cursor, [])` returns `cursor`, which is only null on a first pull with nothing creditable). `hardSkipped > 0` OR `heldBack > 0` → cursor UNTOUCHED, feed error recorded, `ok: false`. Applier throw → cursor untouched, feed error recorded. Scope strings ALWAYS via `SCOPES.x(projectId)` — the same source Task 8's eviction deletes by.
   - Amendments feed note: `report_amendments.created_at` is SERVER-assigned at RPC execution time (`rpcMap` sends no `created_at`), so a locally-pushed amendment's server row always carries a `created_at` newer than any cursor this device holds — the `amendment_number` backfill re-delivery (Task 7) is guaranteed by construction.
6. **Sweeps:** for each `PullPlan.sweepProjects` project: fetch complete id sets — reports via `selectAllById` on `.select('id').eq('project_id', ...)` from `daily_reports`, photos via `selectAllById` on `.select('id').eq('project_id', ...)` from `report_photos`; BOTH complete AND floor (c) passes per set (server set non-empty OR no clean local rows exist for it) → `sweepProject`, stamp `pull_sweep_last:<id>`, delete its `pull_sweep_due:<id>`; a floor refusal records a feed error and leaves the sweep-due flag in place; a throw skips that project's sweep.
7. When `planPullRun` executed (Tier-1 succeeded): write back `pull_rotation_v1 = nextRotationState`. On the Tier-1-failure path nothing after step 3 runs — rotation state untouched. Return `PullOutcome` — `ok: true` IFF every attempted phase succeeded (Tier-1 replace, every feed with zero hardSkipped/heldBack, every sweep, rotation write-back).

- [ ] Failing tests (semantic fakes for client + fake-Db, per paginate.test idiom): members/prefs fetched via selectAllKeyset composite key, NOT selectAllById; Tier-1 empty floor refuses replace + eviction + Tier-2 for EACH of projects/members/profiles (prefs-empty passes); floor (b) skips eviction; cursor NOT advanced when hardSkipped > 0; cursor NOT advanced when heldBack > 0 (tombstone freeze reaches the orchestrator); cursor advanced only post-commit with nextCursor of cursorKeys; null-fold skips the cursors.set write; overlap floor passed to the query (and absent on first pull); photos scoped via plain `.eq('project_id')` (no embed); sections/amendments scoped via `daily_reports!inner` with embed stripped before apply; ride-along `.in()` chunked at IN_CHUNK_SIZE and skipped when empty; offline-classified first failure short-circuits with `offline: true`; sweep floor (c) refusal keeps the sweep-due flag and skips sweepProject; sweep runs when both id-fetches complete + floors pass, stamps + consumes meta keys; rotation state written back only when planPullRun ran; `ok: true` only when every attempted phase succeeded (a single hardSkipped/heldBack feed or floor refusal flips `ok: false` while other feeds still run); never rejects (client throwing everywhere still resolves an outcome); membership incident fired ONCE PER EVICTED PROJECT as `('evicted', {kind: 'membership_sweep', attempts: 0})` via the direct observability import.
- [ ] RED → GREEN → commit `feat(sync): pull orchestrator — cursored feeds, floored eviction, gated sweeps, rotation`.

### Task 10: Engine integration — pull phase, `completedPulls`, shell wiring

**Files:** Modify `src/sync/engineCore.ts` + test, `src/sync/engine.native.ts` + test, `src/data/platformRepo.native.ts` + its tests (signature change), `src/data/platformRepo.web.ts` (same signature change — the param is ignored on web, but the two platform files must stay call-compatible), `src/data/RepositoryProvider.tsx` (pass userId through), `src/sync/statusHub.test.ts` (one passthrough assertion if absent).

**Contract (engineCore):** `EngineDeps` gains `readonly pull?: (input: { sessionUserId: string }) => Promise<PullOutcome>` and `readonly sessionUserId?: string | null`. `run()`'s cycle loop (currently `do { dirty = false; await runOnce(); } while (dirty)`) becomes:

```ts
do {
  do {
    dirty = false;
    await runOnce(); // byte-identical — untouched
  } while (dirty);
  await pullOnce(); // after each settled drain
} while (dirty); // an enqueue DURING pull re-drains (and then re-pulls)
```

Reparent safety needs NO guard inside `pullOnce`: the inner loop can only exit with `dirty === false`, so a reparent abort (which sets `dirty`) is always re-drained BEFORE any pull — a pull can never observe a half-rewritten loser id, and the loser id never exists server-side. (Do NOT add a `dirty` check in `pullOnce` — it would be unreachable dead code.) `pullOnce()` skips (publishing nothing) when: `deps.pull` undefined, `deps.sessionUserId` null/undefined (pull unarmed until a session exists), or the just-published cycle-end state has `online === false` (the drain's offline stop is visible via `getState()` — `runOnce` stays untouched; this is the specified offline-signal source). Otherwise: publish `{...state, syncing: true}`; `await deps.pull({sessionUserId})` inside try/catch (a throw is treated as `{ok: false, offline: false, error: message}` — never-rejects stays absolute); end-publish folds the outcome — `completedPulls` bumps by 1 IFF `outcome.ok` (engineApi.ts's documented contract is "bumped after every successful pull" — `ok` also covers Tier-1 replaces and sweep deletions that per-feed row counts would miss; monotone counter beside `reparentsCount`; replaces BOTH hardcoded `0`s at ~:117/~:235), `outcome.offline` → `online: false, lastError: null` (never-alarm); otherwise `lastError` = the drain's lastError when non-null, else `outcome.error` (push failures always win; a pull failure lands only when the push phase was clean).

**Shell:** `createSyncEngine(db: Db, sessionUserId: string | null): SyncEngineApi` — nullable end-to-end. Its single caller `createPlatformRepository()` (platformRepo.native.ts:166) gains the same nullable param, threaded from `RepositoryProvider`'s `useAuth().userId` (which IS `string | null` — the provider mounts at the app root and runs signed-out too; with null the engine still drains pushes but pull stays unarmed; the provider re-keys on userId change, so sign-in rebuilds the bundle and arms pull — no extra re-arm logic; update `platformRepo`'s tests for the signature). Shell wires `createPuller(supabase as unknown as PullClient, db)` — cast documented at the SAME comment block as the existing rpc cast. **403-evict sweep-due flag:** move the shell's `onIncident` handler INSIDE `createSyncEngine` (it needs `db` in scope; today it is module-level without it). When `EngineDeps.onIncident` fires with first-arg `kind === 'evicted'` AND a `Mutation` is present: resolve the project fire-and-forget — payload carries `projectId` (create_report/add_photo) → use it; otherwise payload's `reportId` → `SELECT project_id FROM daily_reports WHERE id = ?` (try/caught; row may be gone — then skip). Write `sync_meta['pull_sweep_due:<projectId>']` = now. NOTE: engineCore's `discardParked` cascade-failure path also fires `onIncident('evicted', …)` (~:307) — it carries a real Mutation, so it arms a sweep-due flag for that project; that is HARMLESS-BY-DESIGN (the sweep reconciles the half-discarded subtree — document the interaction in the handler comment, do not special-case it). Membership-sweep incidents never pass through this handler (they are direct observability calls in Task 9). **Backoff arm 2 extension:** today the shell's retry ladder arms only when the cycle ends `online: false` with `pending > 0`. A pull failure classified offline can now end a cycle `online: false` with `pending === 0` (nothing queued, pull still starved) — extend arm 2 so that case ALSO arms the ladder while NetInfo still reports connected; otherwise an offline-classified pull failure with an empty queue never retries until the next enqueue or NetInfo flap.

- [ ] Failing engineCore tests: pull runs after clean drain; skipped when offline-stop (cycle-end published online:false) / no dep / null sessionUserId; enqueue-during-pull re-drains then re-pulls; reparent abort re-drains before any pull (assert push call order: create → reparent-abort → re-drain pushes → THEN pull — proving the loop structure, not a guard); `completedPulls` bumps IFF `outcome.ok` (an `ok: false` outcome with feeds partially applied does NOT bump), monotone across cycles; push lastError not masked by pull error; pull offline → `online: false, lastError: null`; pull dep throwing → cycle still publishes end-state (never rejects). ALL existing engineCore tests pass UNMODIFIED (pin holds).
- [ ] Failing shell tests: puller wired; evicted incident with projectId-less payload resolves project via daily_reports lookup and writes sweep-due meta; missing local row → no write, no throw; null sessionUserId still builds a working push-only engine.
- [ ] statusHub passthrough: a mirrored engine publish carrying `completedPulls: 2` reaches subscribers verbatim (add only if this exact assertion is absent).
- [ ] `npm run verify` → commit `feat(sync): engine pull phase — completedPulls live, offline folding, shell wiring`.

### Task 11: UI surface — refetch hook, banner states, active-project bridge

**Files:** Create `src/hooks/useRefreshOnFocusAndSync.ts` + test, `src/hooks/useActiveProjectSync.ts` + test. Modify `src/components/SyncStatusBanner.tsx` + test; `src/data/RepositoryProvider.tsx` — `degraded` exposed as REACT STATE set in the fallback catch (`:121-137`) beside `setResolved(supabaseRepository)`, included in the sync context value AND its memo deps (the current `useMemo(..., [])` at :153-159 would freeze it — extend the deps); `src/data/types.ts` + `sqliteRepo.native.ts` + `supabaseRepo.ts` — additive `setActiveProject(projectId: string): Promise<void>` (native: `INSERT INTO sync_meta(key, value) VALUES ('active_project_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value` then `nudge()`; web: resolved no-op); `app/(tabs)/_layout.tsx` mounts the bridge hook.

**Contract:** `useRefreshOnFocusAndSync(refetch: () => void)` — calls `refetch` on screen focus (`useFocusEffect` from expo-router) and whenever `useSyncStatus().completedPulls` CHANGES (ref-diffed; not on unrelated publishes; not on mount before any bump). `useActiveProjectSync()` — bridge mounted once in `app/(tabs)/_layout.tsx`: effect on `useActiveProject().activeProjectId` (`src/project/ActiveProjectProvider.tsx` — the existing seam; its `setActiveProject` at :78 stays untouched) → non-null → `void repo.setActiveProject(id)` with a `.catch` that swallows (sync bookkeeping must never break navigation). Banner: the existing `SyncBannerState` union gains two values — `'degraded'` and `'offline'` — slotted into the precedence. M3a's engine ALREADY publishes `online` (the drain's offline stop sets it false) — the existing pinned banner fixtures publish `online: true` or omit it entirely; VERIFY which, then EXTEND the pinned precedence test (don't rewrite) so the new `offline` row cannot flip any existing pinned case: **parked > degraded > offline > syncing > countError > lastError > pending > synced** — `degraded` when the provider's context reports fallback (copy: "Offline features unavailable — using online mode"), `offline` when `!online && pending > 0` (copy carries the queued count — the count IS the message, never-alarm; muted styling, not error-colored). Concrete plumbing: `bannerStateOf(s: HubSyncState, degraded = false)` — the OPTIONAL second param keeps every existing pinned call compiling unchanged — and `ConnectedSyncStatusBanner` reads `degraded` from the provider context and passes it down as a prop. `!online && pending === 0` deliberately falls through to `synced` — nothing is queued, so "all saved" is true and alarm-free (never-alarm contract; record the rationale in the component comment). `SyncState.online` finally has its consumer.

- [ ] Failing tests: refetch hook — on completedPulls bump, not on same-value publish, not on mount, plus on focus (mock expo-router); bridge hook — writes on id change, swallows rejection, no write on null; banner precedence table extended with degraded and offline rows in the pinned order; offline-with-zero-pending renders synced (rationale pinned); degraded copy exact and REACTIVE (flips after the provider's catch fires — test via provider state, not the module flag); offline copy carries the count; ThemeProvider-wrapped; `src/maestroSelectors.test.ts` green (no new testIDs expected; if any added, inventory in `.maestro/README.md`).
- [ ] RED → GREEN → `npx jest src/hooks src/components src/maestroSelectors.test.ts` → commit `feat(sync): completedPulls refetch hook, degraded and offline banner states, active-project bridge`.

### Task 12: Retire `seedReferenceMirror`, pin `pullCore`, docs

**Files:** Modify `src/data/platformRepo.native.ts` (delete `seedReferenceMirror` + call site — Tier-1 pull owns the mirror now; the engine's `start()` initial kick performs the first pull, and hydration never awaits it — same non-blocking posture as today), `package.json` (`coverageThreshold`: add `src/sync/pullCore.ts` at `{branches: 95, functions: 100, lines: 95, statements: 95}`; the GLOBAL threshold is NOT touched — see Global Constraints: the doc-05 global raise is deferred to a dedicated M4 test-backfill task, ~31 pool files lack sibling tests), `docs/architecture/06-sync-mappings.md` §C (record: pull follows push's DI style, not doc 05's SyncContext; the ABSOLUTE dirty shield superseding doc 02 invariant 8's LWW wording; sweep semantics as built — triggers, floors, gates, parked-create eviction decision; the Tier-2 scoping choices — photos by own `project_id`, sections/amendments by `daily_reports!inner`; the cursor hard-skip and tombstone-shield freeze rules), `docs/architecture/01-work-plan.md` (tick M3b; record the deferred global-raise follow-up).

- [ ] Delete + wire; full suite; `npm run verify && npm run check:parity && npm run check:web` all green.
- [ ] Commit `feat(sync): tier-1 pull replaces reference seeding; pullCore coverage pin`.

## Follow-ups (recorded, not this plan)

- **M4:** submit UI signature pre-check (>1 MB → 22023); rotation/sweep cadence tuning; amendment UX consuming pulled `amendment_number`s; submit/lock enqueue clientId scheme (MUST be decided — clientId = reportId collides with a queued create_report PK; `OR IGNORE` would silently drop the submit); **global coverage raise to 65/55/68/65 as a dedicated test-backfill task** — ~31 of 71 files in the global coverage pool lack sibling tests, so the raise needs its own backfill effort, not a rider on M3b (whose native modules sit outside the pool entirely).
- **M5:** photo kinds + outbox; photo file/thumb download-cache (incl. tombstone file cleanup; reparent's `storage_path` local-row rewrite obligation).
- **M4+:** pull-cycle telemetry (per-feed durations/counts); a quarantine/alert surface for persistently hard-skipped rows (M3b holds the cursor and records the error — visible via lastError — but no dedicated UI); revisit the legitimate-zero-reports sweep residue if it ever matters in practice.

## Verification (plan-level)

Docs-only on approval: prettier check on this file; structural self-check (every interface consumed by Task N is produced by a Task ≤ N or verified in Design references; dirty-shield tests present for every applier incl. the timestamp-must-not-matter discriminating pair; cursor hard-skip AND tombstone hold-back tests present; all three deletion floors tested; sweep gating tests present; no `select('*')` anywhere in the plan's column manifests).
