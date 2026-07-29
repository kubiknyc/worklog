# M3a — Sync Engine Push Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use `- [ ]` checkboxes.

**Goal:** Queued JSON mutations drain to Supabase through the five lifecycle RPCs, the sync engine publishes real `SyncState` through `statusHub` (retiring the M2 counter in practice), and parked mutations get a tappable retry/discard surface.

**Architecture:** Pure engine core (`src/sync/engineCore.ts`) with injected store/pusher/publish seams; thin native shell (`src/sync/engine.native.ts`) binds NetInfo/AppState/SQLite/Supabase and owns all timers. Pure RPC mapping (`src/sync/rpcMap.ts`); IO only in `push.native.ts` + `reparent.native.ts`. `statusHub` gains `attachEngine`; `setCounter` survives solely for the online-only fallback.

**Tech stack:** Expo/RN (Hermes), TypeScript strict, supabase-js v2 (PostgREST), expo-sqlite via the `Db` seam, `@react-native-community/netinfo` (new dep), Jest (jest-expo).

**Scope cuts (deliberate, recorded):**
- Pull path (Tier 1/2 cursors, reconcile sweeps, `completedPulls` bumps, amendment-number backfill, `didFallBackToOnlineOnly` surface) → **M3b**. `completedPulls` stays `0`.
- Photo kinds (`add_photo`, `update_photo_meta`, `remove_photo`) → **M5**. Guarantee: no repository path enqueues photo kinds before M5 (`orderForDrain` only tail-orders `add_photo`); `rpcCallOf` throws on them, and that throw would classify retryable — another reason it must stay unreachable.
- `amend_report`'s returned `amendment_number` and `update_section`'s returned timestamp are ignored (M3b pull backfills).
- Evict-class (403/42501): park + incident, **no local row deletion** — M3b's membership sweep is the authoritative evictor.
- `SyncState.online` has no banner consumer in M3a (deliberate; M3b wires it).

## Global Constraints

- `npm run verify` green before claiming done; `npm run check:web` green.
- `src/sync/` pure and IO-free except `*.native.ts` and the sanctioned `statusHub.ts`. Timers only in the native shell.
- **Never create `foo.ts` beside `foo.native.ts`** — tsconfig `moduleSuffixes` + jest-expo haste resolve the bare specifier to the `.native` file everywhere (this is why the pure modules are `rpcMap.ts`/`engineCore.ts`, matching the `engineApi.ts`/`store.native.ts` precedent).
- New native-only imports go in `*.native.ts(x)` AND `NATIVE_ONLY_MODULES` (`src/platformSplit.test.ts:12`).
- E2E-driven UI needs `testID`s per `.maestro/README.md`; `src/maestroSelectors.test.ts` stays green (runtime-built ids → `DYNAMIC_TESTIDS`).
- Coverage pins never lowered; `mutationQueue.ts` stays 100% (all its changes here are branch-free additions); new pins for `rpcMap.ts` and `engineCore.ts` (Task 9).
- Report tables are SELECT-only to clients — every server write goes through the five `SECURITY DEFINER` RPCs.
- No `console.log`; use `src/lib/observability*`.
- Conventional commits; no attribution.
- A stale worktree at `.claude/worktrees/m3-sync-engine/` holds abandoned drafts — ignore/remove; never resume it.

## Design references (read before each task)

