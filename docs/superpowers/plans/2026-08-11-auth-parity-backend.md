# Auth Parity — Backend Audit + Deploy Plan (3 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Make registration work end to end via **fully namespaced, purely additive** backend artifacts: `worklog-register-company` + `worklog-send-email` (a WorkLog-branded fork — the shared `send-email` is never touched), plus WorkLog secrets and GoTrue allowlist appends, validated with real round-trips.

**Architecture:** Audit-first (user decision, spec Resolved decisions). Server code: `../jobsight-backend`, branch `worklog-register` off its default branch. Hosted project `nxlznnrocrffnbzjaaae` is shared with another app; this plan makes **zero replace-class changes**: no shared function redeployed, no existing secret value modified, no existing template touched. Shared-state classes: (a) replace-forbidden — existing secrets' values, deployed functions, template keys, GoTrue Site URL; (b) append-permitted — GoTrue `uri_allow_list`: appends add exactly three WorkLog entries; **rollback removes exactly those three entries from the allowlist's then-current value** (never restores an old snapshot — that would clobber the other tenant's concurrent changes; abort and escalate if the entries aren't found verbatim). Spec: `docs/superpowers/specs/2026-08-07-punchlog-auth-parity-design.md` (§7, A1–A3, A6, Resolved decisions). Santa escalation resolved by user 2026-08-11: fork, don't patch.

**Tech Stack:** Supabase (Deno edge functions, GoTrue, Postgres), Supabase MCP + **management API** (auth config: `GET/PATCH /v1/projects/{ref}/config/auth`; function deploys with flags: `POST /v1/projects/{ref}/functions?slug=<slug>&verify_jwt=<bool>` — the MCP deploy tool cannot set `verify_jwt`), Vercel CLI (site env check), `../jobsight-backend`, WorkLog app repo (one seam commit).

## Global Constraints

- **Namespaced artifacts only:** new slugs `worklog-register-company` (`verify_jwt=true`; all curls send `Authorization: Bearer $ANON_KEY` + `apikey: $ANON_KEY`) and `worklog-send-email` (`verify_jwt=false`; authenticates via `x-email-secret`). Neither generic slug is ever claimed or redeployed. Curl template (keys sourced from env, never inlined):
  `curl -s -X POST "$SUPABASE_URL/functions/v1/worklog-register-company" -H "Authorization: Bearer $ANON_KEY" -H "apikey: $ANON_KEY" -H "Content-Type: application/json" -d '{"companyName":"...","fullName":"...","email":"...","client":"app"}'` — byte-identical-200 checks diff the saved response bodies of two runs.
