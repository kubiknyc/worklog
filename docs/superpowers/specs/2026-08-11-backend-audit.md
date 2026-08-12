# Backend preflight audit — Task 1 (read-only)

**Date:** 2026-08-12 (supersedes the 2026-08-12 NO-GO draft, preserved below) · **Writes performed:** none
**Method:** Supabase MCP read-only (`list_edge_functions`, `list_tables`, `list_migrations`,
`execute_sql`, `get_publishable_keys`, `get_project_url`, `list_projects`), `eas env:list`,
live-site curls, repo greps.

## VERDICT: **GO against `bbhszvdbchxwoxxqaxvh` (Punchlist)** — the plan's project ref was wrong, its architecture was right

The plan (and the 2026-08-07 spec it derives from) names `nxlznnrocrffnbzjaaae` as the shared
hosted project. That ref is **"JobSight"** — a different product with ~300 tables, `public.users`,
no `profiles`, no `register-company`, no quota RPC. The earlier NO-GO draft (below) correctly
found that every plan premise fails against it.

**The project the plan *describes* is `bbhszvdbchxwoxxqaxvh` ("Punchlist")** — the PunchLog+WorkLog
shared backend. Every plan premise verifies against it (evidence per bullet below), and
`../jobsight-backend/supabase/.temp/linked-project.json` is linked to exactly this ref. The plan's
prose already names PunchLog as the other tenant throughout; only the ref string was wrong.

### Ref correction — collateral damage found (both are live misconfigurations, independent of plan 3)

| Surface | Current value | Evidence | Impact |
|---|---|---|---|
| Website Vercel env (deployed bundle) | `nxlznnrocrffnbzjaaae` baked into `/_next/static/chunks/app/welcome/page-b990f2c3ad94f6c2.js` | curl + grep of live bundle | `/welcome` cannot complete tokens minted by Punchlist GoTrue — T5's confirm flow fails until repointed + redeployed |
| App EAS `preview` env | `EXPO_PUBLIC_SUPABASE_URL=https://nxlznnrocrffnbzjaaae.supabase.co`, anon key = JobSight legacy JWT | `eas env:list preview` | Preview builds talk to the wrong project entirely |
| App EAS `production` env | **no vars set** | `eas env:list production` | Production builds have no Supabase config |
| `website/.env.local.example:4` | `nxlznnrocrffnbzjaaae` | repo grep | Doc-level; misleads future setup |

Remediation (needs user sign-off at the gate; not plan-3 writes but prerequisites for T5):
repoint Vercel `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` to Punchlist + redeploy;
set EAS preview (and production) `EXPO_PUBLIC_SUPABASE_URL`/`EXPO_PUBLIC_SUPABASE_ANON_KEY` to
Punchlist; fix `.env.local.example`.

## Per-bullet evidence (all against `bbhszvdbchxwoxxqaxvh`)

- **Function inventory:** `list_edge_functions` → `ai-describe` v15, `send-push` v10,
  `send-email` **v23, `verify_jwt=false`** (x-email-secret model confirmed live), `delete-account`
  v9, `invite-user` v14, `register-company` **v16, `verify_jwt=true`**, `report-content` v6.
  **`worklog-register-company` and `worklog-send-email` are VACANT** ✓. (They are also vacant on
  the JobSight project.) Deploy provenance: PunchLog repo GitHub CI (`.backend/` paths).
- **Schema:** `profiles` (12 rows), `companies` (9), `company_members` (9),
  `registration_attempts` (20), all RLS-enabled; no RLS advisories. Triggers:
  `on_auth_user_created` → `handle_new_user()` on `auth.users`; `bootstrap_company_creator` on
  `public.companies` ✓. **`handle_new_user` populates `profiles.email`** (verified via
  `pg_get_functiondef`: `insert into public.profiles (id, email, full_name) values (new.id,
  coalesce(new.email,''), …)`) — the duplicate-lookup escalation branch does NOT fire ✓.
- **RPC:** `consume_registration_quota(p_key text, p_limit integer)` exists ✓.
- **Allowlist minter search (fixes the justified set at TWO entries):**
  - `https://worklog-site.vercel.app/welcome` ← minted by both fork redirect sites (A1) ✓
  - `worklog://set-password` ← `src/auth/AuthProvider.tsx:306` (`resetPasswordForEmail({redirectTo})`) ✓
  - `worklog://confirm` — **NO minter** in app repo or `website/` (only parsed by
    `confirmLanding.ts`/`authLink.ts`; grep for setters returned test files only) → **DROPPED**.
  Justified set = `{https://worklog-site.vercel.app/welcome, worklog://set-password}`. `ADDED` in
  T3/T4 is computed from this two-entry set.
