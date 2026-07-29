# M3a — Sync Engine Push Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Queued JSON mutations actually drain to Supabase through the five lifecycle RPCs, the sync engine publishes real `SyncState` through `statusHub` (retiring the M2 counter), and parked mutations get a tappable retry surface.

**Architecture:** Pure engine core (`engine.ts`) with injected store/pusher/publish seams, thin native shell (`engine.native.ts`) binding NetInfo/AppState/SQLite/Supabase. Push handlers map `MutationPayload` → RPC calls via a pure mapping module (`push.ts`); IO lives only in `push.native.ts` + `reparent.native.ts`. The hub gains `attachEngine` and keeps `setCounter` solely for the online-only fallback.

**Tech Stack:** Expo / React Native, TypeScript strict, supabase-js (PostgREST RPCs), expo-sqlite via existing `Db` seam, `@react-native-community/netinfo` (new dep), Jest (jest-expo).

**Scope cuts (deliberate):**
- Pull path (Tier 1/2 scopes, cursors, reconcile, `completedPulls` bumps) → follow-up plan **M3b**. In M3a `completedPulls` stays `0`.
- Photo kinds (`add_photo`, `update_photo_meta`, `remove_photo`) → **M5**. `rpcCallOf` throws on them; `orderForDrain` already sequences them last so a thrown mapping is unreachable until M5 enqueues one.
- `amend_report`'s returned `amendment_number` is ignored — the M3b pull backfills the local row (doc 06 §A note). `update_section`'s returned `timestamptz` likewise ignored.
- Evict-class (403) on JSON kinds: park + `reportSyncIncident('evicted', …)`, **no local row deletion** — the authoritative evictor is M3b's membership sweep. Deleting a local report tree on a transient RLS misread would destroy evidence.

## Global Constraints

- `npm run verify` green before claiming done (typecheck + format + lint + jest w/ coverage). `npm run check:web` green (CI runs it separately).
- `src/sync/` stays pure and IO-free except `*.native.ts` files and the sanctioned `statusHub.ts`.
- Every new native-only import goes in `*.native.ts(x)` files AND `NATIVE_ONLY_MODULES` in `src/platformSplit.test.ts:12` (currently `['expo-sqlite', '@sentry/react-native', 'expo-updates']`).
- Anything an E2E flow drives needs a `testID`; new testIDs follow `.maestro/README.md` naming; `src/maestroSelectors.test.ts` must stay green.
- `mutationQueue.ts` is pinned at 100% coverage in `package.json` `coverageThreshold`; do not lower any pin. New `engine.ts` and `push.ts` get their own 95-line pins (Task 9).
- Report tables are SELECT-only to clients — all writes in this plan go through the five `SECURITY DEFINER` RPCs; never add a direct client INSERT/UPDATE on a report table.
- No `console.log`; use `src/lib/observability*` seams.
- Conventional commits (`feat:`/`fix:`/`test:`/`chore:`), no attribution footer.

## Design references (read before starting a task)

- `docs/architecture/06-sync-mappings.md` — authoritative kind→RPC mapping, drain rules, blessed flattened `RowTarget`.
- `src/sync/types.ts` — `Mutation`, `MutationPayload`, `MutationStore`, `QueueCounts`.
- `src/sync/mutationQueue.ts` — `orderForDrain`, `applyOutcome`, `classifyError`, `rowTargetOf`, `otherMutationTargetsRow`, `PushOutcome`, `RETRY_CEILING`.
- `src/sync/engineApi.ts` — `SyncEngineApi`, `SyncState`, `IDLE_SYNC_STATE` (the contract `engine.ts` implements).
- `src/sync/statusHub.ts` — hub internals; M2 counter mode.
- `src/sync/store.native.ts` — `createMutationStore(db)`, fake-Db test harness pattern in `store.native.test.ts`.
- RPC signatures (jobsight-backend `20260717000007_worklog_rpcs.sql`):
  - `create_report(p_project_id uuid, p_report_date date, p_client_id uuid) returns table(report_id uuid, was_created boolean)`
  - `update_section(p_report_id uuid, p_section text, p_payload jsonb, p_is_complete boolean default false) returns timestamptz`
  - `submit_report(p_report_id uuid, p_signer_title text, p_signature_png bytea) returns void` — **no signer-name param**: the server derives the signer from `auth.uid()`; `SubmitReportPayload.signerName` is NOT sent.
  - `lock_report(p_report_id uuid) returns void`
  - `amend_report(p_report_id uuid, p_amendment_client_id uuid, p_reason text, p_changes jsonb, p_signer_title text default null, p_signature_png bytea default null) returns integer`

---

### Task 1: Pure RPC mapping — `src/sync/push.ts`

**Files:**
- Create: `src/sync/push.ts`
- Test: `src/sync/push.test.ts`

**Interfaces:**
- Consumes: `MutationPayload`, `Json` from `./types`.
- Produces: `interface RpcCall { readonly fn: 'create_report' | 'update_section' | 'submit_report' | 'lock_report' | 'amend_report'; readonly args: Readonly<Record<string, Json>> }`; `rpcCallOf(payload: MutationPayload): RpcCall`; `base64ToByteaHex(b64: string): string`. Task 4's `push.native.ts` calls both.