- **WorkLog secrets (all new; T1 confirms none pre-exist, else escalate):** `WORKLOG_WEBSITE_URL=https://worklog-site.vercel.app` (**normalized: no trailing slash, empty path** — the fork rejects values with a path so `//welcome` can never be minted); `WORKLOG_EMAIL_SHARED_SECRET` = freshly generated 44-char value shared by exactly the two worklog functions (≥32-char check on BOTH sides); `WORKLOG_RESEND_FROM` (value = user decision at the T1 gate). `RESEND_API_KEY` read by name only (project-scoped, value untouched).
- **A1 (mechanically fail-closed):** both redirect sites in the fork (of index.ts:133-135, `APP_CONFIRM_FALLBACK_URL` deleted; of the `client` ternary at :267-272) read `WORKLOG_WEBSITE_URL`; the function URL-parses it at startup and 503s before any quota RPC / GoTrue call / link generation unless `protocol==='https:'` && host `worklog-site.vercel.app` && pathname `/`.
- **A3 (mechanically fail-closed):** the fork keeps standard template keys (`confirm_signup`, `account_exists`) and posts ONLY to `worklog-send-email`. Implementation note: the four call sites (of index.ts:313, 341, **395 signup-race**, 424) all route through the single `sendEmail` helper whose URL lives on one line (fork of :261) — the EDIT is that one line; the four call sites are enumerated so the reviewer can verify none bypasses the helper.
- **Branding rule for the fork:** shell + templates rebranded (WorkLog wordmark/footer, blueprint-accent button — not #C8102E), `from: WORKLOG_RESEND_FROM`. **Site-owned links** point only at `/welcome`, `/terms`, `/privacy` on `WORKLOG_WEBSITE_URL`; the confirm CTA's href is GoTrue's `action_link` (a `*.supabase.co/auth/v1/verify` URL whose `redirect_to` is the /welcome page) — that is expected and allowed. No `/forgot-password`, `/download`, `/register` site links ("lost your password" copy points at the app's Forgot password button; `website/lib/welcome-copy.test.ts:45-47` rejects those exact hrefs on the site side).
- **Production gate:** Tasks 3, 4, 5 each require explicit user approval naming the specific actions. T3's approval covers: paid branch creation AND its deletion at task end AND possible real email via the shared Resend key.
- **User-decision gate ending Task 1 (unconditional, three questions; answers recorded as a spec amendment BEFORE Task 2 begins):** (1) **A2** — may WorkLog registrants enter the shared `auth.users` pool, given the audit's evidence? (2) **A6** — no WorkLog web app is deployed (Expo web is CI-export only): approve deferring both A6 halves (`ALLOWED_ORIGINS` + functional web-export pass), or name a web deployment to bring in scope. The `client:'web'` curls in T3/T5 are server-contract tests and run regardless. (3) **Sender** — `WORKLOG_RESEND_FROM`: `WorkLog <worklog@{Resend-verified domain — user reads it off their Resend dashboard}>` (same-domain needs no new verification) or `onboarding@resend.dev` (testing only; swap before public launch).
- **Quotas (fork keeps both):** `EMAIL_DAILY_LIMIT` 3/day/address (rotate `+` aliases); `IP_DAILY_LIMIT` 20/day/hashed-IP (index.ts:100) — planned curls ≤10/day (validation-400s don't consume quota: the field checks at index.ts:209-215 run before the quota RPC). Never reset quota rows in production.

---

### Task 1: Read-only preflight audit (no writes anywhere)

Produce `docs/superpowers/specs/2026-08-11-backend-audit.md` with SQL/MCP evidence per bullet:

- [ ] **Function inventory:** `list_edge_functions` — all slugs + versions; `worklog-register-company` and `worklog-send-email` vacant (else escalate). Note `register-company` presence/absence and the shared `send-email` version (reference only — it is never redeployed).
- [ ] **Schema:** `profiles` (incl. `email`, `full_name`), `companies` (`created_by`), company-membership table, triggers `handle_new_user` (populates `profiles.email`?) and **`bootstrap_company_creator`** — absent means the company row is created but the registrant gets **no membership/admin enrolment** (index.ts:68, :412-416). Compare against migrations `20260712000001_companies.sql` / `20260712000002_registration_rate_limit.sql`.
- [ ] **RPC:** `consume_registration_quota(p_key, p_limit)` exists.
- [ ] **Other-tenant lifecycle:** ALL triggers on `auth.users`; would a WorkLog registrant enter the other app's approval queue/tables/UI?
- [ ] **Secrets (names only, never values):** `RESEND_API_KEY` exists (required — T3 and production both depend on it); `WEBSITE_URL`/`EMAIL_SHARED_SECRET`/`RESEND_FROM` noted for reference; no `WORKLOG_*` secret pre-exists (else escalate).
- [ ] **Branching availability:** confirm the hosted project supports Supabase preview branches (plan feature + billing) BEFORE T3 asks the user to pay for one; if enabling branching would itself change project-level state, surface that in the T3 approval.
- [ ] **GoTrue config:** Site URL + `uri_allow_list` verbatim (`GET /v1/projects/{ref}/config/auth`).
- [ ] **Website prerequisite:** curl `/welcome` `/terms` `/privacy` → 200 AND `npx vercel env ls production` (project `worklog-site`) shows both `NEXT_PUBLIC_SUPABASE_*` vars present (targeting `nxlznnrocrffnbzjaaae`) — a 200 alone doesn't prove /welcome can submit.
- [ ] **Verdict:** GO / NO-GO with each collision named. **Then present the three-question user gate; write the answers into the spec as an amendment. STOP until done.**

### Task 2: Fork the two functions (code only, sibling repo)

On `../jobsight-backend` branch `worklog-register`:

- [ ] `supabase/functions/worklog-register-company/` = copy of `register-company/` with: both redirect sites on `WORKLOG_WEBSITE_URL`; `APP_CONFIRM_FALLBACK_URL` deleted; startup https+host+path validation (503 pre-side-effect); `EMAIL_SHARED_SECRET` → `WORKLOG_EMAIL_SHARED_SECRET` (≥32-char check); the `sendEmail` helper URL (one line, fork of :261) → `/functions/v1/worklog-send-email`; header comments rewritten for WorkLog.
- [ ] `supabase/functions/worklog-send-email/` = copy of `send-email/` with: shell + `confirm_signup`/`account_exists` rebranded per the Branding rule; `RESEND_FROM` → `WORKLOG_RESEND_FROM`; `EMAIL_SHARED_SECRET` → `WORKLOG_EMAIL_SHARED_SECRET` (≥32-char check kept); `WEBSITE_URL` reads → `WORKLOG_WEBSITE_URL`; templates not needed by registration deleted.
- [ ] **Gate script `scripts/worklog-a1-gate.sh`** (committed; output pasted in the report). With `A=supabase/functions/worklog-register-company` `B=supabase/functions/worklog-send-email` (explicit path operands on every command):
  - `grep -rinE "punchlist|punch.?log|punch list|#C8102E|APP_CONFIRM_FALLBACK_URL" $A $B | wc -l` ⇒ 0 (case-insensitive; `punch.?log` cannot match `worklog`, so no exclusion guard is needed — any PunchLog/punchlist mention, comment or code, fails the gate)
  - `grep -rnE "href=\"/forgot-password|href=\"/download|href=\"/register" $A $B | wc -l` ⇒ 0
  - `grep -rn "WEBSITE_URL" $A $B | grep -v WORKLOG_WEBSITE_URL | wc -l` ⇒ 0
  - `grep -rn "EMAIL_SHARED_SECRET" $A $B | grep -v WORKLOG_EMAIL_SHARED_SECRET | wc -l` ⇒ 0
  - `grep -rn "RESEND_FROM" $A $B | grep -v WORKLOG_RESEND_FROM | wc -l` ⇒ 0
  - `grep -rn "functions/v1/worklog-send-email" $A | wc -l` ⇒ ≥1; `grep -rnE "functions/v1/send-email\b" $A $B | wc -l` ⇒ 0
  - `grep -rn "WORKLOG_WEBSITE_URL" $A | wc -l` ⇒ ≥3; `grep -rn "WorkLog" $B | wc -l` ⇒ ≥2
- [ ] Commit on the branch; do NOT deploy.

### Task 2b: App seam commit (WorkLog repo, worktree)

- [ ] `src/auth/registration.ts`: the `functions.invoke('register-company')` string → `'worklog-register-company'` + the expectation in `registration.test.ts`; updating the file's header/inline comments that name the function is allowed and encouraged. The `register-company-*` **testIDs** in `app/(auth)/register.tsx` and `.maestro/register-validation.yaml` are unrelated — untouched (blanket rename breaks `maestroSelectors.test.ts`). `npm run verify` green. One commit.

### Task 3: Rehearse on a Supabase branch (USER APPROVAL: paid branch + deletion + may send real email)

**Precondition (from T1): `RESEND_API_KEY` is available to the branch.** A send failure is not a soft skip — send-email 500s make register-company throw (index.ts:432-434) and roll back the just-created company/profile/auth user (:435-452), so no assertions survive without working email. If the branch cannot see a Resend key: STOP, escalate (options: user provides a Resend test key for the branch, or T3 is descoped to deploy-and-400-shape checks only, recorded in the audit doc).

- [ ] Create branch (`create_branch` after `get_cost`/`confirm_cost`). Caveat recorded: migration-built, NOT a clone of the drifted hosted schema — mechanics rehearsal only.
- [ ] Apply missing WorkLog migrations. **Configure the branch's GoTrue `uri_allow_list`** (management API PATCH, branch ref) with the three WorkLog entries BEFORE any round-trip.
- [ ] Deploy both worklog functions to the branch via the management API with flags (`verify_jwt=true` / `false`). Branch secrets: `WORKLOG_WEBSITE_URL`, fresh 44-char `WORKLOG_EMAIL_SHARED_SECRET`, `WORKLOG_RESEND_FROM` per T1 decision.
- [ ] Round-trips (curl template from Global Constraints, branch URL/keys), `client:'app'` AND `client:'web'`, all emails to user-controlled `+` aliases: **fresh** → 200 `{ok:true}` + profile/company/**membership** rows + delivered email whose CTA `action_link` has `redirect_to` host `worklog-site.vercel.app` path `/welcome`, sender = `WORKLOG_RESEND_FROM`, WorkLog branding; **confirmed-duplicate** → first confirm the fresh account on the branch (`auth.admin.updateUserById(id, {email_confirm: true})` via the branch service key — the stated mechanism, since a branch token cannot complete the production-configured /welcome), then re-register → byte-identical 200 (diff saved bodies) + `account_exists` mail; **unconfirmed-duplicate** → re-register a never-confirmed alias → 200 + magiclink mail landing on `/welcome` (link-shape assertion here; end-to-end password-set is T5's); **invalid field** → 400 `{error, field}`; **4th same-alias** → 429. Total curls ≤10.
- [ ] Record evidence; delete the branch (covered by this task's approval).

### Task 4: Production config + deploy (USER APPROVAL naming every change — all additive)

Approval lists exactly: three new `WORKLOG_*` secrets; two new function deploys (vacant slugs, flags stated, via management API); `uri_allow_list` append (three entries). Pre-condition: T1's website check re-run green. Then, in order:

- [ ] **Allowlist first:** PATCH `uri_allow_list` = current live value (re-read NOW, not T1's snapshot) + `https://worklog-site.vercel.app/welcome,worklog://set-password,worklog://confirm`; Site URL untouched.
- [ ] Set the three `WORKLOG_*` secrets.
- [ ] Deploy `worklog-send-email` (`verify_jwt=false`), then `worklog-register-company` (`verify_jwt=true`).
- [ ] Rollback recorded: delete the two worklog functions; delete the three `WORKLOG_*` secrets; **remove exactly the three WorkLog entries from the allowlist's then-current value** (abort + escalate if not found verbatim).

### Task 5: End-to-end production validation (USER APPROVAL: sends real email)

- [ ] `kubiknyc+wl1@gmail.com`, `client:'app'`: email arrives — WorkLog branding, sender per T1 decision, no PunchLog strings, no dead links; CTA lands on `/welcome`; password set succeeds; sign-in works in the app.
- [ ] `kubiknyc+wl2@gmail.com`, `client:'web'`: same assertions (server-contract path).
- [ ] **Confirmed-duplicate:** re-register `+wl1` → byte-identical 200 (diff saved bodies) + WorkLog `account_exists` email with no `/forgot-password` link.
- [ ] **Unconfirmed-duplicate / magiclink recovery (the lost-confirm-link path, index.ts:297-318):** register `kubiknyc+wl3@gmail.com`, do NOT confirm, register it again → magiclink email → open on `/welcome` (site shows the neutral 'other' copy per `welcomeLink.ts:59-64`) → **password set succeeds → sign-in works**. This closes the assertion T3 defers.
- [ ] Bad-field → 400 shape. Alias rotation respects 3/day; total curls ≤10.
- [ ] Update memory + spec status; registration LIVE.

## Self-review notes

- This loop's round-1 findings all addressed: T3 Resend precondition with STOP path (no impossible log-shape fallback); gate gains RESEND_FROM check, case-insensitive branding greps, explicit path operands; magiclink end-to-end assertion added to T5; confirmed-duplicate precondition named (admin email_confirm via branch service key); allowlist rollback = remove-three-entries from current value (both T4 append and rollback read live state, no snapshot restore); action_link carve-out in the Branding rule; deploy mechanism = management API with verify_jwt query param; branching availability checked in T1; URL normalization rule; T2b comment touch-ups allowed; T3 approval covers deletion; A6/A2/sender answers recorded as spec amendment before T2; curl template + byte-identical procedure defined.
- Out of scope: hosted drift reconciliation; universal links; invite flow.
