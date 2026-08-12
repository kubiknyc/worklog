# Backend preflight audit — Task 1 (read-only)

**Project:** `nxlznnrocrffnbzjaaae` · **Date:** 2026-08-12 · **Writes performed:** none
**Method:** Supabase MCP read-only (`list_edge_functions`, `list_tables`, `execute_sql`)

## VERDICT: **NO-GO** — the plan's core premise does not hold against this project

Plan 3 assumes it is forking `register-company` + `send-email` *alongside their originals* on this
project, and that the fork's duplicate-detection, quota, and company-bootstrap paths land on schema
that already exists. **None of that is true here.** Four independent blockers, any one of which is a
STOP.

## Blocker 1 — `register-company` is not deployed on this project

`list_edge_functions` returns 24 functions. `register-company` is **absent**. So are `invite-user`,
`delete-account`, `ai-describe`, `report-content`, `send-push`.

The deployed set belongs to a different product: `qb-*` (QuickBooks ×7), `docusign-token-exchange`,
`approve-user` / `reject-user` / `get-pending-users`, `weather-api`, `ai-proxy`,
`process-drawing-pdf`, `extract-sheet-metadata`, `build-intelligence-query`, `weekly-timesheet`,
`email-webhook`, `verify-captcha`, `validate-file-upload`, `find-pattern-matches`,
`export-material-list`, `extract-document-chunks`.

**`../jobsight-backend` is not the source of truth for this project.** The whole fork-don't-patch
architecture — and the santa escalation that produced it — reasoned about a coexistence that does
not exist here.

## Blocker 2 — the schema the fork depends on is absent

| Object the fork requires | Source ref | Present? |
|---|---|---|
| `profiles` table (duplicate lookup) | `register-company:353-356` | **NO** — no `profiles` in any schema |
| `consume_registration_quota(p_key, p_limit)` | `:232`, `:243` | **NO** |
| `bootstrap_company_creator` trigger | `:67`, `:412-416` | **NO** |
| `handle_new_user` | `:63` | yes (trigger `on_auth_user_created` on `auth.users`) |
| `companies` | `:412-416` | yes |

This project uses `public.users`, not `profiles`.

This is the plan's own escalation branch (T1, *Schema*) in its strongest form: it anticipated
"`handle_new_user` does not populate `profiles.email`" and required a STOP. Here there is no
`profiles` table at all, so **every duplicate path collapses into the signup-race branch
(`:382-402`) and both quota RPCs fail outright** — the function could not serve a single successful
registration against this database.

## Blocker 3 — deployed `send-email` has `verify_jwt: true`

Deployed: `send-email`, version 20, **`verify_jwt: true`**.

The source it would be forked from documents the opposite (`send-email/index.ts:25-27`: "Deploy:
`supabase functions deploy send-email --no-verify-jwt` … the shared-secret header is the auth
instead"). The deployed function has drifted from the repo, or was never deployed from it. Either
way the plan's `x-email-secret`-only auth model does not describe what is running, and the fork's
`verify_jwt=false` intent becomes a *divergence* from the live sibling rather than parity with it.

## Blocker 4 — the shared-tenant model was mis-scoped

The plan treats this as "PunchLog's project, which WorkLog is joining additively." The deployed
surface is a large construction-management product (drawings, submittals, RFIs, lien waivers,
QuickBooks, DocuSign, agent tooling — roughly 300 tables). Whatever the tenancy story is, it is not
the two-app model the risk analysis, the rollback rules, and the T4 approval text were written
against.

## What is still GO

- **Both target slugs are vacant:** no `worklog-register-company`, no `worklog-send-email`. The
  namespacing would not collide.
- `companies` exists; `handle_new_user` + `on_auth_user_created` exist.

## Not checked (require `$SUPABASE_ACCESS_TOKEN`, collected at the T1 gate — never reached)

GoTrue Site URL / `uri_allow_list` / `mailer_autoconfirm`; secret name inventory (`RESEND_API_KEY`,
`WORKLOG_*` vacancy); preview-branch availability and git integration; website `/welcome` `/terms`
`/privacy` 200s and Vercel env; Resend verified domain.

## Unrelated security finding (surfaced per MCP advisory, NOT acted on)

Two tables have **RLS disabled** and are fully exposed to the `anon` key: `public.spec_sections`,
`public.build_intelligence_knowledge_chunks`.

Remediation SQL — **do not run blind; enabling RLS without policies blocks all access**:

```sql
ALTER TABLE public.spec_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.build_intelligence_knowledge_chunks ENABLE ROW LEVEL SECURITY;
```

## Recommendation

Do not proceed to Task 2. Settle first **which project WorkLog registration is actually supposed to
target**, and whether `../jobsight-backend` is deployed anywhere. Plan 3 cannot be repaired by
editing its steps; its premise needs re-establishing.