`docs/architecture/06-sync-mappings.md` (kind→RPC map; flattened `RowTarget` blessed); `src/sync/types.ts`, `mutationQueue.ts`, `engineApi.ts`, `statusHub.ts`, `store.native.ts` (+ its fake-Db test harness); `src/db/rows.native.ts` (`all`/`first`/`run`, zero-arg `tx` — nested `tx` deadlocks); backend RPC signatures (20260717000007_worklog_rpcs.sql): `create_report(p_project_id, p_report_date, p_client_id) → setof (report_id, was_created)`; `update_section(p_report_id, p_section, p_payload jsonb, p_is_complete bool default false) → timestamptz`; `submit_report(p_report_id, p_signer_title, p_signature_png bytea) → void` (no signer-name param — server derives from `auth.uid()`; replay on submitted is an idempotent no-op); `lock_report(p_report_id) → void` (idempotent replay); `amend_report(p_report_id, p_amendment_client_id, p_reason, p_changes jsonb, p_signer_title default null, p_signature_png default null) → integer` (`p_changes` must be a non-empty OBJECT `{section: {"payload": {...}}}`). Errcode contract: 42501 unauthorized · P0002 not found · P0001 illegal lifecycle · 22023 invalid arg · 40001 create race. The weather branch of `worklog_apply_section` reads `payload->>'condition'` and `payload->>'temp_f'` — snake_case, on BOTH the update_section and amend_report paths.

---

### Task 1: Pure RPC mapping — `src/sync/rpcMap.ts` (+ web-path weather fix)

**Files:** Create `src/sync/rpcMap.ts`, `src/sync/rpcMap.test.ts`. Modify `src/data/supabaseRepo.ts` (route `updateSection` content through the shared helper). Create `src/data/supabaseRepo.test.ts`.

**Produces (consumed by Tasks 4, and supabaseRepo):**
```ts
export interface RpcCall { readonly fn: 'create_report'|'update_section'|'submit_report'|'lock_report'|'amend_report'; readonly args: Readonly<Record<string, Json>> }
export type RpcName = RpcCall['fn'];
export function base64ToByteaHex(b64: string): string;            // backslash-x + hex via array+join; in JS source the prefix literal is '\\x' (a bare '\x' is invalid) — pin the escaping in the test. atob verified: Hermes RN 0.81 / Node≥16 / DOM lib types
export function sectionWirePayload(section: SectionKind, content: Json): Json;  // weather → { condition, temp_f: content.tempF } after shape-narrowing (throw on mismatch); others pass through
export function rpcCallOf(payload: MutationPayload): RpcCall;
```
Mapping rules: `create_report` → `{p_project_id, p_report_date, p_client_id: reportId}`. `update_section` → `{p_report_id, p_section, p_payload: sectionWirePayload(section, content), p_is_complete}`. `submit_report` → `{p_report_id, p_signer_title, p_signature_png: base64ToByteaHex(...)}` — `signerName` is never sent. `lock_report` → `{p_report_id}`. `create_amendment` → fn `amend_report` with the full arg map: `{p_report_id: reportId, p_amendment_client_id: amendmentId, p_reason: reason, p_changes, p_signer_title: signerTitle, p_signature_png: signaturePngBase64 === null ? null : base64ToByteaHex(signaturePngBase64)}` where `p_changes` = object built from the changes array: `{ [section]: { payload: sectionWirePayload(section, content) } }`, throwing on duplicate section keys. Photo kinds throw `photo kinds are M5`.

- [ ] Write failing tests: hex conversion (incl. empty); create/lock mappings; update_section weather asserts `p_payload = {condition, temp_f}` snake_case; submit signature-hex + no-signerName; amend object shape incl. weather entry translated + duplicate-section throw; photo-kind throw. supabaseRepo test: weather `updateSection` sends `temp_f` (mocked rpc).
- [ ] `npx jest src/sync/rpcMap.test.ts src/data/supabaseRepo.test.ts` → FAIL; implement; → PASS.
- [ ] Commit `feat(sync): pure RPC mapping with shared weather wire translation (native + web paths)`.

### Task 1b: Additive `mutationQueue.ts`/`types.ts` changes (100% pin preserved)

**Files:** Modify `src/sync/mutationQueue.ts`, `src/sync/mutationQueue.test.ts`, `src/sync/types.ts`.

