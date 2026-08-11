# Auth Parity — Backend Audit + Deploy Plan (3 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Make registration work end to end: audit the shared hosted Supabase project, deploy a WorkLog-parameterized `register-company` + WorkLog email templates + auth redirect config, and validate real registration round-trips (app and web contract paths).

**Architecture:** Audit-first (user decision, spec Resolved decisions). Server code lives in the sibling repo `../jobsight-backend` (its own git; branch from its default branch). The hosted JobSight project `nxlznnrocrffnbzjaaae` is **shared with another app**. Two classes of shared state: (a) **replace-forbidden** — existing secrets' values, existing email template keys, GoTrue Site URL, any function slug another tenant owns: never overwritten; (b) **append-permitted** — list-shaped config (GoTrue redirect allowlist) may be appended to, with the pre-change value recorded for rollback. Spec: `docs/superpowers/specs/2026-08-07-punchlog-auth-parity-design.md` (§7, A1–A3, A6, Resolved decisions).

**Tech Stack:** Supabase (Deno edge functions, GoTrue, Postgres), Supabase MCP tools + management API, `../jobsight-backend` repo.

## Global Constraints

- **Shared-tenant rule:** replace-forbidden vs append-permitted per the Architecture paragraph. Every production change records the pre-change state (function version numbers, allowlist value, secret names) in the audit doc for rollback.
- **A1 (hard, fail-closed):** the WorkLog-deployed `register-company` must contain no `punchlist://` or any custom-scheme fallback — mechanically enforced (T2 grep gate), covering BOTH redirect sites: `appConfirmUrl()` (index.ts:133-135, incl. deleting `APP_CONFIRM_FALLBACK_URL`) and the `client:'web'` branch (index.ts:267-272). Both read `WORKLOG_WEBSITE_URL`; if it is unset the function returns 503 **before** creating any user or link.
- **Deployed-source rule:** the live `send-email` (v20) has drifted from the repo. Any send-email change is based on the **deployed source captured in Task 1**, never the repo file, and adds only new template keys `worklog_confirm_signup` / `worklog_account_exists` (exact names, used everywhere). Redeploying it is still a whole-unit replace of a shared function — it is called that in the Task 4 approval, with version-pinned rollback, not "additive".
- **Production gate:** Tasks 3, 4, 5 each require explicit user approval naming the specific actions (T3 creates a paid branch AND can deliver real email through the shared Resend account; T4 changes the live shared project; T5 sends real production email).
- **A2 gate (unconditional):** Task 1 ends with the user deciding whether WorkLog registrants may enter the shared `auth.users` pool — even if the audit finds no mechanical collision. No Task 2+ work before that decision.
- Client contract stays: the app invokes slug `register-company` with `{companyName, fullName, email, client:'app'|'web'}`, expects `{error, field}` 400s, byte-identical 200s (no account enumeration), 429 rate limit. If Task 1 finds the slug already deployed and owned by the other tenant: automatic escalation — options are a namespaced slug + one-line app seam change (`src/auth/registration.ts` invoke string) or stop.
- **ALLOWED_ORIGINS / A6:** no WorkLog web app is deployed anywhere today (the Expo web build is CI-export only), so there is no WorkLog origin to allow; native-app calls are not CORS-gated. Decision recorded here: DEFER appending to `ALLOWED_ORIGINS` until a WorkLog web deployment exists; the `client:'web'` contract path is still validated server-side via curl (no browser CORS involved).

---

### Task 1: Read-only preflight audit (no writes anywhere)

Produce `docs/superpowers/specs/2026-08-11-backend-audit.md` with SQL/MCP evidence per bullet:

