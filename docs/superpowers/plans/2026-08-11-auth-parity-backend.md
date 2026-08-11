# Auth Parity — Backend Audit + Deploy Plan (3 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Make registration work end to end via **fully namespaced, purely additive** backend artifacts: `worklog-register-company` + `worklog-send-email` (WorkLog-branded fork — shared `send-email` never touched), plus WorkLog secrets and GoTrue allowlist appends, validated with real round-trips.

**Architecture:** Audit-first (user decision, spec Resolved decisions). Server code: `../jobsight-backend`, branch `worklog-register` off its default branch. Hosted project `nxlznnrocrffnbzjaaae` is shared with another app; **zero replace-class changes**: no shared function redeployed, no existing secret value modified, no existing template touched. Shared-state classes: (a) replace-forbidden — existing secrets' values, deployed functions, template keys, GoTrue Site URL; (b) append-permitted — GoTrue `uri_allow_list`: append adds exactly three WorkLog entries; **rollback removes exactly those three from the then-current value** (never restores a snapshot; abort + escalate if not found verbatim). Spec: `docs/superpowers/specs/2026-08-07-punchlog-auth-parity-design.md` (§7, A1–A3, A6, Resolved decisions). Santa escalation resolved by user 2026-08-11: fork, don't patch.

**Tech Stack & required credentials:** Supabase MCP (read-only audit: `list_edge_functions`, `list_tables`, `execute_sql`; branch lifecycle: `get_cost`/`confirm_cost`/`create_branch`/`delete_branch`); **Supabase Management API with a personal access token `$SUPABASE_ACCESS_TOKEN` — collected from the user at the T1 gate** (auth config: `GET/PATCH /v1/projects/{ref}/config/auth`; secrets: `POST /v1/projects/{ref}/secrets` — the MCP has no secrets tool; deploys: `POST /v1/projects/{ref}/functions/deploy` with multipart source files + `metadata` JSON carrying `{slug, entrypoint_path, verify_jwt}` — the MCP deploy tool cannot set `verify_jwt`; after every deploy, GET the function record and assert the returned `verify_jwt` matches intent); Vercel CLI (site env check); `../jobsight-backend`; WorkLog app repo (one seam commit).

## Global Constraints

- **Namespaced artifacts only:** new slugs `worklog-register-company` (`verify_jwt=true`; every curl sends `Authorization: Bearer $ANON_KEY` + `apikey: $ANON_KEY`) and `worklog-send-email` (`verify_jwt=false`; `x-email-secret` auth). Neither generic slug is ever claimed. Curl template (keys from env, never inlined):
  `curl -s -X POST "$SUPABASE_URL/functions/v1/worklog-register-company" -H "Authorization: Bearer $ANON_KEY" -H "apikey: $ANON_KEY" -H "Content-Type: application/json" -d '{"companyName":"...","fullName":"...","email":"...","client":"app"}' -o rN.json` — byte-identical-200 checks are `diff r1.json r2.json`.
