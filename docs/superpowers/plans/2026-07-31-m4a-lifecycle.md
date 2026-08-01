# M4a — Report Lifecycle (submit / lock) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the report lifecycle into the UI — submit (with signature capture) and lock actions, read-only mode for non-draft reports, a collision-proof enqueue clientId scheme, a pull-side status shield, and the cross-repo pgTAP gate for the locked-row trigger.

**Architecture:** The sync layer is already lifecycle-complete (`rpcMap.ts` handlers, payload types, server RPCs, locked-row triggers, auto-lock sweeper). This plan adds the layers above it: pure guards (`lifecycleGuards.ts`), two `Repository` methods (optimistic local status write + namespaced enqueue on native; direct RPC on web), a status shield in the pull applier so a pull can't regress an optimistic `submitted`, and the submit/lock UI on the report screen. Backend work is a greenfield pgTAP suite in the sibling `../jobsight-backend` clone.

**Tech Stack:** Expo / React Native + TypeScript, expo-sqlite, jest-expo, `react-native-signature-canvas` (+`react-native-webview`, both already installed), Supabase (PostgREST RPCs), pgTAP via `supabase test db`.

**Spec:** `docs/superpowers/specs/2026-07-31-m4a-lifecycle-design.md`. Issue #26 already landed on main (`36bf1ff`) — NOT part of this plan.

## Global Constraints

- `npm run verify` green after every task (typecheck + format:check + lint + full jest with coverage). Jest flake note: fresh-worktree full-parallel runs can 5s-timeout; re-run with `--maxWorkers=2` before debugging.
- `src/sync/mutationQueue.ts` is pinned at 100/100/100/100 — any code added there must be fully covered. `conflict.ts` is pinned 95/100/95/95.
- Native-only modules may be imported ONLY from `*.native.ts(x)` files; new native-only deps must be added to `NATIVE_ONLY_MODULES` in `src/platformSplit.test.ts`.
- Every new interactive control gets a literal `testID` (convention: `.maestro/README.md`); `src/maestroSelectors.test.ts` enforces flow-referenced ids exist in source.
- Report tables are SELECT-only to clients — all lifecycle writes go through the existing SECURITY DEFINER RPCs; never add a direct client INSERT/UPDATE.
- `src/sync/` stays pure/IO-free except `*.native.ts` adapters; persistence only in `store.native.ts`.
- Copy is plain language ("Submit report", "Lock report") — testIDs, never copy, are the E2E contract.
- Backend work goes in `../jobsight-backend` on branch `feat/worklog-pgtap` (separate clone, separate git history — never commit backend files from the app repo).

## File Structure

**App (WorkLog):**
- `src/sync/mutationQueue.ts` — add `lifecycleClientId()` (pure helper, Task 1)
- `src/data/lifecycleGuards.ts` — NEW pure guard module (Task 2)
- `src/sync/conflict.ts` — `resolveReport` gains `lifecycleHeld` param (Task 3)
- `src/sync/pullTables.native.ts` — `heldStatusReportIds()` + `applyReports` wiring (Task 4)
- `src/sync/pull.native.ts` — pass the held set at the one `applyReports` call site (Task 4)
- `src/data/types.ts` + `src/data/sqliteRepo.native.ts` + `src/data/supabaseRepo.ts` — `submitReport`/`lockReport` (Task 5)
- `src/sync/rpcMap.ts` — export `base64ToByteaHex` (Task 5)
- `src/components/report/useSectionDraft.ts` + `SectionSheetScaffold.tsx` — `readOnly` (Task 6)
- 10 section sheets + `app/report/[id]/index.tsx` — thread `readOnly` (Task 7)
- `src/components/report/SubmitReportSheet.native.tsx` + `SubmitReportSheet.tsx` (web stub) (Task 8)
- `app/report/[id]/index.tsx` — submit/lock buttons, members load, lock confirm (Task 9)
- `.maestro/report-sections.yaml` + `.maestro/README.md` + `docs/architecture/01-work-plan.md` (Task 12)

**Backend (../jobsight-backend):**
- `supabase/tests/worklog_lifecycle_test.sql` — RPC transition tests (Task 10)
- `supabase/tests/worklog_locked_guard_test.sql` — trigger + sweeper tests (Task 11)

---

### Task 1: `lifecycleClientId` — the namespaced enqueue key

**Files:**
- Modify: `src/sync/mutationQueue.ts`
- Test: `src/sync/mutationQueue.test.ts`

**Interfaces:**
- Produces: `lifecycleClientId(kind: 'submit_report' | 'lock_report', reportId: string): string` → `` `submit:${reportId}` `` / `` `lock:${reportId}` ``. Tasks 4 and 5 depend on this exact format (Task 4 parses it back with `slice(indexOf(':') + 1)`).

Why: `store.native.ts#enqueue` is `INSERT OR IGNORE` on `client_id UNIQUE`. A submit enqueued with the bare `reportId` silently collides with the queued `create_report` row (whose clientId MUST stay the bare report UUID — it doubles as the RPC idempotency key `p_client_id`). Namespacing mirrors the existing `update_section` composite `` `${reportId}:${section}` ``.

- [ ] **Step 1: Write the failing tests** — append to `src/sync/mutationQueue.test.ts`:

```ts
describe('lifecycleClientId', () => {
  it('namespaces submit and lock so they cannot collide with create_report or each other', () => {
    expect(lifecycleClientId('submit_report', 'r1')).toBe('submit:r1');
    expect(lifecycleClientId('lock_report', 'r1')).toBe('lock:r1');
    expect(lifecycleClientId('submit_report', 'r1')).not.toBe('r1');
    expect(lifecycleClientId('submit_report', 'r1')).not.toBe(lifecycleClientId('lock_report', 'r1'));
  });
});
```

Add `lifecycleClientId` to the existing `from './mutationQueue'` import.

- [ ] **Step 2: Run to verify failure** — `npx jest src/sync/mutationQueue.test.ts -t lifecycleClientId` → FAIL (not exported).
- [ ] **Step 3: Implement** — in `src/sync/mutationQueue.ts`, near `newMutation`:

```ts
/**
 * clientId for the two lifecycle kinds. `create_report` keeps the BARE report
 * UUID (it doubles as the RPC's p_client_id idempotency key); submit/lock get
 * a namespaced key so enqueue's INSERT OR IGNORE can never silently drop them
 * against the queued create_report row or each other. Mirrors update_section's
 * `${reportId}:${section}` composite. Re-enqueue of the same action stays an
 * idempotent no-op by design.
 */
export function lifecycleClientId(
  kind: 'submit_report' | 'lock_report',
  reportId: string,
): string {
  return kind === 'submit_report' ? `submit:${reportId}` : `lock:${reportId}`;
}
```

- [ ] **Step 4: Run full file with coverage** — `npx jest src/sync/mutationQueue.test.ts --collectCoverageFrom=src/sync/mutationQueue.ts` → PASS; mutationQueue.ts must show 100% branches/functions/lines (the pin).
- [ ] **Step 5: Commit** — `git add src/sync/mutationQueue.ts src/sync/mutationQueue.test.ts && git commit -m "feat(sync): lifecycleClientId — namespaced submit/lock enqueue keys"`

---

### Task 2: `lifecycleGuards` — pure status guards

**Files:**
- Create: `src/data/lifecycleGuards.ts`
- Test: `src/data/lifecycleGuards.test.ts`
- Modify: `package.json` (coverage pin)

