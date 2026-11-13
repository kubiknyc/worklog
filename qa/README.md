# WorkLog QA harness (local Supabase only)

Harness for the WorkLog pre-launch functional pass (Multica MULT-49). Everything
here runs against the **local** Supabase stack from `../jobsight-backend`. It
never touches a hosted project: every script refuses a non-loopback URL, and
the SQL only runs inside the local Postgres container.

No `.env` file is read or written anywhere in this flow. The app is pointed at
the local stack with shell environment variables only (§4).

## 1. Prerequisites

- Docker Desktop running.
- Supabase CLI 2.x (tested on 2.109.1). The backend's `config.toml` needs no
  edits: the old PunchLog-harness `auto_expose_new_tables` workaround is
  obsolete since `20261109000001_explicit_role_grants.sql` (MULT-15).
- `jobsight-backend` cloned next to this repo (`../jobsight-backend`), which
  WorkLog's own `CLAUDE.md` already requires.
- Node 22. `npm ci` in this repo for Expo. The web smoke has its own package
  (`qa/web/package.json`, Playwright) so the app's `package.json` stays untouched.

## 2. Local stack

```bash
cd ../jobsight-backend
supabase start                # API 127.0.0.1:54321, DB 54322, Studio 54323, Mailpit 54324
supabase db reset --local     # replay every migration (88 at 6496a6c, clean)
supabase status -o env        # local ANON_KEY / SERVICE_ROLE_KEY (local demo keys, fine to use)
```

Run `db reset` when the backend has new migrations, or when you want a clean
database. It wipes everything, the PunchLog QA seed included.

The DB container is `supabase_db_PUNCH-LOG-NEW` (`project_id` in config.toml),
the same stack PunchLog QA uses.

### Edge functions

`supabase functions serve` (from the backend dir, no secrets set) serves them
locally when a test needs one:

| Function | Locally | Why |
|---|---|---|
| `delete-account` | testable | needs only the local keys the CLI injects |
| `worklog-weather` | testable, needs internet | calls the keyless public Open-Meteo API |
| `worklog-geocode` | testable, needs internet | needs only the local keys; calls a public geocoder |
| `worklog-register-company` | testable | local keys only |
| `invite-user` | partly | without `EMAIL_SHARED_SECRET` no email is sent |
| `worklog-send-email`, `send-email` | **not testable** | need Resend. Never set a real key; PDF/email delivery is "Manual (Eli)" |
| `send-push` | **not testable** | needs the Expo push service |

Auth mail (password reset, confirm) lands in local Mailpit at
http://127.0.0.1:54324 and is never delivered for real.

## 3. Seed and role check

```bash
node qa/seed/seed-local.mjs      # re-runnable; wipes and rebuilds only the WorkLog QA namespace
node qa/seed/verify-roles.mjs    # signs in as every account; expects 9/9 PASS
```

The seed drives the report lifecycle through the **real** SECURITY DEFINER
RPCs (`create_report` → `update_section` → photo insert → `submit_report` →
`lock_report` → `amend_report`), signed in as the seeded user, so the rows are
exactly what the app itself would produce. The wipe runs with no JWT subject,
the same bypass `delete-account` relies on. It does not disable triggers.

Isolation from the PunchLog QA seed in the same database: WorkLog QA uses
`qa-wl-*@worklog.test` and ids `0b000000-0000-4000-8000-…`. PunchLog uses
`qa-*@punchlog.test` and `0a000000-…`. The wipe refuses to run if its target
set leaves that namespace, and the seed fails if any `0a` row count changes.

**Auto-lock:** `lock_stale_submitted_reports()` locks submitted reports after
24 h (`worklog_config.lock_grace_hours`), when pg_cron is present. The two
"submitted" reports are created at seed time, so re-seed before a run that
needs them still submitted.

### Accounts (password `qa-local-only-2026`, local only)

