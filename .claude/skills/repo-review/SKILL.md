---
name: repo-review
description: Whole-repo code audit of WorkLog — sweeps every file in src/, app/, scripts/, .maestro/ and config for the defect classes a per-diff review structurally cannot see (guard-allowlist decay, cross-file drift, dead code, untested modules, doc↔code divergence, aggregate security posture). Use for "review the whole repo", "audit the codebase", a pre-milestone health check, or onboarding an unfamiliar area. For a single change or PR, use the worklog-reviewer agent instead.
allowed-tools: Read, Grep, Glob, Bash, Task, Agent, Write
---

# Whole-repo review

You are auditing the entire WorkLog repo, not a diff. Output is a written report.

**Change nothing in the repo** — no edits, no commits, no "while I was here"
fixes. The one file you create is the report, and it goes in the scratchpad:
that is why this skill carries `Write` and deliberately does not carry `Edit`.
If a gate dirties the worktree — `check:parity` does, by regenerating a tracked
snapshot — restore it before continuing, and verify the restore.

## How this differs from `worklog-reviewer`

The `worklog-reviewer` agent (`.claude/agents/worklog-reviewer.md`) reviews a
diff against the repo's hard invariants. It is the authority on what each
invariant *is* — **read it before you start and do not restate its list here.**

A diff review sees one side of a boundary at a time. This review exists for the
defects that only exist in the aggregate:

- a guard test whose allowlist has quietly grown until it guards nothing
- the same concept implemented two different ways in two modules
- a module nobody imports, or an export nobody calls
- a whole directory with no tests, passing because global thresholds are low
- documentation that describes code that no longer exists
- an invariant honored in 9 places and violated in the 10th

Every finding you report must be one a reviewer looking at a single commit
**could not** have found. If a finding would have been caught by
`worklog-reviewer` on the commit that introduced it, it still counts — but say
so, because that means a guard is missing.

## Step 0 — facts before opinions

Run the real gates first. A repo-wide review that reports model intuitions
while the actual checks are unrun is guessing.

```bash
# Test for entries, not for the directory: a fresh container has an empty
# node_modules/, where plain `ls node_modules` still exits 0.
[ -n "$(ls -A node_modules 2>/dev/null)" ] || echo "DEPS ABSENT — gates cannot run"

npm run verify; echo "verify=$?"   # typecheck + format:check + lint + test

# check:web needs the two public Supabase vars: src/supabase/client.ts throws
# when they are absent, so without them the gate fails for a reason that has
# nothing to do with the platform split. Placeholders suffice — the export
# needs them present, not valid. This mirrors ci.yml's web-export job.
EXPO_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co \
EXPO_PUBLIC_SUPABASE_ANON_KEY=placeholder-anon-key \
  npm run check:web; echo "check:web=$?"

# check:parity REGENERATES src/db/serverColumns.generated.json and only then
# diffs it, so on real drift it leaves the worktree dirty — exactly when it
# finds something. Restoring afterwards is only safe if the snapshot was clean
# going in: `git checkout --` would otherwise destroy someone's uncommitted
# edit (mid-schema-change is exactly when that file is dirty). If it is dirty,
# skip the gate and report NOT RUN — a review never trades someone's work for
# a gate result.
SNAP=src/db/serverColumns.generated.json
if git diff --quiet -- "$SNAP" && git diff --cached --quiet -- "$SNAP"; then
  npm run check:parity; echo "parity=$?"
  git checkout -- "$SNAP"
  git status --porcelain "$SNAP"   # must print nothing
else
  echo "parity=NOT RUN — $SNAP has uncommitted changes"
fi
```

**Check the exit code, not the tail of the output.** Piping a gate into `tail`
or `head` returns *that* command's status, so a failed gate reads as a pass —
this has already happened once on a calibration run.

Gates are unrunnable more often than you'd expect, and each failure mode looks
different:

- **`node_modules/` empty** (fresh container): `verify` dies at `tsc` with
  `Cannot find module 'react'` and `expo/tsconfig.base not found` — the
  environment, not the code. **Run `npm ci` first.** It takes a couple of minutes
  and converts two second-hand gate results into real ones; on the validated run
  it also made the coverage table available, which Pass E depends on. Report
  **NOT RUN** only if the install itself fails.