- `AppliedOutcome` gains `readonly errorClass: ErrorClass | null` (null on success) — `applyOutcome` populates it from its existing `classifyError` call; no new branches.
- `PushOutcome` gains `readonly reparentedTo?: string` (winner id; set by Task 4's pusher, read by Task 5's engine; `applyOutcome` ignores it).
- (`Mutation.revision` moved to Task 2 so the store and every fake update in the same commit — typecheck never goes red between tasks.)
- New test: `classifyError` fed a supabase-js network-failure shape (`{message: 'TypeError: Network request failed', details: '', hint: '', code: '', status: 0}`) → `offline`. Assert `errorClass` on success/failure outcomes.
- [ ] RED → GREEN → `npm test -- src/sync/mutationQueue.test.ts` confirms 100% pin holds → commit `feat(sync): expose errorClass, reparentedTo, and mutation revision (additive)`.

### Task 2: Store extensions — `clearDirty`, revision guards, schema migration v2

**Files:** Modify `src/sync/store.native.ts`, `src/sync/store.native.test.ts`, `src/db/schema.ts`, `src/db/schema.test.ts` (or wherever migrate() is tested — read `src/db/open.native.ts` first), `src/sync/types.ts` (Mutation + MutationStore), `src/sync/mutationQueue.ts` + test (`newMutation` revision:0), and **every in-memory `MutationStore` fake** — `src/data/sqliteRepo.native.test.ts` AND `src/data/createReport.race.test.ts` (`noopMutations`) — which fail `tsc` under the new signatures; grep `MutationStore` across `src/` for any others before committing.