| Account | Role | Sees (verify-roles) |
|---|---|---|
| `qa-wl-admin@worklog.test` | Company admin of A (QA-WL Granite Builders), super on Riverside + Depot | 2 projects, 6 reports, 5 photos, 1 amendment. Delete account → **refused** (last admin, others in company) |
| `qa-wl-super@worklog.test` | Company member of A, super on Riverside, title "Superintendent" | 1 project, 4 reports |
| `qa-wl-pm@worklog.test` | Company member of A, super on Riverside + Depot, title "Project Manager" (PM = super + display title, PRD §10) | 2 projects, 6 reports |
| `qa-wl-sub@worklog.test` | No company; **sub** on Riverside | the project, **0** reports/photos/signatures; photo download denied |
| `qa-wl-b-admin@worklog.test` | Company admin of B (QA-WL Harbor Works), super on Pier 9 | only Pier 9: 1 report. Cross-tenant canary |
| `qa-wl-member@worklog.test` | Company member of A, no projects | nothing |
| `qa-wl-new@worklog.test` | Brand-new: no company, no projects | nothing (empty states, create-project) |
| `qa-wl-solo@worklog.test` | No company; sole member of the company-less **Solo Garage** | 1 project, 2 reports (1 locked + signed). Delete account → **warning**: no-company project and its locked report are deleted |
| `qa-wl-soloco@worklog.test` | Sole admin and sole member of company C (QA-WL Solo Co) | 1 project, 1 locked report. Delete account → **warning**: company deleted with the account (worklog #44) |

`verify-roles.mjs` also replays the client half of the deletion warning
(`src/auth/soloCompany.ts`) for admin / solo / soloco. It never calls
`prepare_account_deletion`, because that function deletes data. Deleting a
seeded account in the app is real, and a re-seed restores it.

### Data (dates relative to the seed day, in each project's timezone)

| Project | Company / TZ | Date | Status | Content |
|---|---|---|---|---|
| QA-WL Riverside Tower | A / America/New_York, site GPS | today | **draft** | all 11 sections (safety = "None today"), open delay, 2 photos (one GPS, one library photo with **no location**) |
| | | today-1 | submitted (signed) | crew, work, equipment, safety, visitors, notes, 1 photo. Carry-forward source |
| | | today-2 | locked (signed) | first-aid **incident** + weather delay (History filters) |
| | | today-3 | locked + **amended** | super submitted, PM locked, PM amended crew + notes with a signature. 1 photo, 2 signatures |
| QA-WL Depot Warehouse | A / no timezone, no geo (device-TZ fallback) | today-1 | submitted (PM) | 1 library photo, no location |
| | | today-4 | locked (PM) | |
| QA-WL Pier 9 Lofts | B / America/Los_Angeles | today-1 | submitted | company-B canary text and photo |
| QA-WL Solo Garage | **none** (`company_id` NULL) / America/Chicago | today-2 | locked (signed) | 1 photo |
| | | today | draft | notes only |
| QA-WL Solo Co Duplex | C / America/New_York | today-2 | locked (signed) | 1 photo |

Depot and Solo Garage have no draft for today, so "start today's report"
can be tested there. Photos are in the `worklog-photos` bucket at
`<project>/<report>/<photo>.jpg`. Signatures are `report_signatures.png_bytes`
(`qa/seed/assets/signature.png`).

## 4. Start WorkLog against the local stack (shell env only)

The app reads `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`,
`EXPO_PUBLIC_SENTRY_DSN` and `EXPO_PUBLIC_DEMO_LOGINS`.

- `EXPO_NO_DOTENV=1` stops Expo loading any `.env*`.
- An empty Sentry DSN keeps Sentry off.
- `EXPO_PUBLIC_DEMO_LOGINS=off` hides the demo-login rows. Those are the
  App Review accounts, and QA must never use them.

**Web (Git Bash):**

```bash
ANON=$(cd ../jobsight-backend && supabase status -o env | sed -n 's/^ANON_KEY="\(.*\)"$/\1/p')
EXPO_NO_DOTENV=1 EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
EXPO_PUBLIC_SUPABASE_ANON_KEY="$ANON" EXPO_PUBLIC_SENTRY_DSN= EXPO_PUBLIC_DEMO_LOGINS=off \
npx expo start --web --port 8081
```

**Web (PowerShell):**

```powershell
$anon = (supabase status -o env --workdir ..\jobsight-backend | Select-String '^ANON_KEY="(.*)"').Matches.Groups[1].Value
$env:EXPO_NO_DOTENV='1'; $env:EXPO_PUBLIC_SUPABASE_URL='http://127.0.0.1:54321'
$env:EXPO_PUBLIC_SUPABASE_ANON_KEY=$anon; $env:EXPO_PUBLIC_SENTRY_DSN=''; $env:EXPO_PUBLIC_DEMO_LOGINS='off'
npx expo start --web --port 8081
```

**Android emulator:** use the same variables with
`EXPO_PUBLIC_SUPABASE_URL=http://10.0.2.2:54321`, or keep `127.0.0.1` and run
`adb reverse tcp:54321 tcp:54321`. For any native build also set
`SENTRY_DISABLE_AUTO_UPLOAD=true`. Build locally (`npx expo run:android`),
never with `eas build`. The `EXPO_PUBLIC_*` values are inlined at bundle time,
so restart Metro with `--clear` after changing them.

## 5. Web smoke

With Expo web running (§4):

```bash
cd qa/web && npm install && node smoke-local.mjs smoke.png
# PASS qa-wl-super signed in on web, sees today's draft on "QA-WL Riverside Tower" and opens it
```

It uses the installed Chrome (`QA_BROWSER_CHANNEL=chrome`). Set
`QA_BROWSER_CHANNEL=` to use Playwright's own Chromium instead
(`npx playwright install chromium`).
