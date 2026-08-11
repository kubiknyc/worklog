# Auth Parity — Backend Audit + Deploy Plan (3 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Make registration work end to end: audit the shared hosted Supabase project, deploy a WorkLog-parameterized registration function under a **namespaced slug** + WorkLog email templates + auth redirect config, and validate real registration round-trips.

**Architecture:** Audit-first (user decision, spec Resolved decisions). Server code lives in the sibling repo `../jobsight-backend` (branch `worklog-register` off its default branch). The hosted JobSight project `nxlznnrocrffnbzjaaae` is **shared with another app**. Shared-state classes: (a) **replace-forbidden** — existing secrets' values, existing template keys, GoTrue Site URL, any slug another tenant could own; (b) **append-permitted** — list-shaped config (GoTrue `uri_allow_list`), recorded-before-change for rollback. **Default to namespaced artifacts:** the function deploys as slug `worklog-register-company` (the generic `register-company` slug is never claimed — a shared-name grab is a replace-forbidden-class hazard even when the slug is currently vacant); the app seam changes accordingly (see Task 2b). Spec: `docs/superpowers/specs/2026-08-07-punchlog-auth-parity-design.md` (§7, A1–A3, A6, Resolved decisions).

**Tech Stack:** Supabase (Deno edge functions, GoTrue, Postgres), Supabase MCP + management API, `../jobsight-backend`, WorkLog app repo (one seam commit).

## Global Constraints