- **`../jobsight-backend` absent**: `check:parity` cannot run. Never infer
  parity from the committed snapshot — that is the thing being checked.

When a gate cannot run locally, fall back to the latest CI result for the
commit and **label it second-hand**. Do not silently report a gate as passing
because CI once did.

Capture the coverage table from `npm test`; Pass E depends on it.

Then read, in order: `CLAUDE.md`, `docs/architecture/00-README.md` (the index —
it records what is settled vs. still an open decision), `.maestro/README.md`,
`.claude/rules/`.

## Passes

The repo is ~160 source files — too much for one context to hold at review
depth. Run the six passes below as separate subagents (one each, dispatched in
parallel), give each the pass text plus Step 0's output, and require every
finding to arrive with a `file:line` and a concrete failure scenario. Then
dedupe and rank the merged set yourself. Reviewing sequentially in one context
is acceptable for a single pass on request, but not for a full audit — quality
collapses in the back half.

### Pass A — Guard integrity

This repo defends its invariants with executable guards. If a guard has gone
blind, every invariant behind it is unprotected and no diff review will notice.
Audit the guards themselves, not the code they guard:

- `src/platformSplit.test.ts` — is every native-only dependency in
  `package.json` present in `NATIVE_ONLY_MODULES`? Read the array (don't trust a
  list written here — it goes stale) and cross-check it against `dependencies`.
  A native dep that is *used* correctly but not *registered* means the guard is
  blind to every future use of it.

  Two separate questions here, and conflating them is the likeliest error in
  this pass:

  1. **Is the module native-only?** Decide that from the module itself — does
     its API work in a web bundle — and never from whether anything currently
     imports it. A new native dep imported *only* from `.native.` files keeps
     `web-export` green and still belongs in the array, because the array exists
     to catch the *next* import, the one from a file in the web graph. **A green
     export never clears a missing registration.**
  2. **Does a web-graph file import it today?** That is what turns the guard
     red, and it is a separate and more urgent finding.

  The array lists modules that must never appear in a non-`.native.` file — so a
  module the app *deliberately* imports from a shared file cannot be in it.
  `expo-secure-store` (`src/supabase/client.ts:14`), `expo-crypto` and
  `@react-native-async-storage/async-storage` are each imported from a shared
  file behind a `Platform.OS` branch with a real web fallback; they are correctly
  absent, and registering one would fail `platformSplit.test.ts` against a file
  that works as designed. Look for that deliberate web path before concluding
  either way.
- `src/maestroSelectors.test.ts` — every entry in `DYNAMIC_TESTIDS` is an
  assertion downgraded from "this testID exists" to "this prefix appears in
  this file." Is each one still genuinely runtime-built, or has a now-static
  testID been left in the escape hatch?
- `src/db/schemaParity.test.ts` — every entry in `LOCAL_ONLY` / `SERVER_ONLY`
  is a deliberate hole in parity. Does each still carry a comment justifying
  it, and is that justification still true?
- `package.json` `coverageThreshold` — do the per-file pins still name the
  files that matter? A pinned file that was split in two leaves the new half
  unpinned.
- `collectCoverageFrom` exclusions (`!src/**/types.ts`, `!src/**/index.ts`,
  `!src/lib/observability.web.ts`, …) — is each excluded file genuinely
  logic-free? An `index.ts` that grew real code is invisible to coverage.
- CI (`.github/workflows/ci.yml`) — does it run every gate the docs claim, and
  does each gate actually fail the build?

**Report a widened allowlist as its own finding**, separate from whatever it
lets through.

**Then audit each guard's *mechanism*, not just its allowlist.** This is where
the findings actually are: the 2026-07-30 full run found every allowlist honest
and four mechanisms broken. Ask of each guard:

- **What can its detector not see?** `platformSplit.test.ts`'s regex requires
  `from ` or `require(` immediately before the specifier, so a bare side-effect
  import — `import 'expo-sqlite/localStorage/install';` — is invisible. That form
  is already used in this repo (`src/supabase/client.ts:12`). Dynamic `import()`
  is unmatched too.
