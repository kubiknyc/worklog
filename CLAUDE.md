# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# WorkLog

Offline-first Expo app for daily construction reports. Local SQLite is the read
path; every write goes through the sync queue in `src/sync/`.

## Layout

- `app/` — expo-router routes only (`(auth)`, `(tabs)`, `report/[id]`). Jest
  ignores `app/` entirely; anything worth testing belongs in `src/`.
- `src/data/` — the repository seam. `RepositoryProvider` injects a `Repository`
  (`src/data/types.ts`): native resolves to the SQLite repo via
  `platformRepo.native.ts`, web to the online-only `supabaseRepo.ts`, through
  Metro's built-in platform-extension resolution (plus `moduleSuffixes` in
  tsconfig for TypeScript). The provider is keyed on `userId`
  so an account switch rebuilds the repo and wipes the prior user's cache.
- `src/sync/` — pure sync policy (queue, conflict, cursors, paginate);
  persistence lives only in `store.native.ts`. `statusHub.ts` is the one
  sanctioned stateful exception (mutable module-level subscription state for
  the sync pill) — still zero IO; its counts producer is injected.
- `src/db/` — SQLite schema plus the server-column parity snapshot.
- `src/theme/` — `ThemeProvider` + `tokens.ts`; component tests must render
  inside the `ThemeProvider` wrapper.
- `src/components/` — shared UI (`PrimaryButton`, `TextField`, `SheetRow`, …);
  all accept and forward `testID`.

## Sibling repo dependency

The Supabase backend is **a separate clone at `../jobsight-backend`** — not a
subdirectory here, and not optional:

- `npm run gen:server-columns` reads `../jobsight-backend/supabase/migrations`
  and rewrites `src/db/serverColumns.generated.json`. Without the sibling clone
  it fails.
- Local Supabase runs from there (`supabase start`), and `.env.example` expects
  the URL/anon key from that stack's `supabase status`.

## Architecture docs

`docs/architecture/00-README.md` is the index — read it before changing sync,
the data model, or the photo/PDF pipelines. It records which cross-track design
conflicts are settled and which are still open decisions, so check its status
before implementing anything it lists as unresolved.

## Commands

`npm run verify` — typecheck + format:check + lint + test with coverage. This
is the gate; run it before claiming a change is done. CI runs the same thing.

`npm run check:web` — `expo export --platform web`. The real check that
`src/platformSplit.test.ts` approximates. CI runs it as its own job.

`npm run check:parity` — regenerates the server column snapshot from
`../jobsight-backend` and fails if it drifted from what is committed.

Single test file: `npx jest src/sync/conflict.test.ts` (jest-expo preset;
add `-t "name"` for one case). `npm test` always runs with coverage, so a
partial run can fail thresholds that a full run passes — expected.

E2E: `maestro test .maestro/` against a booted emulator with an `e2e-test`
profile build (`eas build --profile e2e-test --platform android`, enables
demo logins). See `.maestro/README.md`.

## Rules that bite

**After any backend schema change, run `npm run gen:server-columns`.** The
snapshot is checked in, and `src/db/schemaParity.test.ts` fails in both
directions when it drifts. Deliberate app-only or server-only columns get
declared in that test's `LOCAL_ONLY` / `SERVER_ONLY` maps — never by loosening
the assertion. CI's `schema-parity` job now regenerates from the live backend
and fails on drift, so a stale snapshot is caught rather than trusted.

**Anything an E2E flow will drive needs a `testID`.** Flows key on testIDs, not
visible copy — copy here is plain language and expected to change, so a text
assertion breaks for reasons unrelated to the behaviour. Naming convention and
the current inventory live in `.maestro/README.md`. Add them as screens are
built; retrofitting costs far more. `src/maestroSelectors.test.ts` (runs in
`verify`) asserts every `id:` a flow uses exists as a `testID` in source;
runtime-built testIDs go in its `DYNAMIC_TESTIDS` list, never by loosening the
assertion.

**Never OTA a SQLite schema or mutation-payload shape change.** A device that
has been offline for days holds queued mutations written in the *old* shape; an
update that changes how they are read lands on rows written by code that no
longer exists. Those changes ship as a store build, and the migration reads
both shapes for at least one release. `runtimeVersion` is on the `fingerprint`
policy so a native change can't receive an incompatible update.

**Adding a native-only dependency requires editing
`src/platformSplit.test.ts`.** Metro resolves static imports regardless of
`Platform.OS` branches, so one static import of a native module from a file in
the web graph breaks `expo export --platform web`. Add the module to
`NATIVE_ONLY_MODULES` and keep its usage in `*.native.ts(x)` files.

**`src/sync/mutationQueue.ts` is pinned at 100% branch/function/line coverage**
in `package.json`. This is deliberate — it is the quality spine of the sync
engine. Add tests to meet it; do not lower the threshold. `conflict.ts`,
`cursors.ts`, `paginate.ts`, and `db/schema.ts` carry their own ~90–95% pins in
the same `coverageThreshold` block.

**Report tables are SELECT-only to clients.** All lifecycle writes go through
`SECURITY DEFINER` RPCs on the server. Never add a direct client `INSERT`/
`UPDATE` against a report table to work around a missing RPC.

`src/sync/` and most of `src/db/` are pure and IO-free by design — persistence
lives in `store.native.ts`. Keep new policy logic pure so it stays testable
without a device.

## Agent skills

### Issue tracker

Issues live in GitHub Issues (`kubiknyc/worklog`), managed via the `gh` CLI.
See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage labels are used as-is (`needs-triage`, `needs-info`,
`ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See
`docs/agents/domain.md`.
