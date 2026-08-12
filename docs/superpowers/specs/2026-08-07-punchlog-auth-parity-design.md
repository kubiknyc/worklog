# PunchLog auth parity — registration and login

**Date:** 2026-08-07
**Status:** Approved (user, this session)
**Goal:** WorkLog's registration and login flows become functionally and visually identical to PunchLog's (`../PunchLog`), adapted to WorkLog branding and repo conventions.

## Context

WorkLog's `app/(auth)/login.tsx` is already a near-copy of PunchLog's login. What's
missing is everything around it: a register screen, the invite-style confirmation
email → set-password flow, the confirm-link deep-link handling, the brand mark, and
the legal links. The server side (`register-company` edge function) exists in
`../jobsight-backend/supabase/functions/` but is **not deployed** to the hosted
shared Supabase project **`bbhszvdbchxwoxxqaxvh` ("Punchlist")** — the PunchLog+WorkLog backend.
(An earlier draft said "JobSight `nxlznnrocrffnbzjaaae`"; that is a different product where none of
this exists. Corrected 2026-08-12 from the T1 audit.)

## Approach

Straight port from PunchLog, adapted to WorkLog conventions. Rejected alternatives:
a shared auth package (couples two diverging repos for little gain) and a fresh
implementation (PunchLog's flow is proven, including subtle security properties
worth preserving byte-for-byte — see Invariants).

Architecture rule preserved: **screens never import the Supabase client.** All
network calls go through seams in `src/auth/`.

## Components

### 1. Login screen (`app/(auth)/login.tsx`) — modify

- Add `<BrandMark size={64} />` above the wordmark in the lockup.
- Add "New here? *Create a company account*" link → `/(auth)/register`
  (testID `login-register`).
- Demo rows: Ionicons avatar (`shield-checkmark` / `construct`) + trailing
  `chevron-forward`, matching PunchLog.
- Everything else (fields, forgot-password, styles) unchanged.

### 2. BrandMark (`src/components/BrandMark.tsx`) — new