- [ ] **Function inventory:** MCP `list_edge_functions` — record every deployed slug + version. Explicitly: does `register-company` already exist (whose?), and capture the **full deployed source of `send-email` v20** into the audit doc's appendix (basis for T2's template additions). Any slug collision on `register-company` → escalation per Global Constraints.
- [ ] **Schema:** `profiles` (columns incl. `email`, `full_name`), `companies` (`created_by`), company-membership table, triggers `handle_new_user` (does it populate `profiles.email`?) and **`bootstrap_company_creator`** (the function depends on it at index.ts:68 — absent means registrants get a clean 200 and no company). Compare shapes against migrations `20260712000001_companies.sql` / `20260712000002_registration_rate_limit.sql` and the function's assumptions. (`list_tables` + read-only `execute_sql` over `information_schema`, `pg_trigger`.)
- [ ] **RPC:** `consume_registration_quota` exists with the expected signature.
- [ ] **Other-tenant lifecycle:** list ALL triggers on `auth.users`; characterize the approve/reject-user flow — would a WorkLog self-serve registrant enter that app's approval queue, tables, or UI?
- [ ] **Secrets (names only, never values):** which of `WEBSITE_URL`, `ALLOWED_ORIGINS`, `EMAIL_SHARED_SECRET`, `RESEND_API_KEY`, `RESEND_FROM` exist on the project.
- [ ] **send-email v20 contents:** which template keys exist; whose branding; where the shared `WEBSITE_URL` is interpolated (recovery links in `confirm_signup`/`account_exists` bodies — the reason WorkLog variants must read `WORKLOG_WEBSITE_URL`).
- [ ] **GoTrue config:** current Site URL + `uri_allow_list` via management API (`GET /v1/projects/{ref}/config/auth`); record verbatim for the T4 append + rollback.
- [ ] **Verdict:** GO / NO-GO with each collision named. **Then, regardless of verdict: present the A2 product decision to the user (WorkLog registrants entering the shared auth.users pool — with the audit's evidence about what the other app would see). STOP until answered.**

### Task 2: WorkLog-parameterize the backend (code only, sibling repo)

In `../jobsight-backend`, branch `worklog-register` off its default branch:

- [ ] `register-company/index.ts`: BOTH redirect sites read `WORKLOG_WEBSITE_URL` (app path → `/welcome`; web path → `/welcome`); delete `APP_CONFIRM_FALLBACK_URL`; missing `WORKLOG_WEBSITE_URL` → 503 before any GoTrue call. Request template keys `worklog_confirm_signup` / `worklog_account_exists` at every send-email call site (all three: fresh signup, confirmed duplicate, unconfirmed duplicate). Update header comments to WorkLog's contract.
- [ ] `send-email`: create `send-email-worklog-templates.patch` applied ON TOP of the deployed v20 source (from T1's appendix): adds ONLY the two `worklog_*` keys (WorkLog branding, "choose your password" copy, recovery links built from `WORKLOG_WEBSITE_URL`); existing keys byte-identical. The patched file is what T3/T4 deploy.
- [ ] **Mechanical A1 gate** (the function has no deno test harness — do not invent one; this is a grep gate, scripted in the repo): `grep -RnE "punchlist://|APP_CONFIRM_FALLBACK_URL" register-company/ send-email-worklog/` → must be empty; `grep -n "WORKLOG_WEBSITE_URL" register-company/index.ts` → ≥2 sites. Record output in the task report.
- [ ] Commit on the branch; do NOT push/deploy.

### Task 3: Rehearse on a Supabase branch (USER APPROVAL: paid branch + can send real email)

- [ ] Approval ask names: branch cost (`get_cost`/`confirm_cost`), and that the rehearsal sends real email via the shared Resend account to a user-controlled address.
- [ ] Create the branch (`create_branch`). Note in the audit doc: **a branch is migration-built, NOT a clone of the hosted project's drifted schema — it rehearses the function mechanics, not the collision risks; those are covered only by T1's audit.**
- [ ] Apply missing WorkLog migrations to the branch only. Deploy `register-company` and the patched send-email to the branch — **send-email with `verify_jwt=false`** (it authenticates via `x-email-secret`, and register-company's call carries no JWT). Set branch secrets: `WORKLOG_WEBSITE_URL=https://worklog-site.vercel.app`, `EMAIL_SHARED_SECRET` = freshly generated ≥32-byte value (never production's) — the **same value** on both functions' env, plus `RESEND_API_KEY`/`RESEND_FROM` (production names exist per T1; branch inherits or user provides a test key — if neither, skip actual delivery and assert the captured outbound payload instead).
- [ ] Round-trips via curl against the branch, `client:'app'` AND `client:'web'`: fresh registration → 200 `{ok:true}` + profile/company/membership rows + confirm URL on `/welcome` with no `punchlist://`; confirmed-duplicate → byte-identical 200 + `worklog_account_exists` mail; **unconfirmed-duplicate → 200 + magiclink mail whose link lands on `/welcome` (site classifies `type=magiclink` as generic copy — assert password set still works there, PunchLog-parity)**; invalid field → 400 `{error, field}`; rate limit → 429.
- [ ] Record all evidence in the audit doc; delete the branch (approval).

### Task 4: Production config + deploy (USER APPROVAL naming every change)

Approval ask lists exactly: new secret `WORKLOG_WEBSITE_URL`; deploy `register-company` (new function or versioned replace per T1's inventory); **whole-unit redeploy of shared `send-email`** from the T2 patched-v20 source (framed as the replace it is, with the pre-change version number pinned for rollback); GoTrue `uri_allow_list` append. Then:

- [ ] Set `WORKLOG_WEBSITE_URL=https://worklog-site.vercel.app`.
- [ ] Deploy `register-company` (slug per T1 outcome; if renamed, update `src/auth/registration.ts` invoke string + its test in the app repo, one commit).
- [ ] Deploy patched send-email (`verify_jwt=false` preserved); verify `EMAIL_SHARED_SECRET` already serves both functions (same project-level secret).
- [ ] GoTrue: `PATCH /v1/projects/{ref}/config/auth` with `uri_allow_list` = T1's recorded value + `https://worklog-site.vercel.app/welcome,worklog://set-password,worklog://confirm` (append; Site URL untouched).
- [ ] Rollback recorded in the audit doc: redeploy prior send-email version (number from T1), delete/restore `register-company` per T1 inventory, restore T1's verbatim `uri_allow_list`, delete `WORKLOG_WEBSITE_URL`.

### Task 5: End-to-end production validation (USER APPROVAL: sends real email)

- [ ] Register `kubiknyc+worklogtest@gmail.com` via curl, `client:'app'`: user opens the email — confirm link lands on `https://worklog-site.vercel.app/welcome`, password set succeeds, sign-in works in the app.
- [ ] Repeat via `client:'web'` with a second `+` alias: same landing, no PunchLog URL anywhere in the mail body.
- [ ] Duplicate (confirmed) and bad-field paths re-checked in production: byte-identical 200 / 400 shape.
- [ ] Update memory + spec status; registration LIVE.

## Self-review notes

- Spec coverage: §7 → T1+T4; A1 → Global Constraints + T2 grep gate + T3/T5 assertions (both client paths); A2 → unconditional user gate ending T1; A3 → deployed-source rule + T2 patch discipline; A6 → explicit deferral decision (no WorkLog web origin exists) recorded in Global Constraints.
- All four reviewer-critical findings from santa round 1 are addressed: deployed-v20 basis for send-email, slug-inventory audit + escalation, both-redirect-sites fail-closure with mechanical grep, bootstrap_company_creator/membership in the audit.
- Out of scope: hosted-project drift reconciliation beyond what registration touches; universal links; invite flow; ALLOWED_ORIGINS (deferred with rationale).