PostgREST decodes a `bytea` parameter from a `\x`-prefixed hex string, not base64 — hence `base64ToByteaHex`.

- [ ] **Step 1: Write the failing test**

```ts
// src/sync/push.test.ts
import { base64ToByteaHex, rpcCallOf } from './push';
import type { MutationPayload } from './types';

describe('base64ToByteaHex', () => {
  it('converts base64 to \\x-prefixed lowercase hex', () => {
    // 'AQID' is base64 for bytes 0x01 0x02 0x03
    expect(base64ToByteaHex('AQID')).toBe('\\x010203');
  });
  it('handles empty input', () => {
    expect(base64ToByteaHex('')).toBe('\\x');
  });
});

describe('rpcCallOf', () => {
  it('maps create_report', () => {
    const p: MutationPayload = {
      kind: 'create_report',
      data: { reportId: 'r1', projectId: 'p1', reportDate: '2026-07-28', carryForwardSourceReportId: null },
    };
    expect(rpcCallOf(p)).toEqual({
      fn: 'create_report',
      args: { p_project_id: 'p1', p_report_date: '2026-07-28', p_client_id: 'r1' },
    });
  });

  it('maps update_section (weather rides the same RPC)', () => {
    const p: MutationPayload = {
      kind: 'update_section',
      data: { reportId: 'r1', section: 'weather', content: { condition: 'Rain', tempF: 61 }, isComplete: true },
    };
    expect(rpcCallOf(p)).toEqual({
      fn: 'update_section',
      args: { p_report_id: 'r1', p_section: 'weather', p_payload: { condition: 'Rain', tempF: 61 }, p_is_complete: true },
    });
  });

  it('maps submit_report — signature as bytea hex, signerName never sent', () => {
    const p: MutationPayload = {
      kind: 'submit_report',
      data: { reportId: 'r1', signaturePngBase64: 'AQID', signerName: 'Pat', signerTitle: 'Super' },
    };
    expect(rpcCallOf(p)).toEqual({
      fn: 'submit_report',
      args: { p_report_id: 'r1', p_signer_title: 'Super', p_signature_png: '\\x010203' },
    });
  });

  it('maps lock_report', () => {
    const p: MutationPayload = { kind: 'lock_report', data: { reportId: 'r1' } };
    expect(rpcCallOf(p)).toEqual({ fn: 'lock_report', args: { p_report_id: 'r1' } });
  });

  it('maps create_amendment with null signature passing null bytea', () => {
    const p: MutationPayload = {
      kind: 'create_amendment',
      data: {
        amendmentId: 'a1', reportId: 'r1', reason: 'wrong crew count',
        changes: [{ section: 'crew', content: { rows: [] } }],
        signaturePngBase64: null, signerTitle: null,
      },
    };
    expect(rpcCallOf(p)).toEqual({
      fn: 'amend_report',
      args: {
        p_report_id: 'r1', p_amendment_client_id: 'a1', p_reason: 'wrong crew count',
        p_changes: [{ section: 'crew', content: { rows: [] } }],
        p_signer_title: null, p_signature_png: null,
      },
    });
  });

  it('throws on photo kinds (M5)', () => {
    const p: MutationPayload = {
      kind: 'remove_photo',
      data: { photoId: 'ph1', reportId: 'r1', storagePath: 'p1/r1/ph1.jpg' },
    };
    expect(() => rpcCallOf(p)).toThrow(/photo kinds are M5/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/sync/push.test.ts`
Expected: FAIL — `Cannot find module './push'`

- [ ] **Step 3: Write the implementation**

```ts
// src/sync/push.ts
/**
 * Pure payload → RPC mapping for the five lifecycle kinds (doc 06 §A).
 * Photo kinds are storage + direct table ops and land in M5; mapping them
 * here would be dead code the drain order can't reach yet.
 */
import type { Json, MutationPayload } from './types';

export interface RpcCall {
  readonly fn: 'create_report' | 'update_section' | 'submit_report' | 'lock_report' | 'amend_report';
  readonly args: Readonly<Record<string, Json>>;
}

/**
 * PostgREST decodes `bytea` params from `\x`-prefixed hex, not base64.
 * atob is available in Hermes and Node ≥ 16 (jest) alike.
 */
export function base64ToByteaHex(b64: string): string {
  const bytes = atob(b64);
  let hex = '\\x';
  for (let i = 0; i < bytes.length; i += 1) {
    hex += bytes.charCodeAt(i).toString(16).padStart(2, '0');
  }
  return hex;
}

export function rpcCallOf(payload: MutationPayload): RpcCall {
  switch (payload.kind) {
    case 'create_report':
      return {
        fn: 'create_report',
        args: {
          p_project_id: payload.data.projectId,
          p_report_date: payload.data.reportDate,
          p_client_id: payload.data.reportId,
        },
      };
    case 'update_section':
      return {
        fn: 'update_section',
        args: {
          p_report_id: payload.data.reportId,
          p_section: payload.data.section,
          p_payload: payload.data.content,
          p_is_complete: payload.data.isComplete,
        },
      };
    case 'submit_report':
      // signerName is display-only local state; the server derives the signer
      // from auth.uid() — sending it would just be an unused (and spoofable) arg.
      return {
        fn: 'submit_report',
        args: {
          p_report_id: payload.data.reportId,
          p_signer_title: payload.data.signerTitle,
          p_signature_png: base64ToByteaHex(payload.data.signaturePngBase64),
        },
      };
    case 'lock_report':
      return { fn: 'lock_report', args: { p_report_id: payload.data.reportId } };
    case 'create_amendment':
      return {
        fn: 'amend_report',
        args: {
          p_report_id: payload.data.reportId,
          p_amendment_client_id: payload.data.amendmentId,
          p_reason: payload.data.reason,
          p_changes: payload.data.changes as unknown as Json,
          p_signer_title: payload.data.signerTitle,
          p_signature_png:
            payload.data.signaturePngBase64 === null
              ? null
              : base64ToByteaHex(payload.data.signaturePngBase64),
        },
      };
    case 'add_photo':
    case 'update_photo_meta':
    case 'remove_photo':
      throw new Error(`photo kinds are M5 — no RPC mapping for '${payload.kind}'`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/sync/push.test.ts`