- **A1 (hard, mechanically fail-closed):** the WorkLog function must contain no `punchlist://` or custom-scheme fallback on ANY path. Enforced three ways: (1) both redirect sites — `appConfirmUrl()` (register-company/index.ts:133-135, `APP_CONFIRM_FALLBACK_URL` deleted) and the `client:'web'` ternary (index.ts:267-272) — read `WORKLOG_WEBSITE_URL`; (2) the function **URL-parses** `WORKLOG_WEBSITE_URL` at startup and 503s before any quota RPC / GoTrue call / link generation unless `protocol === 'https:'` and host `worklog-site.vercel.app`; (3) the Task 2 grep gate (scoped to the WorkLog function's directory only — see gate definition there).
- **A3 (mechanically fail-closed):** register-company has **FOUR** `sendEmail` call sites (index.ts:313 confirm_signup resend, 341 account_exists, **395 account_exists in the signup-race branch**, 424 confirm_signup fresh). All four must request `worklog_confirm_signup` / `worklog_account_exists`; the gate greps the WorkLog function for bare `"confirm_signup"` / `"account_exists"` string literals — must be zero.
- **Deployed-source rule:** the live `send-email` (v20) has drifted from the repo. The WorkLog template addition is applied ON TOP of the deployed source obtained verbatim in Task 1 (via MCP `get_edge_function` body, or `supabase functions download send-email`; **if the deployed source cannot be obtained verbatim, the audit verdict is NO-GO**). The patched artifact lives at `supabase/functions/send-email/index.ts` on the `worklog-register` branch — that exact file is what T3/T4 deploy. Existing template keys/copy byte-identical (they legitimately contain PunchLog strings — the A1 grep gate does NOT run over send-email; A3's template-key gate covers the WorkLog function's requests instead).
- **Template content rule:** `worklog_*` templates link ONLY routes that exist on the WorkLog site (`/welcome`, `/terms`, `/privacy` — `website/lib/welcome-copy.test.ts:41-47` forbids `/forgot-password`, `/download`, `/register`). "Lost your password" copy says to use the app's Forgot password button — no web recovery link.
- **Deploy flags (both environments):** `worklog-register-company` with `verify_jwt=true` (client calls carry the anon JWT; curls in T3/T5 must send `Authorization: Bearer <anon key>` + `apikey` headers); patched `send-email` with `verify_jwt=false` (authenticates via `x-email-secret`).
- **Production gate:** Tasks 3, 4, 5 each require explicit user approval naming the specific actions (T3: paid branch + may send real email via shared Resend; T4: live shared-project changes; T5: real production email).
- **User-decision gate ending Task 1 (unconditional, two questions):** (1) A2 — may WorkLog registrants enter the shared `auth.users` pool, given the audit's evidence of what the other app would see? (2) A6 — the spec calls for `ALLOWED_ORIGINS` web origins and a functional `check:web` registration pass, but no WorkLog web app is deployed anywhere (the Expo web build is CI-export only), so there is no origin to allow and no deployed surface to test: approve deferring both A6 halves (recorded as a spec amendment) or name a web deployment to bring in scope. No Task 2+ work before both answers.
- **Email quota:** `EMAIL_DAILY_LIMIT` = 3/day per address (index.ts:101) — validation runs rotate `+` aliases; never reset quota rows in production.

---

### Task 1: Read-only preflight audit (no writes anywhere)

Produce `docs/superpowers/specs/2026-08-11-backend-audit.md` with SQL/MCP evidence per bullet:

- [ ] **Function inventory:** `list_edge_functions` (slugs + versions). Confirm `worklog-register-company` is vacant; note whether `register-company` exists (informational — we don't claim it either way). Obtain the **verbatim deployed `send-email` v20 source** (`get_edge_function`; fallback `supabase functions download send-email`) into the audit appendix. Unobtainable ⇒ NO-GO.
- [ ] **Schema:** `profiles` (incl. `email`, `full_name`), `companies` (`created_by`), company-membership table, triggers `handle_new_user` (populates `profiles.email`?) and **`bootstrap_company_creator`** (index.ts:68 depends on it; absent ⇒ registrants get 200 and no company). Compare against migrations `20260712000001_companies.sql` / `20260712000002_registration_rate_limit.sql` and the function's assumptions.
- [ ] **RPC:** `consume_registration_quota(p_key, p_limit)` exists.
- [ ] **Other-tenant lifecycle:** ALL triggers on `auth.users`; characterize the approve/reject-user flow — would a WorkLog registrant enter that app's approval queue/tables/UI?
- [ ] **Secrets (names only, never values):** existence of `WEBSITE_URL`, `ALLOWED_ORIGINS`, `EMAIL_SHARED_SECRET`, `RESEND_API_KEY`, `RESEND_FROM`, **and `WORKLOG_WEBSITE_URL`** (if it already exists: record that T4 must not overwrite and rollback must not delete it — escalate instead).
- [ ] **send-email v20 contents:** template keys present; where shared `WEBSITE_URL` is interpolated (why WorkLog variants must read `WORKLOG_WEBSITE_URL`).
- [ ] **GoTrue config:** Site URL + `uri_allow_list` verbatim (`GET /v1/projects/{ref}/config/auth`) for the T4 append + rollback.
- [ ] **Website prerequisite check:** curl `https://worklog-site.vercel.app/welcome`, `/terms`, `/privacy` — all 200 today (recheck; plan 2 validated behavior on 2026-08-10, cite that evidence for fragment handling).
- [ ] **Verdict:** GO / NO-GO with each collision named. **Then present the two-question user gate (A2 + A6) from Global Constraints. STOP until answered.**

### Task 2: WorkLog-parameterize the backend (code only, sibling repo)

On `../jobsight-backend` branch `worklog-register`:

- [ ] Copy `register-company/` → `worklog-register-company/`. In it: both redirect sites read `WORKLOG_WEBSITE_URL`; delete `APP_CONFIRM_FALLBACK_URL`; add the startup HTTPS+host validation (503 pre-side-effect per A1); switch ALL FOUR `sendEmail` call sites (index.ts:313, 341, 395, 424 in the original numbering) to the `worklog_*` keys; update header comments to WorkLog's contract.
- [ ] Regenerate `supabase/functions/send-email/index.ts` from the T1 appendix (deployed v20 verbatim) + append ONLY the two new keys `worklog_confirm_signup` / `worklog_account_exists` per the Template content rule.
- [ ] **Mechanical gate (scoped, scripted in repo as `scripts/worklog-a1-gate.sh`):** over `supabase/functions/worklog-register-company/` only: `grep -RnE "punchlist://|APP_CONFIRM_FALLBACK_URL|\"confirm_signup\"|\"account_exists\""` ⇒ empty; `grep -c "WORKLOG_WEBSITE_URL"` ⇒ ≥3 (two redirect sites + validation). Over the send-email diff vs the T1 appendix: additions only, and additions contain no `punchlist://`. Record outputs.
- [ ] Commit on the branch; do NOT deploy.

### Task 2b: App seam commit (WorkLog repo, worktree)

- [ ] `src/auth/registration.ts`: invoke string `register-company` → `worklog-register-company`; update `registration.test.ts` expectation. `npm run verify` green. One commit.

### Task 3: Rehearse on a Supabase branch (USER APPROVAL: paid branch + may send real email)

- [ ] Approval names: branch cost (`get_cost`/`confirm_cost`) + possible real email via shared Resend to user-controlled aliases.
- [ ] Create branch. Caveat recorded: **migration-built, not a clone of the drifted hosted schema — rehearses function mechanics only; collision risk is covered solely by T1.**
- [ ] Apply missing WorkLog migrations to the branch. Deploy `worklog-register-company` (`verify_jwt=true`) + patched send-email (`verify_jwt=false`). Branch secrets: `WORKLOG_WEBSITE_URL=https://worklog-site.vercel.app`, fresh ≥32-byte `EMAIL_SHARED_SECRET` (generated, never production's) identical on both functions, `RESEND_API_KEY`/`RESEND_FROM` (test key if user provides; else skip delivery and assert the outbound Resend request payload via a branch-only stub of the fetch URL env — if no stub seam exists, capture via Resend test-mode key or accept delivery to user aliases per approval).
- [ ] Round-trips via curl (with `Authorization: Bearer <branch anon key>` + `apikey` headers), `client:'app'` AND `client:'web'`: fresh → 200 `{ok:true}` + profile/company/membership rows + confirm URL on `https://worklog-site.vercel.app/welcome`, no `punchlist://` anywhere in the captured email payload; confirmed-duplicate → byte-identical 200 + `worklog_account_exists` payload; unconfirmed-duplicate → 200 + magiclink payload landing on `/welcome` (**link-shape assertion only** — the production site posts tokens to production GoTrue, so a branch token cannot complete a password set; the real set-password assertion belongs to T5); invalid field → 400 `{error, field}`; 4th same-alias registration → 429.
- [ ] Record evidence; delete the branch (approval).

### Task 4: Production config + deploy (USER APPROVAL naming every change)

Approval lists exactly: new secret `WORKLOG_WEBSITE_URL` (T1 confirmed absent — else escalate); deploy new function `worklog-register-company` (vacant slug, `verify_jwt=true`); **whole-unit redeploy of shared `send-email`** from the T2 patched-v20 file (labeled as the replace it is; pre-change version pinned); GoTrue `uri_allow_list` append. Pre-condition: T1's website check still green (re-curl `/welcome` 200). Then:

- [ ] Set `WORKLOG_WEBSITE_URL=https://worklog-site.vercel.app`.
- [ ] Deploy `worklog-register-company` (`verify_jwt=true`).
- [ ] Deploy patched send-email (`verify_jwt=false` preserved); confirm project-level `EMAIL_SHARED_SECRET` serves both.
- [ ] GoTrue: PATCH `uri_allow_list` = T1's verbatim value + `https://worklog-site.vercel.app/welcome,worklog://set-password,worklog://confirm` (append; Site URL untouched).
- [ ] Rollback recorded: redeploy send-email at T1's pinned version; delete `worklog-register-company`; restore T1's verbatim `uri_allow_list`; delete `WORKLOG_WEBSITE_URL` (only because T1 confirmed it did not pre-exist).

### Task 5: End-to-end production validation (USER APPROVAL: sends real email)

- [ ] Register `kubiknyc+wl1@gmail.com` via curl (anon-key headers), `client:'app'`: user opens the email — WorkLog branding, no PunchLog strings, no dead links; confirm link lands on `/welcome`; password set succeeds; sign-in works in the app.
- [ ] `client:'web'` with `kubiknyc+wl2@gmail.com`: same assertions.
- [ ] Confirmed-duplicate (re-register `+wl1`) → byte-identical 200, `worklog_account_exists` email with no `/forgot-password` link; bad-field → 400 shape. (Alias rotation respects the 3/day quota.)
- [ ] Update memory + spec status (record the A6 amendment per the T1 user decision); registration LIVE.

## Self-review notes

- Round-2 santa findings all addressed: 4 call sites enumerated + template-key negative grep (A); no-/forgot-password template rule (A); branch password-set assertion downgraded to link-shape, real one in T5 (A); gate path fixed + patched artifact path named (A); namespaced slug default + seam Task 2b (A); body-returning source capture with NO-GO fallback (A); anon-key headers + quota alias rotation (A); grep never runs over preserved send-email source (B); WORKLOG_WEBSITE_URL https+host validation pre-side-effect (B); verify_jwt stated for both functions in both environments (B); A6 now a user decision at the T1 gate, not a unilateral deferral (B); /welcome live check in T1 + re-check gating T4 (B); WORKLOG_WEBSITE_URL existence audited, rollback conditioned (B).
- Out of scope: hosted drift reconciliation beyond registration; universal links; invite flow.