- **Can the assertion be satisfied by something that isn't the code?**
  `maestroSelectors.test.ts` asserts `toContain(prefix)` over a whole file, so a
  *prose comment* mentioning the prefix satisfies it while the template that
  builds the testID gets renamed. Confirm each prefix's occurrence is the
  template, not documentation.
- **Audit the generators, not only their output.** `scripts/gen-server-columns.mjs`
  builds each table from `CREATE TABLE` plus `add column`, minus `drop column`.
  It has no handler for `ALTER TABLE … RENAME COLUMN`, so a backend rename
  regenerates a byte-identical snapshot and the parity gate passes on precisely
  the cross-repo drift it exists to catch. Ask of any generator: which forms of
  its input can it not represent?
- **Is the pin falsifiable?** A `coverageThreshold` entry on a file with zero
  functions and zero branches reports 100/100/100/100 unconditionally — the
  number is decoration. Check whether the logic that pin stands in for is even in
  the denominator; `!src/**/*.native.ts` removes a great deal of it.
- **Does the guard prove it scanned anything?** `maestroSelectors.test.ts:97`
  asserts it found at least one flow — "guards against the whole suite passing
  vacuously if `.maestro` moves". A guard without that assertion passes having
  read zero bytes as soon as its scan root moves.

**These five examples were live defects when written, not hypotheticals** —
they are tracked as issues #14 and #15. They are here to show the *shapes*, not
to mark them settled: check whether each is still true, and hunt for new
instances of the same shapes. If an example has been fixed, the value is in the
shape it taught, so keep looking for the next one rather than deleting the
bullet.

### Pass B — Layering and boundaries

Build the import graph and check the seams hold *everywhere*:

- **Repository seam.** Screens and components import the `src/data` interface,
  never `src/supabase/client` directly. Compute the importer list rather than
  trusting one written here — `grep -rln "supabase/client" src app --include=*.ts
  --include=*.tsx | grep -v '\.test\.'`. As of 2026-07-30 it returns exactly six
  legitimate importers (`AuthProvider`, `supabaseRepo`, `createProject`,
  `inviteMember`, `platformRepo.native`, `engine.native`); treat a seventh as
  the finding, and anything under `app/`, `src/components/` or `src/hooks/` as
  the finding regardless of count.
- **Platform split, in reality not in theory.** For each non-native file,
  confirm no transitive path pulls in a native module — `check:web` proves the
  whole graph, the grep guard only proves direct imports.

  **A `*.native.ts(x)` file with no `*.web` sibling is normal, not a finding.**
  Seven of them have none today (`sqliteRepo`, `engine`, `push`, `reparent`,
  `store`, `rows`, `open`): the web graph simply never reaches them, because
  `platformRepo.web.ts` doesn't import them. The pairing that must exist is at
  the *seam* — `platformRepo.native` / `platformRepo.web` — not per file. Report
  a missing counterpart only when the web graph actually reaches the module.
- **`app/` is routes only.** No business logic, no tests, and nothing in `src/`
  importing from `app/`.
- **Cycles and orphans.** Circular imports; exported symbols with no importer;
  files nothing reaches; entries in `src/components/index.ts` re-exporting
  components no screen renders.
- **Duplication and drift.** Two implementations of the same idea — date/
  timezone handling, error shapes, id minting, retry/backoff, storage key
  formats. Say which one is correct and why.

### Pass C — The offline-first contract, end to end

The invariants live in `worklog-reviewer`; what this pass adds is *completeness*
— checking that the contract holds across every path, not the one in a diff:

- **Every offline-capable write goes through the queue.** Enumerate the mutating
  call sites in `src/data/` and `src/sync/` and account for each — but scope the
  *finding* to native, offline-capable report mutations. Several direct writes
  are deliberate and documented: `supabaseRepo.ts` is the online-only web repo
  and calls RPCs directly, and `createProject.ts`'s header explains why project
  creation is online-only on every platform and never touches the queue.
  Reporting those is a false HIGH. The real finding is a native report-mutation
  path that bypasses `mutationQueue`, or a read path that writes — check for a
  header comment sanctioning the direct write before reporting either.
