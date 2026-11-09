# Product

<!-- impeccable:product-schema 1 -->

Scope: the WorkLog native app (`app/`, `src/`). Claims below are sourced
from `docs/PRD.md`, `CLAUDE.md` and `src/lib/legal.ts`. Confirmed with the
owner via `/impeccable init` on 2026-11-09.

## Platform

ios

## Users

- **Superintendents** (primary) author the daily report. One report per
  project per day, filled on site with poor connectivity, gloved hands,
  bright sun and little time. **When needs conflict, the superintendent
  wins.**
- **Project managers** hold the same project-level authority as supers (the
  same database role) but in practice review: history and PDFs. "PM" is a
  display title that prints in the PDF signature block, not a permission
  boundary.
- **Company admins** set branding and report customization.
- **Owners** have no in-app access in v1. They receive reports as
  distributed PDFs.
- **Subcontractors** have no daily-report access in v1. A sub must never read
  safety incidents or delay entries that name them.

## Product Purpose

The legal record of what happened on site, as a mobile app. One report per
project per day moves from draft to submitted to locked. After locking,
corrections happen only through audited amendments. The output is a branded
PDF that holds up in a dispute.

Success means:
- the daily entry takes under 5 minutes hands-on (carry-forward path);
- a full report, photos included, can be created with no connectivity, and
  no field data is ever silently lost;
- a locked report, its amendment trail and its PDF (photo sheets with
  timestamp and GPS provenance) survive scrutiny in a delay claim.

## Positioning

**Lead with the record: daily logs that hold up.** In order:

1. **Dispute-grade record.** Server-enforced draft → submitted → locked
   lifecycle, audited amendments, and photo provenance (capture time and GPS
   as first-class data, printed in the PDF).
2. **Smart carry-forward.** Yesterday's crews, open delays and recurring
   entries carry forward, so a typical day takes under 5 minutes.
3. **True offline, no project cap.** Every project stays fully usable
   offline, with no cache limit.
4. **JobSight suite peer** to PunchLog: the same account, backend and
   design system.

No competitor names in store copy or UI.

## Operating Context

- A report is filled in three moments: morning (carry-forward, about 45s),
  during the day (photos), and end of day (about 3 minutes).
- Drafts autosave locally on every change. There is no Save button.
- Each report has 11 sections, plus photos with tags and a lightbox.
- Report history is browsed by calendar and filterable list. A weekly rollup
  covers manpower, progress and delays.
- Project bootstrap happens in-app (register → company → project → first
  report), so a user who never installed PunchLog can still start.

## Capabilities and Constraints

- Expo / React Native, offline-first on device (SQLite read path, every
  write through the sync queue). The web build runs online-only.
- Shares the Supabase backend (`jobsight-backend`) with PunchLog. Report
  tables are read-only to clients; lifecycle writes go only through server
  RPCs.
- Offline is a normal state, not an error: neutral styling, never red.
- Voice-to-text on notes fields is always backed by full keyboard entry.
- Account deletion is in-app. A company's only member deleting their account
  deletes the company's projects with it, after a warning. This matches
  PunchLog, and the two apps ship that rule together.
- **Release status:** not yet submitted to either store (version 1.0.0).
  Legal pages are live at `worklog-site.vercel.app`.
- **Not decided:** pricing and plans. Do not state any.

## Brand Commitments

- Name: **WorkLog**, part of the JobSight Suite (sister app: PunchLog).
  Store name pattern "WorkLog - Construction Daily Log". JobSight stays out
  of the app name.
- Visual identity is PunchLog's: the same design system and colors, with no
  WorkLog accent of its own (see `DESIGN.md`).
- User-facing copy is plain language. Internal labels never appear in UI
  copy.
- Assets: app icon, adaptive icon and splash in `assets/`.

## Evidence on Hand

- Product requirements and the timed 5-minute flow: `docs/PRD.md`.
- **None yet:** store listing, screenshots, customer testimonials, named
  customers, usage numbers, press. Do not invent any of them.

## Product Principles

1. **The record is the product.** Nothing editable after locking except
   through an audited amendment. Attribution and provenance are never lost.
2. **Under five minutes or it won't get filled.** Carry forward what's known
   and ask only for what changed today.
3. **The field is the default.** Assume gloves, sun, one hand and no signal.
4. **Never lose field data.** Every failure is visible and retryable. No
   silent drops.
5. **One job, done well.** The daily report. Punch lists live in PunchLog.

## Accessibility & Inclusion

- WCAG AA in all three themes. Any new color documents its contrast ratios
  in code comments. No state is conveyed by color alone.
- Hit areas of at least 48×48 px with 8 px spacing. Primary flows work with
  taps and vertical swipes only, and every swipe action has a tap
  equivalent.
- The primary action sits in the bottom 40% of every daily-flow screen.
- VoiceOver / TalkBack labels everywhere. Dynamic type up to XL breaks no
  daily-flow layout.
