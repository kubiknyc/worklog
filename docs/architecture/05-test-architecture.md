# WorkLog — Test Architecture & Test Plan (Phase 2, Testing Track)

> Phase 2 deliverable, produced by the testing track. Covers test file layout, the platform-split grep guard, per-module test plans for the sync engine and adjacent pure logic, per-milestone (M0–M12) test gates, and coverage targets. Written against `FABLE5-PROMPT-worklog.md` §4.3/§6/§10 and `docs/PRD.md` (rev 3).

---

## A. Test architecture

### A.1 Pure vs. native — what is Jest-testable

The sync engine (and everything modeled on it) is split so that **all decision logic is pure TypeScript with zero native imports**, and only the I/O shell touches `expo-sqlite` / `@react-native-community/netinfo` / `AppState`. This split is what makes ~90% of the sync engine's risk surface unit-testable in plain Jest, no device or simulator required.

| Layer | File pattern | Native imports? | Jest-testable? | Verified by |
|---|---|---|---|---|
| Mutation/pull payload shapes, store seams | `src/sync/types.ts` | No | Yes (type-level + `newMutation` factory) | Unit |
| Public sync surface (`SyncState`/`SyncEngineApi`) | `src/sync/engineApi.ts` | No | Yes (shape/constant tests only) | Unit |
| Queue policy: classify, apply-outcome, drain order, storage-error normalization, duplicate-upload detection | `src/sync/mutationQueue.ts` | No | Yes — **the highest-value test target in the app** | Unit |
| Pull-vs-dirty-row conflict policy | `src/sync/conflict.ts` | No | Yes | Unit |
| Keyset pull cursors | `src/sync/cursors.ts` | No | Yes | Unit |
| Pull pagination | `src/sync/paginate.ts` | No | Yes | Unit |
| SQLite DDL strings + `DOMAIN_COLUMNS` map | `src/db/schema.ts` | No (pure strings, per spec §4.3) | Yes — schema-parity test reads these as text, never opens a DB | Unit |
| Report HTML assembly | `src/report/renderReportHtml.ts` | No (pure string templating) | Yes | Unit |
| Carry-forward candidate selection | `src/data/carryForward.ts` | No | Yes | Unit |
| Report-state / lifecycle guard predicates (`canEditSection`, `canAddPhoto`, etc.) | `src/data/lifecycleGuards.ts` (or `transitions.ts`) | No | Yes | Unit |
| Orchestrator: push-then-pull, single-flight, debounce, NetInfo/AppState wiring | `src/sync/engine.native.ts` | Yes | **No** — exercised via integration/E2E on-device, not Jest | Manual + E2E |
| Per-kind push handlers → Supabase | `src/sync/push.native.ts` | Yes | Partial — handler *shape* testable with a mocked Supabase client injected via `SyncContext` | Integration (mocked) |
| Keyset pulls → SQLite upserts | `src/sync/pull.native.ts` | Yes | Partial — same mocked-context pattern; upsert SQL needs on-device smoke | Integration (mocked) + manual |
| `MutationStore`/`CursorStore` over SQLite | `src/sync/store.native.ts` | Yes | No (thin adapter) | Manual / on-device smoke |
| Durable photo-bytes outbox | `src/sync/outbox.native.ts` | Yes | No | Manual / on-device smoke |
| `SyncContext` wiring | `src/sync/context.native.ts` | Yes | No (composition root) | Manual |
| Screens, sheets, chips, steppers | `app/**`, `src/components/` | Varies | Screens are thin by design — light RTL smoke tests where a component has real behavior; user-flow assurance is E2E later | RTL (thin) + E2E |

**Design consequence, not an afterthought:** because `push.native.ts` / `pull.native.ts` accept a `SyncContext` (db, mutations, cursors) as a param seam rather than importing `supabase` at module scope, their **per-kind branching logic** can be unit-tested by injecting a fake `SyncContext` whose `mutations`/`cursors` are in-memory implementations of the pure `MutationStore`/`CursorStore` interfaces, and whose Supabase calls are jest mocks. This is *integration-with-mocks*, not native-integration — it stays inside jest-expo.

ASSUMPTION: `push.native.ts`/`pull.native.ts` take `ctx: SyncContext` as an explicit parameter (mirroring the `SyncEngine` constructor pattern in the spec). If PunchLog's actual files import a module-level Supabase singleton instead, flag as a divergence to reconcile in Phase 3 — the testability property is worth the injection style.

