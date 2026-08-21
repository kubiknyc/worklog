# Whole-repo review — 2026-07-30 (`8f5cccd`)

First full run of the `repo-review` skill: six passes dispatched as parallel
subagents, then merged, deduped and ranked. **38 raw findings → 35 after
dedupe.** Every finding is resolved below — all were filed as issues; none was
fixed in place (this was a read-only audit) and none was declined.

## Gate results

| Gate | Result |
|---|---|
| `npm run verify` | PASS — 50 suites, 456 tests, every coverage pin met |
| `npm run check:web` | PASS — full web export with placeholder Supabase env |
| `npm run check:parity` | **NOT RUN** — `../jobsight-backend` absent |

`check:parity` not running means **nothing server-side was verified**. Every
"the server also enforces this" conclusion in this review rests on header
comments in this repo, not on the backend.

## Findings → issues

| Sev | Finding | Issue |
|---|---|---|
| CRITICAL | `discardParked`'s `create_report` cascade fires on a *pending* mutation, destroying a report the server already accepted | [#12](https://github.com/kubiknyc/worklog/issues/12) |
| HIGH | `didFallBackToOnlineOnly()` has no consumer — degraded online-only mode reports "All saved to the cloud" | [#13](https://github.com/kubiknyc/worklog/issues/13) |
| HIGH | Parity generator is blind to `RENAME COLUMN`; the gate passes on real cross-repo drift | [#14](https://github.com/kubiknyc/worklog/issues/14) |
| HIGH | `e2e-test` profile can't enable demo logins (`__DEV__` short-circuit); both flows can never pass | [#16](https://github.com/kubiknyc/worklog/issues/16) |
| HIGH | R1 listed as an open decision, called approved by `06-sync-mappings.md`, and already shipped in the SQLite schema | [#17](https://github.com/kubiknyc/worklog/issues/17) |
| HIGH | Destructive confirm button at ≈1.9:1 contrast — a status-indicator token used as a text background | [#18](https://github.com/kubiknyc/worklog/issues/18) |
| HIGH | Six controls under the 48px floor, including the only route to the sync queue | [#19](https://github.com/kubiknyc/worklog/issues/19) |
| HIGH | Four shipped tabs display internal milestone labels ("History — M2") | [#20](https://github.com/kubiknyc/worklog/issues/20) |
| MEDIUM | `sheet-safety` dynamic-testID entry exempts more than it should | [#11](https://github.com/kubiknyc/worklog/issues/11) |
| MEDIUM/LOW | Four guard *mechanisms* that pass while the invariant behind them breaks | [#15](https://github.com/kubiknyc/worklog/issues/15) |
| MEDIUM/LOW | Test-suite quality: assertions that pass against broken implementations | [#21](https://github.com/kubiknyc/worklog/issues/21) |
| MEDIUM/LOW | Five modules with no consumer, each documented as if it had one | [#22](https://github.com/kubiknyc/worklog/issues/22) |
| MEDIUM | Queue's destructive path undriveable by Maestro; `/settings/sync` has no tap path back | [#23](https://github.com/kubiknyc/worklog/issues/23) |
| — | Untested modules ranked by blast radius (`rows.native.ts`'s `tx()` first) | [#24](https://github.com/kubiknyc/worklog/issues/24) |

Two findings are silent, unrecoverable data loss (#12, #13) and should lead any
scheduling decision. #12 is the more urgent: it needs no unusual precondition,
only a specific interleaving a user can hit by tapping Retry then Discard.

## What the review could and could not see

**Verified at source by the merger** (not taken on a subagent's word): #12, #13,
#14, #16, #17, the zero-importer claims behind #22, and the unfalsifiable
`schema.ts` coverage pin in #15. The rest rest on their pass's own evidence.

**Vacuous rather than clean.** The pull-path primitives (`conflict.ts`,
`cursors.ts`, `paginate.ts`) have no callers, so "every pulled row flows through
`resolveItem`" and "no cursor advances before a durable write" were
*unverifiable*, not verified. When the pull path lands, that half of the sync
contract has never been audited.

**Not examined at all:**

- Anything server-side — no RPC, RLS policy, trigger or grant was checked.
- The photo pipeline end to end (M5, deliberately unimplemented).
- `submit_report` / `lock_report` / `create_amendment` enqueue paths — no
  repository method mints them yet.
- Whether `verify` / `web-export` / `schema-parity` are actually *required*
  status checks on the repo.
- Whether the seeded demo accounts exist on the shared hosted Supabase project.
  If `seed.sql` were ever applied there, `login.tsx:48` is a live credential in a
  public repo — worth confirming independently.
- Runtime Sentry breadcrumb capture (reasoned from `Sentry.init`, not observed).
- Assertion quality of the auth tests and the three largest `.native` test
  files; all sit over modules excluded from the coverage denominator, so their
  real depth is unmeasured.

## Notes on the skill itself

The run doubled as the skill's validation, and the corrections it forced are in
`.claude/skills/repo-review/SKILL.md` (see PR #10):

- Pass C had been calibrated beforehand; it correctly declined to re-report the
  staged photo kinds and the row-level conflict model, and found the CRITICAL
  instead. Before that calibration the same pass produced four false positives
  and no true findings.
- Every allowlist in the repo was honest. Four guard *mechanisms* were broken.
  That asymmetry is now the core of Pass A.
- The merge step — verifying HIGHs at source, deduping, arbitrating severity
  between passes — had never been exercised and was almost undocumented. It is
  now.