Same construction as PunchLog's: RN primitives + Ionicons, no react-native-svg,
fixed internal palette (logos don't re-tint per theme), 120-unit design box,
`size` and `chip` props. Different motif: a field-notebook daily-report page —
ruled lines and a bold date-stamp corner block, WorkLog accent + slate ink.

### 3. Register screen (`app/(auth)/register.tsx`) — new

Ported from PunchLog minus branding:

- Fields: company name, your name, email. **No password field** — invite-style
  registration; the server mints a discarded random password and the emailed
  confirmation link lands on set-password.
- Success state: in-place "Check your email" copy (platform-aware: "on this
  phone" only on native). Byte-identical whether or not the account already
  existed.
- Field-level errors under inputs; top-level error above the button; typed result
  kinds from the seam (`ok | invalid | rateLimited | failed`).
- Legal consent line linking Terms + Privacy (see §6).
- testIDs on every control per `.maestro/README.md` naming.

### 4. Set-password + confirm flow — new

Port from PunchLog:

- `app/set-password.tsx` — password choice screen reached from the confirm email
  (registration) and recovery email (forgot password).
- `app/confirm.tsx` — confirm-link landing.
- Seams: `passwordChoice.ts`, `passwordStrength.ts`, `setPasswordSession.ts`,
  `confirmLanding.ts`, `pendingAuthLink.ts` (+ their test files).
- Extend WorkLog's existing `src/auth/authLink.ts` to PunchLog's shape.
- Verify the deep-link `scheme` in `app.json`; add if missing. **Native change →
  ships as a store build** (runtimeVersion fingerprint policy), never OTA.

### 5. Registration seams (`src/auth/`) — new

- `registration.ts` — calls the `register-company` edge function; parses its
  `{error, field}` contract; returns typed results, never throws past the seam.
- `registrationValidation.ts` — pure client-side validation.
- Both ported with full test files. Jest ignores `app/`, so seams carry coverage.

### 6. Legal links (`src/lib/legal.ts`) — new

- `TERMS_URL` / `PRIVACY_URL` → `https://worklog-site.vercel.app/terms|/privacy`
  (presumptive future domain; no WorkLog site exists yet).
- `LEGAL_PAGES_PUBLISHED = false`.
- **Deviation from PunchLog:** the gate is asserted by a dedicated
  `check:submission` npm script, NOT by the jest suite — WorkLog runs `verify` in
  CI on every PR and a deliberately-red suite would poison unrelated work.
  The gate stays mechanical at submission time; CI stays green day-to-day.
  Flip the flag only after both URLs return 200 on the deployed site.

### 7. Backend + hosted-project config

- Deploy to the hosted shared project (`bbhszvdbchxwoxxqaxvh`, "Punchlist"); verify
  compatibility with the deployed `send-email` (v20).
- Add confirm/set-password deep-link URLs to Supabase Auth's redirect allowlist.
- Flagged, out of scope: the hosted project's deployed function set has drifted
  from the `jobsight-backend` repo generally.

## Invariants (preserve exactly from PunchLog)

- **No account enumeration:** register success response and success copy are
  identical whether or not the account existed; forgot-password notice does not
  confirm accounts.
- **No password in the registration contract.**
- **Demo logins:** `__DEV__ && EXPO_PUBLIC_DEMO_LOGINS !== 'off'` gate so the
  password literal is dead-code-eliminated from production bundles.
- On auth success the layout guard redirects; screens never navigate manually.

## Testing

- All ported seam tests (registration, validation, passwordChoice, strength,
  setPasswordSession, confirmLanding, pendingAuthLink, authLink extensions).
- `src/maestroSelectors.test.ts` updated for new testIDs.
- Gate: `npm run verify` green; `npm run check:web` green (BrandMark uses no
  native-only modules).

## Out of scope

- Invite management UI (`invites.ts`, `companyMembers.ts` from PunchLog).
- Reconciling the hosted project's drifted function deployments.

## Resolved decisions (2026-08-07, user)

- **Website:** a minimal WorkLog site (`/welcome` web set-password, `/terms`,
  `/privacy`) is IN SCOPE, cloned from PunchLog's website pieces, deployed to
  Vercel. Registration ships working end to end; §6's gate flips when live.
- **Tenancy:** audit-first. The A2 preflight audit of the hosted project runs
  before any deploy decision; deploy to the shared project only if its schema
  matches jobsight-backend's assumptions and cross-tenant risks are acceptable
  (rehearsed on a Supabase branch). Otherwise escalate back to the user with
  the evidence before considering a separate project.

## Review amendments (2026-08-07, two-agent review)

Corrections from the fact-check pass:

- **Theme:** PunchLog screens use `FIXED_COLORS.error`, which WorkLog's
  `FIXED_COLORS` lacks (`{ camera }` only). Add `error` to WorkLog's
  `FIXED_COLORS` (matching PunchLog's value) rather than diverging the port.
- **Dependencies:** `passwordStrength.ts` requires `@zxcvbn-ts/core`,
  `@zxcvbn-ts/language-common`, `@zxcvbn-ts/language-en` — add to package.json.
- **authLink extension is also a security fix:** PunchLog's version stops
  echoing GoTrue's `error_description` (attacker-controlled text reachable via
  custom-scheme links); WorkLog's current parser still echoes it. Port includes
  this fix and the `LINK_PROBLEM_MESSAGE` export, plus the `'signup'` link type.
- **Contract detail:** `register-company` takes `{companyName, fullName, email,
  client: 'app'|'web'}`; the `client` field drives the confirm-link landing.
- **Scheme:** `worklog` scheme already registered in app.json — no native change
  needed for the port itself. Universal links (`associatedDomains` + AASA) are
  deferred until a website exists; THAT will be the native change forcing a
  store build.

Findings that change the plan (from the risk review):

- **A1 — Confirm-link landing (supersedes part of §4/§7).** `register-company`
  no longer deep-links registrants into the app: after a 2026-08-02 incident
  (Gmail's in-app browser silently refuses custom-scheme redirects), PunchLog
  lands `client:'app'` registrants on the website's `/welcome` set-password
  page, with a **hardcoded `punchlist://set-password` fallback** when
  `WEBSITE_URL` is unset. Deployed unmodified for WorkLog, registrants would
  land on the PunchLog site or receive dead `punchlist://` links (which, with
  PunchLog installed on the same phone, would deliver a WorkLog auth token into
  the PunchLog app). Therefore: the function must be parameterized/forked so a
  WorkLog registration can never mint a `punchlist://` URL, and **a minimal
  WorkLog website (`/welcome`, `/terms`, `/privacy`) is a prerequisite of
  shipping registration** — it also satisfies §6. `app/confirm.tsx` is a legacy
  shim in PunchLog; WorkLog keeps it only as a generic bad-link landing.
- **A2 — Shared-project tenancy (gates §7).** The hosted project serves another
  app (approve/reject-user flow, QuickBooks, drawings). `register-company`
  assumes `profiles`/`companies` tables, a `handle_new_user` trigger, and the
  `consume_registration_quota` RPC exist and are WorkLog-shaped; `auth.users`,
  GoTrue email templates, Site URL, redirect allowlist, and function secrets
  (`WEBSITE_URL`, `ALLOWED_ORIGINS`, `EMAIL_SHARED_SECRET`) are all shared with
  the other tenant. Before any deploy: a read-only preflight audit (tables,
  triggers on auth.users, RPCs, secrets) diffed against the function's
  assumptions, rehearsed on a Supabase branch — and an explicit product decision
  on whether WorkLog registrants may enter the shared `auth.users` pool.
- **A3 — send-email templates.** Registration hard-requires `send-email`
  (`EMAIL_SHARED_SECRET` or 503) and its `confirm_signup`/`account_exists`
  templates; the deployed v20's templates belong to the other tenant. Add
  WorkLog-branded template variants; never mutate shared ones.
- **A4 — Submission gate needs an enforcement point.** `check:submission` must
  live-check both legal URLs return 200 AND be the only sanctioned path:
  `submit:ios`/`submit:android` npm wrappers around `eas submit`, a CLAUDE.md
  note prohibiting raw `eas submit`, and the same check in any release CI job.
- **A5 — Queue-loss guard.** If user A has unsynced queued mutations and taps
  user B's confirm/recovery link, the session swap rebuilds RepositoryProvider
  and wipes A's cache. Before applying a session for a different userId,
  check the pending-mutation count and block with "sign in and sync first"
  copy (never silent-destroy offline reports). Covered by a seam test.
- **A6 — Web/CORS.** WorkLog web origins must be added to `ALLOWED_ORIGINS`
  (noting the shared-secret blast radius); Testing gains "register/confirm/
  set-password functional in the `check:web` export against local Supabase."
- **A7 — E2E.** Add a Maestro flow for register-screen validation and the
  `worklog://set-password#error=...` landing states (no email loop needed);
  assert existing login testIDs unchanged. Full email-loop stays a manual
  on-device checklist.
- **A8 — `pendingAuthLink`** is a second sanctioned module-stateful exception
  (one-shot, security-motivated) — document it alongside `statusHub.ts` in
  CLAUDE.md so it doesn't get "fixed" into a route param later.

## Amendment — T1 gate answers (2026-08-12, user-recorded before Task 2)

Required by plan 3's "User-decision gate ending Task 1". Evidence:
`docs/superpowers/specs/2026-08-11-backend-audit.md`.

- **Project ref corrected.** Execute against `bbhszvdbchxwoxxqaxvh` ("Punchlist"), the
  PunchLog+WorkLog shared backend. `nxlznnrocrffnbzjaaae` ("JobSight") is a different product
  where every premise fails. **Approved**, together with repointing the website Vercel env and
  EAS preview/production env to Punchlist — those are live misconfigurations today, independent
  of plan 3, and T5's confirm flow cannot pass until they are fixed.
- **A2 — shared `auth.users` / `profiles` pool: YES.** WorkLog registrants may enter the pool
  shared with PunchLog. Verified at T1 that `handle_new_user` is the only `auth.users` trigger
  and only inserts a `profiles` row; Punchlist has no approval-queue tables or functions, so a
  WorkLog registrant has no other-tenant lifecycle side effect.
- **A6 — CORS half DEFERRED.** No WorkLog web deployment calls the function (`website/` contains
  no edge-function call; `/welcome` hits GoTrue directly). `WORKLOG_ALLOWED_ORIGINS` stays unset
  ⇒ **three** new `WORKLOG_*` secrets, not four.
- **Sender — verified-domain address: `WORKLOG_RESEND_FROM = worklog@dailyjobsight.com`**
  (user-supplied 2026-08-12). `onboarding@resend.dev` was declined, so the T3/T5 owner-address
  descopes do NOT apply and T5 runs the full `kubiknyc+wlN@gmail.com` alias schedule and ends LIVE.
  A new address on an already-verified domain needs no further Resend verification.
  **Verified only by the user reading their Resend dashboard — not independently confirmed here.**
  T3's precondition is where this gets tested for real: if the domain is not actually Verified, the
  first send returns non-ok, `register-company` throws at `:432-434` and rolls back the
  registration, and every T3 assertion fails for a configuration reason. Treat a first-send failure
  as "check Resend", not as a fork defect.
  *Cosmetic, not a blocker:* the sender domain reads `dailyjobsight.com` while the email body is
  WorkLog-branded, so the From line will not say WorkLog. Raise with the user before T5 if that
  matters for the store-review trail.
- **`$SUPABASE_ACCESS_TOKEN` — still outstanding.** Blocks the remaining T1 bullets (GoTrue full
  config + `mailer_autoconfirm`, secret-name inventory, branching availability) and all of T3/T4.

**T1 is NOT complete.** Outstanding before Task 2: the Resend domain, the access token, and the
three token-gated audit bullets — including the `mailer_autoconfirm` check, which is a STOP if
autoconfirm is enabled.