**Interfaces:**
- Produces: `canEditSection(status: ReportStatus): boolean`, `canSubmit(status: ReportStatus): boolean`, `canLock(status: ReportStatus): boolean`, `type ReportStatus = 'draft' | 'submitted' | 'locked'` (re-derived from `DailyReportRow['status']`). Tasks 5, 7, 9 consume these exact names.

- [ ] **Step 1: Write the failing test** — `src/data/lifecycleGuards.test.ts` (test-architecture §B.7: parametrized over all 11 sections):

```ts
import { SECTION_KINDS } from '../sync/types';
import { canEditSection, canLock, canSubmit } from './lifecycleGuards';

describe('lifecycleGuards', () => {
  it.each(SECTION_KINDS)('%s is editable only while draft', (_section) => {
    expect(canEditSection('draft')).toBe(true);
    expect(canEditSection('submitted')).toBe(false);
    expect(canEditSection('locked')).toBe(false);
  });

  it('canSubmit allows only draft → submitted', () => {
    expect(canSubmit('draft')).toBe(true);
    expect(canSubmit('submitted')).toBe(false);
    expect(canSubmit('locked')).toBe(false);
  });

  it('canLock allows only submitted → locked', () => {
    expect(canLock('submitted')).toBe(true);
    expect(canLock('draft')).toBe(false);
    expect(canLock('locked')).toBe(false);
  });
});
```

(The `it.each` over sections is deliberate: it pins that the guard is status-only — no per-section carve-out can creep in without this suite noticing the signature change.)

- [ ] **Step 2: Run to verify failure** — `npx jest src/data/lifecycleGuards.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement** — `src/data/lifecycleGuards.ts`:

```ts
/**
 * Pure lifecycle guards (05-test-architecture §B.7). The server RPCs are the
 * authority (submit_report/lock_report enforce legal transitions with P0001);
 * these guards are the CLIENT's half: an edit attempt on a non-draft report is
 * never even enqueued, and the UI only offers transitions the server would
 * accept. Role gating (is_super) is deliberately NOT here — it is a UI concern
 * fed by membership data; these functions answer only "does the status allow
 * it".
 */
import type { DailyReportRow } from './types';

export type ReportStatus = DailyReportRow['status'];

/** Sections are editable only while the report is a draft — all 11 alike. */
export function canEditSection(status: ReportStatus): boolean {
  return status === 'draft';
}

/** draft → submitted is the only legal submit transition. */
export function canSubmit(status: ReportStatus): boolean {
  return status === 'draft';
}

/** submitted → locked is the only legal manual-lock transition. */
export function canLock(status: ReportStatus): boolean {
  return status === 'submitted';
}
```

- [ ] **Step 4: Run to verify pass** — `npx jest src/data/lifecycleGuards.test.ts` → PASS.
- [ ] **Step 5: Add the coverage pin** — in `package.json` `coverageThreshold`, after the `src\db\schema.ts` entry, add:

```json
"src\\data\\lifecycleGuards.ts": {
  "branches": 95,
  "functions": 100,
  "lines": 95,
  "statements": 95
}
```

- [ ] **Step 6: Commit** — `git add src/data/lifecycleGuards.ts src/data/lifecycleGuards.test.ts package.json && git commit -m "feat(data): lifecycleGuards — pure canEditSection/canSubmit/canLock"`

---

### Task 3: `resolveReport` lifecycle hold

**Files:**
- Modify: `src/sync/conflict.ts:105-112`
- Test: `src/sync/conflict.test.ts`

**Interfaces:**
- Consumes: existing `resolveReport(local, server, localDirty)` and `ResolvedReport`.
- Produces: `resolveReport(local: T | null, server: T, localDirty: boolean, lifecycleHeld?: boolean)` — when `lifecycleHeld` is true and a local row exists, the LOCAL `status` survives (an optimistic submit/lock with its mutation still pending must not be regressed by a pull). Default `false` keeps every existing call site's behavior byte-identical. Task 4 passes the flag.

- [ ] **Step 1: Write the failing tests** — append to the `resolveReport` describe block in `src/sync/conflict.test.ts`:

```ts
it('lifecycleHeld keeps the optimistic local status on a clean row (server content still adopted)', () => {
  const local = { status: 'submitted', note: 'local' };
  const server = { status: 'draft', note: 'server' };
  expect(resolveReport(local, server, false, true)).toEqual({
    item: { status: 'submitted', note: 'server' },
    dirty: 0,
  });
});

it('lifecycleHeld keeps the optimistic local status on a dirty row (local content already shielded)', () => {
  const local = { status: 'submitted', note: 'local' };
  const server = { status: 'draft', note: 'server' };
  expect(resolveReport(local, server, true, true)).toEqual({
    item: { status: 'submitted', note: 'local' },
    dirty: 1,
  });
});

it('lifecycleHeld with no local row is a plain server adoption', () => {
  const server = { status: 'draft' };
  expect(resolveReport(null, server, false, true)).toEqual({ item: server, dirty: 0 });
});

