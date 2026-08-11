# Auth Parity — Backend Audit + Deploy Plan (3 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Make registration work end to end via **fully namespaced, purely additive** backend artifacts: `worklog-register-company` + `worklog-send-email` (a WorkLog-branded fork — the shared `send-email` is never touched), plus WorkLog secrets and GoTrue allowlist appends, validated with real round-trips.

**Architecture:** Audit-first (user decision, spec Resolved decisions). Server code: `../jobsight-backend`, branch `worklog-register` off its default branch. Hosted project `nxlznnrocrffnbzjaaae` is shared with another app; this plan makes **zero replace-class changes**: no shared function is redeployed, no existing secret value modified, no existing template touched. Shared-state classes: (a) replace-forbidden — existing secrets' values, deployed functions, template keys, GoTrue Site URL; (b) append-permitted — GoTrue `uri_allow_list` (pre-change value recorded verbatim for rollback). Spec: `docs/superpowers/specs/2026-08-07-punchlog-auth-parity-design.md` (§7, A1–A3, A6, Resolved decisions). Santa-loop escalation resolved by user 2026-08-11: fork `worklog-send-email` instead of patching shared `send-email`.

**Tech Stack:** Supabase (Deno edge functions, GoTrue, Postgres), Supabase MCP + management API, Vercel CLI (site env check), `../jobsight-backend`, WorkLog app repo (one seam commit).

## Global Constraints