Expected: PASS (all cases)

- [ ] **Step 5: Commit**

```bash
git add src/sync/push.ts src/sync/push.test.ts
git commit -m "feat(sync): pure payload-to-RPC mapping for the five lifecycle kinds"
```

---

### Task 2: Dirty-clear helper — extend `src/sync/store.native.ts`

**Files:**
- Modify: `src/sync/store.native.ts` (append)
- Test: `src/sync/store.native.test.ts` (append, reuse the existing fake-Db harness)

**Interfaces:**
- Consumes: `RowTarget` from `./mutationQueue` (the shipped flattened `{ table, id }` shape — for `report_sections` the id is `` `${reportId}:${section}` ``, doc 06 §A blessed deviation); `Db`, `run` from `../db/rows.native`.
- Produces: `clearDirty(db: Db, target: RowTarget): Promise<void>` — Task 5's engine calls it after a successful push when `otherMutationTargetsRow` says the row is uncontested.

Doc 06 §A WHERE clauses: `daily_reports`/`report_amendments`/`report_photos` clear by `id`; `report_sections` splits the composite id and clears by `(report_id, section)` — and when the section is `weather`, the dirtied local row is `report_weather` (cleared by `report_id`), because the queue layer doesn't distinguish weather from other sections but the local mirror does.

- [ ] **Step 1: Write the failing tests** (in `store.native.test.ts`, same fake-Db style as the existing counter tests — assert the exact SQL + args passed to `run`)

```ts
describe('clearDirty', () => {
  it('clears daily_reports by id', async () => {
    const db = makeFakeDb(); // existing harness helper
    await clearDirty(db, { table: 'daily_reports', id: 'r1' });
    expect(db.statements).toContainEqual({
      sql: 'UPDATE daily_reports SET _dirty = 0 WHERE id = ?',
      args: ['r1'],
    });
  });

  it('clears report_sections by composite id', async () => {
    const db = makeFakeDb();
    await clearDirty(db, { table: 'report_sections', id: 'r1:crew' });
    expect(db.statements).toContainEqual({
      sql: 'UPDATE report_sections SET _dirty = 0 WHERE report_id = ? AND section = ?',
      args: ['r1', 'crew'],
    });
  });

  it('routes the weather section to report_weather', async () => {
    const db = makeFakeDb();
    await clearDirty(db, { table: 'report_sections', id: 'r1:weather' });
    expect(db.statements).toContainEqual({
      sql: 'UPDATE report_weather SET _dirty = 0 WHERE report_id = ?',
      args: ['r1'],
    });
  });

  it('clears report_amendments and report_photos by id', async () => {
    const db = makeFakeDb();
    await clearDirty(db, { table: 'report_amendments', id: 'a1' });
    await clearDirty(db, { table: 'report_photos', id: 'ph1' });
    expect(db.statements).toContainEqual({
      sql: 'UPDATE report_amendments SET _dirty = 0 WHERE id = ?',
      args: ['a1'],
    });
    expect(db.statements).toContainEqual({
      sql: 'UPDATE report_photos SET _dirty = 0 WHERE id = ?',
      args: ['ph1'],
    });
  });
});
```

(Adapt `makeFakeDb`/`db.statements` to whatever the existing harness actually records — read `store.native.test.ts` first and follow its idiom exactly.)

- [ ] **Step 2: Run to verify failure** — `npx jest src/sync/store.native.test.ts` → FAIL (`clearDirty` not exported)

- [ ] **Step 3: Implement** (append to `store.native.ts`)