- **Schema migration — MIGRATIONS[2] is the SOLE producer of the column:** `SCHEMA_VERSION` bumps to 2 and `MIGRATIONS[2] = ['ALTER TABLE sync_mutations ADD COLUMN revision INTEGER NOT NULL DEFAULT 0']`. **SCHEMA_V1 stays byte-identical** — a fresh device at user_version 0 runs MIGRATIONS[1] then MIGRATIONS[2] in sequence (open.native.ts applies every step above the stored version), so putting the column in BOTH places would throw `duplicate column name` on every fresh install and silently degrade it to the online-only repo via the provider's catch. Editing V1 alone is equally wrong (already-migrated devices never re-run it → `no such column`). Migration tests must cover BOTH paths: v1→v2 upgrade gains the column; v0→v2 fresh install runs both steps cleanly.
- **`Mutation.revision` is owned here (not Task 1b):** `types.ts` gains `readonly revision: number`, `newMutation` (mutationQueue.ts — still branch-free, pin holds) sets `0`, and `toMutation` in store.native.ts reads the column — all in this task's single commit, so typecheck is never red between commits.
- `enqueueCoalescing` bumps `revision = revision + 1` on conflict-update; store reads it into `Mutation.revision`.
- `remove(clientId, revision)` / `replace(m)` become revision-guarded (`WHERE client_id = ? AND revision = ?`) and **return the affected-row count** (`Promise<number>`); `unpark` unchanged (resets attempts to 0 — deliberate fresh ceiling). New plain helpers for Task 8's discard path: `removeParked(clientId): Promise<number>` (`DELETE … WHERE client_id = ? AND status = 'parked'` — the status guard makes a racing coalesce, which flips the row to pending, win over a stale discard tap) and `removeMany(clientIds): Promise<void>` (unconditional deletes, used only by the create_report cascade).
- `clearDirty(db, target: RowTarget)`: `daily_reports`/`report_amendments`/`report_photos` by `id`; `report_sections` splits the composite id `${reportId}:${section}` — and when section === `'weather'`, clears `report_weather` by `report_id` (the queue layer files weather under report_sections; the local mirror doesn't).
- `deleteLocalReport(db, reportId): Promise<void>` — one tx deleting the `daily_reports` row and every child-table row for that report (Task 5's discard cascade consumes it via the injected seam; Task 6 wires it). Implemented and tested HERE.
- Migration-test caveats: nothing imports `open.native.ts` under Jest today and `jest.setup.js` mocks only async-storage/expo-crypto — the test adds a `jest.mock('expo-sqlite', …)`; and a fake Db won't genuinely reject a duplicate column, so the v0→v2 case asserts the migration SEQUENCE, not real SQLite enforcement (stated so the executor doesn't over-trust it).
- [ ] Failing tests in the existing fake-Db idiom: 4 clearDirty WHERE shapes incl. weather routing; coalesce bumps revision; guarded remove/replace no-op (0 affected) on stale revision; removeParked no-ops on a pending row; v1→v2 migration adds the column. Update the sqliteRepo fake. RED → GREEN → `npm run verify` → commit `feat(sync): schema v2 revision column, guarded queue writes, clearDirty routing`.

### Task 3: Re-parent transaction — `src/sync/reparent.native.ts`

**Files:** Create `src/sync/reparent.native.ts`, `src/sync/reparent.native.test.ts`.

**Produces:** `reparentReport(db: Db, loserId: string, winnerId: string): Promise<void>` — called by Task 4 when `create_report` returns a different id. One `tx(db, async () => …)` (zero-arg callback; import `all` aliased `allRows`, plus `run` — no unused imports):
1. **Loser-wins collision policy throughout.** For `report_sections` and `report_weather` (composite/`report_id` PKs): delete the winner-side row a rewrite would collide with, and for each re-homed section also delete the winner's relational child rows (`report_crew`/`report_equipment`/`report_work_performed`/`report_delays`/`report_safety_observations` — surrogate PKs, safe), then `UPDATE … SET report_id = winner WHERE report_id = loser` across ALL child tables — explicitly: `report_sections`, `report_weather`, `report_photos`, `report_amendments`, `report_crew`, `report_equipment`, `report_work_performed`, `report_delays`, `report_safety_observations`.
2. **Queue rewrite:** for every queued mutation whose payload embeds the loser id (skip `create_report` itself): rewrite `data.reportId` (and `data.storagePath` for unpushed photos); rewrite coalesced `client_id`s `${loserId}:${section}` → `${winnerId}:${section}`, deleting a pre-existing winner-keyed row first (loser's payload wins).
3. **Rename, never delete, the report row:** `UPDATE OR REPLACE daily_reports SET id = ? WHERE id = ?` (winner, loser) — OR REPLACE drops a pre-existing winner row; no child ever points at a missing parent (M3a has no pull to materialize the winner). No FKs/triggers exist in schema.ts, so no side effects.
On throw: full rollback; `create_report` stays pending — safe, the RPC is idempotent and returns the same winner again.
- [ ] Failing tests (fake-Db): (a) child rewrite; (b) queued section mutation payload+client_id rewrite; (c) queued add_photo reportId+storagePath rewrite; (d) unrelated reports untouched; (e) winner-keyed queue row collision → loser payload survives; (f) winner absent → report row renamed, queryable; (g) winner present locally → single row, loser content kept, winner's colliding section/weather/child rows removed; (h) **idempotency** — running `reparentReport` twice leaves the winner subtree intact (guards against a naive blanket `DELETE … WHERE report_id = winner` implementation destroying re-homed data when create_report re-pushes after a crash between reparent-commit and queue-remove). RED → GREEN → commit `feat(sync): loser-wins re-parenting that renames instead of deleting`.
**Recorded M5 obligation:** this task rewrites queued `add_photo` payloads' `storagePath` but NOT local `report_photos.storage_path` values — harmless now (no photo rows exist before M5); M5's reparent handling must add the local-row rewrite.

### Task 4: Native pusher — `src/sync/push.native.ts`

**Files:** Create `src/sync/push.native.ts`, `src/sync/push.native.test.ts`.

**Produces (consumed by Task 6):**
```ts
export type RpcRunner = (fn: RpcName, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown; status: number }>;
export type Pusher = (m: Mutation) => Promise<PushOutcome>;
export function createPusher(rpc: RpcRunner, db: Db): Pusher;
```
Behavior: `rpcCallOf` → `await rpc(...)`. On error: `{ ok: false, error: { ...error, status } }` — postgrest-js errors are PLAIN objects (verified at source), so the spread preserves `code`/`message` and the merged `status` keeps `classifyError`'s 403-evict/401/5xx branches live. On `create_report` success: `data[0].report_id`; if ≠ payload id, `await reparentReport(db, loser, winner)` then return `{ ok: true, reparentedTo: winner }`; reparent throw → `{ ok: false, error }`. Any thrown exception → `{ ok: false, error }`.
- [ ] Failing tests: success; error object w/ status merge; thrown fetch error; same-id no-reparent; collision → reparent(loser,winner) + `reparentedTo`; reparent throw → ok:false. RED → GREEN → commit `feat(sync): native pusher with status-preserving errors and collision re-parenting`.

### Task 5: Pure engine core — `src/sync/engineCore.ts`

**Files:** Create `src/sync/engineCore.ts`, `src/sync/engineCore.test.ts`. Modify `src/sync/engineApi.ts` (additive `readonly reparents: number` on `SyncState`; also add to `IDLE_SYNC_STATE`).

**Produces:** `createEngineCore(deps: EngineDeps): EngineCore` where `type EngineCore = Omit<SyncEngineApi, 'start' | 'stop'> & { discardParked(clientId: string): Promise<void> }` — listeners/timers are the shell's job; Task 6 composes `{...core, start, stop}`. `SyncEngineApi` gains the additive `discardParked` member (engineApi.ts), and `SyncState` gains `readonly reparents: number`.
```ts
export interface EngineDeps {
  readonly store: MutationStore;
  // Restated inline from mutationQueue/types exports — do NOT import the Pusher
  // alias from push.native.ts (a bare value import would drag the native graph
  // into the pure core; restating avoids even the type-only dependency).
  readonly push: (m: Mutation) => Promise<PushOutcome>;
  readonly clearDirty: (target: RowTarget) => Promise<void>;
  readonly onIncident: (kind: 'parked'|'evicted', m: Mutation, error: unknown) => void;
  readonly isOnline: () => boolean;
}
```
`discardParked(clientId)` (the unwedging path the cross-cycle block requires): look the mutation up via `store.all()`; if its kind is `create_report`, cascade — `store.removeMany` every queued mutation whose payload's `reportId` matches, then `await deps.deleteLocalReport(reportId)` (new injected seam, implemented in store.native.ts as one tx deleting the `daily_reports` row and every child-table row for that report). Rationale: the server never saw this report and `sqliteRepo.createReport` short-circuits on an existing local row, so keeping the local subtree would strand it — every future edit P0002-parks forever with no re-enqueue path. The confirm copy states it plainly: "This removes the report and its changes from this device." For every other kind: `store.removeParked(clientId)` (status-guarded, so a racing fresh edit that re-pended the row survives) — queue row only; local rows keep `_dirty` (recorded consequence: shielded from M3b's pull until a later push clears it). `discardParked` returns the affected count so the UI can show "This change was just updated — it no longer needs attention" when the guard wins (0 rows) instead of appearing to do nothing. Publish a recount after. `EngineDeps` gains `readonly deleteLocalReport: (reportId: string) => Promise<void>` (Task 6 wires it).
`run()` contract (never rejects; store/clearDirty throws caught per-mutation, surfaced via `lastError`, cycle aborted cleanly):
1. Single-flight + dirty-coalesce (model on `statusHub`'s `cycle`/`dirty`), so the trailing cycle always recounts the last enqueue.
2. Cycle start: recount from `store.all()` → publish `{syncing: true, online: isOnline(), pending, parked, lastError, reparents, completedPulls: 0}` — `reparents` carries forward unchanged (monotone across start/end publishes; `useReparentRedirect` must never observe a reset).
3. Load `store.pending()`, `orderForDrain`. **Skip rules:** (cross-cycle) any PARKED mutation for report R blocks every pending mutation for R — the discard/retry surface is the resolution path; (within-cycle) any failure for report R shadows R's later mutations this cycle. Do NOT gate the drain on `isOnline()` — NetInfo false negatives must never stop sync.
4. Per mutation (revision captured at load): `outcome = await push(m)`; `applied = applyOutcome(m, outcome)`.
   - Success: guarded `store.remove(m.clientId, m.revision)`; **if 0 rows affected (fresh coalesce won) skip `clearDirty` entirely**; else clearDirty when the row is uncontested — the contention check calls `store.all()` FRESH at success-handling time (never a cycle-start snapshot; a different-clientId mutation enqueued mid-cycle against the same row must be seen). When `outcome.reparentedTo` is set, BOTH the contention check and the clearDirty target are re-keyed to the winner: build the comparison from a payload with `reportId` rewritten to the winner (the reparent already rewrote every other queued mutation to the winner id, so a loser-keyed `otherMutationTargetsRow` would miss a pending submit/lock and wrongly clear `_dirty` — latent until M3b's pull, then a real shield break). If `reparentedTo`: bump `reparents`, abort the remaining cycle, mark dirty (immediate follow-up reloads rewritten ids — no push against a dead loser id, no spurious incident).
   - Failure: guarded `store.replace(applied.next)` (0 rows → charge nothing); parked → `onIncident(applied.evict ? 'evicted' : 'parked', m, outcome.error)`.
   - `applied.errorClass === 'offline'`: stop draining, publish `online: false` and **`lastError: null`** — the queued count IS the offline UX (never-alarm contract).
5. Cycle end: recount; publish `{online, syncing: false, pending, parked, lastError, reparents, completedPulls: 0}` (lastError = last non-offline failure's message, or null on a clean drain).
6. `retryParked()`: unpark all parked, then `run()`.
- [ ] Failing tests: drain order + removals + publish sequence (start AND end recounts); uncontested-only clearDirty; retryable bump + park at ceiling + incident carries error; offline stops drain, `online:false`, `lastError:null`; parked-anything blocks report (parked update_section + pending submit → submit untouched; retryParked drains both in order); within-cycle shadowing (failed create_report → same-report section skipped, not attempted); single-flight; **coalesced edit arriving during in-flight push survives a successful push and stays pending**; **…is not charged an attempt on failure**; reparent bumps `reparents` once, aborts + follow-up cycle pushes with winner id, clearDirty AND its contention check keyed to winner; store-throw does not reject; `discardParked` cascades a parked create_report's whole subtree, status-guard lets a racing fresh edit survive, recount published. RED → GREEN → commit `feat(sync): pure engine core — guarded drain, shadowing, reparent-aware cycles, discard`.

### Task 6: Native shell — `src/sync/engine.native.ts` + NetInfo

**Files:** Create `src/sync/engine.native.ts`, `src/sync/engine.native.test.ts`. Modify `package.json` (dep), `src/platformSplit.test.ts` (`NATIVE_ONLY_MODULES` += `'@react-native-community/netinfo'`).

`createSyncEngine(db: Db): SyncEngineApi` wires: `createMutationStore(db)`; `createPusher(async (fn, args) => await supabase.rpc(fn as never, args as never), db)` — builders are PromiseLike not Promise, and generated `rpc()` overloads key on literal names; both casts live at this single documented site (note: generated `submit_report` types `p_signer_title` non-nullable while the payload and SQL both allow null — the cast covers typecheck, and passing a literal `null` is fine at runtime since the SQL signature permits it; the pusher passes the payload value through unmodified); `clearDirty` curried; `onIncident` builds `SyncIncidentDetail` as `{kind: m.payload.kind, attempts: m.attempts, errorCode, errorStatus}` extracted from the error (NO `clientId` — not in the type) → `reportSyncIncident`. `start()`: NetInfo listener (offline→online edge → run; NetInfo fires current state on subscribe — must not double-run beside start's explicit kick), AppState `'active'` → run, initial kick. **Backoff ladder** (timers live here, not in core): wrap `core.run()`; after each resolve inspect `core.getState()` — schedule one `setTimeout(wrappedRun, delay)` with ladder `[30s, 2m, 10m]` by consecutive non-clean cycles when EITHER `pending > 0 && lastError !== null && online` (server failures) OR `pending > 0 && !state.online && netInfoSaysConnected` (transport failures — captive portal/dead DNS publish offline with `lastError: null` while NetInfo still reports connected, so no NetInfo edge will ever fire; without this arm the queue re-drains only on foreground/nudge). Reset on clean cycle; superseded by any earlier trigger; cleared in `stop()`.
- [ ] `npx expo install @react-native-community/netinfo`; platformSplit green. Failing wiring tests (fake timers): start subscribes + kicks once (no NetInfo-initial double-run); reconnect/foreground trigger; failing cycle schedules exactly one timer, success resets ladder, `stop()` clears everything. RED → GREEN → commit `feat(sync): native engine shell with NetInfo/AppState triggers and bounded backoff`.

### Task 7: Hub engine mode + provider wiring

**Files:** Modify `src/sync/statusHub.ts` + test; `src/sync/store.native.ts` + `src/sync/store.native.test.ts` (DELETE `createMutationCounter` and its tests — last production caller gone); `src/data/types.ts` (`PlatformRepoBundle` → `{ repo, engine: SyncEngineApi | null }`); `src/data/platformRepo.native.ts` (build engine, nudge → `() => void engine.run()`); `src/data/platformRepo.web.ts` (`engine: null`); `src/data/RepositoryProvider.tsx` (attach/start under `active`, `if (engine)` guard, detach+stop in cleanup before `setCounter(null)`, `retrySync`/`discardSync` exposed via a NEW dedicated `SyncActionsContext` (+ `useSyncActions()` hook) delegating to the engine, no-ops on web — the `Repository` interface and `useRepository()`'s return type are deliberately untouched so no existing screen breaks); `src/data/RepositoryProvider.rekey.test.tsx` (mock → `{repo: {}, engine: null}`).

Hub contract: `attachEngine(engine: Pick<SyncEngineApi,'getState'|'subscribe'>): () => void` — bumps epoch (discarding in-flight counts and superseding any later-resolving stale counter install), publishes `{...engine.getState(), countError: false}` immediately, mirrors every engine publish; detach unsubscribes and resets idle. `refresh()` no-ops (resolved) while attached. `setCounter` survives for exactly the fallback path (`setCounter(null)` in the provider's catch/cleanup). `createMutationCounter` loses its last production caller in this task — **delete it and its tests** (store.native.ts); the M3b fallback surface will not resurrect it (fallback is online-only, no local DB to count).
- [ ] Failing hub tests: attach mirrors; detach resets; refresh no-op while attached; stale `setCounter` after attach ignored (epoch). Wire provider; `npm run verify && npm run check:web`. Commit `feat(sync): engine publishes through statusHub; provider drives engine lifecycle`.

### Task 8: Retry/discard surface + reparent-aware report screen

**Files:** Create `app/settings/sync.tsx` (thin route), `src/components/SyncQueueScreen.tsx` + test, `src/hooks/useReparentRedirect.ts` + test. Modify `src/components/SyncStatusBanner.tsx` + test (pressable via injected `onPress` → router to `/settings/sync`; `attention` also when engine `lastError !== null` with `parked === 0`, copy "Sync problem — tap to review" — distinct from `countError`'s string; **precedence position pinned**: the new check slots between `countError` and `pending` — full order parked > syncing > countError > lastError > pending > synced — so the existing precedence test extends rather than breaks); `app/(tabs)/settings.tsx` (SheetRow link); `app/_layout.tsx` (register route if explicit); `app/report/[id]/index.tsx` (mount `useReparentRedirect`); `src/data/types.ts` + `sqliteRepo.native.ts` + `supabaseRepo.ts` (`listMutations(): Promise<Mutation[]>` — native delegates to store `all()` [newest-first], web returns `[]`); `.maestro/README.md` inventory.

Queue screen: rows from `listMutations()` with plain-language kind labels. Per-row detail NEVER shows the raw `lastError` string (an offline device stores "TypeError: Network request failed" — leaking it breaks the never-alarm contract): map via a small pure helper — `isLikelyOffline({ message: m.lastError })`-matching rows (note the object call shape — it returns false for bare strings) → "Waiting for connection", parked rows → "Couldn't send — needs your attention", other pending errors → "Will retry automatically". (`SyncState.lastError` is never used here — nulled on offline aborts, overwritten by later cycles.) "Retry now" (`retrySync`) visible when any parked (copy reflects fresh-ceiling unpark); per-row "Discard" for parked rows wired to the provider's `discardSync(clientId)` context value (→ `engine.discardParked`; no-op on web) with a confirm dialog: change stays on this device only, and **discarding a parked `create_report` states it removes the report's entire queued subtree**; web shows "Sync runs automatically while online" instead of an empty list. Provider (`RepositoryProvider.tsx`, already in Task 7's list) exposes `discardSync` beside `retrySync`. `useReparentRedirect(routeId, loaded: { projectId: string; reportDate: string } | null)`: the screen passes the identity pair from its ALREADY-LOADED report state (the in-memory copy survives the rename; the loser id alone resolves to nothing after Task 3 renames the row — a reportId-only signature would be unimplementable). On `reparents` change (via `useSyncStatus`) with `loaded` non-null: re-resolve by `(projectId, reportDate)` through the repo; `getReportByDate` returns `DailyReportRow | null` — **on null, do nothing** (pinned in the hook test; a transient miss must never navigate); if the resolved id ≠ `routeId` → `router.replace`. testIDs: `sync-queue-screen`, `sync-queue-retry`, `sync-queue-row-<clientId>`, `sync-queue-discard-<clientId>` (dynamic ones → `DYNAMIC_TESTIDS`).
- [ ] Component/hook tests inside `ThemeProvider` (injected props; no route-file imports). RED → GREEN → `npx jest src/components src/hooks src/maestroSelectors.test.ts` → commit `feat(sync): retry/discard surface, tappable banner, reparent-aware report screen`.

### Task 9: Coverage pins + full gate

- [ ] `package.json` `coverageThreshold` += `src/sync/engineCore.ts` and `src/sync/rpcMap.ts` at `{branches: 95, functions: 100, lines: 95, statements: 95}`. `npm test` — add tests if under (never lower pins). `npm run verify && npm run check:web` green. Commit `test(sync): pin engine core and rpc map coverage`.

### Task 10: On-device E2E + Maestro flow impact

- [ ] Boot the recorded local recipe (Docker → `supabase start` in ../jobsight-backend → guarded seed → emulator → `adb reverse tcp:54321` + `tcp:8081` → `npx expo run:android` → prewarm bundle → `maestro test .maestro/report-sections.yaml`).
- [ ] The flow's `sync-status-queued` assert may flake once drains are live: keep it only immediately post-tap (short `extendedWaitUntil`), tolerate a transient `sync-status-syncing`, and ADD a terminal `sync-status-synced` assert (the stronger claim the engine makes true). Update `.maestro/README.md`.
- [ ] Verify a drain landed: `docker exec supabase_db_PUNCH-LOG-NEW psql -U postgres -d postgres -c "select id, status from daily_reports order by created_at desc limit 3;"`.
- [ ] Commit `fix(e2e): report-sections flow asserts full queued-to-synced drain`.

## Follow-ups (recorded, not this plan)

- **jobsight-backend issue (file before M3b):** `update_section` never bumps `daily_reports.updated_at` — violates doc 06 §B's weather-ride-along/cursor obligation; M3b's pull would miss section edits.
- **doc 06 §A amendments:** (1) replay paragraph — shipped `submit_report`/`lock_report` replays are idempotent no-ops, not P0001 parks; (2) photo-kind drain note — only `add_photo` is tail-ordered.
- **M3b:** pull path (explicit `profiles` column list — `select('*')` 403s), reconcile sweeps, `completedPulls`, weather ride-along, amendment-number backfill, online-only-fallback surface, wiring `SyncState.online` into banner copy.
- **M4 note:** submit UI should pre-check signature size (RPC rejects >1 MB with 22023).
- **M5:** photo kinds + outbox.

## Verification (plan-level)

Docs-only on approval: prettier check on the rewritten plan file; structural self-check (every interface consumed by task N produced by task ≤ N; the three wire-shape tests — weather snake_case both paths + web, amend object, network-error classification — present; revision-guard tests present).