it('defaulted lifecycleHeld leaves the existing contract untouched', () => {
  const local = { status: 'draft', note: 'local' };
  const server = { status: 'submitted', note: 'server' };
  expect(resolveReport(local, server, true)).toEqual({
    item: { status: 'submitted', note: 'local' },
    dirty: 1,
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx jest src/sync/conflict.test.ts -t lifecycleHeld` → FAIL.
- [ ] **Step 3: Implement** — replace the `resolveReport` body (keep/extend its doc comment: add a paragraph explaining the hold — "the ONE exception to 'status is always adopted from the server': while a submit/lock mutation is still pending, the optimistic local status is the truth in flight; the pull adopting the server's stale status would regress the UI and then re-flip after the drain — visible flicker and a lie in between"):

```ts
export function resolveReport<T extends ReportLike>(
  local: T | null,
  server: T,
  localDirty: boolean,
  lifecycleHeld = false,
): ResolvedReport<T> {
  if (!local) return { item: server, dirty: 0 };
  if (!localDirty) {
    return lifecycleHeld
      ? { item: { ...server, status: local.status }, dirty: 0 }
      : { item: server, dirty: 0 };
  }
  return {
    item: { ...local, status: lifecycleHeld ? local.status : server.status },
    dirty: 1,
  };
}
```

- [ ] **Step 4: Run with the pin** — `npx jest src/sync/conflict.test.ts --collectCoverageFrom=src/sync/conflict.ts` → PASS, coverage ≥ the 95/100/95/95 pin.
- [ ] **Step 5: Commit** — `git add src/sync/conflict.ts src/sync/conflict.test.ts && git commit -m "feat(sync): resolveReport lifecycleHeld — pending submit/lock shields optimistic status"`

---

### Task 4: Pull applier wiring — compute and apply the held set

**Files:**
- Modify: `src/sync/pullTables.native.ts` (`applyReports`, ~line 296; new `heldStatusReportIds`)
- Modify: `src/sync/pull.native.ts:515` (the one `applyReports` call site)
- Test: `src/sync/pullTables.native.test.ts`, `src/sync/pull.native.test.ts`

**Interfaces:**
- Consumes: `lifecycleClientId` format from Task 1 (`submit:<id>` / `lock:<id>`); `resolveReport(..., lifecycleHeld)` from Task 3.
- Produces: `heldStatusReportIds(db: Db): Promise<ReadonlySet<string>>`; `applyReports(db, rows, heldStatusReportIds?: ReadonlySet<string>)` (third param, defaults to an empty set so existing tests/callers stay valid).

- [ ] **Step 1: Write the failing applier test** — in `src/sync/pullTables.native.test.ts`, follow the file's existing fake-Db pattern (it builds an in-memory Db and seeds `daily_reports` rows; mirror the nearest existing `applyReports` test's setup exactly). Add:

```ts
it('holds the optimistic local status while a lifecycle mutation is pending for that report', async () => {
  // Seed: local row status='submitted' (optimistic, clean), server delivers
  // status='draft' with a NEWER updated_at (so the no-op fast path cannot hide
  // the regression).
  // ...seed local daily_reports row: { id: 'r1', status: 'submitted', updated_at: 'T1', _dirty: 0 }
  const bundles = [
    { report: { id: 'r1', project_id: 'p1', report_date: '2026-07-31', status: 'draft', updated_at: 'T2' }, weather: null },
  ];
  const result = await applyReports(db, bundles, new Set(['r1']));
  const row = await first(db, `SELECT status FROM daily_reports WHERE id = 'r1'`, []);
  expect(row?.status).toBe('submitted'); // content columns updated, status held
  expect(result.cursorKeys).toContain('T2'); // cursor still credited
});

it('heldStatusReportIds parses pending submit:/lock: clientIds and ignores parked ones', async () => {
  // Seed sync_mutations: pending 'submit:r1', pending 'lock:r2',
  // PARKED 'submit:r3', pending 'r4' (a create_report — bare id), pending 'r5:crew'.
  const held = await heldStatusReportIds(db);
  expect(held).toEqual(new Set(['r1', 'r2']));
});
```

(Adapt the seeding calls to the file's existing helpers — the assertions above are the contract.)

- [ ] **Step 2: Run to verify failure** — `npx jest src/sync/pullTables.native.test.ts -t held` → FAIL.
- [ ] **Step 3: Implement in `pullTables.native.ts`**:

```ts
/**
 * Report ids with a PENDING submit/lock mutation — their optimistic local
 * status outranks a pulled status until the drain acks. Parked lifecycle
 * mutations are deliberately NOT held: a permanent rejection means the server
 * status is the truth and the queue surface owns the user decision.
 * Recognized by the lifecycleClientId namespace (mutationQueue.ts) — the
 * payload never needs parsing.
 */
export async function heldStatusReportIds(db: Db): Promise<ReadonlySet<string>> {
  const rows = await all<{ client_id: string }>(
    db,
    `SELECT client_id FROM sync_mutations
      WHERE status = 'pending'
        AND (client_id LIKE 'submit:%' OR client_id LIKE 'lock:%')`,
    [],
  );
  return new Set(rows.map((r) => r.client_id.slice(r.client_id.indexOf(':') + 1)));
}
```

In `applyReports`: add the third param `heldStatusReportIds: ReadonlySet<string> = new Set()`; inside the loop compute `const held = heldStatusReportIds.has(id);` and:
  1. pass `held` as the 4th arg to `resolveReport`;
  2. in the `resolved.dirty === 0` branch, write the RESOLVED status instead of the server's: `const values = cols.map((c) => (c === 'status' ? (resolved.item.status as BindValue) : ((server[c] ?? null) as BindValue)));`
  3. change the dirty-branch condition from `local.status !== status` to `resolved.item.status !== local.status` (writes `resolved.item.status`) — same behavior when not held, no write when held.

- [ ] **Step 4: Wire the call site** — `src/sync/pull.native.ts:515`:

```ts
await settleFeed(scope, cursor, await applyReports(db, bundles, await heldStatusReportIds(db)));
```

(Add `heldStatusReportIds` to the existing `pullTables.native` import. Compute it inside `pullReports` right before the apply — per-feed freshness beats a cycle-start snapshot: a submit enqueued mid-cycle is still shielded.)

- [ ] **Step 5: Run both suites** — `npx jest src/sync/pullTables.native.test.ts src/sync/pull.native.test.ts` → PASS.
- [ ] **Step 6: Commit** — `git add src/sync/pullTables.native.ts src/sync/pull.native.ts src/sync/pullTables.native.test.ts src/sync/pull.native.test.ts && git commit -m "feat(sync): pull applier holds optimistic status for pending submit/lock"`

---

### Task 5: Repository seam — `submitReport` / `lockReport`

**Files:**
- Modify: `src/data/types.ts` (Repository interface), `src/data/sqliteRepo.native.ts`, `src/data/supabaseRepo.ts`, `src/sync/rpcMap.ts` (export `base64ToByteaHex`)
- Test: `src/data/sqliteRepo.native.test.ts`, `src/data/supabaseRepo.test.ts`, `src/sync/rpcMap.test.ts`

**Interfaces:**
- Consumes: `lifecycleClientId` (Task 1), `canSubmit`/`canLock` (Task 2), existing `newMutation`, `tx`, `SubmitReportPayload` (`{ reportId, signaturePngBase64, signerName, signerTitle }`).
- Produces (Tasks 8/9 depend on these exact shapes):

```ts
export interface SubmitReportInput {
  readonly signerName: string;
  readonly signerTitle: string | null;
  readonly signaturePngBase64: string;
}
// on Repository:
submitReport(reportId: string, input: SubmitReportInput): Promise<void>;
lockReport(reportId: string): Promise<void>;
```

- [ ] **Step 1: Write the failing native tests** — in `src/data/sqliteRepo.native.test.ts` (reuse the file's existing in-memory Db + mutation-store fakes; mirror the `createReport` tests' arrange style):

```ts
describe('submitReport', () => {
  it('optimistically flips status and enqueues a namespaced submit mutation atomically', async () => {
    // Arrange: seed a draft report row r1 via repo.createReport / direct insert.
    await repo.submitReport('r1', { signerName: 'Sam Super', signerTitle: 'PM', signaturePngBase64: 'AAAA' });
    const row = await db.getFirstAsync(`SELECT status FROM daily_reports WHERE id = 'r1'`);
    expect(row.status).toBe('submitted');
    const queued = enqueued.find((m) => m.clientId === 'submit:r1');
    expect(queued?.payload).toEqual({
      kind: 'submit_report',
      data: { reportId: 'r1', signerName: 'Sam Super', signerTitle: 'PM', signaturePngBase64: 'AAAA' },
    });
  });

  it('refuses to submit a non-draft report and enqueues nothing', async () => {
    // Arrange: seed r1 with status='submitted'.
    await expect(repo.submitReport('r1', input)).rejects.toThrow('Only a draft report can be submitted.');
    expect(enqueued.filter((m) => m.clientId.startsWith('submit:'))).toHaveLength(0);
  });
});

describe('lockReport', () => {
  it('optimistically locks a submitted report and enqueues lock:<id>', async () => {
    // Arrange: seed r1 with status='submitted'.
    await repo.lockReport('r1');
    const row = await db.getFirstAsync(`SELECT status FROM daily_reports WHERE id = 'r1'`);
    expect(row.status).toBe('locked');
    expect(enqueued.some((m) => m.clientId === 'lock:r1')).toBe(true);
  });

  it('refuses to lock a draft and enqueues nothing', async () => {
    await expect(repo.lockReport('r1')).rejects.toThrow('Only a submitted report can be locked.');
  });

  it('refuses to lock an unknown report', async () => {
    await expect(repo.lockReport('missing')).rejects.toThrow('Report not found.');
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx jest src/data/sqliteRepo.native.test.ts -t "submitReport|lockReport"` → FAIL.
- [ ] **Step 3: Implement.**

`src/data/types.ts` — add `SubmitReportInput` (exported, above `Repository`) and the two methods to `Repository` under the Writes section, with doc comments: optimistic local status write + namespaced enqueue on native / direct RPC on web; status guard throws before any write.

`src/data/sqliteRepo.native.ts` — imports: `lifecycleClientId` from `../sync/mutationQueue`, `canLock, canSubmit` from `./lifecycleGuards`, `SubmitReportInput` from `./types`. Add to the returned object:

```ts
async submitReport(reportId: string, input: SubmitReportInput): Promise<void> {
  const row = await db.getFirstAsync<DailyReportRow>(
    'SELECT id, project_id, report_date, status FROM daily_reports WHERE id = ?',
    [reportId],
  );
  if (!row) throw new Error('Report not found.');
  if (!canSubmit(row.status)) throw new Error('Only a draft report can be submitted.');
  // Optimistic status + queued mutation commit atomically (same rationale as
  // createReport). No _dirty flip: content is untouched, and the pull-side
  // hold (heldStatusReportIds) is what protects the status until the ack.
  await tx(db, async () => {
    await db.runAsync(`UPDATE daily_reports SET status = 'submitted' WHERE id = ? AND status = 'draft'`, [reportId]);
    await mutations.enqueue(
      newMutation(
        lifecycleClientId('submit_report', reportId),
        {
          kind: 'submit_report',
          data: {
            reportId,
            signaturePngBase64: input.signaturePngBase64,
            signerName: input.signerName,
            signerTitle: input.signerTitle,
          },
        },
        new Date().toISOString(),
      ),
    );
  });
  nudge();
},

async lockReport(reportId: string): Promise<void> {
  const row = await db.getFirstAsync<DailyReportRow>(
    'SELECT id, project_id, report_date, status FROM daily_reports WHERE id = ?',
    [reportId],
  );
  if (!row) throw new Error('Report not found.');
  if (!canLock(row.status)) throw new Error('Only a submitted report can be locked.');
  await tx(db, async () => {
    await db.runAsync(`UPDATE daily_reports SET status = 'locked' WHERE id = ? AND status = 'submitted'`, [reportId]);
    await mutations.enqueue(
      newMutation(
        lifecycleClientId('lock_report', reportId),
        { kind: 'lock_report', data: { reportId } },
        new Date().toISOString(),
      ),
    );
  });
  nudge();
},
```

`src/sync/rpcMap.ts` — change `function base64ToByteaHex` to `export function base64ToByteaHex` (doc comment: also used by the web repo's direct RPC path so the two encodings can't drift). Pin the export with a named test in `rpcMap.test.ts`:

```ts
it('exports base64ToByteaHex for the web repo path', () => {
  expect(base64ToByteaHex('AAAA')).toMatch(/^\\x/);
});
```

`src/data/supabaseRepo.ts` — import `base64ToByteaHex` from `../sync/rpcMap`; add to the class:

```ts
async submitReport(reportId: string, input: SubmitReportInput): Promise<void> {
  const { error } = await supabase.rpc('submit_report', {
    p_report_id: reportId,
    p_signer_title: input.signerTitle,
    // Same bytea wire encoding as the native push handler (rpcMap.ts).
    p_signature_png: base64ToByteaHex(input.signaturePngBase64) as never,
  });
  if (error) fail('submitReport', error);
}

async lockReport(reportId: string): Promise<void> {
  const { error } = await supabase.rpc('lock_report', { p_report_id: reportId });
  if (error) fail('lockReport', error);
}
```

(Check the generated `src/supabase/types.ts` RPC arg types first: if `p_signer_title` is generated non-nullable or `p_signature_png` isn't `string`, cast the specific argument like the existing `updateSection` does with its documented `as never` — never loosen the seam types.)

- [ ] **Step 4: Write the failing web tests** — in `src/data/supabaseRepo.test.ts`, mirror the file's existing `rpc` mock pattern: assert `submitReport` calls `supabase.rpc('submit_report', {...})` with the hex-encoded signature and that an RPC error surfaces as the generic thrown message; same for `lockReport`.
- [ ] **Step 5: Run all four suites** — `npx jest src/data/sqliteRepo.native.test.ts src/data/supabaseRepo.test.ts src/sync/rpcMap.test.ts src/sync/mutationQueue.test.ts` → PASS.
- [ ] **Step 6: Commit** — `git add src/data src/sync && git commit -m "feat(data): submitReport/lockReport on the repository seam — optimistic native write + web RPC"`

---

### Task 6: `readOnly` plumbing — `useSectionDraft` + `SectionSheetScaffold`

**Files:**
- Modify: `src/components/report/useSectionDraft.ts`, `src/components/report/SectionSheetScaffold.tsx`
- Test: `src/components/report/useSectionDraft.test.tsx`

**Interfaces:**
- Produces: `useSectionDraft(reportId, section, initial, options?: { readonly readOnly?: boolean })` — when `readOnly`, NO repository write ever happens (the §B.7 "never even enqueued" guarantee); `SectionSheetScaffold` gains `readOnly?: boolean` — body becomes non-interactive, the "None today" row hides, Done still closes. Task 7 threads both.

- [ ] **Step 1: Write the failing hook tests** — append to `useSectionDraft.test.tsx` (reuse its render/wrapper + fake-repo pattern):

```ts
it('readOnly: setDraft updates local state but never writes through', async () => {
  const { result } = renderDraft({ readOnly: true }); // adapt to the file's harness
  act(() => result.current.setDraft({ text: 'typed anyway' }));
  act(() => jest.advanceTimersByTime(SECTION_DRAFT_DEBOUNCE_MS + 50));
  await act(async () => {});
  expect(repo.updateSection).not.toHaveBeenCalled();
});

it('readOnly: flush and markComplete are inert', async () => {
  const { result } = renderDraft({ readOnly: true });
  act(() => result.current.setDraft({ text: 'x' }));
  act(() => result.current.flush());
  act(() => result.current.markComplete(true));
  await act(async () => {});
  expect(repo.updateSection).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify failure** — `npx jest src/components/report/useSectionDraft.test.tsx -t readOnly` → FAIL.
- [ ] **Step 3: Implement** — `useSectionDraft` gains a 4th param `options?: { readonly readOnly?: boolean }`; capture `const readOnly = options?.readOnly ?? false;` and add `if (readOnly) return;` as the first line of `issueWrite` (single choke point — the debounce timer, flush, markComplete, and unmount backstop all funnel through it). Extend the module doc comment: readOnly is the client half of the lifecycle guard — a non-draft report's sheet may render content but can never produce a repository write or queued mutation.
- [ ] **Step 4: Scaffold** — `SectionSheetScaffold` gains `readOnly?: boolean`: wrap `{children}` in `<View pointerEvents={readOnly ? 'none' : 'auto'}>` (import `View`), and render the `onNoneToday` row only when `!readOnly`. Default footer unchanged (Done must stay tappable).
- [ ] **Step 5: Run** — `npx jest src/components/report/useSectionDraft.test.tsx` → PASS.
- [ ] **Step 6: Commit** — `git add src/components/report/useSectionDraft.ts src/components/report/useSectionDraft.test.tsx src/components/report/SectionSheetScaffold.tsx && git commit -m "feat(report): readOnly mode for section drafts and the sheet scaffold"`

---

### Task 7: Thread `readOnly` through the 10 sheets + gate the screen

**Files:**
- Modify (same three-line pattern each): `src/components/report/CrewWorkSheet.tsx`, `WeatherSectionSheet.tsx`, `DeliveriesSectionSheet.tsx`, `EquipmentSectionSheet.tsx`, `InspectionsSectionSheet.tsx`, `SafetySectionSheet.tsx`, `DelaysSectionSheet.tsx`, `VisitorsSectionSheet.tsx`, `RfisSectionSheet.tsx`, `NotesSectionSheet.tsx`
- Modify: `app/report/[id]/index.tsx`
- Test: `src/components/report/SafetySectionSheet.test.tsx` (representative behavior test; the others get the prop only)

**Interfaces:**
- Consumes: Task 6's `readOnly` options/prop; Task 2's `canEditSection`.

The pattern, shown on `NotesSectionSheet` (apply identically to all 10 — each sheet: add the prop, pass it to its `useSectionDraft` call(s) — CrewWorkSheet has two — and to its scaffold):

```tsx
type Props = {
  readonly visible: boolean;
  readonly reportId: string;
  readonly initial: GeneralNotesContent;
  readonly onClose: () => void;
  readonly readOnly?: boolean;   // NEW
};

export function NotesSectionSheet({ visible, reportId, initial, onClose, readOnly }: Props) {
  const { draft, setDraft, flush } = useSectionDraft<GeneralNotesContent>(
    reportId,
    'general_notes',
    initial,
    { readOnly },                 // NEW
  );
  // ...
    <SectionSheetScaffold
      testID="sheet-notes"
      readOnly={readOnly}         // NEW
      ...
```

- [ ] **Step 1: Write the failing representative test** — in `SafetySectionSheet.test.tsx` (this sheet has both inputs and a None-today row), following the file's existing render helpers:

```tsx
it('readOnly renders content but hides None today and never writes', async () => {
  renderSheet({ readOnly: true }); // adapt to the file's helper
  expect(screen.queryByTestId('sheet-safety-none')).toBeNull();
  // Done still present and closes:
  fireEvent.press(screen.getByTestId('sheet-safety-done'));
  expect(onClose).toHaveBeenCalled();
  expect(repo.updateSection).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify failure**, then apply the pattern to all 10 sheets.
- [ ] **Step 3: Gate the screen** — in `app/report/[id]/index.tsx`: `import { canEditSection } from '../../../src/data/lifecycleGuards';`, compute `const readOnly = data?.report ? !canEditSection(data.report.status) : false;` and pass `readOnly={readOnly}` to every sheet in `renderActiveSheet()`. Rows stay tappable — a submitted/locked report's sections open as viewers.
- [ ] **Step 4: Run** — `npx jest src/components/report` → PASS (existing sheet tests must stay green: the prop is optional, defaults preserve behavior).
- [ ] **Step 5: Commit** — `git add src/components/report app/report && git commit -m "feat(report): sheets open read-only when the report is not a draft"`

---

### Task 8: `SubmitReportSheet` — signature capture (native) + web stub

**Files:**
- Create: `src/components/report/SubmitReportSheet.native.tsx`, `src/components/report/SubmitReportSheet.tsx` (web stub)
- Modify: `src/platformSplit.test.ts:12-17` (`NATIVE_ONLY_MODULES`)

**Interfaces:**
- Consumes: `BottomSheet`, `PrimaryButton`, `TextField`, `useTheme`.
- Produces (Task 9 renders this):

```tsx
type Props = {
  readonly visible: boolean;
  readonly defaultSignerTitle: string | null;
  /** Called with the captured signature; the CALLER owns the repo call. */
  readonly onSubmit: (input: { signerTitle: string | null; signaturePngBase64: string }) => void;
  readonly onClose: () => void;
  readonly submitting: boolean;
  readonly errorText: string | null;
};
export function SubmitReportSheet(props: Props): JSX.Element | null;
```

- [ ] **Step 1: Add the modules to the platform-split guard** (this is the failing-test half of TDD here — it fails the moment a non-native file imports them):

```ts
const NATIVE_ONLY_MODULES = [
  'expo-sqlite',
  '@sentry/react-native',
  'expo-updates',
  '@react-native-community/netinfo',
  'react-native-signature-canvas',
  'react-native-webview',
];
```

- [ ] **Step 2: Implement the native sheet** — `src/components/report/SubmitReportSheet.native.tsx`:

```tsx
/**
 * SubmitReportSheet — the draft → submitted confirmation (M4a). Captures the
 * signer's display title and a drawn signature (react-native-signature-canvas,
 * WebView-backed — native-only, hence the .native.tsx split; the web build gets
 * the null stub sibling). The signature is REQUIRED: submit stays disabled
 * until a stroke lands (server enforces 22023 on empty bytea regardless).
 * The caller owns the repository call; this sheet only collects input.
 */
import { useCallback, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import SignatureScreen, { type SignatureViewRef } from 'react-native-signature-canvas';

import { useTheme } from '../../theme';
import { BottomSheet } from '../BottomSheet';
import { PrimaryButton } from '../PrimaryButton';
import { TextField } from '../TextField';

type Props = {
  readonly visible: boolean;
  readonly defaultSignerTitle: string | null;
  readonly onSubmit: (input: { signerTitle: string | null; signaturePngBase64: string }) => void;
  readonly onClose: () => void;
  readonly submitting: boolean;
  readonly errorText: string | null;
};

/** Strip react-native-signature-canvas's data-URL prefix — the payload carries bare base64. */
function toBareBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
}

export function SubmitReportSheet({
  visible,
  defaultSignerTitle,
  onSubmit,
  onClose,
  submitting,
  errorText,
}: Props) {
  const { colors, fonts, radii } = useTheme();
  const sigRef = useRef<SignatureViewRef>(null);
  const [signerTitle, setSignerTitle] = useState(defaultSignerTitle ?? '');
  const [hasSignature, setHasSignature] = useState(false);

  const handleOK = useCallback(
    (dataUrl: string) => {
      onSubmit({
        signerTitle: signerTitle.trim() === '' ? null : signerTitle.trim(),
        signaturePngBase64: toBareBase64(dataUrl),
      });
    },
    [onSubmit, signerTitle],
  );

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Submit report">
      <Text style={[styles.blurb, { color: colors.muted, fontFamily: fonts.ui.regular }]}>
        Submitting freezes today's sections. Sign below to confirm.
      </Text>
      <TextField
        testID="submit-signer-title"
        label="Your title"
        value={signerTitle}
        onChangeText={setSignerTitle}
        placeholder="Superintendent"
      />
      <View
        testID="submit-signature-canvas"
        style={[styles.canvas, { borderColor: colors.border, borderRadius: radii.button }]}
      >
        <SignatureScreen
          ref={sigRef}
          onOK={handleOK}
          onBegin={() => setHasSignature(true)}
          onClear={() => setHasSignature(false)}
          descriptionText=""
          webStyle=".m-signature-pad--footer { display: none; } body,html { height: 100%; }"
        />
      </View>
      {errorText ? (
        <Text style={[styles.error, { color: colors.danger, fontFamily: fonts.ui.semibold }]}>
          {errorText}
        </Text>
      ) : null}
      <PrimaryButton
        testID="submit-clear-signature"
        label="Clear signature"
        variant="secondary"
        onPress={() => sigRef.current?.clearSignature()}
      />
      <PrimaryButton
        testID="submit-confirm"
        label={submitting ? 'Submitting…' : 'Submit report'}
        disabled={!hasSignature || submitting}
        onPress={() => sigRef.current?.readSignature()}
      />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  blurb: { fontSize: 14, marginBottom: 4 },
  canvas: { height: 220, borderWidth: 1, overflow: 'hidden' },
  error: { fontSize: 14 },
});
```

Adaptation notes for the implementer (verify against the real components, do not guess): `PrimaryButton`'s secondary variant — if the component has no `variant` prop, use whatever secondary/ghost affordance the codebase already has (check `src/components/PrimaryButton.tsx`; if none, render the clear action as a `Pressable` text link with `testID="submit-clear-signature"`). `colors.danger` — use the theme's actual danger/destructive token name from `src/theme/tokens.ts`. `TextField` prop names — mirror `NotesSectionSheet`'s usage. `SignatureViewRef` — confirm the type export name against the installed `react-native-signature-canvas` version's d.ts.

- [ ] **Step 3: Web stub** — `src/components/report/SubmitReportSheet.tsx`:

```tsx
/**
 * Web stub. The signature canvas is WebView-backed (native-only); the web
 * build is an online-only smoke target with no submit UI in M4a. Metro's
 * platform resolution picks the .native.tsx sibling on device.
 */
export function SubmitReportSheet(): null {
  return null;
}
```

(If the shared import site needs prop-type parity for typecheck, give the stub the same `Props` type with an unused-prefixed parameter: `export function SubmitReportSheet(_props: Props): null`.)

- [ ] **Step 4: Verify guards** — `npx jest src/platformSplit.test.ts src/maestroSelectors.test.ts` → PASS (no non-native import of the canvas; new testIDs are source literals).
- [ ] **Step 5: Commit** — `git add src/components/report/SubmitReportSheet.native.tsx src/components/report/SubmitReportSheet.tsx src/platformSplit.test.ts && git commit -m "feat(report): SubmitReportSheet — signature capture, native-only with web stub"`

---

### Task 9: Report screen — submit / lock actions

**Files:**
- Modify: `app/report/[id]/index.tsx`
- Test: none (jest ignores `app/`; behavior is covered by Task 5's repo tests + the Maestro flow in Task 12)

**Interfaces:**
- Consumes: `repo.submitReport`/`repo.lockReport` (Task 5), `canSubmit`/`canLock` (Task 2), `SubmitReportSheet` (Task 8), `useAuth` (`src/auth` — confirm exact exported fields against `AuthProvider.tsx`; expected: `userId`, `profile` with `full_name`), `MemberRow` via `repo.listMembers`.

- [ ] **Step 1: Extend `load()` with members** (role gating needs the caller's membership; members come from the report's project):

```ts
const load = useCallback(async () => {
  const report = await repo.getReport(reportId);
  const [sections, weather, members] = await Promise.all([
    repo.listSections(reportId),
    repo.getWeather(reportId),
    report ? repo.listMembers(report.project_id) : Promise.resolve([] as const),
  ]);
  return { report, sections, weather, members };
}, [repo, reportId]);
```

- [ ] **Step 2: Role + prefill wiring** (below the existing `useAsyncData` call):

```ts
const { userId, profile } = useAuth();
const me = useMemo(
  () => (data?.members ?? []).find((m) => m.user_id === userId) ?? null,
  [data?.members, userId],
);
const isSuper = me?.role === 'super';
```

(`profile.full_name` is the signer name, `me.title` the default signer title.)

- [ ] **Step 3: Submit/lock state + handlers**:

```ts
const [submitOpen, setSubmitOpen] = useState(false);
const [lockConfirmOpen, setLockConfirmOpen] = useState(false);
const [actionPending, setActionPending] = useState(false);
const [actionError, setActionError] = useState<string | null>(null);

const handleSubmit = useCallback(
  async (input: { signerTitle: string | null; signaturePngBase64: string }) => {
    setActionPending(true);
    setActionError(null);
    try {
      await repo.submitReport(reportId, {
        signerName: profile?.full_name ?? '',
        signerTitle: input.signerTitle,
        signaturePngBase64: input.signaturePngBase64,
      });
      setSubmitOpen(false);
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not submit this report.');
    } finally {
      setActionPending(false);
    }
  },
  [repo, reportId, profile?.full_name, reload],
);

const handleLock = useCallback(async () => {
  setActionPending(true);
  setActionError(null);
  try {
    await repo.lockReport(reportId);
    setLockConfirmOpen(false);
    reload();
  } catch (err) {
    setActionError(err instanceof Error ? err.message : 'Could not lock this report.');
  } finally {
    setActionPending(false);
  }
}, [repo, reportId, reload]);
```

- [ ] **Step 4: Render** — inside the ScrollView, after `<ReportDetailSections …/>`:

```tsx
{isSuper && data.report.status === 'draft' ? (
  <PrimaryButton
    testID="report-submit"
    label="Submit report"
    onPress={() => { setActionError(null); setSubmitOpen(true); }}
  />
) : null}
{isSuper && data.report.status === 'submitted' ? (
  <PrimaryButton
    testID="report-lock"
    label="Lock report"
    onPress={() => { setActionError(null); setLockConfirmOpen(true); }}
  />
) : null}
```

After `{renderActiveSheet()}`:

```tsx
<SubmitReportSheet
  visible={submitOpen}
  defaultSignerTitle={me?.title ?? null}
  onSubmit={handleSubmit}
  onClose={() => setSubmitOpen(false)}
  submitting={actionPending}
  errorText={actionError}
/>
<BottomSheet visible={lockConfirmOpen} onClose={() => setLockConfirmOpen(false)} title="Lock report">
  <Text style={{ color: colors.muted, fontFamily: fonts.ui.regular, fontSize: 14 }}>
    Locking is final — after this, changes go through a formal amendment.
    Reports also lock automatically 24 hours after submission.
  </Text>
  {actionError ? (
    <Text style={{ color: colors.danger, fontFamily: fonts.ui.semibold, fontSize: 14 }}>{actionError}</Text>
  ) : null}
  <PrimaryButton
    testID="report-lock-confirm"
    label={actionPending ? 'Locking…' : 'Lock report'}
    disabled={actionPending}
    onPress={handleLock}
  />
</BottomSheet>
```

(Imports to add: `SubmitReportSheet`, `BottomSheet`, `useAuth`. `colors.danger`: use the real token name from `src/theme/tokens.ts`. `BottomSheet` backdrop dismiss is the cancel path; also add a `Pressable` "Cancel" with `testID="report-lock-cancel"` so the flow has an explicit handle.)

- [ ] **Step 5: Verify** — `npm run verify` (jest ignores app/, but typecheck+lint cover this file).
- [ ] **Step 6: Commit** — `git add "app/report/[id]/index.tsx" && git commit -m "feat(report): submit and lock actions with role gating"`

---

### Task 10: pgTAP harness + lifecycle RPC tests (backend repo)

**Files (in `../jobsight-backend`, branch `feat/worklog-pgtap`):**
- Create: `supabase/tests/worklog_lifecycle_test.sql`

Setup notes for the implementer:
- `supabase test db` runs every `supabase/tests/*.sql` against the local stack with pgTAP available via `create extension pgtap`. The stack must be up (`supabase start` in `../jobsight-backend`); backend PR #7 (`fix/create-report-ambiguity`) must be in the branch you cut — verify with `git log --oneline -5`, and if unmerged, branch from it.
- Each test file is one transaction: `begin; … rollback;` — nothing persists.
- Seeds run as the default superuser (auth.uid() is null ⇒ the locked-guard trigger's service-role exemption applies, so seeding locked states directly works). Client behavior is simulated with `set local role authenticated` + `request.jwt.claims`.
- The `handle_new_user` trigger auto-creates a `profiles` row on `auth.users` insert — seed users through `auth.users`, then update the profile.

- [ ] **Step 1: Write the test file** — `supabase/tests/worklog_lifecycle_test.sql`:

```sql
-- pgTAP: lifecycle RPC transitions (WorkLog M4a cross-repo gate).
begin;
create extension if not exists pgtap;
select plan(13);

-- ── Seed (superuser: RLS/grants/trigger-exempt) ─────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-4000-a000-000000000001', 'super@test.local'),
  ('00000000-0000-4000-a000-000000000002', 'sub@test.local');
update profiles set full_name = 'Sam Super' where id = '00000000-0000-4000-a000-000000000001';
update profiles set full_name = 'Sal Sub'   where id = '00000000-0000-4000-a000-000000000002';

insert into projects (id, name, created_by) values
  ('00000000-0000-4000-b000-000000000001', 'pgTAP Site', '00000000-0000-4000-a000-000000000001');
insert into project_members (project_id, user_id, role) values
  ('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000001', 'super'),
  ('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000002', 'sub');

insert into daily_reports (id, project_id, report_date, status, created_by) values
  ('00000000-0000-4000-c000-000000000001', '00000000-0000-4000-b000-000000000001', '2026-07-30', 'draft',
   '00000000-0000-4000-a000-000000000001'),
  ('00000000-0000-4000-c000-000000000002', '00000000-0000-4000-b000-000000000001', '2026-07-29', 'locked',
   '00000000-0000-4000-a000-000000000001');

-- ── Act as the super ────────────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-a000-000000000001","role":"authenticated"}', true);

-- 1-3: draft → submitted writes status + signature + audit
select lives_ok(
  $$select submit_report('00000000-0000-4000-c000-000000000001', 'PM', '\x89504e47'::bytea)$$,
  'submit_report succeeds on a draft');
select is((select status from daily_reports where id = '00000000-0000-4000-c000-000000000001'),
  'submitted'::report_status, 'status is submitted');
select is((select count(*)::int from report_signatures
           where report_id = '00000000-0000-4000-c000-000000000001'),
  1, 'one signature row written');

-- 4-5: idempotent replay — no error, no duplicate signature
select lives_ok(
  $$select submit_report('00000000-0000-4000-c000-000000000001', 'PM', '\x89504e47'::bytea)$$,
  'submit replay is a no-op');
select is((select count(*)::int from report_signatures
           where report_id = '00000000-0000-4000-c000-000000000001'),
  1, 'replay adds no second signature');

-- 6: submit on locked → P0001
select throws_ok(
  $$select submit_report('00000000-0000-4000-c000-000000000002', 'PM', '\x89504e47'::bytea)$$,
  'P0001', null, 'submit on a locked report raises P0001');

-- 7: empty signature → 22023 (fresh draft seeded under superuser)
reset role;
insert into daily_reports (id, project_id, report_date, status, created_by) values
  ('00000000-0000-4000-c000-000000000003', '00000000-0000-4000-b000-000000000001', '2026-07-28', 'draft',
   '00000000-0000-4000-a000-000000000001');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-a000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$select submit_report('00000000-0000-4000-c000-000000000003', 'PM', ''::bytea)$$,
  '22023', null, 'empty signature raises 22023');

-- 8-9: lock submitted → locked
select lives_ok(
  $$select lock_report('00000000-0000-4000-c000-000000000001')$$,
  'lock_report succeeds on submitted');
select is((select status from daily_reports where id = '00000000-0000-4000-c000-000000000001'),
  'locked'::report_status, 'status is locked');

-- 10: lock replay is a no-op
select lives_ok(
  $$select lock_report('00000000-0000-4000-c000-000000000001')$$,
  'lock replay is a no-op');

-- 11: lock a draft → P0001
select throws_ok(
  $$select lock_report('00000000-0000-4000-c000-000000000003')$$,
  'P0001', null, 'lock on a draft raises P0001');

-- 12-13: the sub is denied both RPCs (42501)
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-a000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$select submit_report('00000000-0000-4000-c000-000000000003', 'Sub', '\x89504e47'::bytea)$$,
  '42501', null, 'sub cannot submit');
select throws_ok(
  $$select lock_report('00000000-0000-4000-c000-000000000001')$$,
  '42501', null, 'sub cannot lock');

select * from finish();
rollback;
```

- [ ] **Step 2: Run** — in `../jobsight-backend`: `supabase test db`. Expected first-run failures are SEED shape issues (e.g. `auth.users` NOT NULL columns on this CLI version, enum-vs-text in `is()` comparisons) — fix the seed/assertion syntax, NOT the migrations. All 13 must pass.
- [ ] **Step 3: Commit (backend repo)** — `git add supabase/tests/worklog_lifecycle_test.sql && git commit -m "test(worklog): pgTAP lifecycle RPC transition suite"`

---

### Task 11: pgTAP — locked-row guard on all 7 tables + sweeper

**Files (in `../jobsight-backend`):**
- Create: `supabase/tests/worklog_locked_guard_test.sql`

- [ ] **Step 1: Write the test file**:

```sql
-- pgTAP: worklog_reject_if_locked defense-in-depth across all 7 guarded
-- tables, plus the grace-window sweeper. PRIMARY enforcement is grants
-- (report tables are SELECT-only to authenticated), so both layers are
-- verified separately:
--   (a) grants: authenticated gets 42501 on direct writes;
--   (b) trigger: a write with auth.uid() non-null and the amendment GUC unset
--       raises P0001 on every guarded table.
begin;
create extension if not exists pgtap;
select plan(16);

-- ── Seed a locked report with one row in every guarded table ────────────────
insert into auth.users (id, email) values
  ('00000000-0000-4000-a000-000000000011', 'super2@test.local');
insert into projects (id, name, created_by) values
  ('00000000-0000-4000-b000-000000000011', 'pgTAP Guard Site', '00000000-0000-4000-a000-000000000011');
insert into project_members (project_id, user_id, role) values
  ('00000000-0000-4000-b000-000000000011', '00000000-0000-4000-a000-000000000011', 'super');
insert into daily_reports (id, project_id, report_date, status, created_by, submitted_at) values
  ('00000000-0000-4000-c000-000000000011', '00000000-0000-4000-b000-000000000011', '2026-07-27', 'locked',
   '00000000-0000-4000-a000-000000000011', now() - interval '2 days');

insert into report_sections (report_id, section, payload, updated_by) values
  ('00000000-0000-4000-c000-000000000011', 'general_notes', '{"text":"x"}',
   '00000000-0000-4000-a000-000000000011');
insert into report_crew (id, report_id, trade, headcount, hours) values
  ('00000000-0000-4000-d000-000000000001', '00000000-0000-4000-c000-000000000011', 'Electric', 4, 8.0);
insert into report_equipment (id, report_id, name, status) values
  ('00000000-0000-4000-d000-000000000002', '00000000-0000-4000-c000-000000000011', 'Lift', 'active');
insert into report_work_performed (id, report_id, trade, area, note) values
  ('00000000-0000-4000-d000-000000000003', '00000000-0000-4000-c000-000000000011', 'Electric', 'L2', 'conduit');
insert into report_delays (id, report_id, cause) values
  ('00000000-0000-4000-d000-000000000004', '00000000-0000-4000-c000-000000000011', 'rain');
insert into report_safety_observations (id, report_id, obs_type) values
  ('00000000-0000-4000-d000-000000000005', '00000000-0000-4000-c000-000000000011', 'observation');
insert into report_weather (report_id, weather_source) values
  ('00000000-0000-4000-c000-000000000011', 'none')
on conflict (report_id) do nothing;

-- ── (b) trigger layer: auth.uid() non-null + GUC unset ⇒ P0001 per table ────
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-a000-000000000011","role":"authenticated"}', true);

select throws_ok($$update report_sections set payload = '{"text":"y"}'
  where report_id = '00000000-0000-4000-c000-000000000011'$$,
  'P0001', null, 'report_sections locked-guard fires');
select throws_ok($$update report_crew set headcount = 5
  where report_id = '00000000-0000-4000-c000-000000000011'$$,
  'P0001', null, 'report_crew locked-guard fires');
select throws_ok($$update report_equipment set status = 'idle'
  where report_id = '00000000-0000-4000-c000-000000000011'$$,
  'P0001', null, 'report_equipment locked-guard fires');
select throws_ok($$update report_work_performed set note = 'y'
  where report_id = '00000000-0000-4000-c000-000000000011'$$,
  'P0001', null, 'report_work_performed locked-guard fires');
select throws_ok($$update report_delays set cause = 'wind'
  where report_id = '00000000-0000-4000-c000-000000000011'$$,
  'P0001', null, 'report_delays locked-guard fires');
select throws_ok($$update report_safety_observations set description = 'y'
  where report_id = '00000000-0000-4000-c000-000000000011'$$,
  'P0001', null, 'report_safety_observations locked-guard fires');
select throws_ok($$update report_weather set override_condition = 'sunny'
  where report_id = '00000000-0000-4000-c000-000000000011'$$,
  'P0001', null, 'report_weather locked-guard fires');

-- delete is guarded too (one representative table)
select throws_ok($$delete from report_crew
  where id = '00000000-0000-4000-d000-000000000001'$$,
  'P0001', null, 'locked-guard fires on DELETE');

-- the amendment GUC bypass (worklog.allow_locked_write) — transaction-local
select lives_ok($$
  do $b$ begin
    perform set_config('worklog.allow_locked_write', 'on', true);
    update report_sections set payload = '{"text":"amended"}'
      where report_id = '00000000-0000-4000-c000-000000000011';
    perform set_config('worklog.allow_locked_write', '', true);
  end $b$;$$,
  'GUC bypass admits the amendment write path');

-- ── (a) grants layer: authenticated cannot write report tables at all ───────
set local role authenticated;
select throws_ok($$insert into report_crew (id, report_id, trade, headcount, hours)
  values (gen_random_uuid(), '00000000-0000-4000-c000-000000000011', 'X', 1, 1)$$,
  '42501', null, 'authenticated has no INSERT on report_crew');
select throws_ok($$update daily_reports set status = 'draft'
  where id = '00000000-0000-4000-c000-000000000011'$$,
  '42501', null, 'authenticated has no UPDATE on daily_reports');
reset role;

-- ── sweeper: stale submitted → locked, actor null; fresh stays ──────────────
select set_config('request.jwt.claims', '', true);
insert into daily_reports (id, project_id, report_date, status, created_by, submitted_at) values
  ('00000000-0000-4000-c000-000000000012', '00000000-0000-4000-b000-000000000011', '2026-07-26', 'submitted',
   '00000000-0000-4000-a000-000000000011', now() - interval '48 hours'),
  ('00000000-0000-4000-c000-000000000013', '00000000-0000-4000-b000-000000000011', '2026-07-31', 'submitted',
   '00000000-0000-4000-a000-000000000011', now() - interval '1 hour');

select is(lock_stale_submitted_reports(), 1, 'sweeper locks exactly the stale report');
select is((select status from daily_reports where id = '00000000-0000-4000-c000-000000000012'),
  'locked'::report_status, 'stale submitted is locked');
select is((select locked_by from daily_reports where id = '00000000-0000-4000-c000-000000000012'),
  null, 'auto-lock has no acting user');
select is((select status from daily_reports where id = '00000000-0000-4000-c000-000000000013'),
  'submitted'::report_status, 'inside-grace report is untouched');

select * from finish();
rollback;
```

- [ ] **Step 2: Run** — `supabase test db` in `../jobsight-backend`; all 16 pass (same seed-shape adjustment license as Task 10 — fix test SQL, never migrations; if a guard test FAILS because the trigger doesn't fire, that is a REAL FINDING — stop and report, do not adapt the test).
- [ ] **Step 3: Commit (backend repo) + PR** — `git add supabase/tests/worklog_locked_guard_test.sql && git commit -m "test(worklog): pgTAP locked-row guard + sweeper suite"`, push `feat/worklog-pgtap`, open a PR with `gh pr create` summarizing both test files and the M4a cross-repo gate they close.

---

### Task 12: Maestro flow, docs, and the final gate

**Files:**
- Modify: `.maestro/report-sections.yaml`, `.maestro/README.md`, `docs/architecture/01-work-plan.md`

- [ ] **Step 1: Extend the Maestro flow** — after the existing section-editing assertions in `.maestro/report-sections.yaml`, append the submit path (testIDs from Tasks 8/9):

```yaml
# ── M4a: submit the draft ─────────────────────────────────────────────
- scrollUntilVisible:
    element:
      id: 'report-submit'
- tapOn:
    id: 'report-submit'
- assertVisible:
    id: 'submit-signature-canvas'
# Draw a stroke across the WebView canvas (coordinates are % of screen):
- swipe:
    start: 30%, 60%
    end: 70%, 65%
- tapOn:
    id: 'submit-confirm'
# The sheet closes; the chip flips optimistically, then the drain syncs it:
- extendedWaitUntil:
    visible:
      id: 'sync-status-synced'
    timeout: 30000
```

(The swipe lands inside the canvas only if the sheet layout matches — tune the percentages on-device during validation; the flow's contract is the testIDs. If the WebView stroke proves flaky on the emulator, keep the flow to `report-submit` + `submit-signature-canvas` visibility and move the signature stroke to the on-device validation checklist — record whichever outcome in the README.)

- [ ] **Step 2: testID inventory** — add to `.maestro/README.md`'s inventory table: `report-submit`, `report-lock`, `report-lock-confirm`, `report-lock-cancel`, `submit-signer-title`, `submit-signature-canvas`, `submit-clear-signature`, `submit-confirm`. Run `npx jest src/maestroSelectors.test.ts` → PASS.
- [ ] **Step 3: Work-plan doc** — in `docs/architecture/01-work-plan.md`'s M3-status section, append: `- [x] **M4a** — lifecycle in UI (submit/lock + signature, read-only mode, namespaced lifecycle clientIds, pull-side status hold, pgTAP suite in jobsight-backend). Amendments UI and the doc-05 global coverage raise remain M4b+.`
- [ ] **Step 4: Full gates** — `npm run verify`; `npm run check:web` (in a FLAT worktree if executing from a nested one — nested `.claude/worktrees` breaks expo-router route scanning); `npm run check:parity` (needs `../jobsight-backend`; snapshot must be unchanged — this plan adds no columns).
- [ ] **Step 5: Commit** — `git add .maestro docs/architecture/01-work-plan.md && git commit -m "test(e2e): submit flow coverage; docs: record M4a"`

---

## Verification (whole-plan)

1. `npm run verify` green (incl. new suites: lifecycleGuards, mutationQueue lifecycleClientId, conflict lifecycleHeld, pullTables held-set, sqliteRepo submit/lock, supabaseRepo submit/lock, useSectionDraft readOnly, SafetySectionSheet readOnly).
2. `npm run check:web` green — proves the signature canvas never leaks into the web graph.
3. `npm run check:parity` green — no schema drift.
4. `supabase test db` green in `../jobsight-backend` (29 pgTAP assertions).
5. On-device (Pixel emulator + local Supabase, e2e-test profile): create → fill sections → **Submit** (sign) → chip shows Submitted immediately → drain → `psql`: `daily_reports.status='submitted'`, one `report_signatures` row, audit rows present → **Lock** → sections open read-only, no mutation enqueued on edit attempts → pull cycle does NOT regress a pending optimistic status (airplane-mode submit, re-enable network, watch the chip never flip back).
6. Maestro `report-sections.yaml` passes end-to-end with the submit extension.