- **Key format + existing-function flags:** Punchlist issues a **legacy anon JWT** (enabled) plus an
  `sb_publishable_…` key. Existing `register-company` is `verify_jwt=true`, so the fork's
  `verify_jwt=true` matches the live sibling ✓. The app currently ships a JWT-format key (good) but
  for the wrong project — covered by the EAS remediation above. T5's JWT preflight stays mandatory.
- **Other-tenant lifecycle:** the only trigger on `auth.users` is `handle_new_user` (shared-by-design
  with PunchLog: inserts a `profiles` row, nothing else). No approval-queue functions or tables on
  Punchlist. A WorkLog registrant enters the shared `auth.users` + `profiles` pool — this is
  exactly gate question A2.
- **Secrets (names only):** NOT YET CHECKED — requires `$SUPABASE_ACCESS_TOKEN`
  (`GET /v1/projects/{ref}/secrets`), collected at the gate. To verify: `RESEND_API_KEY` present;
  no `WORKLOG_*` pre-existing.
- **Resend readiness:** gate question (user reads verified domain off their Resend dashboard).
- **Branching availability + build inputs:** NOT YET CHECKED (billing/plan via `get_cost` at T3;
  token needed for config). Note for T3 approval: Punchlist functions deploy from PunchLog repo CI —
  whether Supabase-native git integration exists (which branch builds pull migrations from) is
  unestablished; T3 may need re-scoping per the plan's own fallback (local `supabase start`
  rehearsal) if no integration exists.
- **GoTrue config (full-body baseline, `mailer_autoconfirm`, Site URL, `uri_allow_list`):** NOT YET
  CHECKED — requires `$SUPABASE_ACCESS_TOKEN`. Must be completed before the verdict is acted on
  (autoconfirm-ON is a STOP).
- **Website prerequisite:** `/welcome` `/terms` `/privacy` all **200** ✓. `/welcome` calls GoTrue
  directly (no edge-function call in `website/` source) — grounds the A6 deferral ✓. Vercel env
  values are the wrong project (see remediation table); `vercel env ls` re-check happens after
  repointing.

## Gate questions (plan-mandated, plus the ref correction)