```ts
import type { RowTarget } from './mutationQueue';

/**
 * Clear a pushed row's `_dirty` flag (doc 06 §A). Only call when no other
 * queued mutation still targets the row — the engine guards with
 * `otherMutationTargetsRow`. The weather section's dirtied local row lives in
 * `report_weather` even though the queue files it under `report_sections`.
 */
export async function clearDirty(db: Db, target: RowTarget): Promise<void> {
  if (target.table === 'report_sections') {
    const splitAt = target.id.indexOf(':');
    const reportId = target.id.slice(0, splitAt);
    const section = target.id.slice(splitAt + 1);
    if (section === 'weather') {
      await run(db, 'UPDATE report_weather SET _dirty = 0 WHERE report_id = ?', [reportId]);
      return;
    }
    await run(db, 'UPDATE report_sections SET _dirty = 0 WHERE report_id = ? AND section = ?', [
      reportId,
      section,
    ]);
    return;
  }
  await run(db, `UPDATE ${target.table} SET _dirty = 0 WHERE id = ?`, [target.id]);
}
```

(If the existing `run` helper's signature differs, match it; the WHERE shapes are the contract.)

- [ ] **Step 4: Run to verify pass** — `npx jest src/sync/store.native.test.ts` → PASS
- [ ] **Step 5: Commit** — `git add -A src/sync && git commit -m "feat(sync): clearDirty helper with weather-section routing"`

---

### Task 3: Re-parent transaction — `src/sync/reparent.native.ts`

**Files:**
- Create: `src/sync/reparent.native.ts`
- Test: `src/sync/reparent.native.test.ts` (fake-Db harness again)

**Interfaces:**
- Consumes: `Db`, `tx`, `run`, `first` from `../db/rows.native` (read `rows.native.ts` for exact signatures before writing); `Mutation` from `./types`.
- Produces: `reparentReport(db: Db, loserId: string, winnerId: string): Promise<void>` — Task 4's `create_report` handler calls it when the RPC returns a different `report_id` than the payload's.

Contract (doc 06 §A per-kind notes, verbatim requirements): in ONE SQLite transaction —
1. Rewrite `report_id = winnerId` on every `report_sections`, `report_weather`, `report_photos`, `report_amendments`, `report_crew`, `report_equipment`, `report_work_performed`, `report_delays`, `report_safety_observations` row where `report_id = loserId`.
2. Rewrite every OTHER queued `sync_mutations` row whose payload embeds the loser's `reportId`: JSON-parse the stored payload, replace `data.reportId`, and for not-yet-pushed photos also rewrite `data.storagePath` (`<projectId>/<loserId>/<photoId>.jpg` → `<projectId>/<winnerId>/<photoId>.jpg`). Re-serialize in place (same `seq`). Also rewrite composite `client_id`s of coalesced section mutations (`${loserId}:${section}` → `${winnerId}:${section}`) so future coalescing keys on the winner.
3. Delete the loser's `daily_reports` row.

If the transaction throws, everything rolls back and the `create_report` mutation stays pending — safe, because the RPC is get-or-create-idempotent and returns the same winner next attempt.

- [ ] **Step 1: Write failing tests** — cases: (a) child-table rows rewritten; (b) a queued `update_section` mutation for the loser has payload.reportId AND client_id rewritten; (c) a queued `add_photo` payload gets reportId + storagePath rewritten; (d) loser `daily_reports` row deleted; (e) mutations for unrelated reports untouched. Seed the fake Db's `sync_mutations` with JSON payload strings; assert the rewritten JSON.
- [ ] **Step 2: Run to verify failure** — `npx jest src/sync/reparent.native.test.ts` → FAIL
- [ ] **Step 3: Implement**

```ts
// src/sync/reparent.native.ts
import { run, selectAll, tx, type Db } from '../db/rows.native'; // match real helper names
import type { MutationPayload } from './types';

const CHILD_TABLES = [
  'report_sections', 'report_weather', 'report_photos', 'report_amendments',
  'report_crew', 'report_equipment', 'report_work_performed', 'report_delays',
  'report_safety_observations',
] as const;

/** [02 §C conflict surface 3] Re-home every local artifact of a losing
 * same-day report onto the server's winner, atomically. */
export async function reparentReport(db: Db, loserId: string, winnerId: string): Promise<void> {
  await tx(db, async (t) => {
    for (const table of CHILD_TABLES) {
      await run(t, `UPDATE ${table} SET report_id = ? WHERE report_id = ?`, [winnerId, loserId]);
    }
    const rows = await selectAll<{ client_id: string; payload: string }>(
      t, 'SELECT client_id, payload FROM sync_mutations', [],
    );
    for (const row of rows) {
      const payload = JSON.parse(row.payload) as MutationPayload;
      if (payload.kind === 'create_report' || payload.data.reportId !== loserId) continue;
      const data: Record<string, unknown> = { ...payload.data, reportId: winnerId };
      if (payload.kind === 'add_photo') {
        data.storagePath = payload.data.storagePath.replace(`/${loserId}/`, `/${winnerId}/`);
      }
      const nextClientId = row.client_id.startsWith(`${loserId}:`)
        ? `${winnerId}:${row.client_id.slice(loserId.length + 1)}`
        : row.client_id;
      await run(
        t,
        'UPDATE sync_mutations SET client_id = ?, payload = ? WHERE client_id = ?',
        [nextClientId, JSON.stringify({ ...payload, data }), row.client_id],
      );
    }
    await run(t, 'DELETE FROM daily_reports WHERE id = ?', [loserId]);
  });
}
```

(Match the real `tx`/`run`/`selectAll` helper names and signatures from `rows.native.ts`; the transaction + rewrite semantics are the contract.)

- [ ] **Step 4: Run to verify pass** — `npx jest src/sync/reparent.native.test.ts` → PASS
- [ ] **Step 5: Commit** — `git commit -am "feat(sync): atomic create_report collision re-parenting"`

---

### Task 4: Native pusher — `src/sync/push.native.ts`

**Files:**
- Create: `src/sync/push.native.ts`
- Test: `src/sync/push.native.test.ts` (mock rpc runner + fake Db; everything is injected, no jest.mock needed)

**Interfaces:**
- Consumes: `rpcCallOf` (Task 1), `reparentReport` (Task 3), `PushOutcome` from `./mutationQueue`, `Mutation` from `./types`.
- Produces: `type Pusher = (m: Mutation) => Promise<PushOutcome>`; `createPusher(rpc: RpcRunner, db: Db): Pusher` where `type RpcRunner = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>`. Task 6 wires `RpcRunner` to `(fn, args) => supabase.rpc(fn, args)`. Injecting the runner (not the whole client) keeps this file trivially testable.

Behavior:
- `rpcCallOf(m.payload)` → `await rpc(call.fn, call.args)`.
- `error` non-null → `{ ok: false, error }` (classification is `applyOutcome`'s job, not the pusher's).
- `create_report` success: PostgREST returns the `returns table` row as `[{ report_id, was_created }]` (array) — take `data[0]`. If `report_id !== m.payload.data.reportId`, `await reparentReport(db, loserId, report_id)` BEFORE returning `{ ok: true }`; a re-parent throw returns `{ ok: false, error }` so the mutation stays queued (retryable path).
- Any thrown exception (network) → `{ ok: false, error }`.

- [ ] **Step 1: Write failing tests** — cases: (a) success maps to `{ok:true}`; (b) RPC error object → `{ok:false, error}`; (c) thrown fetch error → `{ok:false, error}`; (d) create_report same-id success does NOT call reparent; (e) create_report collision calls reparent with (loser, winner) then `{ok:true}`; (f) reparent throw → `{ok:false}`.
- [ ] **Step 2: Verify failure** — `npx jest src/sync/push.native.test.ts` → FAIL
- [ ] **Step 3: Implement**

```ts
// src/sync/push.native.ts
import { rpcCallOf } from './push';
import { reparentReport } from './reparent.native';
import type { PushOutcome } from './mutationQueue';
import type { Mutation } from './types';
import type { Db } from '../db/rows.native';

export type RpcRunner = (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: unknown }>;

export type Pusher = (m: Mutation) => Promise<PushOutcome>;

export function createPusher(rpc: RpcRunner, db: Db): Pusher {
  return async (m) => {
    try {
      const call = rpcCallOf(m.payload);
      const { data, error } = await rpc(call.fn, call.args as Record<string, unknown>);
      if (error) return { ok: false, error };
      if (m.payload.kind === 'create_report') {
        const row = (Array.isArray(data) ? data[0] : data) as
          | { report_id: string }
          | undefined;
        const winner = row?.report_id;
        if (winner && winner !== m.payload.data.reportId) {
          await reparentReport(db, m.payload.data.reportId, winner);
        }
      }
      return { ok: true };
    } catch (error: unknown) {
      return { ok: false, error };
    }
  };
}
```

- [ ] **Step 4: Verify pass**, **Step 5: Commit** — `git commit -am "feat(sync): native pusher dispatching lifecycle RPCs with collision re-parenting"`

---

### Task 5: Pure engine core — `src/sync/engine.ts`

**Files:**
- Create: `src/sync/engine.ts`
- Test: `src/sync/engine.test.ts`

**Interfaces:**
- Consumes: `MutationStore`, `Mutation` from `./types`; `orderForDrain`, `applyOutcome`, `otherMutationTargetsRow`, `rowTargetOf`, type `PushOutcome`, type `RowTarget` from `./mutationQueue`; `SyncEngineApi`, `SyncState`, `IDLE_SYNC_STATE` from `./engineApi`.
- Produces:

```ts
export interface EngineDeps {
  readonly store: MutationStore;
  readonly push: (m: Mutation) => Promise<PushOutcome>;
  readonly clearDirty: (target: RowTarget) => Promise<void>;
  /** Report a park/evict for observability; injected so the core stays IO-free. */
  readonly onIncident: (kind: 'parked' | 'evicted', m: Mutation) => void;
  readonly isOnline: () => boolean;
}
export function createEngineCore(deps: EngineDeps): SyncEngineApi;
```

Task 6 instantiates it with native seams. `start()`/`stop()` are no-ops here (trigger wiring is the native shell's job) — the core owns `run()`, `retryParked()`, `getState()`, `subscribe()`.

Behavior contract for `run()`:
1. **Single-flight + coalesce**: a `run()` during a running cycle returns the same promise but marks dirty → one follow-up cycle runs after (same pattern as `statusHub.refresh()` — read it first).
2. Cycle: set `{ syncing: true, online: isOnline() }`, publish. Load `store.pending()`, `orderForDrain` it.
3. **Skip-dependents rule** (doc 06 §A): before pushing `m`, if the queue (from `store.all()`) holds a PARKED `create_report` whose `reportId` equals `m.payload.data.reportId`, skip `m` untouched (not an attempt).
4. Per mutation: `outcome = await push(m)`; `applied = applyOutcome(m, outcome)`.
   - `applied.next === null` (success): `store.remove(m.clientId)`; if `!otherMutationTargetsRow(await store.all(), m)` → `clearDirty(rowTargetOf(m.payload))`.
   - else `store.replace(applied.next)`; if `applied.next.status === 'parked'` → `onIncident(applied.evict ? 'evicted' : 'parked', m)`.
   - If the outcome classified offline (`applied.next !== null && applied.next.attempts === m.attempts`): set `online: false` and **stop draining** (the rest would fail identically).
5. End of cycle: recount from `store.all()` → `{ pending, parked }`; publish `{ online, syncing: false, pending, parked, lastError, completedPulls: 0 }` where `lastError` is the last applied mutation's error message or null after a clean drain.
6. `retryParked()`: `unpark` every parked clientId, then `run()`.
7. `run()` never rejects.

- [ ] **Step 1: Write failing tests** — use an in-memory `MutationStore` fake (array-backed, ~30 lines, matching the `MutationStore` interface). Cases:
  - drains two pending mutations in `orderForDrain` order, removes both, publishes `syncing:true` then final `{pending:0, syncing:false}`;
  - success clears dirty only when uncontested (queue a second mutation targeting the same row → no `clearDirty` call);
  - retryable failure bumps attempts and republishes counts; parked at ceiling fires `onIncident('parked', …)`;
  - offline outcome stops the drain (second mutation never pushed) and publishes `online:false`;
  - skip-dependents: parked `create_report` for r1 + pending `update_section` for r1 → section skipped, zero push calls for it, still pending after;
  - single-flight: two concurrent `run()`s → cycles run sequentially, both promises resolve;
  - `retryParked` unparks then drains;
  - subscriber sees stable snapshots (`getState()` identity changes only on publish).
- [ ] **Step 2: Verify failure** — `npx jest src/sync/engine.test.ts` → FAIL
- [ ] **Step 3: Implement** `createEngineCore` per the contract above. Keep it under ~150 lines; model the single-flight/dirty-cycle machinery on `statusHub.ts`'s `cycle`/`dirty` pattern. State updates are immutable (`state = { ...state, … }`) and `subscribe` follows the `engineApi` signature `(fn: (s: SyncState) => void)`.
- [ ] **Step 4: Verify pass** — also run `npx jest src/sync` to catch regressions.
- [ ] **Step 5: Commit** — `git commit -am "feat(sync): pure engine core — drain loop, skip-dependents, single-flight"`

---

### Task 6: Native shell — `src/sync/engine.native.ts` + NetInfo dependency

**Files:**
- Create: `src/sync/engine.native.ts`
- Modify: `package.json` (new dep), `src/platformSplit.test.ts:12` (`NATIVE_ONLY_MODULES` += `'@react-native-community/netinfo'`)
- Test: `src/sync/engine.native.test.ts` (jest-expo mocks NetInfo/AppState listeners; assert wiring, not behavior — behavior is Task 5's)

**Interfaces:**
- Consumes: `createEngineCore` (Task 5), `createMutationStore`, `clearDirty` (Task 2), `createPusher` (Task 4), `reportSyncIncident` from `../lib/observability.native`, `supabase` from `../supabase/client`, `Db`.
- Produces: `createSyncEngine(db: Db): SyncEngineApi` — Task 7's provider calls it.

- [ ] **Step 1: Install the dependency** — `npx expo install @react-native-community/netinfo` (expo-pinned version), then add it to `NATIVE_ONLY_MODULES`. Run `npx jest src/platformSplit.test.ts` → PASS.
- [ ] **Step 2: Write failing wiring tests** — `start()` subscribes NetInfo + AppState and kicks one `run`; connectivity regained → `run` fires; AppState `active` → `run` fires; `stop()` unsubscribes (no run on later events).
- [ ] **Step 3: Implement**

```ts
// src/sync/engine.native.ts
import NetInfo from '@react-native-community/netinfo';
import { AppState } from 'react-native';
import { createEngineCore } from './engine';
import { createMutationStore, clearDirty } from './store.native';
import { createPusher } from './push.native';
import { reportSyncIncident } from '../lib/observability.native';
import { supabase } from '../supabase/client';
import type { Db } from '../db/rows.native';
import type { SyncEngineApi } from './engineApi';

export function createSyncEngine(db: Db): SyncEngineApi {
  let online = true;
  const core = createEngineCore({
    store: createMutationStore(db),
    push: createPusher((fn, args) => supabase.rpc(fn, args), db),
    clearDirty: (target) => clearDirty(db, target),
    onIncident: (kind, m) =>
      reportSyncIncident(kind, { kind: m.payload.kind, clientId: m.clientId, attempts: m.attempts }),
    isOnline: () => online,
  });

  let unsubNet: (() => void) | null = null;
  let subApp: { remove(): void } | null = null;

  return {
    ...core,
    start() {
      unsubNet = NetInfo.addEventListener((s) => {
        const was = online;
        online = s.isConnected !== false;
        if (!was && online) void core.run();
      });
      subApp = AppState.addEventListener('change', (s) => {
        if (s === 'active') void core.run();
      });
      void core.run();
    },
    stop() {
      unsubNet?.();
      unsubNet = null;
      subApp?.remove();
      subApp = null;
    },
  };
}
```

(Adjust `reportSyncIncident`'s detail shape to the real `SyncIncidentDetail` in `src/lib/observabilityTypes.ts` — read it first.)

- [ ] **Step 4: Verify pass** — `npx jest src/sync/engine.native.test.ts src/platformSplit.test.ts`
- [ ] **Step 5: Commit** — `git commit -am "feat(sync): native engine shell with NetInfo/AppState triggers"`

---

### Task 7: Hub engine mode + provider wiring

**Files:**
- Modify: `src/sync/statusHub.ts` (add `attachEngine`), `src/sync/statusHub.test.ts` (new cases)
- Modify: `src/data/RepositoryProvider.tsx` + `src/data/platformRepo.native.ts` (engine lifecycle; read both files first — the M2 install site is `platformRepo.native.ts:176-181`)
- Test: existing suites + new hub cases

**Interfaces:**
- Produces: `SyncStatusHub.attachEngine(engine: Pick<SyncEngineApi, 'getState' | 'subscribe'>): () => void`.
- `setCounter` SURVIVES for exactly one caller: the online-only fallback (`setCounter(null)` on native local-DB failure and on sign-out). The counter-refresh path is otherwise dead once the engine attaches.

Hub contract for `attachEngine`:
- Bumps the epoch (discarding any in-flight count), detaches any counter, immediately publishes `{ ...engine.getState(), countError: false }`, then mirrors every engine publish. Returns a detach function that unsubscribes and resets the hub to idle (same reset semantics as `setCounter(null)`).
- `refresh()` while an engine is attached is a no-op that resolves (the engine owns state now; the nudge path no longer calls refresh anyway).

Provider contract (native): after `openDb()` + repo construction, `const engine = createSyncEngine(db)`; nudge becomes `() => void engine.run()` (replacing `() => void syncStatusHub.refresh()` at `platformRepo.native.ts:181`); on provider mount `syncStatusHub.attachEngine(engine); engine.start()`; on unmount/account-switch `engine.stop()` + detach. The `createMutationCounter` install is removed (its `store.native.ts` implementation stays — the retry surface reuses `store.all()`; delete only if nothing references it after Task 8). Web platform: unchanged (no engine, hub idle).

- [ ] **Step 1: Write failing hub tests** — attach publishes engine snapshot; engine publish mirrors through with `countError:false`; detach resets to idle and stops mirroring; `refresh()` no-ops while attached; attach after counter mode discards a pending count (epoch guard).
- [ ] **Step 2: Verify failure** — `npx jest src/sync/statusHub.test.ts` → FAIL
- [ ] **Step 3: Implement `attachEngine`**, keeping the existing counter machinery intact for the fallback path.
- [ ] **Step 4: Wire the provider** — follow the existing `active`-flag pattern in `RepositoryProvider` (the M2 counter install shows where lifecycle effects live; engine install replaces it 1:1, keyed on `userId` so an account switch rebuilds engine + hub attachment).
- [ ] **Step 5: Full gate** — `npm run verify && npm run check:web` (the provider renders in the web graph — `createSyncEngine` must only be referenced from `.native` files; the provider gets it via `platformRepo.native.ts`'s platform-split seam, same as the repo itself).
- [ ] **Step 6: Commit** — `git commit -am "feat(sync): engine publishes through statusHub; provider drives engine lifecycle"`

---

### Task 8: Retry surface — `app/settings/sync.tsx` + tappable banner

**Files:**
- Create: `app/settings/sync.tsx` (route) + `src/components/SyncQueueScreen.tsx` (testable body — Jest ignores `app/`)
- Modify: `src/components/SyncStatusBanner.tsx` (tappable → navigate; `attention` copy for engine `lastError`), `app/(tabs)/settings.tsx` (add a "Sync status" `SheetRow` linking to the route), `app/_layout.tsx` (register the stack route if layouts are explicit — read it first)
- Modify: `.maestro/README.md` (testID inventory)
- Test: `src/components/SyncQueueScreen.test.tsx`, extend `src/components/SyncStatusBanner.test.tsx`

**Interfaces:**
- Consumes: `useSyncStatus()` (existing hook), `store.all()` via a new repo-surface `listMutations(): Promise<Mutation[]>` — check `src/data/types.ts` for where to add it (native impl delegates to the mutation store's `all()`; web impl returns `[]`), and `engine.retryParked()` exposed through a new provider context value `retrySync: () => Promise<void>` (no-op on web).
- Produces testIDs (add to `.maestro/README.md` inventory): `sync-queue-screen`, `sync-queue-retry`, `sync-queue-row-<clientId>` (dynamic → `DYNAMIC_TESTIDS` in `src/maestroSelectors.test.ts` if a flow uses it), `sync-status` tap target (already exists).

Screen behavior: list queued mutations newest-first (`all()` already orders that way) with plain-language kind labels ("Report created", "Crew section", …), status ("waiting" / "needs attention"), and `lastError` detail for parked rows; a "Retry now" `PrimaryButton` visible when any row is parked, calling `retrySync()`. Banner: pressing it routes to `/settings/sync` (use `router.push` from `expo-router`); the banner's `attention` state now also triggers on engine `lastError` non-null with parked=0 ("Sync problem — tap to review") — distinct from `countError`'s "Can't check sync status".

- [ ] **Step 1: Write failing component tests** (inside `ThemeProvider` wrapper, per repo rule) — renders rows from injected mutations; retry button hidden when nothing parked; press calls the injected retry; banner press calls the injected navigate.
- [ ] **Step 2: Verify failure**, **Step 3: Implement** (component takes `mutations`/`onRetry` props — the route file only wires context hooks to the component, staying out of Jest's tree).
- [ ] **Step 4: Verify pass** — `npx jest src/components && npx jest src/maestroSelectors.test.ts`
- [ ] **Step 5: Commit** — `git commit -am "feat(sync): parked-mutation retry surface and tappable status banner"`

---

### Task 9: Coverage pins + full verification

**Files:**
- Modify: `package.json` `coverageThreshold` — add `src/sync/engine.ts` and `src/sync/push.ts` at `{ branches: 95, functions: 100, lines: 95, statements: 95 }` (mirror the statusHub pin's shape).

- [ ] **Step 1: Add the pins**, run `npm test` — if under threshold, add tests (do NOT lower pins).
- [ ] **Step 2: `npm run verify`** → green. **`npm run check:web`** → green (proves no native leak from the new modules).
- [ ] **Step 3: Commit** — `git commit -am "test(sync): pin engine and push mapping coverage"`

---

### Task 10: On-device E2E sanity + Maestro flow impact

The existing `.maestro/report-sections.yaml` asserts `sync-status-queued` AFTER section edits — once the engine drains against the local stack, that pill may flip back to `synced` before Maestro asserts, making the flow **newly flaky**. This task decides the flow's shape with a live engine.

- [ ] **Step 1: Boot the local recipe** (memory-recorded, 2026-07-27): Docker → `supabase start` in `../jobsight-backend` → guarded seed → emulator → `adb reverse tcp:54321 tcp:54321` + `tcp:8081` → `npx expo run:android` → prewarm bundle URL → `maestro test .maestro/report-sections.yaml`.
- [ ] **Step 2: If the queued assertion flakes**, update the flow: keep the queued assert only where a drain can't have completed (immediately after the tap, via `extendedWaitUntil` with a short timeout), and ADD a terminal `sync-status-synced` assertion after edits — the stronger end-to-end claim (edit → queued → drained → synced) the engine now makes true. Update `.maestro/README.md` accordingly.
- [ ] **Step 3: Verify a real drain landed** — `docker exec supabase_db_PUNCH-LOG-NEW psql -U postgres -d postgres -c "select id, status from daily_reports order by created_at desc limit 3;"` shows the report created by the flow.
- [ ] **Step 4: Commit** — `git commit -am "fix(e2e): report-sections flow asserts full queued-to-synced drain"`

---

## Self-review notes

- **Spec coverage:** engine natives ✔ (T5/T6), five RPC handlers ✔ (T1/T4), statusHub producer + setCounter retirement-in-practice ✔ (T7), retry surface ✔ (T8). The `didFallBackToOnlineOnly` fallback-banner item from the M2 handoff is **deferred to M3b** alongside the pull (it needs the online/offline truth the pull loop refines); recorded here so it isn't lost.
- **Type consistency:** `Pusher`/`RpcRunner` (T4) consumed by T6; `EngineDeps.clearDirty` matches T2's `clearDirty(db, target)` curried in T6; `RowTarget` is everywhere the shipped flattened `{table, id}` shape.
- **Placeholder scan:** helper names from `rows.native.ts` (`tx`/`run`/`first`/`selectAll`) are marked "match real signatures" — that is a read-the-file instruction, not a TBD; the WHERE/behavior contracts are fully specified.

## Follow-up plans (not this document)

- **M3b — pull path:** Tier 1 snapshot pulls (explicit `profiles` column list — `select('*')` 403s, doc 06 §B), Tier 2 keyset pulls per `SCOPES`, reconcile sweeps, `completedPulls`, weather ride-along, amendment-number backfill, online-only-fallback surface.
- **M5 — photo pipeline:** the three photo kinds' handlers + outbox.
