# Phase 4 dynamic review — 2026-07-19

## Method

Reviewed the Phase 4 foundation slice across 6 dimensions (correctness,
concurrency/races, security, test quality, tooling/CI hygiene, and
documentation accuracy), with adversarial verification on every raised
finding (reproduce or disprove before counting it confirmed). 11 findings
raised, 10 confirmed, 1 refuted.

## Fixed this branch (`fix/phase4-review-findings`)

1. Revoked-session cleanup (`signOut`/`clearAccountCaches`) ran even when a
   newer session had superseded the in-flight check — gated on
   `sessionGenRef` before the side effects. `8580e19`
2. `updateProfile`'s state commit could land a stale PATCH response over a
   newer session's profile — gated on session generation captured at call
   entry. `8580e19`
3. `npm test` never collected coverage, so the `mutationQueue.ts` 100%
   threshold was decorative — added `--coverage` to the script. `bb19316`
4. `expo-env.d.ts` (Expo-generated, meant to be gitignored) was tracked and
   causing working-tree churn — gitignored and untracked (kept on disk).
   `38257ad`
5. `.gitignore` only had a literal `.env` — added `.env.local` and
   `.env*.local`, mirrored from PunchLog. `38257ad`

## Deferred

| # | Finding | Target |
|---|---------|--------|
| a | PII account cache (`AsyncStorage`) vs a `SecureStore`/field-pruning threat model isn't settled | M2 |
| b | Platform-split guard doesn't catch dynamic `import()`/computed `require` | Extend guard when the first dynamic import appears |
| c | `signOut` success-path test only asserts the mock was called, not behavior | Strengthen with the M2 auth work |
| d | `tsconfig` `moduleSuffixes` + bare `jest-expo` preset means `.web.ts` files never resolve under Jest | Address when the first `.web` unit test is needed |
| e | Schema-parity generator ignores `RENAME COLUMN` | Handle next time the generator is touched |

## Refuted

- Claim: `CompoundKey`'s 2-column pagination cursor can't support a 3-column
  key. No current consumer needs 3 columns; the 3-column adapter, if ever
  needed, is M3's concern.