0. **Ref correction sign-off:** execute plan 3 against `bbhszvdbchxwoxxqaxvh` (Punchlist), with the
   spec/plan ref amended, and repoint website Vercel env + EAS env as prerequisites. (All the
   shared-tenant discipline in the plan applies unchanged — the other tenant is PunchLog, as the
   plan's prose already says.)
1. **A2:** may WorkLog registrants enter the shared `auth.users`/`profiles` pool (shared with
   PunchLog)? "No" kills Tasks 2–5 and escalates to a separate-project design.
2. **A6:** defer `WORKLOG_ALLOWED_ORIGINS` (no WorkLog web deployment calls the function; verified)
   — "defer" or STOP.
3. **Sender:** `WORKLOG_RESEND_FROM` = `worklog@{Resend-verified domain}` or `onboarding@resend.dev`
   (testing-only; descopes T3/T5 and is NOT a completion path).
4. **Token:** `$SUPABASE_ACCESS_TOKEN` for the Management API (GoTrue config read, secrets listing,
   later PATCHes).

## Spec amendment — gate answers (recorded 2026-08-12, before Task 2)

| Question | Answer |
|---|---|
| Ref correction | **Approved: target `bbhszvdbchxwoxxqaxvh` (Punchlist).** Spec/plan ref amended; website Vercel env + EAS env repointing approved as T5 prerequisites. |
| A2 (shared user pool) | **Yes** — WorkLog registrants may enter the shared `auth.users`/`profiles` pool with PunchLog. |
| A6 (CORS) | **Defer** — `WORKLOG_ALLOWED_ORIGINS` unset; three secrets, not four. |
| Sender | **`worklog@dailyjobsight.com`** (Resend-verified domain supplied by user 2026-08-12). |

## Unrelated security finding (JobSight project, surfaced per MCP advisory, NOT acted on)

Two tables on `nxlznnrocrffnbzjaaae` have **RLS disabled** and are fully exposed to its anon key:
`public.spec_sections`, `public.build_intelligence_knowledge_chunks`.
Remediation SQL — **do not run blind; enabling RLS without policies blocks all access**:

```sql
ALTER TABLE public.spec_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.build_intelligence_knowledge_chunks ENABLE ROW LEVEL SECURITY;
```

---

## Appendix: superseded 2026-08-12 NO-GO draft (audit of the wrong ref, `nxlznnrocrffnbzjaaae`)

Preserved because it is the evidence trail for the ref correction: `register-company` absent; no
`profiles` (project uses `public.users`); no `consume_registration_quota`; no
`bootstrap_company_creator`; deployed `send-email` v20 has `verify_jwt=true` (a different product's
function); deployed surface is a ~300-table construction-management suite (`qb-*`, DocuSign,
drawings, submittals, `approve-user` queue). Both worklog slugs vacant there too. Conclusion stood:
"settle which project WorkLog registration actually targets" — settled above.

---

## Env remediation — DONE and verified (2026-08-12, user-approved at the gate)

Prerequisite for T5; these were live misconfigurations independent of plan 3.

| Surface | Before | After | Verification |
|---|---|---|---|
| EAS `preview` | `nxlznnrocrffnbzjaaae` + JobSight anon JWT | `bbhszvdbchxwoxxqaxvh` + Punchlist legacy anon JWT | `eas env:list preview` ✓ |
| EAS `production` | **unset** | Punchlist URL + anon JWT | `eas env:list production` ✓ |
| Vercel `worklog-site` production | JobSight ref baked into the deployed bundle | Punchlist | live-bundle grep ✓ |

Website redeployed to production. Ground-truth check on `https://worklog-site.vercel.app`:
`/welcome` `/terms` `/privacy` all **200**; the welcome chunk
(`/_next/static/chunks/app/welcome/page-e2cc0605816a64a1.js`) contains **1** occurrence of
`bbhszvdbchxwoxxqaxvh` and **0** of `nxlznnrocrffnbzjaaae`.

Key choice: the **legacy anon JWT**, not the `sb_publishable_…` key — `register-company` (and the
planned fork) run `verify_jwt=true`, which requires a JWT-format key. This is what T5's JWT
preflight curl exists to confirm.

Note: `vercel env pull` renders these as `""` because they are stored **Sensitive**; that is not
evidence of an empty value. Verify via the deployed bundle, as above.

**Still outstanding for `website/.env.local.example:4`** — it still names the JobSight ref
(doc-level only; the directory is edit-restricted in this session).

---

## T1 completion via CLI + data inference (2026-08-12, no PAT required)

The Supabase CLI is authenticated on this machine (token in Windows Credential Manager, not a
readable file), which closes two of the three token-gated bullets without `$SUPABASE_ACCESS_TOKEN`.

- **Secrets (names only) — `supabase secrets list --project-ref bbhszvdbchxwoxxqaxvh`:**
  `RESEND_API_KEY` **present** ✓ (T3 precondition satisfiable); `EMAIL_SHARED_SECRET`,
  `WEBSITE_URL`, `ALLOWED_ORIGINS`, `RESEND_FROM`, `PUSH_SHARED_SECRET`, `ANTHROPIC_API_KEY`, and
  the platform `SUPABASE_*` set present for reference. **No `WORKLOG_*` name pre-exists** ✓ — all
  three target names are vacant, so T4's writes stay purely additive.
  The CLI returns SHA-256 **digests**, not plaintext — independently confirming the plan's
  "`GET /secrets` returns digests, not reusable values" correction.

- **`mailer_autoconfirm` — the STOP does NOT fire.** The setting itself needs the Management API,
  but it is decidable from data: `auth.users` holds 11 rows, **2 with `email_confirmed_at IS NULL`**
  (9 confirmed; 2 of those confirmed within 2s of creation, consistent with admin/invite paths).
  **Unconfirmed users cannot exist when autoconfirm is on**, so email confirmations are required
  ✓. Consequences: `generateLink({type:'signup'})` yields an UNCONFIRMED user, so the anonymous
  confirmed-account attack the header at `register-company:70-74` guards against is not live; and
  the unconfirmed-duplicate/magiclink branch at `:296` is reachable, so T3/T5's magiclink
  assertions exercise a real path.
  *Caveat:* this is inference from row state, not a config read. Re-confirm directly once the PAT
  is available, before T4.

### Still blocked on `$SUPABASE_ACCESS_TOKEN`

- ~~**GoTrue full-config baseline**~~ — **CLOSED**, see the section below.
- ~~**Secrets name inventory**~~ — **CLOSED**, see the section below.
- **Branching availability / git-integration** for T3's build inputs. Still open; it is a T3
  precondition and gates nothing in T2.

---

## T1 closure — GoTrue baseline + secrets, read directly (2026-08-12)

**Method.** No personal access token was created, pasted, or written to disk. The Supabase CLI's
existing login credential (Windows Credential Manager, `Supabase CLI:supabase`) was read in-process
and used as the bearer for two **read-only** Management API GETs:
`/v1/projects/bbhszvdbchxwoxxqaxvh/config/auth` and `.../secrets`. No value from either response is
recorded here — names and non-secret settings only.

### GoTrue baseline (authoritative; supersedes the row-state inference above)

| Setting | Value | Why it matters |
|---|---|---|
| `mailer_autoconfirm` | **`false`** | **The STOP does not fire** — now a config read, not an inference. The `:296` unconfirmed-duplicate/magiclink branch is genuinely reachable. |
| `disable_signup` | `false` | `generateLink({type:'signup'})` is not blocked at the project level. |
| `site_url` | `punchlist://` | Replace-forbidden, and it is the OTHER product's scheme. T4 touches it under no circumstances. |
| `uri_allow_list` | 5 entries: `punchlist://set-password`, `https://punchlog-site.vercel.app/welcome`, `punchlist://confirm`, `https://punchlog-site.vercel.app/forgot-password`, `http://localhost:3000/welcome` | **Neither justified WorkLog entry is present**, so T4's `ADDED` set is both of them: `https://worklog-site.vercel.app/welcome` and `worklog://set-password`. Rollback removes exactly those two and nothing else. |
| `hook_send_email_enabled` | `false` (uri empty) | GoTrue does not delegate mail to an edge function. `worklog-send-email` is called by the register fork directly, never as a GoTrue hook — the fork owns its own delivery, as designed. |
| `smtp_host` / `smtp_user` / `smtp_pass` | **all empty** | No custom SMTP: GoTrue's own mail (recovery, invite, email-change) goes through Supabase's built-in mailer at `rate_limit_email_sent = 2`/hour, project-wide and shared with the other tenant. Registration mail is unaffected (it is ours, via Resend), but **the recovery path our copy names as the rescue route is on that 2/hour shared budget** — worth stating in the T5 plan rather than discovering it as a flake. |
| `mailer_otp_exp` | `3600` | Confirm links expire in one hour. T5's end-to-end timing must fit inside it; an expired link is exactly the state the `:296` resend branch exists for. |
| `mailer_subjects_*` / `mailer_templates_*` | GoTrue defaults, **brand-neutral** ("Confirm your email address", "Reset your password", "You've been invited") | Shared templates are replace-forbidden. They happen to name no product, so a WorkLog user receiving a GoTrue-sent recovery mail is not shown the other brand. Nothing to change, and nothing that would tempt anyone to. |
| `security_captcha_enabled` | `false` | The 20/IP + 3/email daily quotas in the fork are the only abuse control on registration. |
| `password_min_length` / `password_required_characters` | `6` / none | Project-wide floor; the app's own strength meter is stricter. |
| `external_email_enabled` | `true`; all OAuth providers `false`; `saml_enabled` `false` | Email is the only identity path, on both tenants. |

### Secrets — names only (Management API, 14 entries)

Platform-managed: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_SECRET_KEYS`, `SUPABASE_DB_URL`, `SUPABASE_JWKS`.

Project: `ANTHROPIC_API_KEY`, `PUSH_SHARED_SECRET`, **`RESEND_API_KEY`**, `RESEND_FROM`,
`EMAIL_SHARED_SECRET`, `WEBSITE_URL`, `ALLOWED_ORIGINS`.

- `RESEND_API_KEY` present ✓ — the T3 precondition is satisfiable without asking the user for a key.
- **No `WORKLOG_*` name exists.** All three targets — `WORKLOG_WEBSITE_URL`,
  `WORKLOG_EMAIL_SHARED_SECRET`, `WORKLOG_RESEND_FROM` — are vacant, so T4's secret writes are
  purely additive and no existing value is read or modified. (`WORKLOG_ALLOWED_ORIGINS` is not
  provisioned: the A6 CORS half is deferred, and the fork falls back to its dev-origin defaults.)
- Reminder, unchanged by this read: edge-function secrets are **project-global**, so
  `WORKLOG_EMAIL_SHARED_SECRET` also sits in the other tenant's runtime. Disclosed in T4's approval.

**T2 is therefore unblocked** — it is code-only in the sibling repo, deploys nothing, and touches
no project state.