### A.2 File layout — co-located with `src/`, never under `app/`

Hard rule from spec §6: Expo Router bundles every file under `app/` into the native bundle, so a colocated `*.test.tsx` there breaks the device build silently. **No test file may live under `app/`, ever.**

```
src/
├── sync/
│   ├── types.ts / types.test.ts
│   ├── engineApi.ts / engineApi.test.ts
│   ├── mutationQueue.ts / mutationQueue.test.ts     # highest-value suite in the repo
│   ├── conflict.ts / conflict.test.ts
│   ├── cursors.ts / cursors.test.ts
│   ├── paginate.ts / paginate.test.ts
│   ├── engine.native.ts                              # no .test.ts — native-only
│   ├── push.native.ts / push.native.test.ts          # mocked-context integration test
│   ├── pull.native.ts / pull.native.test.ts
│   ├── store.native.ts / outbox.native.ts / context.native.ts   # no unit tests
├── db/
│   ├── schema.ts / schema.test.ts                    # schema-parity test lives here
├── data/
│   ├── carryForward.ts / carryForward.test.ts
│   ├── lifecycleGuards.ts / lifecycleGuards.test.ts
│   ├── repository.ts                                 # interface only
│   ├── repository.sqlite.native.ts                   # no unit test
│   └── repository.supabase.web.ts                    # light unit test on request shaping ok
├── report/
│   ├── renderReportHtml.ts / renderReportHtml.test.ts
│   ├── printReport.native.ts / printReport.web.ts    # no unit tests
└── components/
    └── <Component>/<Component>.tsx + <Component>.test.tsx   # thin RTL smoke, where behavior exists

app/                                                   # Expo Router — NO test files here, ever
```

