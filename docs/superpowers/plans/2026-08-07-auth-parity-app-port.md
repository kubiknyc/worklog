# Auth Parity — App-Side Port Implementation Plan (1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port PunchLog's registration + set-password + confirm auth flow into the WorkLog app (client side only; website = plan 2, backend deploy = plan 3).

**Architecture:** Verbatim port from `C:\Users\kubik\JOBSIGHT-SUITE\PunchLog` (the source of truth — read each source file before porting), adapted only where the spec's amendments require: WorkLog branding, `worklog://` scheme, testIDs, `FIXED_COLORS.error` addition. Screens never import the Supabase client; all network goes through `src/auth/` seams. Spec: `docs/superpowers/specs/2026-08-07-punchlog-auth-parity-design.md` (read it first).

**Tech Stack:** Expo / React Native, expo-router, Supabase JS, jest-expo, @zxcvbn-ts.

## Global Constraints

- Source repo for all ports: `C:\Users\kubik\JOBSIGHT-SUITE\PunchLog` (referenced below as `PL/`). Copy the file, then apply ONLY the listed adaptations. Do not rewrite working code.
- WorkLog brand strings: app name `WorkLog`, scheme `worklog://`, company sub-line `Keystone Build Group` stays.
- Every interactive control an E2E flow could drive gets a `testID` (`<screen>-<field>` convention per `.maestro/README.md`); after adding screens, `src/maestroSelectors.test.ts` must pass.
- `npm run verify` green after every task; `npm run check:web` green after tasks touching components/screens (BrandMark, screens).
- Jest ignores `app/` — screen logic that needs tests lives in `src/`.
- No native module additions; no `app.json` changes (scheme `worklog` already registered).
- Registration will be dark (edge function not deployed) until plan 3 — that is expected; seams and screens must fail gracefully (`failed` kind → user-visible error copy), which the ported code already does.
- Commit after every task (conventional commits). Work happens in an isolated worktree (standing consent).

---

### Task 1: Theme + dependencies groundwork

**Files:**
- Modify: `src/theme/tokens.ts` (FIXED_COLORS)
- Modify: `package.json` (dependencies)
- Test: `src/theme/tokens.test.ts` (extend if it exists; else assertion lives in the BrandMark test of Task 2)

**Interfaces:**
- Produces: `FIXED_COLORS.error: string` (value `#FF8A8A`, copied from `PL/src/theme/tokens.ts` `FIXED_COLORS.error`) — used by Tasks 4 and 6.
- Produces: installed packages `@zxcvbn-ts/core`, `@zxcvbn-ts/language-common`, `@zxcvbn-ts/language-en` at the same major versions PunchLog pins (read `PL/package.json` for exact versions) — used by Task 5.

- [ ] **Step 1:** Read `PL/src/theme/tokens.ts` FIXED_COLORS block and WorkLog's `src/theme/tokens.ts:122` area. Add the `error` key (exact PunchLog value) to WorkLog's `FIXED_COLORS` with PunchLog's comment about why it's fixed.
- [ ] **Step 2:** `npm install @zxcvbn-ts/core @zxcvbn-ts/language-common @zxcvbn-ts/language-en` pinned to PunchLog's versions.
- [ ] **Step 3:** Run `npm run verify`. Expected: green (type-only addition).
- [ ] **Step 4:** Commit: `feat(theme): add FIXED_COLORS.error + zxcvbn deps for auth port`

### Task 2: WorkLog BrandMark

**Files:**
- Create: `src/components/BrandMark.tsx`
- Test: `src/components/BrandMark.test.tsx`

**Interfaces:**
- Produces: `export function BrandMark({ size = 64, chip = false }: { readonly size?: number; readonly chip?: boolean })` — same props contract as `PL/src/components/BrandMark.tsx`. Used by Tasks 4 and 6.