- **WorkLog secrets (all new; T1 confirms none pre-exist, else escalate):** `WORKLOG_WEBSITE_URL=https://worklog-site.vercel.app`; `WORKLOG_EMAIL_SHARED_SECRET` (fresh 44-char, shared by exactly the two worklog functions, ≥32-char check BOTH sides); `WORKLOG_RESEND_FROM` (T1 gate decision); `WORKLOG_ALLOWED_ORIGINS` (fork of the CORS list read at index.ts:144-150 — unset ⇒ fork keeps its no-origin-echo default). **Shared-by-name reads (exhaustive carve-out list): `RESEND_API_KEY` only.** Values set via `POST /v1/projects/{ref}/secrets`.
- **A1 (mechanically fail-closed):** both redirect sites in the fork (of index.ts:133-135, `APP_CONFIRM_FALLBACK_URL` deleted; of the ternary at :267-272) read `WORKLOG_WEBSITE_URL`; startup validation 503s before any quota RPC / GoTrue call / link generation unless the parsed URL has `protocol==='https:'`, host `worklog-site.vercel.app`, no port, `pathname==='/'`, empty search AND hash; links are built from the parsed canonical origin.
- **A3:** the fork keeps standard template keys and posts ONLY to `worklog-send-email` — the edit is the single `sendEmail` helper URL line (fork of :261); the four call sites (:313, :341, **:395 signup-race**, :424) are enumerated for reviewer verification that none bypasses the helper.
- **Branding rule:** shell + templates rebranded (WorkLog wordmark/footer, blueprint-accent button — not #C8102E), `from: WORKLOG_RESEND_FROM`. Site-owned links point only at `/welcome`, `/terms`, `/privacy`; the confirm CTA href is GoTrue's `action_link` (`*.supabase.co/auth/v1/verify?...redirect_to=<welcome>`) — expected and allowed. No `/forgot-password`, `/download`, `/register` links in any form, including `${VAR}/path` interpolations ("lost your password" copy points at the app's Forgot password button).
- **Production gate:** T3/T4/T5 each require explicit user approval naming the specific actions. T3's approval covers branch creation AND deletion AND possible real email via the shared Resend key.
- **User-decision gate ending Task 1 (unconditional; answers recorded as a spec amendment BEFORE Task 2):** (1) **A2** — may WorkLog registrants enter the shared `auth.users` pool? (2) **A6** — approve deferring both halves (no WorkLog web deployment exists; verified in T1 that the website never calls the function and `/welcome` hits GoTrue directly, so `ALLOWED_ORIGINS` is off the critical path), or name a web deployment. (3) **Sender** — `WORKLOG_RESEND_FROM`: a `worklog@{Resend-verified domain — user reads it off their Resend dashboard}` address (same-domain needs no new verification), **or `onboarding@resend.dev` — WARNING: it delivers only to the Resend account owner's own address, so choosing it DESCOPES T5's Gmail-alias assertions to owner-address sends and is testing-only**. Also collected here: `$SUPABASE_ACCESS_TOKEN` for the management API.
- **Quotas (fork keeps both):** `EMAIL_DAILY_LIMIT` 3/day/address; `IP_DAILY_LIMIT` 20/day/hashed-IP (index.ts:100). Field-validation 400s (index.ts:209-215) precede the quota RPC and cost nothing. **Curl schedule** (fits both quotas): T3 branch — wl-a fresh(app), wl-a re-register after admin-confirm (=confirmed-dup), wl-b fresh(web), wl-c fresh + wl-c re-register (=unconfirmed-dup/magiclink), wl-d ×4 (429 check), bad-field ×1 → 10 curls, aliases distinct. T5 production — wl1 fresh(app), wl2 fresh(web), wl1 re-register (confirmed-dup), wl3 fresh + wl3 re-register (magiclink), bad-field ×1 → 6 curls. Never reset quota rows in production.

---

### Task 1: Read-only preflight audit (no writes anywhere)

Produce `docs/superpowers/specs/2026-08-11-backend-audit.md` with SQL/MCP evidence per bullet:

- [ ] **Function inventory:** `list_edge_functions` — all slugs + versions; `worklog-register-company` / `worklog-send-email` vacant (else escalate); note `register-company` presence and shared `send-email` version (reference only).
- [ ] **Schema:** `profiles` (incl. `email`, `full_name`), `companies` (`created_by`), company-membership table, triggers **`handle_new_user`** and **`bootstrap_company_creator`** (index.ts:68, :412-416 — absent trigger ⇒ company row without membership/admin enrolment). **Escalation branch:** if `handle_new_user` does NOT populate `profiles.email`, the duplicate lookup (index.ts:353-356) never matches and every duplicate path falls into the signup-race branch (:382-402) — T3/T5's duplicate assertions become unreachable; STOP and escalate with options (add a WorkLog migration vs accept degraded duplicate handling) before proceeding.
- [ ] **RPC:** `consume_registration_quota(p_key, p_limit)` exists.
- [ ] **Other-tenant lifecycle:** ALL triggers on `auth.users`; would a WorkLog registrant enter the other app's approval queue/tables/UI?
- [ ] **Secrets (names only, never values):** `RESEND_API_KEY` exists; `WEBSITE_URL`/`EMAIL_SHARED_SECRET`/`RESEND_FROM`/`ALLOWED_ORIGINS` noted for reference; no `WORKLOG_*` secret pre-exists (else escalate).
- [ ] **Resend readiness:** from the user at the gate: which domain is Verified in their Resend dashboard; confirm sending quota headroom for ~16 mails; record that `onboarding@resend.dev` delivers only to the account owner (drives the Sender decision's descope warning).
- [ ] **Branching availability:** hosted project supports preview branches (plan/billing) BEFORE T3 asks the user to pay; if enabling branching is itself a project-level state change, surface it in T3's approval.
- [ ] **GoTrue config:** Site URL + `uri_allow_list` verbatim (`GET /v1/projects/{ref}/config/auth`).
- [ ] **Website prerequisite:** curl `/welcome` `/terms` `/privacy` → 200 AND `npx vercel env ls production` shows both `NEXT_PUBLIC_SUPABASE_*` vars present; confirm from website source (already in-repo) that `/welcome` calls GoTrue directly and never the edge function (grounds the A6 deferral).
- [ ] **Verdict:** GO / NO-GO with each collision named. **Then the three-question user gate + `$SUPABASE_ACCESS_TOKEN` collection; write answers into the spec as an amendment. STOP until done.**

### Task 2: Fork the two functions (code only, sibling repo)

On `../jobsight-backend` branch `worklog-register`. Task artifact: `docs/worklog-fork-report.md` in that repo (gate output pasted there).

- [ ] `supabase/functions/worklog-register-company/` = copy of `register-company/` with: both redirect sites on `WORKLOG_WEBSITE_URL`; `APP_CONFIRM_FALLBACK_URL` deleted; startup canonical-origin validation (503 pre-side-effect per A1); `EMAIL_SHARED_SECRET` → `WORKLOG_EMAIL_SHARED_SECRET` (≥32-char check); `ALLOWED_ORIGINS` → `WORKLOG_ALLOWED_ORIGINS`; `sendEmail` helper URL → `/functions/v1/worklog-send-email`; header comments rewritten.
- [ ] `supabase/functions/worklog-send-email/` = copy of `send-email/` with: shell + `confirm_signup`/`account_exists` rebranded (Branding rule); **all `${WEBSITE_URL}/forgot-password|/download|/register` interpolated links removed** (send-email/index.ts:129, 189, 197, 225 in the source — copy says "use the app's Forgot password button"); `RESEND_FROM` → `WORKLOG_RESEND_FROM`; `EMAIL_SHARED_SECRET` → `WORKLOG_EMAIL_SHARED_SECRET` (≥32-char check kept); `WEBSITE_URL` → `WORKLOG_WEBSITE_URL`; unused templates deleted.
- [ ] **Gate script `scripts/worklog-a1-gate.sh`** (committed; `set -euo pipefail`; every check is a `test`/`[ ]` assertion that EXITS NON-ZERO on failure — counts alone gate nothing; output pasted in the fork report). `A=supabase/functions/worklog-register-company; B=supabase/functions/worklog-send-email` (explicit operands on every grep). Each zero-expectation records its **pre-fork count against the unforked sources** in a comment, proving non-vacuity:
  - `[ "$(grep -rinE 'punchlist|punch.?log|punch list|#C8102E|APP_CONFIRM_FALLBACK_URL' $A $B | wc -l)" -eq 0 ]` (pre-fork: >40)
  - `[ "$(grep -rnE '/(forgot-password|download|register)\b' $A $B | wc -l)" -eq 0 ]` (occurrence-based — catches `${VAR}/forgot-password` interpolations; pre-fork: 8)
  - `[ "$(grep -rnoE '[A-Z_]*WEBSITE_URL' $A $B | grep -v WORKLOG_WEBSITE_URL | wc -l)" -eq 0 ]` (extraction, not line-filtering — a mixed line cannot mask a bare name; pre-fork: >10; same shape for `EMAIL_SHARED_SECRET`, `RESEND_FROM`, `ALLOWED_ORIGINS`)
  - `[ "$(grep -rn 'functions/v1/worklog-send-email' $A | wc -l)" -ge 1 ] && [ "$(grep -rnE 'functions/v1/send-email\b' $A $B | wc -l)" -eq 0 ]`
  - `[ "$(grep -rn 'WORKLOG_WEBSITE_URL' $A | wc -l)" -ge 3 ]`
  - Branding, render-level (mirrors welcome-copy.test.ts's slice approach): extract the `shell(` template literal body from `$B/index.ts` (sed range) and assert it contains `WorkLog` and does not contain `#C8102E` — header comments cannot satisfy it.
- [ ] Commit on the branch; do NOT deploy.

### Task 2b: App seam commit (WorkLog repo, worktree)

- [ ] `src/auth/registration.ts`: `functions.invoke('register-company')` → `'worklog-register-company'` + `registration.test.ts` expectation; comment touch-ups naming the fork allowed. `register-company-*` **testIDs untouched** (app/(auth)/register.tsx, .maestro/register-validation.yaml — blanket rename breaks `maestroSelectors.test.ts`). `npm run verify` green. One commit.

### Task 3: Rehearse on a Supabase branch (USER APPROVAL: paid branch + deletion + may send real email)

**Preconditions:** `RESEND_API_KEY` usable from the branch (a send failure is not soft — send-email non-ok makes register-company throw at :432-434 and roll back the registration at :435-452). If unavailable: STOP, escalate (user supplies a Resend test key, or T3 descopes to deploy + 400-shape checks, recorded in the audit doc).

- [ ] Create branch (`create_branch` after `get_cost`/`confirm_cost`). Caveat: migration-built, NOT a clone of the drifted hosted schema — mechanics only.
- [ ] Apply missing WorkLog migrations. **Branch GoTrue `uri_allow_list`** (management API PATCH, branch ref, `$SUPABASE_ACCESS_TOKEN`) gets the three WorkLog entries BEFORE any round-trip.
- [ ] Deploy both functions via `POST /v1/projects/{branch-ref}/functions/deploy` (multipart, metadata `{slug, entrypoint_path, verify_jwt}`); GET each function record and assert `verify_jwt` true/false as intended. Branch secrets via `POST /v1/projects/{branch-ref}/secrets`: `WORKLOG_WEBSITE_URL`, fresh 44-char `WORKLOG_EMAIL_SHARED_SECRET`, `WORKLOG_RESEND_FROM` per T1 decision.
- [ ] Round-trips per the Global Constraints curl schedule (branch URL/keys; aliases user-controlled): fresh(app) → 200 `{ok:true}` + profile/company/**membership** rows + email whose CTA `action_link` `redirect_to` is host `worklog-site.vercel.app` path `/welcome`, sender `WORKLOG_RESEND_FROM`, WorkLog branding; **confirmed-dup**: `auth.admin.updateUserById(id, {email_confirm: true})` with the branch service key, then re-register → byte-identical 200 (`diff` saved bodies) + `account_exists` mail; fresh(web) → same contract; **unconfirmed-dup** → magiclink mail landing on `/welcome` (link-shape only — production-configured site can't complete a branch token; end-to-end is T5's); bad-field → 400 `{error, field}`; ×4 same alias → 429.
- [ ] Record evidence in the audit doc; delete the branch (covered by this approval).

### Task 4: Production config + deploy (USER APPROVAL naming every change — all additive)

Approval lists exactly: four new `WORKLOG_*` secrets (or three if `WORKLOG_ALLOWED_ORIGINS` stays unset); two function deploys (vacant slugs, `verify_jwt` per Global Constraints, via `/functions/deploy` multipart); `uri_allow_list` append (three entries). Pre-condition: T1's website check re-run green. In order:

- [ ] **Allowlist first:** PATCH `uri_allow_list` = live value re-read NOW + the three entries; Site URL untouched.
- [ ] Secrets via `POST /v1/projects/{ref}/secrets`.
- [ ] Deploy `worklog-send-email` (`verify_jwt=false`) then `worklog-register-company` (`verify_jwt=true`); GET each and assert the flag.
- [ ] Rollback recorded: delete the two functions; delete the `WORKLOG_*` secrets; remove exactly the three allowlist entries from the then-current value (abort + escalate if absent).

### Task 5: End-to-end production validation (USER APPROVAL: sends real email; SKIPPED-to-owner-address if the T1 sender decision was onboarding@resend.dev)

- [ ] `kubiknyc+wl1@gmail.com`, `client:'app'`: email arrives — WorkLog branding, sender per T1, no PunchLog strings, no dead links; CTA lands on `/welcome`; password set succeeds; app sign-in works.
- [ ] `kubiknyc+wl2@gmail.com`, `client:'web'`: same assertions.
- [ ] Confirmed-dup: re-register `+wl1` → byte-identical 200 + WorkLog `account_exists` mail with no forgot-password link.
- [ ] **Magiclink recovery** (closes T3's deferral): `+wl3` fresh, do NOT confirm, re-register → magiclink mail → `/welcome` (neutral 'other' copy per welcomeLink.ts:59-64) → password set succeeds → sign-in works.
- [ ] Bad-field → 400 shape. 6 curls total per the schedule.
- [ ] Update memory + spec status; registration LIVE.

## Self-review notes

- Loop-2 round-2 findings all addressed: gate is fail-closed (`set -euo pipefail`, test-assertions, occurrence-based patterns with recorded pre-fork counts proving non-vacuity, extraction-not-filtering for secret names, render-level branding slice); deploy endpoint corrected to `/functions/deploy` multipart with post-deploy flag assertion; secrets endpoint + `$SUPABASE_ACCESS_TOKEN` named once in Tech Stack and collected at the T1 gate; `ALLOWED_ORIGINS` namespaced (`WORKLOG_ALLOWED_ORIGINS`) with the shared-read carve-out list now exhaustive (`RESEND_API_KEY` only); URL validation extended to port/search/hash with links built from the parsed origin; onboarding@resend.dev restriction surfaced at the gate + T5 descope; `handle_new_user`-no-email escalation branch added; explicit curl schedules; T2 report artifact defined; forbidden-link removal enumerated at its four real source lines (129/189/197/225).
- Out of scope: hosted drift reconciliation; universal links; invite flow.