Test files sit **next to** the module they test (`*.test.ts` / `*.test.tsx`) — never a parallel `__tests__/` tree (co-location is PunchLog's existing pattern).

### A.3 jest-expo config essentials

```jsonc
// package.json (relevant slice) — ASSUMPTION: mirrors PunchLog's jest-expo baseline;
// confirm exact transformIgnorePatterns against PunchLog's package.json in Phase 3.
{
  "jest": {
    "preset": "jest-expo",
    "testEnvironment": "node",
    // CRITICAL: never let jest crawl into app/ — route files import native-only
    // modules at module scope; even coverage globbing can require() them.
    "testPathIgnorePatterns": ["/node_modules/", "<rootDir>/app/"],
    "collectCoverageFrom": [
      "src/**/*.{ts,tsx}",
      "!src/**/*.native.ts",
      "!src/**/*.d.ts",
      "!src/theme/fonts.ts"
    ],
    "coverageThreshold": {
      "global": { "branches": 80, "functions": 80, "lines": 80, "statements": 80 },
      "./src/sync/mutationQueue.ts": { "branches": 100, "functions": 100, "lines": 100, "statements": 100 },
      "./src/sync/conflict.ts": { "branches": 95, "functions": 100, "lines": 95, "statements": 95 },
      "./src/sync/cursors.ts": { "branches": 95, "functions": 100, "lines": 95, "statements": 95 },
      "./src/sync/paginate.ts": { "branches": 95, "functions": 100, "lines": 95, "statements": 95 },
      "./src/db/schema.ts": { "branches": 90, "functions": 100, "lines": 90, "statements": 90 }
    },
    "transformIgnorePatterns": [
      "node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|expo-.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg)/)"
    ]
  }
}
```

No test file imports `expo-sqlite`, NetInfo, or any `*.native` module directly — enforced by the grep guard below, not jest config.

### A.4 Platform-split grep guard — how it runs in CI/scripts

The guard from spec §4.3 must return **zero lines**. Wire it as an npm script and a required CI step:

```jsonc
// package.json scripts
{
  "scripts": {
    "test:guard:platform-split": "bash scripts/check-platform-split.sh",
    "test": "jest",
    "test:ci": "npm run typecheck && npm run test:guard:platform-split && jest --coverage"
  }
}
```

```bash
#!/usr/bin/env bash
# scripts/check-platform-split.sh
# Fails the build if any non-native, non-test file in src/ or app/ reaches a
# native-only module. Metro resolves static imports regardless of Platform.OS.
set -euo pipefail

MATCHES=$(grep -rln "from '.*\.native'\|expo-sqlite\|@react-native-community/netinfo" src app \
  --include='*.ts*' | grep -v test | grep -v '\.native\.' || true)

if [ -n "$MATCHES" ]; then
  echo "PLATFORM-SPLIT GUARD FAILED — native-only import reachable from shared code:"
  echo "$MATCHES"
  exit 1
fi

echo "Platform-split guard: clean."
```

- CI run order: `typecheck` → `platform-split guard` → `jest --coverage` (fail fast and cheap).
- ASSUMPTION: run unconditionally on every PR (sub-second) rather than path-filtered — a violation from an unrelated file (a screen importing `store.native.ts` directly) is exactly the failure mode this catches.

---

## B. Per-module test plans

### B.1 `src/sync/mutationQueue.ts` — the reliability spine (100% coverage)

**`classifyError` — mapping table (test every row + every boundary):**

| Input | Expected `ErrorClass` |
|---|---|
| `{ code: '42501' }` | `evict` |
| `{ status: 403 }` | `evict` |
| `{ code: '42501', status: 403 }` | `evict` (no contradiction) |
| `{ status: 401 }` | `retryable` (expired token, not authorization denial) |
| `{ status: 500 }` / `{ status: 503 }` | `retryable` |
| `{ status: 0, name: 'TypeError' }` | `offline` |
| `{ status: 0, message: 'Network request failed' }` / `'fetch failed'` / `'timeout exceeded'` | `offline` |
| `{ status: 0, message: 'weird unrelated message' }` | NOT `offline` — falls through to `retryable` |
| `{ code: '22001' }` / `{ code: '23514' }` / `{ code: '23505' }` | `permanent` |
| `{ code: 'P0001' }` / `{ code: 'P0002' }` / `{ code: 'PL001' }` | `permanent` |
| `{ code: 'PGRST301' }` (expired JWT) | `retryable` — **the regression test for the naive `startsWith('P')` bug the code comment calls out; must exist verbatim** |
| `{ code: 'PGRST116' }` | `retryable` |
| `{ status: 404 }` / `{ status: 422 }` / `{ status: 400 }` | `permanent` |
| `{}` / `undefined` / `null` / thrown string | `retryable` (safe default via `asError`) |
| Precedence: `{ code: '42501', status: 500 }` | `evict` (evict check precedes 5xx) |

**`applyOutcome` — test matrix:**

- Success → `{ next: null, evict: false }` regardless of prior attempts/status.
- **Offline never bumps attempts:** attempts=3 + offline → attempts stays 3, status stays `pending`, `lastError` updates, no evict. Also at the ceiling boundary (attempts=5 + offline → still `pending`).
- **Retry ceiling parks at exactly 5:** attempts=4 + retryable → attempts=5, `parked`; attempts 0–3 + retryable → still `pending`. Parametrized boundary test.
- `permanent` parks with `evict: false`; `evict`-class parks with `evict: true`; both bump attempts.
- Immutability: input `Mutation` object is never mutated (assert original reference unchanged).
- `lastError` is set on every failure path including offline (visible in the sync-status UI, never silently blank).

**`orderForDrain`:**

- JSON before photos regardless of input interleaving; relative (oldest-first) order preserved *within* each class — no re-sorting of a correctly-ordered input.
- Empty array in → empty array out; all-JSON and all-photo inputs pass through unchanged.
- Parametrized over the full `MutationPayload` kind union: every non-`add_photo` kind classifies as JSON (guards a future kind falling into the photo bucket by typo).

**`normalizeStorageError`:**

- String `statusCode: '403'` → numeric `status: 403` → `classifyError` returns `evict`.
- Numeric `statusCode` honored; numeric `status` preferred when both present.
- Unparsable `statusCode: 'abc'` → returns the **original** error unchanged (never `{status: NaN}`).
- Zero/missing status → original unchanged; non-object input passes through; normalized output shape is exactly `{ name, message, code, status }`.

**`isDuplicateUpload`:**

- `{ status: 409 }` → true; `{ statusCode: '409' }` → true; legacy `{ status: 400, error: 'Duplicate' }` → true; `{ message: 'The resource already exists' }` → true; case-insensitive.
- Genuine unrelated 400 (`'Invalid bucket name'`) → false; non-object/null → false, no throw.

**`rowTargetOf` / `otherMutationTargetsRow`** (ASSUMPTION: names carry over from PunchLog; verify in Phase 3):

- Every mutation kind resolves to a concrete row target (parametrized over the union).
- `update_section` targets are **section-scoped**, not report-scoped (two sections of the same report → different targets).
- `otherMutationTargetsRow`: true when another queued mutation targets the row; false when the excluded one was the only one; **a `parked` mutation still counts** (a parked write against a row means the row must keep its dirty protection — ASSUMPTION: confirm PunchLog semantics; the alternative silently drops dirty protection, violating invariant 6).

### B.2 `src/sync/conflict.ts`

- A dirty row with a pending mutation is never overwritten by an incoming pull; a clean row accepts the pull (normal LWW).
- `_dirty` stays set after one mutation succeeds if another queued mutation still targets the row; clears only after the **last** one completes.
- A suppressed pull produces a **surfaced conflict record** (row id, table, local vs server `updated_at`) — never a silent no-op (spec §5 requires a resolution surface).
- Applying the same server row twice is idempotent.
- Lifecycle/status fields are **not** merged by the generic LWW path — they change only via RPC results echoed on the next pull (documents the exclusion, guards against a future accidental merge branch).

### B.3 `src/sync/cursors.ts` + `src/sync/paginate.ts`

Cursors:
- Next cursor derives from the **last** row's `(updated_at, id)` tuple; identical `updated_at` tie-broken by `id` (stable, no skips or dupes across pages).
- Scopes fully isolated (`reports:projectA` never touches `reports:projectB` or `photos:projectA`).
- Empty page does **not** advance the cursor; composite cursor value round-trips through encode/decode losslessly.

Paginate:
- Stops on a short page; a full page triggers exactly one more fetch (never assumes exactly-full means done).
- Builds a strict greater-than keyset predicate from the cursor tuple (no off-by-one; boundary row excluded, not repeated).
- Null/absent cursor fetches from the start with no lower bound.

### B.4 Schema parity (`src/db/schema.test.ts`)

Asserts column agreement between the SQLite `DOMAIN_COLUMNS` map and the Postgres migration SQL — **without opening a database** (both are text sources).

ASSUMPTION: migration SQL reaches this test either as a vendored/synced copy of `jobsight-backend`'s relevant migrations in the app repo (reference copies are already mandated by spec §4.2), or via a cross-repo CI checkout — open Phase 3 CI wiring question.

Test cases:
- **Missing local column:** a Postgres column with no `DOMAIN_COLUMNS` counterpart → fails naming the exact table + column.
- **Missing remote column:** a `DOMAIN_COLUMNS` entry with no backing migration column → fails naming it.
- **`_`-prefixed local-only columns (`_dirty`, `_pending`):** two-assertion test — present in the local DDL strings AND excluded from the cross-check diff.
- **Type differences are not errors:** uuid/timestamptz → `TEXT` for the same column name never flags (name presence only, both directions).
- **Sync bookkeeping tables (`sync_mutations`, `sync_cursors`, `sync_meta`)** are on an explicit exclusion list (local-only by design).
- **New migration column with no local update** (fixture migration snippet) → fails loudly with a specific, actionable message.
- **Additive migration history:** columns added by later `ALTER TABLE ADD COLUMN` files union with the original `CREATE TABLE` columns.
- **Child tables without their own `updated_at`** (`report_crew`, …) are not required to have one.

### B.5 Report assembly / PDF HTML rendering (`renderReportHtml.test.ts`)

Pure `(model) => string`. String-output assertions; snapshot-style acceptable here (pure data serialization — the explicit carve-out in the global testing rules).

- All 11 sections render in fixed order with populated fixture data (parametrized).
- **Every section's empty state renders explicitly** — the header appears with "None reported"; a section never silently disappears (dispute-grade: considered-and-empty ≠ skipped).
- Safety's explicit "Nothing to report — affirmed by ⟨name⟩" renders **distinctly** from an unaffirmed empty section.
- Photo provenance line built from first-class columns (`Captured <date> <time> <tz> · <lat>, <lng> (±<accuracy> m)`); null GPS renders "location not recorded" — never a raw null/undefined/NaN.
- Library imports show both "Taken" and "Added" timestamps when they differ.
- Amended report: original sections unaltered + "Amended" stamp on affected sections + appendix (who/when/what, original preserved beside the correction); multiple amendments to one section all appear in order; zero amendments → no stamps and **no appendix section at all**.
- Signature block: drawn PNG + name + timestamp, or an explicit "Not signed" state (never an empty box).
- Weather shows auto snapshot + manual override together, each timestamped, when both exist.
- Page-number/generated-timestamp markers and a branding slot are present as structural markers.
- **Dual-renderer golden-output test** (PRD §15 #4) is a separate explicit target comparing both renderers on one reference fixture — ASSUMPTION: implemented in Phase 4/M7, RED from the moment `renderReportHtml` is stable so drift is caught when the server path lands.

### B.6 Carry-forward logic (`carryForward.test.ts`)

- **Last-report selection, not calendar-yesterday:** Monday selects the prior Friday's report across the weekend gap; no prior report → clean empty candidate set, no throw; multiple priors → single most recent only, never merged.
- **What carries:** crew rows (pre-checked, tagged as carried); equipment with prior on/off-site state pre-set; **open delays only** (resolved delays don't carry; ongoing ones carry with a "Still ongoing?" prompt); **open RFIs only**.
- **What never carries:** free-text description/notes fields in any section — asserted absent from the candidate set entirely, not just unchecked.
- Unchecking individual candidate rows excludes only those rows from the final payload.
- **No fabrication:** a trade explicitly recorded at zero headcount carries as zero — distinguished from a trade never entered (PRD risk #9, "carry-forward manufacturing false records").
- "Last report" resolution uses the project's timezone-derived `report_date`, not device-local midnight.

### B.7 Lifecycle guards, client-side (`lifecycleGuards.test.ts`)

UI-gating hints only — server RPCs are the enforcement ("Immutability that only exists in the UI is not immutability"). These tests ensure the client never *offers* an edit path the server would reject.

- `canEditSection` true only in `draft`; false for every one of the 11 sections in both `submitted` and `locked` (parametrized).
- `canAmend` true for `submitted` and `locked`, false for `draft`.
- `canAddPhoto` **never blocks capture** but returns a destination discriminator (direct-attach vs amendment-flow) by status — asserted as a typed result, not a bare boolean.
- `canRemovePhoto` true only in `draft`.
- `isAmended` derives from status + amendment count — never a stored fourth status literal (PRD assumption #23).
- **Guards are pure and total:** every guard returns a defined value for every `ReportStatus` union member (fail-closed allowed; fail-silent/undefined not) — parametrized over the full union × every guard.

---

## C. Per-milestone test gates (M0–M12)

Gates are additive: each milestone's gate includes all prior gates staying green, plus:

| Milestone | Must exist & pass before done | RED-first notes |
|---|---|---|
| **M0** | `tokens.test.ts` (palette/status/spacing values match spec verbatim — value assertions per the pure-data carve-out); `ThemeProvider` hydration test (`isHydrated` gate, `touchedRef` manual-change-wins-over-stale-persist); typecheck green; grep guard green (trivially). | RED-first for the hydration race — exactly the subtle-bug class TDD is for. |
| **M1** | Full schema-parity suite (§B.4) green against the `jobsight-backend` migrations existing by then; repository-interface contract test (a fake in-memory impl satisfies it); platform-split guard becomes a permanent required CI gate. | Parity is the textbook RED-first case: write against an intentionally incomplete `DOMAIN_COLUMNS` stub, watch it fail naming columns. |
| **M2** | `lifecycleGuards.test.ts` draft-path subset (section editors need `canEditSection` before RPCs exist), parametrized over all 11 sections; local optimistic-write round-trip smoke through the repository seam per section shape. | — |
| **M3** | Full `mutationQueue.test.ts` at 100% branch coverage (§B.1); `conflict/cursors/paginate` suites (§B.2/B.3); `engineApi` shape tests; mocked-context kind-routing tests for push/pull; `create_report` get-or-create contract test (mocked client — asserts re-parenting when a same-day conflict returns an existing id). | **Non-negotiable RED-first:** every §B.1 table row written as a failing test before implementation — the tests double as verification that the PunchLog replication is faithful. |
| **M4** | Full `lifecycleGuards.test.ts` (§B.7); integration test (mocked) that an edit attempt on a locked report is never even enqueued; **cross-repo gate:** the DB-level locked-row rejection test lives in `jobsight-backend`'s suite (pgTAP or equivalent) — M4 is not done on client tests alone. | ASSUMPTION: cross-repo gate named explicitly in M4 sign-off. |
| **M5** | Pure `wrongProjectFlag`/`computeGpsFlagForProject` tests: far → flag; near → ok; **project coords null → no-op, never flags, never throws** (rev-3 blocker fix); photo GPS null → no-op. `renderReportHtml` provenance-line cases green (photo data now exists). | RED-first for the null-coordinates no-op specifically, before the distance math, so the degrade path can't regress under threshold tuning. |
| **M6** | Full `carryForward.test.ts` (§B.6) incl. timezone-boundary and never-fabricates cases. | "Never carries notes" and "last report ≠ calendar-yesterday" written RED-first from PRD language — a naive `today - 1 day` first draft is the plausible wrong implementation this guards against. |
| **M7** | Full `renderReportHtml.test.ts` (§B.5); golden-output consistency test exists and passes against the reference fixture across both renderers. | Golden test exists and is RED from the moment `renderReportHtml` is stable, so drift is caught the first time the server path lands. |
| **M8** | Pure `shouldShowMicButton(platform, osVersion, supportsOnDevice)` predicate tests: iOS 17+ → true; Android 13+ with support → true; Android ≤12 → false; unknown → false (fail-closed, keyboard always present). No transcription-accuracy unit tests (manual/device verification). | — |
| **M9** | Pure `shouldFillWeather(report)` tests: null weather + no source → fill; null + `manual` → never fill (never fights an override); non-null (any source) → no fill. Edge-function contract integration-tested against a mocked Open-Meteo response shape. | RED-first for "never fights a manual override" — the exact bug class the PRD flags. |
| **M10** | Pure filter-predicate tests (project, date range, status, trade, keyword, has-incident, has-delay — independently and combined) over a fixture list; cursors/paginate re-exercised with a 1000+ row fixture under a light time-budget smoke. | — |
| **M11** | Rollup aggregation as a pure function over relational fixture rows (Mon–Sun in project TZ); customization enforcement-split test: client surfaces required-field hints but does NOT block solely client-side — server RPC is the enforcement point (PRD §15 #8). | — |
| **M12** | WorkLog-side unit tests cover only the two-tier UI state machine and correct routing to the extended function (mocked). **Cross-repo gate:** the seeded-account cascade test (every WorkLog table + storage path empty; sign-in fails in both apps) is owned by `jobsight-backend`'s suite — a named dependency in M12's DoD, not certifiable by WorkLog's jest run. | ASSUMPTION as stated. |

Every milestone additionally requires (spec §10): `tsc --noEmit` green under strict, and the platform-split grep guard green (mandatory from M1 onward).

---

## D. Coverage targets

Applying the global 80% floor with per-layer targets adjusted for a sync-engine-heavy app with thin screens:

| Layer | Target | Rationale |
|---|---|---|
| `src/sync/mutationQueue.ts` | **100%** all metrics | Every branch is a distinct real-world failure mode; an untested branch is a silent-data-loss risk class. |
| `conflict.ts`, `cursors.ts`, `paginate.ts` | **~95%+** | Pure utilities carrying the offline-correctness invariants. |
| `types.ts`, `engineApi.ts` | 100% of the *testable surface* (runtime values `RETRY_CEILING`, `IDLE_SYNC_STATE`, `newMutation`) — line % is a poor metric for mostly-type files. | |
| `src/db/schema.ts` | **~90%** | Parity-diff logic branches fully covered per §B.4. |
| `renderReportHtml.ts` | **~90%+** | Legal-document-generating code — closer to the sync engine's risk class than to a presentational component. |
| `carryForward.ts`, `lifecycleGuards.ts` | **~90%+** | Every branch maps to a named PRD risk item. |
| `push.native.ts`, `pull.native.ts` | **~70–80%** of kind-routing logic via mocked-context tests; native I/O calls excluded from the denominator. | The "container" layer; pure decision logic is already covered upstream. |
| `engine.native.ts`, `store/outbox/context.native.ts` | **Excluded from the Jest coverage denominator** (`collectCoverageFrom` excludes `*.native.ts`) — covered by on-device smoke + later E2E. | Forcing a number here would be fake (over-mocked) or blocked on emulator-in-CI infra. |
| Screens (`app/**`) + presentational components | Smoke-only RTL where real behavior exists; critical-path E2E later (Detox/Maestro, scoped alongside M7+). No numeric floor on route-shell code; **no test files under `app/` regardless.** | Screens are thin by design; logic lives in `src/` and is tested there. |
| **Global floor** | **80%** over `collectCoverageFrom` (src, excluding `*.native.ts`) | A regression backstop, not the primary signal — the per-module targets above all exceed it. If the global floor ever fails while per-module thresholds pass, new code was added outside this table: assign it a target, don't lower the floor. |

---

### D.1 Interim floor and ratchet plan (added 2026-07-25, M2)

The 80% global floor above is the **target**, not the current gate. Measured at
`chore/build-workflow` with `collectCoverageFrom` widened from `src/sync/*.ts`
to all of `src/` (excluding `*.native.*`, `types.ts`, `index.ts`, `fonts.ts`,
`supabase/client.ts`), actual coverage was:

| Metric | All of `src/` | Global pool (after per-file thresholds are subtracted) |
|---|---|---|
| Statements | 64.42% | 58.11% |
| Branches | 54.40% | 43.19% |
| Functions | 63.13% | 57.97% |
| Lines | 66.00% | 60.48% |

Jest subtracts files carrying their own path threshold from the global pool, so
the right-hand column is what `global` actually gates. The floor is set a few
points under it (`55/40/57/55`) so CI is green today and any *regression* fails.
That tuple is **statements / branches / functions / lines**, matching the table
order above — `package.json` had `functions` and `lines` transposed against it
until #15; the order is load-bearing, so keep the two in step when ratcheting.

**On the `supabase/client.ts` exclusion (revised by #15).** Every other entry in
that exclusion list is logic-free. `client.ts` was not: it carried the chunked
SecureStore session adapter, so a security-critical path sat at 0% and invisible
to every threshold. The logic now lives in `src/supabase/storageAdapters.ts`,
which is **inside** `collectCoverageFrom` and pinned in `coverageThreshold`.
`client.ts` keeps the exclusion because what remains is module-scope wiring that
cannot be imported without side effects — it throws on missing env vars,
constructs a live client, and registers an `AppState` listener. The rule the
exclusion list now follows: *a file may be excluded only if it has no branchable
logic.* If logic lands in `client.ts` again, extract it rather than re-widening
the exclusion.

**Ratchet, not a resting place.** Raise the floor at each milestone gate:

| Gate | Global floor | What gets it there |
|---|---|---|
| M3 (sync engine complete) | 65 / 55 / 68 / 65 | `push/pull.native.ts` mocked-context tests; `engineApi` shape tests |
| M4 (lifecycle) | 72 / 62 / 74 / 72 | full `lifecycleGuards.test.ts`; `src/data` write-path coverage |
| M7 (PDF) | **80 / 80 / 80 / 80** — the §D target | `renderReportHtml` suite; `carryForward` suite; component RTL smoke |

The uncovered mass today is concentrated and known: `src/components/` (49.75%
statements — most presentational components have no test at all),
`src/data/` (27.21% — `supabaseRepo.ts`, `createProject.ts`, `inviteMember.ts`
are 0%), and `src/lib/` (2.38% — `errors.ts` and `time.ts` are 0%). `src/lib`
is the cheapest win and should go first; it is pure and small.

Per §D's own rule: if the global floor fails while every per-module threshold
passes, code was added outside the table above. Assign it a target — do not
lower the floor.

---

## Assumptions register (this document)

- `push/pull.native.ts` accept an injected `SyncContext` (not a module-scope singleton) to enable the mocked-integration seam — verify against PunchLog in Phase 3.
- `rowTargetOf`/`otherMutationTargetsRow` names and "parked still counts" semantics carry over from PunchLog — verify in Phase 3.
- Schema-parity access to `jobsight-backend` migrations = vendored copy or cross-repo CI checkout — open Phase 3 CI wiring question.
- The dual-renderer golden-output test is Phase 4/M7 implementation scope — flagged so it isn't dropped between phases.
- `transformIgnorePatterns` mirrors PunchLog's actual config — confirm in Phase 3.
- The DB-level locked-row rejection test (M4) and deletion cascade test (M12) are owned by `jobsight-backend`'s suite — explicit cross-repo DoD dependencies.
- Pure `computeGpsFlagForProject` (M5) and `shouldShowMicButton` (M8) predicates are extracted from native flows for testability — if implementation inlines them into `.native.ts`, that's a testability regression to flag.