- [ ] **Step 1:** Read `PL/src/components/BrandMark.tsx` completely (construction technique: RN primitives + Ionicons, 120-unit design box, fixed internal palette, `size`/`chip` props).
- [ ] **Step 2:** Write failing test `src/components/BrandMark.test.tsx` inside the ThemeProvider wrapper (see any existing component test for the wrapper pattern): renders at default size; renders with `chip`; snapshot-free — assert via `getByTestId('brand-mark')` presence and no throw at sizes 32/64/120.
- [ ] **Step 3:** Run `npx jest src/components/BrandMark.test.tsx` — expected FAIL (module not found).
- [ ] **Step 4:** Implement the WorkLog mark using PunchLog's construction: a field-notebook daily-report page — white page on slate ink, 3–4 ruled lines, a bold accent date-stamp block in the top-left corner, one green check row (report filed). Fixed palette constants at top (INK `#0F172A`, PAPER `#FFFFFF`, plus WorkLog blueprint accent read as a literal, NOT via useTheme — logos don't re-tint). Root `View` gets `testID="brand-mark"`. `chip` draws the accent rounded-square field behind the page.
- [ ] **Step 5:** Run the test — expected PASS. Run `npm run check:web` — expected green (pure RN + Ionicons).
- [ ] **Step 6:** Commit: `feat(components): WorkLog BrandMark (field-notebook mark)`

### Task 3: Registration seams

**Files:**
- Create: `src/auth/registrationValidation.ts`, `src/auth/registrationValidation.test.ts`
- Create: `src/auth/registration.ts`, `src/auth/registration.test.ts`
- Create: `src/lib/legal.ts`, `src/lib/legal.test.ts`
- Modify: `src/auth/index.ts` (re-exports, mirroring `PL/src/auth/index.ts`)

**Interfaces:**
- Produces: `validateRegistration(input: RegisterInput): FieldErrors`, types `RegisterInput {companyName, fullName, email}`, `RegisterField`, `FieldErrors` — exactly as in `PL/src/auth/registrationValidation.ts`.
- Produces: `registerCompany(req: RegisterCompanyRequest): Promise<RegisterCompanyResult>` with result kinds `'ok' | 'invalid' | 'rateLimited' | 'failed'` — exactly as in `PL/src/auth/registration.ts` (keeps the `client: 'app' | 'web'` field).
- Produces: `TERMS_URL = 'https://worklog-site.vercel.app/terms'`, `PRIVACY_URL = 'https://worklog-site.vercel.app/privacy'`, `LEGAL_PAGES_PUBLISHED = false`.

- [ ] **Step 1:** Copy `PL/src/auth/registrationValidation.ts` + its `.test.ts` verbatim. Run `npx jest src/auth/registrationValidation.test.ts` — expected PASS (pure module).
- [ ] **Step 2:** Copy `PL/src/auth/registration.ts` + `.test.ts`. Adaptations: import path of the supabase client must match WorkLog (`../supabase/client`); no other changes. Run its tests — expected PASS (tests mock the client).
- [ ] **Step 3:** Create `src/lib/legal.ts` with the three constants above, PunchLog's App Store 5.1.1(i) header comment rewritten for WorkLog, and a comment: "Submission gate: check:submission (package.json) live-checks these URLs — see spec A4. Flip LEGAL_PAGES_PUBLISHED only after both return 200." `src/lib/legal.test.ts` asserts both URLs are https, same origin, and end in `/terms` / `/privacy` — it does NOT assert the flag (deliberate deviation from PunchLog, spec §6).
- [ ] **Step 4:** Run `npm run verify` — expected green. Commit: `feat(auth): registration seams + legal constants`

### Task 4: Register screen + login screen changes

**Files:**
- Create: `app/(auth)/register.tsx`
- Modify: `app/(auth)/login.tsx`
- Modify: `src/maestroSelectors.test.ts` only if it fails (it asserts flows' ids exist in source; new testIDs without flows don't break it)

**Interfaces:**
- Consumes: `BrandMark` (Task 2); `registerCompany`, `validateRegistration`, `RegisterInput`, `FieldErrors` (Task 3); `TERMS_URL`/`PRIVACY_URL` (Task 3); `FIXED_COLORS.error` (Task 1).

