# Auth Parity — Minimal WorkLog Website Plan (2 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Stand up the minimal WorkLog website — `/welcome` (web set-password landing for confirm/recovery emails), `/terms`, `/privacy` — deployed on Vercel, then flip the app's `LEGAL_PAGES_PUBLISHED` gate.

**Architecture:** Port PunchLog's `website/` Next.js 15 app (`C:\Users\kubik\JOBSIGHT-SUITE\PunchLog\website`, referenced as `PLW/`) into `website/` in this repo, keeping only the pages in scope, rebranded for WorkLog and pointed at the JobSight Supabase project. Spec: `docs/superpowers/specs/2026-08-07-punchlog-auth-parity-design.md` (Resolved decisions + A1).

**Tech Stack:** Next.js 15 / React 19, @zxcvbn-ts, vitest, Vercel.

## Global Constraints

- Port from `PLW/`; copy then apply only listed adaptations. WorkLog branding throughout: product name `WorkLog`, no `PunchLog`/`punchlist` strings except provenance comments.
- In-scope routes ONLY: `/` (minimal landing), `/welcome`, `/terms`, `/privacy`. Do NOT port `register/`, `support/`, `download/`, `delete-account/`, `forgot-password/` (later work).
- `/welcome` reads the Supabase URL + anon key from `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` env vars (JobSight project `https://nxlznnrocrffnbzjaaae.supabase.co`; anon key is the publishable client key — set in Vercel env, and in `.env.local` for dev, gitignored).
- Legal page text: port PunchLog's terms/privacy content rebranded to WorkLog; where the text names the product's function, describe WorkLog (daily construction reports) not punch lists.
- Gate: `cd website && npm run typecheck && npm run test && npm run build` green per task.
- Deploy target: Vercel project named `worklog-site` → `worklog-site.vercel.app`. If that subdomain is taken, pick the closest available (`worklog-site-app`, etc.) and update `src/lib/legal.ts` URLs to the ACTUAL domain in Task 4 — the app constants must match reality, not the presumptive name.
- Commit per task on a worktree branch.

---

### Task 1: Scaffold + legal pages

**Files:**
- Create: `website/` — port `PLW/package.json` (rename `worklog-website`), `next.config.ts`, `tsconfig.json`, `vitest.config.ts`, `app/layout.tsx`, `app/globals.css`, `app/icon.svg` (swap for a WorkLog mark: reuse the field-notebook motif colors from `src/components/BrandMark.tsx`), `app/page.tsx` (minimal: wordmark + one-line description + links to /terms and /privacy), `app/terms/`, `app/privacy/`, plus whatever `components/`/`lib/` files those pages import (trace imports from the pages; port only what's needed).
- Create: `website/.gitignore` (from PLW), `website/.env.local.example` documenting the two env vars.

- [ ] Read `PLW/app/terms/page.tsx`, `PLW/app/privacy/page.tsx`, `PLW/app/layout.tsx`, `PLW/app/page.tsx` fully; trace their imports.
- [ ] Port with WorkLog branding per Global Constraints.
- [ ] `cd website && npm install && npm run typecheck && npm run build` — green; `/terms` and `/privacy` in the route list.
- [ ] Commit: `feat(website): scaffold WorkLog site with terms + privacy`

### Task 2: /welcome set-password page

**Files:**
- Create: `website/app/welcome/` ported from `PLW/app/welcome/` with every lib/component it imports (expect a GoTrue fragment parser and zxcvbn strength meter — port their vitest suites too).

- [ ] Read `PLW/app/welcome/` fully including its tests; port verbatim + rebrand; Supabase URL/key from the env vars (Global Constraints).
- [ ] `npm run test` (vitest) green — ported suites pass; `npm run typecheck && npm run build` green.
- [ ] Commit: `feat(website): /welcome set-password landing`

### Task 3: Deploy to Vercel

- [ ] `cd website && npx vercel link --yes --project worklog-site` then `npx vercel env add` for the two `NEXT_PUBLIC_SUPABASE_*` vars (production), then `npx vercel deploy --prod --yes`. If the CLI needs interactive auth, STOP and report BLOCKED (the controller hands auth to the user).
- [ ] Verify with curl: `/`, `/terms`, `/privacy`, `/welcome` all HTTP 200 on the live domain. Record the ACTUAL domain.
- [ ] Commit any config artifacts that belong in git (`.vercel/` stays gitignored): `chore(website): deploy config`

### Task 4: Flip the app gate

**Files:**
- Modify: `src/lib/legal.ts` — set URLs to the actual live domain (if ≠ presumptive) and `LEGAL_PAGES_PUBLISHED = true` with a comment recording verification date + method.

- [ ] Run `npm run check:submission` (repo root) — must now PASS (flag true + both URLs live-200). That pass is this task's test.
- [ ] `npm run verify` green (legal.test.ts URL-shape assertions still hold).
- [ ] Commit: `feat: flip LEGAL_PAGES_PUBLISHED — legal pages live`

## Self-review notes

- Spec coverage: Resolved-decision "website in scope" → T1-T3; §6/A4 flip → T4; A1's `/welcome` landing → T2. The A1 backend redirect change itself is Plan 3.
- Out of scope: custom domain, marketing content, the excluded PLW routes.