- **Namespaced artifacts only:** new function slugs `worklog-register-company` (`verify_jwt=true`; client calls carry the anon JWT — all curls send `Authorization: Bearer <anon key>` + `apikey` headers) and `worklog-send-email` (`verify_jwt=false`; authenticates via `x-email-secret`). Neither generic slug (`register-company`, `send-email`) is ever claimed or redeployed.
- **WorkLog secrets (all new; T1 confirms none pre-exist, else escalate):** `WORKLOG_WEBSITE_URL=https://worklog-site.vercel.app`; `WORKLOG_EMAIL_SHARED_SECRET` = freshly generated 44-char value shared by exactly the two worklog functions (the fork keeps send-email's ≥32-char enforcement and `worklog-register-company` gains the same length check — the shared `EMAIL_SHARED_SECRET` is not reused, eliminating cross-tenant secret coupling); `WORKLOG_RESEND_FROM` (value = user decision at the T1 gate). `RESEND_API_KEY` is read by name (project-scoped, value untouched).
- **A1 (mechanically fail-closed):** in `worklog-register-company`, both redirect sites (fork of index.ts:133-135 with `APP_CONFIRM_FALLBACK_URL` deleted; fork of the `client` ternary at :267-272) read `WORKLOG_WEBSITE_URL`; the function URL-parses it at startup and 503s before any quota RPC / GoTrue call / link generation unless `protocol==='https:'` && host `worklog-site.vercel.app`.
- **A3 (mechanically fail-closed):** `worklog-register-company` keeps the standard template keys (`confirm_signup`, `account_exists` — its send-email is now WorkLog-branded, so key renaming is unnecessary) but must call ONLY `worklog-send-email` — all FOUR `sendEmail` call sites (fork of index.ts:313, 341, **395 signup-race**, 424) post to `${SUPABASE_URL}/functions/v1/worklog-send-email` (fork of :261).
- **Branding rule for the fork:** `worklog-send-email` is based on the repo's `send-email` source with shell + templates rebranded: WorkLog wordmark/footer, blueprint-accent button (not #C8102E), `from: WORKLOG_RESEND_FROM`, links ONLY to `/welcome`, `/terms`, `/privacy` on `WORKLOG_WEBSITE_URL` (never the shared `WEBSITE_URL`; `website/lib/welcome-copy.test.ts:45-47` forbids `/forgot-password`, `/download`, `/register` — "lost your password" copy points at the app's Forgot password button).
- **Mechanical gates** (scripted as `../jobsight-backend/scripts/worklog-a1-gate.sh`, run in T2, exact commands there): scoped to the two `worklog-*` function directories; quote-style-independent regexes; totals via `grep -rn ... | wc -l`.
- **Production gate:** Tasks 3, 4, 5 each require explicit user approval naming the specific actions (T3: paid branch + may send real email via shared Resend key; T4: live-project additive changes; T5: real production email).
- **User-decision gate ending Task 1 (unconditional, three questions):** (1) **A2** — may WorkLog registrants enter the shared `auth.users` pool, given the audit's evidence? (2) **A6** — no WorkLog web app is deployed (Expo web is CI-export only): approve deferring both A6 halves (`ALLOWED_ORIGINS` + functional web-export pass) as a recorded spec amendment, or name a web deployment to bring in scope. The `client:'web'` curls in T3/T5 are server-contract tests and run regardless. (3) **Sender** — `WORKLOG_RESEND_FROM` value: `WorkLog <worklog@{the Resend-verified domain, visible in the user's Resend dashboard}>` (no new verification needed on an already-verified domain) or `onboarding@resend.dev` (testing only, fine for T3/T5, swap before public launch). No Task 2+ work before all three answers.
- **Quotas (fork keeps both):** `EMAIL_DAILY_LIMIT` 3/day/address — validation rotates `+` aliases; `IP_DAILY_LIMIT` 20/day/hashed-IP (index.ts:100) — T3/T5 curl counts stay under it (≤10 planned); never reset quota rows in production.

---

### Task 1: Read-only preflight audit (no writes anywhere)

Produce `docs/superpowers/specs/2026-08-11-backend-audit.md` with SQL/MCP evidence per bullet:

- [ ] **Function inventory:** `list_edge_functions` — record all slugs + versions; confirm `worklog-register-company` and `worklog-send-email` are vacant (else escalate). Informational: note `register-company` presence/absence. (The shared `send-email` is never redeployed, so no source capture is load-bearing; record its version for reference only.)
- [ ] **Schema:** `profiles` (incl. `email`, `full_name`), `companies` (`created_by`), company-membership table, triggers `handle_new_user` (populates `profiles.email`?) and **`bootstrap_company_creator`** — absent means the company row is created but the registrant gets **no membership/admin enrolment** (index.ts:68, :412-416); the audit checks for exactly that gap. Compare against migrations `20260712000001_companies.sql` / `20260712000002_registration_rate_limit.sql`.
- [ ] **RPC:** `consume_registration_quota(p_key, p_limit)` exists.
- [ ] **Other-tenant lifecycle:** ALL triggers on `auth.users`; would a WorkLog registrant enter the other app's approval queue/tables/UI?
- [ ] **Secrets (names only, never values):** existence of `RESEND_API_KEY` (required), `WEBSITE_URL`/`EMAIL_SHARED_SECRET`/`RESEND_FROM` (reference), and that no `WORKLOG_*` secret pre-exists (else escalate — T4 must not overwrite and rollback must not delete pre-existing state).
- [ ] **GoTrue config:** Site URL + `uri_allow_list` verbatim (`GET /v1/projects/{ref}/config/auth`) for T4's append + rollback.
- [ ] **Website prerequisite:** curl `/welcome`, `/terms`, `/privacy` → 200 AND `npx vercel env ls production` (project `worklog-site`, we own it) shows `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` present targeting `nxlznnrocrffnbzjaaae` — a 200 alone doesn't prove /welcome can submit (page only fails at submit if env is wrong).
- [ ] **Verdict:** GO / NO-GO with each collision named. **Then present the three-question user gate (A2, A6, Sender). STOP until answered.**

### Task 2: Fork the two functions (code only, sibling repo)

On `../jobsight-backend` branch `worklog-register`:

- [ ] `supabase/functions/worklog-register-company/` = copy of `register-company/` with: both redirect sites on `WORKLOG_WEBSITE_URL`; `APP_CONFIRM_FALLBACK_URL` deleted; startup https+host validation (503 pre-side-effect); `EMAIL_SHARED_SECRET` → `WORKLOG_EMAIL_SHARED_SECRET` with a ≥32-char length check; all FOUR `sendEmail` call sites posting to `/functions/v1/worklog-send-email`; header comments rewritten for WorkLog.
- [ ] `supabase/functions/worklog-send-email/` = copy of `send-email/` with: shell + `confirm_signup`/`account_exists` templates rebranded per the Branding rule; `RESEND_FROM` → `WORKLOG_RESEND_FROM`; `EMAIL_SHARED_SECRET` → `WORKLOG_EMAIL_SHARED_SECRET` (≥32-char check kept); shared-`WEBSITE_URL` reads replaced by `WORKLOG_WEBSITE_URL`; templates not needed by registration deleted.
- [ ] **Gate script `scripts/worklog-a1-gate.sh`** (commit it; paste output in the report). Over BOTH `worklog-*` dirs: `grep -rnE "punchlist://|APP_CONFIRM_FALLBACK_URL|PunchLog|punch list|#C8102E" | wc -l` ⇒ 0; `grep -rnE "/forgot-password|/download|/register\b" | wc -l` ⇒ 0; `grep -rn "WEBSITE_URL" | grep -v WORKLOG_WEBSITE_URL | wc -l` ⇒ 0; `grep -rn "EMAIL_SHARED_SECRET" | grep -v WORKLOG_EMAIL_SHARED_SECRET | wc -l` ⇒ 0. In `worklog-register-company/`: `grep -rn "functions/v1/worklog-send-email" | wc -l` ⇒ ≥1 and `grep -rn "functions/v1/send-email\b" | wc -l` ⇒ 0; `grep -rn "WORKLOG_WEBSITE_URL" | wc -l` ⇒ ≥3. In `worklog-send-email/`: `grep -rn "WorkLog" | wc -l` ⇒ ≥2 (shell + footer).
- [ ] Commit on the branch; do NOT deploy.

### Task 2b: App seam commit (WorkLog repo, worktree)

- [ ] `src/auth/registration.ts`: change ONLY the `functions.invoke('register-company')` string to `'worklog-register-company'` + its expectation in `registration.test.ts`. The `register-company-*` **testIDs in `app/(auth)/register.tsx` and `.maestro/register-validation.yaml` are unrelated and must not be touched** (a blanket rename breaks `maestroSelectors.test.ts`). `npm run verify` green. One commit.

### Task 3: Rehearse on a Supabase branch (USER APPROVAL: paid branch + may send real email)

- [ ] Approval names: branch cost (`get_cost`/`confirm_cost`) + possible real email via the shared Resend key to user-controlled aliases.
- [ ] Create branch. Caveat recorded: migration-built, NOT a clone of the drifted hosted schema — rehearses mechanics only; collision risk is covered solely by T1.
- [ ] Apply missing WorkLog migrations to the branch. **Configure the branch's GoTrue `uri_allow_list`** (same PATCH, branch ref) with the three WorkLog entries BEFORE any round-trip — without it GoTrue silently falls back to site_url and the confirm-URL assertion fails for a config reason.
- [ ] Deploy both worklog functions to the branch (flags per Global Constraints). Branch secrets: `WORKLOG_WEBSITE_URL`, fresh 44-char `WORKLOG_EMAIL_SHARED_SECRET`, `WORKLOG_RESEND_FROM` per the T1 decision, and the branch's inherited/user-provided `RESEND_API_KEY` (if none: skip delivery assertions; keep link-shape assertions on the captured function logs — no stub seam exists in the function, delivery is all-or-nothing).
- [ ] Round-trips via curl (anon-key headers), `client:'app'` AND `client:'web'` (server-contract paths, independent of the A6 decision): fresh → 200 `{ok:true}` + profile/company/**membership** rows + confirm URL host `worklog-site.vercel.app` path `/welcome`; confirmed-duplicate → byte-identical 200 + account_exists mail (WorkLog-branded); unconfirmed-duplicate → 200 + magiclink mail whose link lands on `/welcome` (**link-shape assertion only** — the production site posts tokens to production GoTrue, so a branch token cannot complete a password set; that assertion is T5's); invalid field → 400 `{error, field}`; 4th same-alias → 429. Total curls ≤10 (IP cap 20/day).
- [ ] Record evidence; delete the branch (approval).

### Task 4: Production config + deploy (USER APPROVAL naming every change — all additive)

Approval lists exactly: three new `WORKLOG_*` secrets; two new function deploys (vacant slugs, flags stated); GoTrue `uri_allow_list` append. Pre-condition: T1's website check re-run green (curl + Vercel env). Then, in this order:

- [ ] **Allowlist first** (harmless standalone): PATCH `uri_allow_list` = T1's verbatim value + `https://worklog-site.vercel.app/welcome,worklog://set-password,worklog://confirm` (Site URL untouched).
- [ ] Set the three `WORKLOG_*` secrets.
- [ ] Deploy `worklog-send-email` (`verify_jwt=false`), then `worklog-register-company` (`verify_jwt=true`).
- [ ] Rollback recorded: delete the two worklog functions; delete the three `WORKLOG_*` secrets (T1 confirmed none pre-existed); restore T1's verbatim `uri_allow_list`. No shared artifact changed ⇒ no other-tenant rollback surface.