- [ ] **Step 1:** Copy `PL/app/(auth)/register.tsx`. Adaptations: brand text `WorkLog`; add testIDs `register-company-name`, `register-full-name`, `register-email`, `register-submit`, `register-back`, `register-error`, `register-done-heading` on the corresponding controls (accessibilityLabel already present); legal links import from `../../src/lib/legal`. Keep the platform-aware success copy, error handling, and `backToSignIn` (`router.canGoBack()`) logic byte-identical.
- [ ] **Step 2:** Modify `app/(auth)/login.tsx` to match `PL/app/(auth)/login.tsx`: add `<View style={styles.logoMark}><BrandMark size={64} /></View>` in the lockup (+ `logoMark` style `{ marginBottom: 14 }`); add the register link Pressable (testID `login-register`, copy "New here? Create a company account", `router.push('/(auth)/register')`, styles `registerLink`/`registerText`/`registerAccent` copied from PunchLog); swap demo avatar initials for PunchLog's Ionicons (`shield-checkmark`/`construct`) + trailing `chevron-forward`. Existing testIDs (`login-email`, `login-password`, `login-submit`, `login-forgot`, `login-error`, `login-notice`, `login-demo-*`) MUST remain untouched — existing Maestro flows key on them. Keep WorkLog's `forgotLink` MIN_TOUCH_TARGET style (it fixed defect #19; do not regress to PunchLog's 40px).
- [ ] **Step 3:** Run `npm run verify` and `npm run check:web` — expected green.
- [ ] **Step 4:** Launch in Expo (or rely on type/test gates if no emulator): register screen reachable from login, back returns to login.
- [ ] **Step 5:** Commit: `feat(auth): register screen + login parity (BrandMark, register link, demo icons)`

### Task 5: Set-password seams (with queue-loss guard)

**Files:**
- Create: `src/auth/passwordStrength.ts` + `.test.ts`, `src/auth/passwordChoice.ts` + `.test.ts`, `src/auth/setPasswordSession.ts` + `.test.ts`, `src/auth/pendingAuthLink.ts` + `.test.ts`, `src/auth/confirmLanding.ts` + `.test.ts`
- Modify: `src/auth/authLink.ts` + `src/auth/authLink.test.ts` (extend to PunchLog's shape)
- Modify: `src/auth/index.ts` (re-exports)

**Interfaces:**
- Consumes: pending-mutation count — read `src/sync/` for the existing counts producer (the one injected into `statusHub.ts`) and use the same source.
- Produces: everything `PL/app/set-password.tsx` and `PL/app/confirm.tsx` import from `src/auth` (read those two files first and mirror `PL/src/auth/index.ts` exports); plus `AuthLinkType` gaining `'signup'` and exported `LINK_PROBLEM_MESSAGE`.
- Produces: `setPasswordSession` gains a guard: before applying a session whose `userId` differs from the currently-authed user, it consults an injected `pendingMutationCount(): Promise<number>`; if > 0 it returns a typed refusal `{ kind: 'blockedPendingSync' }` instead of swapping sessions (spec A5). The screen (Task 6) renders "Sign in and sync your pending reports first, then reopen this link." for that kind.

- [ ] **Step 1:** Copy `passwordStrength`, `passwordChoice`, `pendingAuthLink`, `confirmLanding` + tests verbatim (pure modules; only import-path adjustments). Run their tests — expected PASS.
- [ ] **Step 2:** Diff `PL/src/auth/authLink.ts` against WorkLog's. Apply PunchLog's version: `'signup'` link type, `LINK_PROBLEM_MESSAGE` export, and the security fix that stops echoing GoTrue `error_description` (attacker-controlled). Port PunchLog's test file; keep any WorkLog-only cases that still apply.
- [ ] **Step 3:** Copy `setPasswordSession.ts` + test, then add the queue-loss guard per the Produces block (write the failing test first: different-user session + `pendingMutationCount → 2` ⇒ `blockedPendingSync`; same-user or zero-pending ⇒ ported behavior). Persistence stays out — the count producer is injected, matching the statusHub pattern.
- [ ] **Step 4:** `npm run verify` — expected green (new files clear the global coverage floor via ported tests). Commit: `feat(auth): set-password/confirm seams with pending-sync guard`

### Task 6: Set-password + confirm screens

**Files:**
- Create: `app/set-password.tsx` (from `PL/app/set-password.tsx`)
- Create: `app/confirm.tsx` (from `PL/app/confirm.tsx`)

**Interfaces:**
- Consumes: all Task 5 seams; `BrandMark` (Task 2); `FIXED_COLORS.error` (Task 1).

- [ ] **Step 1:** Copy both screens. Adaptations: brand strings; testIDs `set-password-input`, `set-password-confirm-input`, `set-password-submit`, `set-password-error`, `set-password-strength`, `confirm-message`, `confirm-back`; render the `blockedPendingSync` copy from Task 5; rewrite `PL`'s legacy-shim comment in `confirm.tsx` — WorkLog keeps it as a generic bad-link landing, there are no legacy links to defuse (spec L2).
- [ ] **Step 2:** `npm run verify` + `npm run check:web` — expected green.
- [ ] **Step 3:** Manual deep-link smoke on emulator if available: `npx uri-scheme open "worklog://set-password#error=access_denied&error_description=x" --android` shows the safe generic message (never the description text).
- [ ] **Step 4:** Commit: `feat(auth): set-password and confirm screens`

### Task 7: Submission gate + Maestro + docs

**Files:**
- Modify: `package.json` (scripts: `check:submission`, `submit:ios`, `submit:android`)
- Create: `scripts/check-submission.mjs`
- Create: `.maestro/register-validation.yaml`
- Modify: `.maestro/README.md` (testID inventory), `CLAUDE.md` (raw `eas submit` prohibition; `pendingAuthLink` sanctioned-stateful note next to the statusHub rule)

**Interfaces:**
- Consumes: `LEGAL_PAGES_PUBLISHED`, `TERMS_URL`, `PRIVACY_URL` (Task 3); testIDs from Tasks 4/6.

- [ ] **Step 1:** Write `scripts/check-submission.mjs`: reads the three legal constants by regex from `src/lib/legal.ts` (avoids a TS loader), fails unless `LEGAL_PAGES_PUBLISHED === true` AND both URLs return HTTP 200 (follow redirects, but a 3xx landing on non-200 fails). Exit 1 with a message naming the failing URL.
- [ ] **Step 2:** package.json: `"check:submission": "node scripts/check-submission.mjs"`, `"submit:ios": "npm run check:submission && eas submit --platform ios"`, `"submit:android": "npm run check:submission && eas submit --platform android"`. Run `npm run check:submission` — expected FAIL (flag false) — that failure IS the gate working; note it in the commit body.
- [ ] **Step 3:** Maestro flow `register-validation.yaml`: launch → tap `login-register` → tap `register-submit` empty → assert `register-error`/field errors visible → fill fields → back via `register-back` → assert `login-submit` visible. Also one `openLink` step: `worklog://set-password#error=access_denied` → assert `set-password-error` visible with generic copy. Update `.maestro/README.md` inventory; run `npx jest src/maestroSelectors.test.ts` — expected PASS.
- [ ] **Step 4:** CLAUDE.md: add "Submission goes through `npm run submit:ios|android` — never raw `eas submit` (legal-pages gate)" and the `pendingAuthLink` note beside the statusHub exception.
- [ ] **Step 5:** `npm run verify` — green. Commit: `feat: submission gate, register Maestro flow, docs`

---

## Self-review notes

- Spec coverage: §1→T4, §2→T2, §3→T4, §4→T5+T6, §5→T3, §6→T3+T7, A1–A3→plans 2/3, A4→T7, A5→T5, A6→plan 3 + check:web steps, A7→T7, A8→T7. §7 deliberately absent (plan 3).
- The `blockedPendingSync` kind and `pendingMutationCount` injection are this plan's only novel (non-ported) design; both defined in Task 5's Produces block and consumed in Task 6.
- Verbatim-port steps intentionally reference PL/ source files instead of inlining hundreds of lines; the source repo is on disk and each task names the exact file to read.
