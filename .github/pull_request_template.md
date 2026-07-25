## What

<!-- One or two sentences. What changed and why. -->

## Milestone / plan task

<!-- e.g. M3 task 4 — link docs/superpowers/plans/<file> -->

## Gates

- [ ] `npm run verify` green locally
- [ ] Backend schema changed? → the `jobsight-backend` PR is **merged**, `npm run gen:server-columns` run, snapshot diff included here
- [ ] New native dependency? → added to `NATIVE_ONLY_MODULES` in `src/platformSplit.test.ts` and used only from `*.native.ts(x)`
- [ ] New screen or element an E2E flow will drive? → has a `testID`
- [ ] Touches an open decision in `docs/architecture/00-README.md`? → named below, not decided unilaterally
- [ ] New user-facing copy? → plain language, no internal labels (M6, F4, "phase")
- [ ] Changes SQLite schema or mutation payload shape? → **store build, not OTA** (queued offline mutations are written in the old shape)

## Open decisions touched

<!-- None, or name them. Don't decide them in a PR. -->

## Adversarial review

<!-- Paste the worklog-reviewer subagent's findings and what you did about each.
     Gaps affecting correctness or the stated spec only — style preferences are noise. -->