- **Mutation-kind coverage.** Walk every kind in the `MutationPayload` union
  (`src/sync/types.ts`) against `rpcMap.ts`, the drain order in
  `mutationQueue.ts`, and its tests. Missing corners of that matrix are
  invisible per-diff.

  **Staged kinds are not gaps.** `add_photo`, `update_photo_meta` and
  `remove_photo` are declared in the union and deliberately unimplemented:
  `rpcMap.ts` throws `'photo kinds are M5'`, and `rpcMap.test.ts` asserts that
  throw. A kind whose absence is explicit, milestone-tagged and *tested* is a
  plan, not a defect — reporting those three would be three false findings on
  every run. The real finding is a kind with no handler **and** no explicit
  throw: one that falls through silently.

- **Conflict resolution is row-level, not per-kind.** Do not go hunting for a
  per-mutation-kind conflict table; there isn't one and there shouldn't be.
  `conflict.ts` is generic last-writer-wins on `updated_at` over any
  `MergeableItem` (`isServerNewer` / `mergeItem` / `resolveItem`). What actually
  matters: every pulled row type flows through `resolveItem`; `_dirty` clears
  exactly when the server row wins, since a stuck dirty flag shows the row as
  pending forever and re-merges it on every pull; and `_dirty` survives only
  while something queued still targets the row (`otherMutationTargetsRow`).
- **Idempotency and replay.** Every mutation must survive being sent twice
  (retry after an ambiguous failure) and being drained in a different order
  than enqueued. Check reparenting, cursor advancement, and tombstones against
  a replayed queue.
- **Failure paths.** For each network call: timeout, 409, 403, 5xx, and offline
  mid-drain. Look for a path that drops a queued mutation on the floor, or
  advances a cursor before the write is durable.
- **OTA shape compatibility.** A device offline for days holds rows *and* queued
  mutations written by code that no longer exists. Compatibility can come from
  **either** a migration/backfill that converts the old data before anything
  reads it, **or** a reader that handles both shapes — flag only when neither
  exists. Check the ordering too: a migration that runs after the first dependent
  read is not compatibility. On the validated run `MIGRATIONS[2]`
  (`ADD COLUMN revision … DEFAULT 0`, applied in the same transaction as the
  `PRAGMA user_version` stamp) *was* the both-shapes path, correctly — do not
  report a properly-migrated change.

  **Queued mutation payloads are the harder case.** A SQLite migration rewrites
  table rows; it does not touch payloads already serialized into the queue unless
  it explicitly rewrites them. So for a payload shape change, look for an explicit
  queue rewrite in the migration *or* a push handler that reads both shapes.
  Absent both, that is the device-bricking case — and per `CLAUDE.md` it ships as
  a store build, never an OTA.
- **Purity.** `src/sync/` and most of `src/db/` are IO-free by design
  (`statusHub.ts` is the one sanctioned stateful exception). Flag any import of
  a platform API into a pure module.

### Pass D — UI surface

- **Theme tokens.** Sweep for hardcoded colors and magic spacing:
  `grep -rn "#[0-9a-fA-F]\{3,8\}\b" src app --include=*.tsx`. Compare against
  `src/theme/tokens.ts`.
- **testID coverage.** Every interactive element an E2E flow will plausibly
  drive needs one, following `.maestro/README.md`'s convention. The guard only
  checks testIDs flows *already* reference — the gap is the reverse direction:
  new screens with no testIDs at all.
- **Dark mode and reduced motion.** Every surface renders in both themes;
  animations respect `useReducedMotion`.
- **Accessibility.** Touch targets **≥48×48 px** — this repo's own floor
  (`docs/PRD.md` AC-T1, for gloved field use), not the 44pt platform default, so
  a 44–47 px control is a spec regression. AC-T2 additionally requires ≥8 px
  between adjacent hit areas and ≥12 px between a stepper's `+`/`−`. Also labels
  on icon-only controls, and form fields associated with their labels.
- **React correctness at scale.** Effect cleanup (subscriptions, timers,
  `AbortController`), list keys that are never the index, functional `setState`
  in async paths, no `useEffect` computing derived state.
- **Copy.** Plain language; no internal labels (M6, R1, "phase", "Tier-2") in
  any user-facing string.

### Pass E — Test suite quality

Coverage percentage is the input, not the finding.