### Task 5: End-to-end production validation (USER APPROVAL: sends real email)

- [ ] Register `kubiknyc+wl1@gmail.com` via curl (anon-key headers), `client:'app'`: user opens the email — WorkLog branding, sender per T1 decision, no PunchLog strings, no dead links; confirm link lands on `/welcome`; password set succeeds; sign-in works in the app.
- [ ] `client:'web'` with `kubiknyc+wl2@gmail.com`: same assertions (server-contract path).
- [ ] Confirmed-duplicate (re-register `+wl1`) → byte-identical 200 + WorkLog account_exists email with no `/forgot-password` link; bad-field → 400 shape. Alias rotation respects 3/day; total curls ≤10.
- [ ] Update memory + spec status (record the A6 amendment per the T1 decision); registration LIVE.

## Self-review notes

- Round-3 santa findings resolved structurally by the fork: shared-shell branding, RESEND_FROM sender, whole-unit redeploy race, namespaced-artifact consistency, EMAIL_SHARED_SECRET length coupling — all gone because `send-email` is never touched and the worklog functions carry their own branded shell, sender secret, and 44-char secret with both-sides length checks.
- Remaining round-3 findings addressed pointwise: branch allowlist configured in T3 before round-trips; T4 orders allowlist before function deploys; website check = curl + Vercel env (not 200-only); gate regexes quote-independent with `wc -l` totals and PunchLog/brand-color/dead-route/shared-secret-name coverage; bootstrap_company_creator symptom corrected (membership gap, not missing company); welcome-copy cite fixed to :45-47; IP_DAILY_LIMIT noted with curl budgets; T2b scoped to the invoke string with testIDs explicitly protected; sender decision surfaced as a user question; A6 is a user decision with `client:'web'` curls labeled server-contract tests.
- Out of scope: hosted drift reconciliation; universal links; invite flow; deleting the unused-template dead code beyond what the fork drops.
