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
JobSight Supabase project (`nxlznnrocrffnbzjaaae`).

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

- Deploy `register-company` to hosted JobSight (`nxlznnrocrffnbzjaaae`); verify
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
- The WorkLog marketing site itself.
- Reconciling the hosted project's drifted function deployments.