- **Untested modules.** Compute the list, never quote a remembered count:

  ```bash
  for f in $(find src \( -name '*.ts' -o -name '*.tsx' \) | grep -vE '\.test\.|\.d\.ts|/index\.ts$|types\.ts$'); do
    b="${f%.*}"; [ -f "$b.test.ts" ] || [ -f "$b.test.tsx" ] || echo "$f"
  done
  ```

  (Use the two `-f` tests, not `ls "$b".test.ts "$b".test.tsx` — `ls` exits
  non-zero when *either* operand is missing, so that version reports every file
  as untested. This has already burned one run.)

  Whatever it returns, the global thresholds (40/55/57/55) are low enough that
  every one of those files passes CI — that is the point, not the count. Rank by
  blast radius: `src/lib/errors.ts` and `src/db/rows.native.ts` matter far more
  than `Skeleton.tsx`. List them with a recommended priority; do not report each
  as its own finding.
- **Assertion quality.** Tests that assert implementation detail (call counts,
  internal shape) instead of behavior, or that would pass against a broken
  implementation. Check the 100%-pinned files hardest: `mutationQueue.ts` at
  100% coverage with weak assertions is worse than 80% with sharp ones, because
  the number says it is safe.
- **Race-prone tests.** Fake-timer misuse, unawaited promises, ordering
  assumptions between concurrent operations.
- **E2E flows.** Do `.maestro/*.yaml` cover the critical paths (login, create
  report, fill a section, sync while offline)? Does any flow assert on visible
  copy rather than a testID?
- **The provider wrapper rule.** Component tests must render inside
  `ThemeProvider`; a test that skips it is testing a component that cannot exist.

### Pass F — Security, config, and doc truth

- **Secrets.** Only `EXPO_PUBLIC_*` may reach the client bundle — this repo is
  public. Check `.env.example`, `app.json`, `eas.json`, and every
  `process.env` read.
- **PII in telemetry.** Sentry breadcrumbs, `console.log`, and error payloads
  must not carry report contents, photo metadata, GPS coordinates, or user
  identifiers beyond an opaque id.
- **Client-side trust.** Any check enforcing a permission or lifecycle rule in
  the client that the server does not also enforce (report tables are
  SELECT-only; lifecycle writes go through `SECURITY DEFINER` RPCs).
- **Dependencies.** `npm audit`; anything in `dependencies` that belongs in
  `devDependencies`. For SDK 54 drift, read CI's `deps` job rather than running
  `npx expo-doctor` here: `expo-doctor` is not a dependency of this repo, so an
  unpinned `npx` invocation downloads whatever version is current at review time
  and executes it. If you do run it locally, pin the version explicitly.
- **Doc↔code truth.** `CLAUDE.md`, `.maestro/README.md`, and
  `docs/architecture/` describing structure that no longer exists — wrong file
  paths, renamed modules, commands that fail. Also: `docs/architecture/00-README.md`
  has a **"Decisions needed from you"** section — read it there rather than
  trusting a list here, since it shrinks as decisions get made (as of
  2026-07-30: R1 photo tag edits, distribution-list scope, lock grace window).
  If code has silently implemented one, that is a HIGH finding regardless of
  which way it went.

## Known non-findings

Do not report these. They are settled, and re-reporting them each run is how a
review loses its audience.

**But they are adjudications, not permanent immunity.** Each was decided against
the repo as it stood on the date given, and a dependency bump, a new caller, or a
deleted test can invalidate the *basis* while the entry still says "don't
report". Before suppressing one, re-check the specific claim it rests on — it is
a grep or a single file read, not a re-investigation. If the basis no longer
holds, it is a finding again, and the entry here needs updating. Entries with no
stated basis (settled design decisions, deliberate repo conventions) need no
re-check.

- **Missing `CONTEXT.md` or `docs/adr/`.** `docs/agents/domain.md` says
  explicitly to proceed silently — they are created lazily by `/domain-modeling`.
- **`docs/architecture/00-README.md` marked "DRAFT — awaiting approval."**
  Known status, not drift.
- **No migrations in this repo.** They live in `../jobsight-backend` by design.
- **`src/sync/statusHub.ts` holding module-level mutable state.** The one
  sanctioned exception to sync purity.
- **Tests absent under `app/`.** Required, not a gap.
- **`FABLE5-PROMPT-worklog.md` at the repo root.** The spec of record.
- **Style, formatting, and naming preferences.** `prettier` and `eslint` own
  these; if they pass, there is no finding.
- **`expo-secure-store` / `expo-crypto` / `@react-native-async-storage/async-storage`
  missing from `NATIVE_ONLY_MODULES`.** Adjudicated 2026-07-30: each is imported
  from a *shared* file behind a `Platform.OS` branch with a real web fallback
  (`src/supabase/client.ts:14` and its `WebStorageAdapter` are the clearest
  case), so the array — a list of modules that must never appear in a
  non-`.native.` file — cannot contain them. Registering one would fail
  `platformSplit.test.ts` against a file that works as designed. Note this is
  *not* "the export is green, so it's fine": per Pass A, a green export never
  clears a missing registration.
- **`src/sync/engineApi.ts` unpinned and untested.** Its only runtime export is
  the `IDLE_SYNC_STATE` constant, covered via `statusHub.test.ts` and
  `engineCore.test.ts`.
- **The `deps` CI job's `continue-on-error: true`.** Documented as deliberately
  non-blocking at `.github/workflows/ci.yml:135-136`.
- **`react-native-webview`, `react-native-signature-canvas`, `expo-dev-client`
  in `dependencies` with no import sites.** Staged for later milestones. All
  three also resolve on web (verified in `node_modules` on 2026-07-30:
  `react-native-webview` ships a platform-unsupported fallback, `expo-dev-client`
  reaches `expo-dev-menu`'s `ExpoDevMenu.web.js`), so none is a
  `NATIVE_ONLY_MODULES` candidate either.
- **The pull-path primitives having no callers.** `conflict.ts`, `cursors.ts`,
  `paginate.ts` — plus `authLink.ts`, `createProject.ts`, `inviteMember.ts` —
  each carry a header naming the future consumer, each have tests, and the sync
  three carry their own coverage pins. Deliberate staging, not dead code. (Their
  unreachability *does* make Pass C checks vacuous — see Evidence discipline.)
- **The photo pipeline being unimplemented.** M5. The three photo mutation kinds
  throw `'photo kinds are M5'` and `rpcMap.test.ts` asserts the throw.

## Evidence discipline

A whole-repo sweep is the highest-false-positive review there is: you are
reading code without the context of the change that produced it. A reviewer
asked to find problems in 160 files will find some regardless.

Before reporting anything:

1. **Verify it.** Read the file, not just the grep hit. Check whether a guard,
   a test, or a type already prevents it.
2. **Construct the failure.** Name inputs or state that produce a wrong result.
   If you cannot, it is an observation, not a finding — cut it.
3. **Check it is not deliberate.** Search for a comment, test, or doc that
   sanctions it. The `LOCAL_ONLY`/`SERVER_ONLY`/`DYNAMIC_TESTIDS` allowlists all
   carry justifying comments; so do several apparent violations.
4. **Do not propose architecture.** "This would be cleaner as X" is not a
   finding. Defects, drift, and gaps are.
5. **Distinguish cleared from vacuous.** A check that passes because the code it
   examines has no callers yet has cleared nothing. On the validated run several
   Pass C checks were vacuous rather than clean — the pull-path primitives
   (`conflict.ts`, `cursors.ts`, `paginate.ts`) are unreachable today, so
   "every pulled row flows through `resolveItem`" and "no cursor advances before
   a durable write" were unverifiable, not verified. Reporting those as clean
   implies coverage that does not exist. Say which it was.

Ten verified findings beat sixty speculative ones. Report an empty section
plainly rather than filling it.

## Merging the passes

You dispatched six agents; the merge is yours, and it is not clerical work.

- **Verify every CRITICAL and HIGH at source before publishing.** Open the file
  and confirm the claim yourself. Subagents write confidently about things they
  half-checked. On the validated run every HIGH survived — but only because each
  was re-read, and one needed its framing corrected (a "silently implemented open
  decision" was really two authoritative docs contradicting each other, with the
  same schema consequence). State in the report which findings you verified
  yourself and which rest on a pass's own evidence.
- **Dedupe across passes.** Overlap is expected and is corroboration, not noise —
  the same defect surfacing in two passes independently is worth more than a
  single report of it. Merge into one finding and name both sources.
- **Arbitrate severity; passes disagree.** On the validated run the same
  milestone-labels-in-UI-copy finding came back MEDIUM from one pass and LOW from
  another, while `worklog-reviewer` rates internal labels HIGH. **The repo's own
  rubric wins**: defer to `.claude/agents/worklog-reviewer.md`, then to the PRD's
  acceptance criteria, before your own judgement.
- **Rank, don't concatenate.** Six lists stapled together is not a report. Lead
  with what would cost the most to discover in production, and be willing to
  promote: a finding a pass called HIGH may be CRITICAL once you see it causes
  silent, unrecoverable data loss.
- **Judge the run by its evidence, not its count.** For scale context only: the
  2026-07-30 run produced 38 raw findings → 35 after dedupe, across ~940k
  subagent tokens. That is history, not a target. Three well-evidenced findings
  on a clean repo is a good run; eighty is only a problem if they are unverified.
  Never pad toward a number, and never trim to one — the quality bar is whether
  each finding survived the evidence rules, which is the opposite of a quota.

## Output

Write the raw report to the scratchpad and summarize the top findings in chat.
That draft is working output, not an artifact — do not commit it.

Commit a report only once its findings are **resolved**: each one fixed (cite
the SHA), declined (say why), or filed as a GitHub issue (see
`docs/agents/issue-tracker.md`). The resolved version goes to
`docs/superpowers/reviews/YYYY-MM-DD-repo-review.md` (date from `date +%F`),
alongside the existing reviews. Do not create a second reviews directory.

**Filing: one issue per CRITICAL/HIGH, grouped issues for the rest.** A run
produces tens of findings; thirty-five issues is a tracker nobody reads. On the
validated run, five issues covered everything worth tracking — each CRITICAL and
HIGH on its own (they have distinct owners and distinct fixes), and the smaller
guard defects grouped into one issue because they share a root cause and would be
fixed together. Group by *what a single fix would touch*, never by severity
alone. Every issue needs the failure scenario, not just the location, and a
"don't fix it by loosening the assertion" note wherever a guard is involved.

**Findings that survive only in the report are lost.** The scratchpad dies with
the container and the chat summary scrolls away — if it is worth reporting, it is
worth filing before the session ends.

An unresolved report committed as a to-do list rots — "35 untested modules" is
wrong within weeks and reads as current to whoever finds it next. A report that
records what was *decided* ages correctly, which is why
`2026-07-19-phase4-dynamic-review.md` is still worth reading.

````markdown
# Repo review — YYYY-MM-DD (<commit sha>)

Raw finding count → count after dedupe.

## Gate results
verify / check:web / check:parity — pass, fail, or NOT RUN **with the reason**.
Then one line on what the NOT RUN gates leave unverified (a missing
`check:parity` means nothing server-side was checked at all).

## Findings
### CRITICAL   (invariant violated, data loss, secret exposure, broken build)
### HIGH       (wrong behavior on a real path, blind guard, missing server-side check)
### MEDIUM     (gap that will cause a defect under a plausible change)
### LOW        (drift, dead code, doc divergence)

For each: one-line summary · `file:line` · concrete failure scenario · **what
made this a whole-repo find** — either why a per-diff review structurally could
not have caught it, or, when the defect *was* diff-visible, which guard should
have caught it and didn't. That missing guard is itself a finding; file it too.
Mark deduped findings with the passes that reported them.

## Test gaps
Untested modules ranked by blast radius, with a suggested first test for the top few.

## Coverage of this review
- Which passes ran, and which gates backed them.
- **Which findings you verified at source yourself**, and which rest on a pass's
  own evidence.
- **What was vacuous rather than clean** — checks that passed only because the
  code has no callers yet.
- What was not examined at all.
````

The last section is not optional, and the vacuous line is the part reviewers
skip. A whole-repo review that does not state its own blind spots reads as
exhaustive when it is not — and "clean" claimed over unreachable code is the
most misleading thing such a report can say.
