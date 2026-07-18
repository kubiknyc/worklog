# WorkLog — Product Requirements Document (Phase 1)

**App:** WorkLog — standalone construction daily-report app, JobSight Apps Suite
**Source spec:** `FABLE5-PROMPT-worklog.md` (final; §11 decisions not relitigated)
**Stack (fixed):** Expo SDK 54 · RN 0.81.5 · React 19.1 · Expo Router ~6 · TypeScript 5.9 strict · Supabase (shared project) · expo-sqlite + replicated PunchLog sync engine
**Status:** Phase 1 deliverable, rev 3 — 17 first-pass amendments + second critique pass (4 blockers, 5 mediums, 5 minors) applied; awaiting approval before Phase 2 (Architecture)

The §5 feature set is LOCKED. MoSCoW below is **priority** within that set — nothing is Won't; even Could features ship in the first store submission. Build *order* is the dependency-driven milestone sequence in §3, which deliberately interleaves tiers (e.g. Should-tier carry-forward lands before Must-tier PDF, because the PDF renders what earlier milestones produce).

---

## 1. Product summary

WorkLog is the construction industry's legal record of what happened on site, as a mobile app: one report per project per day, draft → submitted → locked, corrections only via audited amendments, exported as a dispute-grade branded PDF. Primary user is a site superintendent (poor connectivity, gloved hands, sunlight, time-poor); the daily entry must take under 5 minutes. WorkLog is a peer app to PunchLog in the JobSight suite: same Supabase project, same design tokens, same offline-first sync architecture, independent brand and distribution (`com.kubiknyc.worklog`).

**Success criteria for v1:**
- Carry-forward daily entry completes in under 5 minutes hands-on time (measured flow below: ~4:03 ex-photos, ~4:46 all-inclusive; typed-fallback floor ≈5:30–6:00).
- Full report creation + photo capture with zero connectivity; no field data ever silently lost.
- A locked report + amendment trail + PDF (photo sheets with timestamp/GPS provenance) that survives scrutiny in a delay claim.
- Passes App Store and Play review on first or second submission (store requirements baked into config, not prose).

**Measurement method for the 5-minute criterion:** instrumented hands-on timer — screen-interaction time from opening today's report on the Today tab to the submit confirmation, idle pauses excluded — median of 5 scripted Path-A runs on the reference devices (mid-range Android + recent iPhone), voice-capable configuration.

---

## 2. MoSCoW prioritization (within the locked set)

### Must — walking skeleton / first-submission gate

| Feature | Why Must |
|---|---|
| Theme/tokens + auth + tab shell | Nothing renders without it; suite visual identity is a requirement. |
| One report per project per day | Core data contract; every section hangs off it. |
| Draft → submitted → locked lifecycle via server RPCs | Immutability is a core requirement (§3 of spec), not a feature. |
| Amendments with full audit trail | The legal-defensibility spine; a locked report with no correction path is unusable. |
| All 11 report sections | The report *is* the sections. Weather ships manual-first (auto-fetch is Should). |
| Multi-project, no offline cap | Explicit competitive requirement (Raken caches 5 — don't copy). |
| Roles via RLS + project membership | Authorization retrofits on a shared production DB are unacceptable risk. |
| Project bootstrap: create project + invite members | Enabling infrastructure, not a feature-set addition: WorkLog is standalone, so an organic user who has never installed PunchLog must get from register → company → project → first report entirely in-app (also an Apple 2.1 reviewer-reachability requirement). The backend primitives already exist (`bootstrap_project_creator` trigger, `register-company` / `invite-user` edge functions); v1 ships the minimal surfaces over them — no rich project-management UI. |
| Offline-first: local DB, sync queue, status indicators, conflict surface | Non-negotiable per §5/§11. The skeleton IS the sync engine. |
| Fast photo workflow (batch capture, tags, compression, thumbnails, background queue, lightbox) | Killer feature and the EXIF-provenance carrier. |
| Photo provenance as first-class columns (`captured_at`, `gps_lat`, `gps_lng`, `gps_accuracy`) + PDF provenance line | The dispute-grade mechanism (see §11.2 — picker/camera EXIF alone does NOT deliver GPS). |
| PDF export (branded, signature block, page numbers, photo sheets) | The app's output artifact. |
| In-app account deletion (two-tier, see §12.1) | Store-mandated hard gate (Apple 5.1.1(v), Play). |
| `create_report` get-or-create RPC + grouped park surface | The natural key's one strain on the replicated engine (§11.7): the RPC returns the existing report id on a same-day conflict, so a collision dissolves at push time instead of cascade-parking a full day of downstream section/photo/submit mutations; the park surface covers residuals. |

### Should — in first release, sequenced after the skeleton

| Feature | Why Should (not Must) |
|---|---|
| Smart carry-forward | Depends on report CRUD + a prior report existing; manual entry works without it. Still the flagship flow — lands before submission. |
| Weather auto-fetch (edge function + geolocation snapshot, fill-on-sync) | Manual override covers the gap; auto-fetch layers on. |
| Voice-to-text on notes fields | Least-proven dep (`expo-speech-recognition`); isolated so maturity risk can't block the skeleton. Keyboard always works. Gated to on-device-capable devices (§11.1). |
| Report history: calendar + filterable list | Needs multiple synced reports to be meaningful; a flat today view proves the skeleton. |
| Report customization (admin required-fields / section toggles) | Sensible defaults ship first; admin shaping layers on. |
| Company branding settings (logo, colors, header/footer, distribution lists) | Default header/footer lets the PDF pipeline land first. |
| EXIF re-injection into JPEGs (piexifjs) | Raw-photo evidentiary credibility; ~50 lines, severable. **TRADEOFF flagged:** one small pure-JS dep outside PunchLog's proven set. |
| Assisted merge flow for `create_report` collisions | Rich merge UI; the get-or-create RPC (Must) already dissolves the common same-day case at push time. |

### Could — built last within the locked set

| Feature | Why last |
|---|---|
| Weekly rollup summaries (manpower, progress, delays) | Pure read/aggregate over a full week of data across all sections — meaningful only once everything else produces data. Highest-dependency, lowest-blocking. |

---

## 3. Build-ordered milestones (Phase 4 sequence)

Each milestone independently verifiable (`tsc --noEmit` green, jest green) before the next.

| M | Deliverable | Unblocks |
|---|---|---|
| **M0** | Theme (`src/theme/` verbatim, `ReportStatus` rename) + chunked SecureStore Supabase client + `(auth)/login` (always Blueprint) + tab shell + splash-hold on `isHydrated` + infra bootstrap (EAS project id, Sentry project/DSN, store app records) | Every screen, session gating |
| **M1** | SQLite schema (versioned DDL, `_dirty`/`_pending`, `DOMAIN_COLUMNS`, sync bookkeeping tables) + `src/data` repository seam (SQLite native / Supabase web) + schema-parity jest test + platform-split grep guard | All local writes, sync storage seam |
| **M2** | Project bootstrap (create-project sheet, members/invite screen over the existing `invite-user` function) + report CRUD + all 11 section editor sheets, local-only, optimistic writes | First-report path for organic users; carry-forward, PDF, history, customization, rollups |
| **M3** | Sync engine: pure modules verbatim (daily-report mutation kinds) + native adapters + lifecycle RPCs (get-or-create `create_report` / `submit_report` / `lock_report` / `amend_report`) + sync status indicators + conflict surface + grouped park surface | Lifecycle, amendments, photo queue, multi-device |
| **M4** | Lifecycle + amendments wired into UI; status chips; DB-level locked-row rejection | Dispute-grade immutability |
| **M5** | Photo pipeline: batch capture, location+EXIF capture *before* compression, first-class provenance columns, durable outbox, tag/caption sheet, thumbnails (dedicated ~200px rendition), lightbox, `add_photo` drained last, wrong-project GPS guard (no-ops while project coordinates are null — §15 #11) | PDF photo sheets, provenance, privacy declarations |
| **M6** | Smart carry-forward from the **last report** (not calendar-yesterday — Mondays and rain days break "yesterday"; review-first sheet; crew, equipment, open delays, open RFIs — never descriptions/notes) | The under-5-minute morning flow |
| **M7** | PDF export: `src/report/` mirroring PunchLog, `expo-print` on-device (≤40 photos), edge-function fallback (pdf-lib, server-side), signature block, provenance captions, share | The output artifact |
| **M8** | Voice-to-text (`expo-speech-recognition`, on-device only, capability-gated, `contextualStrings` with project trades/vendors) + mic/speech explainer | Faster notes entry (risk contained) |
| **M9** | Weather auto-fetch: Open-Meteo edge function, `expo-location` snapshot, timestamped, manual override preserved, fill-on-next-sync | Zero-touch weather |
| **M10** | History: hand-rolled month calendar (tokens-native) + filterable list (project, date range, status, trade, keyword, has-incident, has-delay) with keyset pagination | Rollups infra, reviewer navigation |
| **M11** | Weekly rollups (activity summary over relational child tables) + branding settings + report customization + distribution delivery (on submit, email the PDF to the project distribution list via the existing `send-email` function — rendered **server-side by pdf-lib**, since submit can fire from an offline queue drain with no client present; see §11.4 and §15 #4) + "report submitted" push to the project's other super-class members via `send-push` | Admin-shaped, branded, **delivered** reports |
| **M12** | Account deletion: extend shared `delete-account` edge function to WorkLog tables + `worklog-photos`; two-tier UI; web deletion-URL page copy | Store submission (hard gate — late in build order, mandatory before submission) |

M12 deliberately follows Could-tier M11: deletion must provably cascade every table in the final schema, so it is built against the complete data model. "First store submission" means the full M0–M12 build; the walking skeleton (M0–M5) is an internal verification gate, not the submission.

---

## 4. Navigation & tab layout — RESOLVED (§6 open question)

**Final tab set (5 slots, raised center action):**

```
[ Today ]   [ History ]   ( ◉ Camera — raised, FIXED_COLORS.camera #3FA9F0 )   [ Photos ]   [ Settings ]
```

- **Today** (`(tabs)/index`) — launch tab; today's draft or start card; project switcher chip on top. The under-5-minute flow starts here.
- **History** (`(tabs)/history`) — calendar (per-day `ReportStatus` dots) **plus** the filterable list (project, date range, status, trade, keyword, has-incident, has-delay). Browse-by-date and browse-by-project are two modes of one tab — the list's project filter covers cross-project browsing.
- **Camera (raised center)** — an *action, not a route* (§6: creation flows are sheets). Opens batch capture pre-scoped to the active project's today draft. If today's report is already submitted/locked: capture still works, tagging sheet ends with "Today's report was already sent. Add these photos as an amendment?" — never a dead camera, never an orphan photo. The capture and tag sheets show the active **project name** prominently with a one-tap project switch, and a photo whose GPS is far from the project's geolocation is flagged before attach — a wrong-project photo on a GPS-stamped legal record is worse than no photo.
- **Photos** (`(tabs)/photos`) — project photo wall grouped by date with trade/location filter chips; doubles as the tag-cleanup surface. Browse, not capture.
- **Settings** (`(tabs)/settings`) — appearance, branding, customization, sync detail, account & deletion.

**Conflict resolved:** the planning review proposed replacing Photos with a cross-project `Reports` list. Rejected: §5 pairs "calendar view + filterable list" as one history feature (the list's project filter subsumes a Reports tab), while the fast-photo killer feature needs a browse/cleanup surface, and the spec's own draft tab set included Photos. Both reviews independently converged on the raised center camera — PunchLog ships the pattern and reserves the `FIXED_COLORS.camera` token for exactly this; suite consistency is free.

---

## 5. Screen inventory

Routes in `app/`; creation/editor flows are **sheet components, not routes** (§6). Roles: **S** = superintendent (`project_members.role='super'`), **PM** (same DB role, see §10), **A** = company admin. All roles read; write-gating noted.

### Auth — `app/(auth)/`
| Screen | Route | Access | Purpose |
|---|---|---|---|
| Login | `(auth)/login` | public | Email+password; always Blueprint theme. |
| Register / company join | `(auth)/register` | public | Account creation (`handle_new_user` trigger server-side). |

### Pre-permission explainers (§8 of spec)
| Screen | Route | Purpose |
|---|---|---|
| Camera explainer | `(onboarding)/permissions/camera` | Plain-language why before the OS prompt. |
| Location explainer | `(onboarding)/permissions/location` | Weather + photo provenance rationale (evidence framing). |
| Mic/speech explainer | `(onboarding)/permissions/speech` | One combined explainer; both OS prompts fire at first mic tap. |
| Photo-library explainer | `(onboarding)/permissions/photos` | Library attach rationale, metadata retention noted. |

ASSUMPTION: explainers are lightweight routed screens (back-stack + deep-linkable from Settings re-prompts); OS dialogs fire at point of use, not on these screens.

### Tabs — `app/(tabs)/`
| Screen | Route | Write | Purpose |
|---|---|---|---|
| Today | `(tabs)/index` | S/PM | Today's draft / start card; carry-forward entry point; project switcher. |
| History | `(tabs)/history` | — | Calendar + filterable report list. |
| *(raised center)* Camera | action → batch-capture sheet | S/PM | One tap to shooting from anywhere. |
| Photos | `(tabs)/photos` | S/PM (tags) | Photo wall, filters, tag cleanup. |
| Settings | `(tabs)/settings` | varies | Hub. |

### Projects — `app/project/` (bootstrap surfaces, Must — §2)
| Screen | Route / sheet | Write | Purpose |
|---|---|---|---|
| Create project | sheet | all | Name + address (+ optional site pin for weather/provenance — §15 #11); creator auto-enrolled `'super'` via `bootstrap_project_creator`. |
| Project members | `project/[id]/members` | S/PM | Member list; invite by email via the existing `invite-user` edge function; role pick (super/sub — subs get no report access, §10). Invite-acceptance mechanics: §15 #16. |

### Report detail & editors — `app/report/`
| Screen | Route / sheet | Write | Purpose |
|---|---|---|---|
| Report detail | `report/[id]` | S/PM on draft | Sections, status chip, submit/lock/amend actions, photo strip. |
| Project switcher | sheet | all | Active-project pick. |
| Carry-forward review | sheet | S/PM | Pre-checked editable list of what rolls (crew, equipment, open delays, open RFIs/issues) — sourced from the **last report**, not calendar-yesterday. |
| 11 section editors (weather, crew, work, deliveries, equipment, inspections, safety, delays, visitors, RFIs, notes) | sheets | S/PM | Per-section fast input (§7 patterns). |
| Amendment editor | sheet | S/PM | Correct a locked report; audit row; original preserved. |
| Review & submit | sheet | S/PM | Section summary + plain-language totals; submit. |
| Signature capture | sheet | S/PM | Drawn signature for the PDF block (mounted when sheet opens). |

### Photos
| Screen | Route / sheet | Purpose |
|---|---|---|
| Batch camera capture | sheet | Full-screen camera, ≥72px shutter, filmstrip, EXIF+location captured pre-compression. |
| Photo tag/caption | sheet | Trade chips (today's crew first) + location chips + voice caption; "Same tags as last photo"; skippable. |
| Photo lightbox | `report/[id]/photo/[photoId]` | Zoom/pan full-res; provenance metadata display. ASSUMPTION: routed (deep-linkable). |

### Settings — `app/settings/`
| Screen | Route | Write | Purpose |
|---|---|---|---|
| Appearance | `settings/appearance` | all | Theme (Blueprint/Editorial/Béton) + density. |
| Company branding | `settings/branding` | A | Logo, colors, header/footer, distribution lists. |
| Report customization | `settings/customization` | A | Required fields, section toggles. |
| Notifications | `settings/notifications` | all | "Report submitted" push opt-in; the point-of-use API 33+ permission prompt fires here (§11 #9). |
| Sync status | `settings/sync` | all | Pending/syncing/synced/error/conflict; parked retry; conflict resolution surface. |
| Account | `settings/account` | all | Profile; entry to deletion. |
| Account deletion | `settings/account/delete` | all | Two-tier deletion (§12.1) with suite-scope disclosure. |

### PDF
| Screen | Route | Purpose |
|---|---|---|
| PDF preview | `report/[id]/pdf` | Rendered PDF before share. |
| Share | OS share sheet (`expo-sharing`) | Email/Files export. |

### Rollups (Could — M11)
| Screen | Route | Purpose |
|---|---|---|
| Weekly rollup | `rollup/[projectId]/[week]` | Manpower / activity / delay summary (Mon–Sun, project TZ); last-synced timestamp (§11.6); entered from History. |

**Web companion scope (v1):** the web target ships **no user-facing surface** — it must only build clean (repository seam + platform-split grep guard honored). The Play deletion-URL page (§12.1) is a static page on the privacy site, not the web app.

---

## 6. The under-5-minute daily flow

A report is filled across three natural moments: morning (~45s), during the day (photos — capture happens while photographing anyway; the tag pass is counted in the all-inclusive figure below), end of day (~3.3 min). Draft autosaves locally on every change — there is no Save button; closing the app loses nothing.

### Path A — carry-forward morning (default; typical day: 5 trades, 1 delivery, 1 open delay, 5 photos)

| # | Step | Input | Budget |
|---|---|---|---|
| 1 | Open app → Today tab shows "No report yet for Tuesday" | tap icon | 4 s |
| 2 | Tap **"Start from last report (Mon, Jul 14)"** (primary; "Start blank" secondary) | tap | 2 s |
| 3 | Carry-forward sheet: pre-checked crew (5), equipment (4), open delays (1), open RFIs (0); uncheck what left; **"Add to today"** | 0–2 checkbox taps + confirm | 10 s |
| 4 | Weather chip auto-filled ("72° · Clear · fetched 6:41 AM") — glance only | none | 3 s |
| 5 | Crew: adjust 2 changed headcounts | stepper ± (hours default 8) | 20 s |
| 6 | Equipment: toggle 1 item off | toggle | 6 s |
| — | **Morning subtotal** | | **45 s** |
| 7 | *(during day)* Photos via raised camera tab — auto-attach to today | see §8 | 0 s |
| 8 | Work performed: per trade — trade chip → area chips → dictate one line (~20 s/trade incl. recognition latency + one gloved correction) | chips + voice | 100 s |
| 9 | Delivery: supplier recents chip → material via voice → quantity stepper + unit chip | chips + voice + stepper | 20 s |
| 10 | Carried delay: "Still ongoing / Ended today" chip, duration stepper | chip + stepper | 10 s |
| 11 | Safety: **"Nothing to report"** explicit affirmation | tap | 3 s |
| 12 | Inspections / Visitors / RFIs: collapsed "None today" — skip | none | 0 s |
| 13 | Notes: dictate ~20 s | voice, edit inline | 25 s |
| 14 | Photo strip: fix one missing tag | chip | 15 s |
| 15 | Review & submit sheet: per-section checks + totals → **Submit** | tap | 10 s |
| 16 | Signature | canvas | 12 s |
| 17 | Confirmation ("It will send when you're back online" if offline) | none | 3 s |
| — | **Evening subtotal** | | **198 s** |
| | **Total hands-on (ex-photos)** | | **243 s ≈ 4 min 03 s** |

**Headroom & honest accounting:** 57 s under the ceiling ex-photos — absorbs an extra delivery (+20 s) or an inspection (+30 s). Counting the day's photo-tag pass (+43 s, §8) the all-inclusive figure is **~4:46**; counting the full photo batch including capture (which happens while the super is photographing anyway) it is ~5:15. Budgets assume the phone is already unlocked and gloves come off once, at the signature (step 16 — a canvas cannot be signed in work gloves).

**Measurement basis:** the 5-minute success criterion is measured on the full M0–M9 build (carry-forward + weather auto-fetch + voice) on voice-capable devices. The typed-keyboard fallback — voice unavailable or capability-gated off (Android ≤12, ~10–15% of devices) — lands **≈5:30–6:00**: the honest floor, stated rather than hidden, and still faster than any competitor's typed flow.

ASSUMPTION: signature at submit is required by default (the dispute-grade PDF needs the block); admins can make it optional in report customization.

### Path B — cold start (first report on a new project)

~**6 min 36 s** — exceeds the target by ~1:40, one time per project (day 2 onward, every trade/equipment/area/supplier entered on day 1 is a chip or carry-forward candidate). Mitigations: standard trade + equipment pickers (budgeted in), company-level default trades/equipment presets (admin customization), and — ASSUMPTION — "Copy setup from another project" on the blank-start sheet (roster and area list only, no data).

---

## 7. Section-entry patterns (all 11 sections)

Sections appear in frequency order; commonly-empty sections collapse to "None today — tap to add". Safety always shows either entries or the explicit **"Nothing to report"** affirmation (a deliberate none is legally stronger than a blank; renders on the PDF as such).

| Section | Fastest input | Voice? | Collapses? |
|---|---|---|---|
| Weather | Zero-input default: auto-fetched chip row + fetch time. Override: condition chips + temp stepper. Offline: "will fill when back online", manual chips available, never blocks. Snapshot + override both kept, timestamped. | No | Never (one row) |
| Crew by trade | Row per trade: headcount stepper + hours stepper (0.5 h steps, default 8). Add via searchable picker, company presets pinned. Carried rows tinted "from yesterday" until touched. | No | Never |
| Work performed | Trade chip (only today's crewed trades) + area chips (project list, grows organically) + one dictated line. #1 voice target — mic primary. | **Yes — primary** | Never |
| Deliveries | Supplier recents chips → material voice/text → quantity stepper + unit chips (loads/pallets/pcs/CY) → "Photo of ticket" camera shortcut. | Yes | Yes |
| Equipment | On-site toggles over the project's known list; carry-forward pre-sets state; optional idle/active chip (delay claims care). | No | Only before first item |
| Inspections | Agency chips (DOB, FDNY, utility, third-party; recents pinned) + inspector recents + result as three big chips (Passed/Failed/Partial) + voice notes. | Yes | Yes |
| Safety | "Nothing to report" one-tap OR add observation/incident: type chips (near miss / first aid / recordable / observation) + voice description + photo shortcut. Incident flag feeds history filters. | Yes | Never hidden |
| Delays & impacts | Cause chips (weather / no materials / no access / trade absent / design question / other) + responsible-party chip + duration stepper (0.5-day) or "Ongoing" + voice impact note. Open delays carry forward with "Still ongoing?" chip. | Yes | Yes (forced open by carried delays) |
| Visitors | Name (recents chips) + role chips (owner/architect/engineer/inspector/other) + time picker (15-min). | No | Yes |
| RFIs / issues | One-line title (voice/text) + trade chip + photo shortcut + "Needs answer from" chip. A log, not an RFI manager — UI copy: "Questions and issues raised today". | Yes | Yes |
| General notes | Full-width; mic is the primary button, keyboard fallback. No formatting. | **Yes — primary** | Yes |

**Voice placement rule:** voice on *sentence-shaped* fields only; never on structured fields (counts, hours, chips, pickers) — structure beats transcription for anything the PDF and rollups aggregate.

---

## 8. Photo workflow

Pattern: **shoot everything first, tag in one pass after, type nothing.** 5-photo batch ≈ **72 s (~14 s/photo)**.

1. Raised camera tab (1 tap from anywhere) → full-screen camera, ≥72 px shutter, filmstrip of instant thumbnails (2 s).
2. Batch capture — photos persist to the durable `captures/` dir at shutter time; nothing lost if the app dies mid-batch (25 s for 5).
3. "Done (5)" (2 s).
4. Tag pass, one photo at a time: trade chips (today's crew first) + location chips + optional voice caption; "Same tags as last photo" one tap; swipe advances (40 s).
5. "Add 5 photos to today's report" (3 s).
6. Background upload: compressed ≤1280 px JPEG; provenance captured before compression; "waiting to send" glyph until confirmed; JSON mutations drain first, photo bytes last (§4.3 of spec); never blocks anything (0 s).

Rules: tagging skippable never forced ("Tag later" → dashed "Add tags" chip in the strip); instant thumbnails / lazy full-res; library imports go through the same tag sheet with EXIF capture time preserved — ASSUMPTION: PDF distinguishes "taken" vs "added" times for evidentiary honesty. Capture and tag sheets display the active **project name** with a one-tap switch, and a photo whose GPS is far from the project location is flagged before attach (wrong-project contamination guard).

---

## 9. Field-condition & accessibility acceptance criteria (testable)

**Touch & gloves:** AC-T1 every interactive element ≥48×48 px hit area. AC-T2 ≥8 px between adjacent hit areas; ≥12 px between a stepper's +/−. AC-T3 all primary flows completable with taps and vertical swipes only (no long-press-required, no drag-required). AC-T4 swipe actions always have a tap-path equivalent.

**Sunlight / themes:** AC-S1 WCAG AA in all three themes; any new WorkLog color ships with documented ratios in code comments (token-file convention). AC-S2 no state conveyed by color alone (icon or label paired). AC-S3 Béton outdoor check: body text ≥4.5:1, placeholder ≥3:1. AC-S4 theme switch ≤2 taps; no wrong-theme flash on cold start (`isHydrated` gate).

**One-handed reach:** AC-R1 primary action in the bottom 40% of every daily-flow screen. AC-R2 sheet confirm buttons in the sheet footer. AC-R3 draft sections scroll vertically (no horizontal tabs). AC-R4 destructive actions full-width, bottom-reachable, visually distinct.

**Offline never blocks:** AC-O1 airplane-mode E2E: create, fill all sections, capture+tag photos, Submit → queues with "Saved on your phone. It will send when you're back online." Zero blocking dialogs or disabled inputs. AC-O2 weather never blocks. AC-O3 glanceable plain-language sync pill ("All saved to the cloud" / "3 changes waiting to send" / "Sending…" / "2 changes need attention" → tappable retry surface). AC-O4 ≥10 projects fully entry-capable offline. AC-O5 offline token-refresh failure never logs out. AC-O6 every parked failure visible and retryable; no silent drops.

**Accessibility:** AC-A1 VoiceOver/TalkBack labels everywhere; steppers announce value+role ("Carpenters headcount, 6, adjustable"). AC-A2 dynamic type to XL breaks no daily-flow layout; chips wrap, numbers never truncate. AC-A3 every voice field is a normal text field with a mic accessory (full keyboard parity).

Offline is styled as a **normal state, not an error** (neutral colors, no red).

---

## 10. Role model — PM mapping RESOLVED (§4.2 open question)

**Decision: PM → existing `project_members.role = 'super'`. No `'pm'` enum value in v1.**

- **Option A (chosen), cost now:** zero migration; `is_member`/`is_super` work unchanged; zero risk to PunchLog. PM and superintendent get identical project-level write authority. The PM designation is a UI-level label — ASSUMPTION: stored as a WorkLog-side display field, visible without being an authorization boundary. The distinction is deferred, not lost.
- **Option B (declined), cost now:** `alter type project_role add value 'pm'` on a **shared production database** mid-PunchLog-submission forces auditing every RLS helper and policy that reads `role`; PunchLog's `is_super` semantics must not silently change; enum-value migrations add ordering fragility. High blast radius, zero current benefit — nothing in the locked feature set requires PM ≠ super authorization.
- **Trigger to revisit:** the first concrete PM-only permission requirement (e.g., PM can lock but not author). At that point it's a clean additive migration with a deliberate `is_super` audit.

Role summary: superintendent = `project_members.role='super'` (author); PM = same DB role, read-mostly reviewer in practice (history + PDF); admin = `company_members.role='admin'` (branding, customization; company admin ⊇ project super per existing helpers).

**Owners (spec §3 secondary users) have no in-app access in v1 — stated, not implied:** owners are not project members; they receive reports as distributed PDFs (M11 distribution lists). An owner read-only login would be a future additive policy change, outside the locked set.

**RLS-enforcement reading (spec §5: "enforced via Supabase RLS + project membership, not just UI"):** the enforced boundaries are (1) the super/PM **write class** — `project_members.role='super'`, RLS-enforced on every report table; (2) company admin via `company_members`; (3) everyone else excluded. Superintendent and PM are one enforced authorization class by design — the *set* of roles is RLS-enforced even though the super/PM distinction is not. The audit trail attributes every action to the individual user id regardless of label, which is the property that actually matters in a dispute. The PM/superintendent label lives in a WorkLog-side table (e.g. `report_member_prefs(project_id, user_id, title)`, admin-editable) and prints as the signer's **title in the PDF signature block**.

**Sub visibility (decided):** `project_role='sub'` members (e.g. subcontractors invited via PunchLog on shared projects) get **no daily-report access in v1**. Every WorkLog report table's SELECT policy gates on `is_super(project_id)` (which company admins pass via the widened helpers) — **not** `is_member` — because a sub must never read safety incidents or delay entries naming them as the responsible party. Revisit only if a sub-facing feature appears; that is an additive policy change.

---

## 11. Technical feasibility annex (stack-verified; full detail in team output)

1. **Voice-to-text (`expo-speech-recognition`):** community package, own config plugin, EAS build required (fine). On-device recognition: iOS 17+ reliable; **Android 13+ only, per-locale model download; nothing on Android ≤12** (~10–15% of devices). **Decision: capability-gate with `supportsOnDeviceRecognition()` — mic button hidden on unsupported devices, keyboard always available; "Download offline voice model" row in Settings (Android); no network fallback** (keeps the privacy declaration clean: audio never leaves the device). Feed `contextualStrings` with project trades/vendors for construction-jargon accuracy. Dictation is per-field short-burst (sidesteps iOS ≤17 3-second-silence stops).
2. **EXIF/GPS provenance — critical correction:** `exif: true` does **NOT** reliably yield GPS — expo-image-picker docs state iOS camera-case EXIF has no GPS tags; PHPicker strips location; expo-camera doesn't geotag. **The mechanism is: at shutter time, read the clock + `expo-location` (`getLastKnownPositionAsync` fast path, ~3–5 s timeout, never blocks the shutter) → write first-class columns** (`captured_at`, `gps_lat`, `gps_lng`, `gps_accuracy`), local + Postgres. Camera EXIF `DateTimeOriginal` stored as corroboration when present. GPS denied → columns null, photo still saved, PDF prints "location not recorded". PDF credibility comes from the printed provenance line per photo ("Captured 2026-07-15 07:42 EST · 40.6782, -73.9442 (±8 m)") — in-file EXIF doesn't survive `expo-print` rasterization anyway. **EXIF re-injection (piexifjs, Should, TRADEOFF flagged)** makes raw shared/discovery JPEGs self-evidently authentic; ~10–50 ms/photo, severable. ASSUMPTION: `captured_at` from device clock with TZ offset; server `created_at` is the independent second timestamp; clock skew surfaced, not corrected.
3. **Signature (`react-native-signature-canvas`):** wraps signature_pad in `react-native-webview` (already in the stack) — no new native module. Output base64 PNG → file → PDF HTML embed. Mount when the submit sheet opens (WebView first-mount 100–500 ms); disable outer scroll during strokes (classic failure mode — budget QA). ASSUMPTION (legal framing): drawn signature image + signer name + timestamp — not PKI; defensibility comes from the lifecycle RPCs and audit trail.
4. **PDF ceiling:** on-device `expo-print` safe to **~40 photos** (worst-case Android memory); dedicated ~800 px print renditions roughly double that. **Route to the edge-function fallback above ~40 source photos** (tunable constant). Edge functions can't run a headless browser → server path uses **pdf-lib** (embeds JPEG bytes without re-encode; fits function limits at hundreds of photos). TRADEOFF (accepted by spec §6): two renderers — but the server path is **not** a photo-heavy edge case: M11 distribution emails render server-side (submit can fire from an offline queue drain with no client present), so the pdf-lib output is the copy recipients keep. Two visually divergent renderings of the same legal record are unacceptable, so the consistency contract — shared layout constants + a golden-output comparison test on a reference report — is a core Phase 2 deliverable (§15 #4), and the signature must be persisted server-side for the server path to work at all (§15 #13).
5. **Calendar:** hand-roll the month grid with `useTheme()` tokens (~1–2 days; one SQLite query for day-dots; `Date`+`Intl` suffice). TRADEOFF recorded, not taken: `react-native-calendars` (pure JS, would work) saves ~1 day but fights the token audit; reversible either way.
6. **Rollups offline:** trivial in SQLite **provided** crew/delays/work-performed are **relational child tables locally** (`report_crew(report_id, trade, headcount, hours)` etc.), not JSON blobs — binds Phase 3 schema. (Reconciled with `update_section`'s whole-section LWW in #7: child rows are exploded from the section payload transactionally; the section row is the concurrency unit.) Non-aggregated sections (notes, visitors) may stay JSON TEXT. Index `(project_id, report_date)`. Rollup screen shows last-synced timestamp (PM-staleness honesty). **"Progress" in v1 = an activity summary** (work-performed entry counts by trade and area, trade-active days) — labeled as activity, never a % complete, since work-performed lines are prose; week = Monday–Sunday in the project's timezone.
7. **Sync mapping strains — one real one:** mutation kinds `create_report`, `update_section`, `update_report_meta`, `submit_report`, `lock_report`, `create_amendment`, `add_photo`, `remove_photo` (draft-only; ASSUMPTION — spec silent, drafts need it) all fit the PunchLog invariants. `update_section` carries the **whole section payload**; concurrency is judged on a per-section version row (`report_sections(report_id, section, updated_at, …)`) — whole-section LWW by that row's server `updated_at`. Storage shape (reconciles §11.6): aggregated sections (crew, equipment, delays, work performed) are **exploded into relational child rows** (`report_crew` etc.) by the server in the same transaction that bumps the section row — delete-and-insert, children carry no independent `updated_at`; non-aggregated sections store JSON on the section row; the local SQLite write mirrors the same two-level shape in one transaction, so local and server never disagree about where section data lives. Coalesce repeated edits by replacing the queued payload in place (same clientId/seq — never re-enqueue, which would reorder past a queued submit); UI blocks section edits once submit is queued — and permanently once submitted: **submitted reports are author-immutable; corrections go through amendments only** (the "grace window" governs auto-lock timing, not editability — §14 #19). ASSUMPTION: single author per report-day; conflict surface covers the residual. **The strain: `UNIQUE(project_id, report_date)` vs client-UUID inserts** — resolved by routing creation through a **get-or-create `create_report` RPC (Must)**: on a same-day conflict it returns the existing report id and the client re-parents local sections/photos onto it, so the collision dissolves at push time instead of cascade-parking a full day of downstream mutations (every `update_section`, the queued `submit_report`, and all `add_photo` writes would otherwise FK-fail against the never-landed report id). The grouped park surface covers residual failures; the rich assisted-merge UI stays Should. `report_date` is computed in the **project's timezone** (see §15 item 9). Single-device double-create can't happen (Today reads the local row first). Lifecycle RPC rejections (`P0001`) park immediately and surface — correct. `amend_report` must be idempotent on the amendment's client UUID. Weather auto-fetch is server-side fill, not a mutation (writes only when weather is null and `weather_source != 'manual'` — can never fight a manual override). Carry-forward is pure client-side composition (zero engine impact). `remove_photo` additionally implies a storage DELETE policy on `worklog-photos` (owner-scoped, draft-window only) that the path-encoding pattern doesn't grant by default — Phase 3 policy item.
8. **Performance budget:** embed the 12 fonts natively via the `expo-font` config plugin (available at first frame; keep `useFonts` for web). Cold start to interactive: **<2 s mid-range Android, <1.2 s recent iPhone**; Sentry app-start instrumentation from day one. History at 1000+ reports: sub-ms with the indexes above; keyword = LIKE (FTS5 is the upgrade path, not built now). Photo grids bind thumbnails only (never full-res); `recyclingKey` + client-UUID filenames. Report detail: plain ScrollView of ~11 memoized section cards. FlashList declined (outside fixed stack) — FlatList + real thumbnails meets budget.
9. **Config plugin inventory** (`app.config.ts`): expo-camera (`microphonePermission: false`, `recordAudioAndroid: false`), expo-image-picker (mic false), expo-location (when-in-use only, all background flags false), expo-speech-recognition (owns the mic permission string — one key, one owner), expo-notifications (point-of-use API 33+ prompt; **v1 push scope:** "report submitted" notification to the project's other super-class members via the existing `send-push` function, wired in M11 — the permission is requested only when the user turns notifications on, so the prompt always maps to a live feature), expo-splash-screen (Blueprint bg `#0C2944`), expo-updates (fingerprint policy), sentry, expo-font (native embed), expo-build-properties (ASSUMPTION: iOS 26 SDK / compileSdk alignment — confirm against PunchLog). App-level `ios.privacyManifests` for required-reason APIs. No background-location, no background modes. No plugin needed: print, sharing, image, file-system, manipulator, netinfo, gesture-handler, reanimated, webview, signature-canvas.
10. **Platform divergence scoped as work:** speech gating + model download UX (above); Android 13+ system Photo Picker → **no broad media-read permission**; iOS limited-library mode tolerated; approximate-location grants → `gps_accuracy` carries the truth, PDF prints ±accuracy, never asserts unheld precision; **"background upload" = durable outbox drained on foreground/reconnect (AppState + NetInfo), not OS background transfer** — expectation set here (TRADEOFF if ever demanded: `expo-background-task` gives only opportunistic drains; defer); PDF page-break CSS validated per platform on a real low-end Android.

**Verdict: every §5 item is buildable on the fixed stack.** Three items need genuine Phase 2 design (not just implementation): the `create_report` collision/merge path, the Android speech gate + model-download UX, and the dual-PDF-renderer consistency contract. One dep recommended and flagged (piexifjs, Should); one declined (react-native-calendars).

---

## 12. Store-readiness requirements (locked now so Phases 4–5 build them once)

### 12.1 Account deletion on a shared suite backend (HIGHEST review risk)

There is no "WorkLog account" at the backend — there is a JobSight account shared with PunchLog. A deletion flow that only wipes daily reports does **not** satisfy Apple 5.1.1(v); full deletion silently destroying PunchLog data is a user-harm disaster. **Locked design:**

1. **Two-tier deletion in Settings:** "Delete my WorkLog data" (scoped: removes the user's WorkLog data *subject to the shared-record policy in (3)* — account, profile, projects, and PunchLog data survive; courtesy feature, not the compliance feature) and **"Delete my account"** (full JobSight deletion via the extended shared `delete-account` edge function — the store-compliance flow).
2. **Suite-scope disclosure before confirm:** "This deletes your JobSight account, which is also used by PunchLog. All your punch-list and daily-report data will be removed. This cannot be undone."
3. **Shared-record policy (governs BOTH tiers):** submitted and locked reports belong to the **company/project record, not the author** — no deletion tier ever destroys them; a departing super cannot hard-delete the company's legal records. User-authored rows inside multi-member projects are **anonymized, not deleted** (author FK → tombstone "Deleted user", personal fields nulled) — disclosed in both flows (tier-1 copy: "Your name comes off the reports; the project's records remain"). Tier 1 hard-deletes only drafts and sole-member-project data. Locked reports keep audit-trail integrity. ASSUMPTION: this mirrors what PunchLog's existing function does for punch items — Phase 3 must verify and mirror, not invent a divergent policy.
4. **Web deletion URL** (Play-mandated): page on the WorkLog privacy site triggering the same full deletion; states what is deleted vs anonymized-and-retained. Copy in Phase 5; commitment locked here.
5. **No support-ticket gate** — completes in-app.

AC: "Delete my account" reachable in ≤3 taps; completes end-to-end; sign-in fails in **both** apps afterward; confirmation names PunchLog; edge function provably cascades every WorkLog table + storage path (seeded-account test); Play Data Safety links a live URL.

### 12.2 Permission purpose strings (draft copy, iOS `infoPlist`)

| Key | String |
|---|---|
| `NSCameraUsageDescription` | WorkLog uses the camera to photograph site conditions and work progress for your daily reports. |
| `NSLocationWhenInUseUsageDescription` | WorkLog uses your location to fetch weather for your project site and to record where report photos were taken — photo location is kept with the report as evidence of where work occurred. |
| `NSMicrophoneUsageDescription` | WorkLog uses the microphone so you can dictate report notes instead of typing; audio is processed on your device and never stored. |
| `NSSpeechRecognitionUsageDescription` | WorkLog uses speech recognition to turn your dictated notes into text in your daily report. |
| `NSPhotoLibraryUsageDescription` | WorkLog lets you attach photos you've already taken to a daily report, keeping their original date and location details as part of the report record. |

Android: `CAMERA`, `ACCESS_FINE_LOCATION`, `RECORD_AUDIO`; **no broad media-read permission** (system Photo Picker). Explainer screens carry the same sentences.

### 12.3 Privacy declarations — deltas vs the PunchLog baseline

App Store nutrition labels: **Precise Location = collected, linked, App Functionality (NEW row — the key divergence)**; Photos, Name, Email, Phone (optional), User Content, User ID, Push token = collected/linked/App Functionality; Crash & Performance (Sentry) = collected, **not linked** (PII-scrubbed — `sendDefaultPii` off, no IP/email); **Audio = not collected** (transient on-device dictation, never stored/transmitted). Tracking: none, no ATT.

Play Data Safety: Precise location (collected, not shared, optional — deny → manual weather + no-GPS photos), Photos, Personal info, User-generated content, Crash logs/diagnostics, Device IDs; encrypted in transit; deletion = in-app + web URL.

**Exact deltas from PunchLog:** (1) Precise Location is a new row on both stores; (2) the Photos row's backing policy text must be **inverted** — PunchLog says metadata is removed, WorkLog says capture time + GPS are retained as evidence; (3) mic/speech strings and the audio-not-collected posture have no PunchLog baseline; (4) privacy policy is new WorkLog copy (PunchLog's Vercel site is the pattern, never the text); (5) everything else carries over unchanged. Privacy manifests: copy PunchLog's set, add entries for expo-location / expo-speech-recognition / signature-canvas; AC = zero ITMS-91053 warnings at upload.

**Retention:** report data is retained for the life of the project/company account — daily reports are the project's legal record, and NY contract claims run six years — with deletion and anonymization per §12.1; this posture is stated in the privacy policy.

### 12.4 Other review risks (register)

- **Location (Apple 5.1.1/5.1.2, Play Location policy):** when-in-use only, point-of-use, explainers; full functionality with location denied (manual weather, GPS-null photos, no nag loops); no background location ever; GPS visible on PDF photo sheets (visible retention is defensible).
- **Mic/speech (5.1.1):** both strings required or instant metadata rejection when the reviewer taps the mic; denial path leaves every notes field editable; no audio file ever written (code-level assertion in Phase 4 review). ASSUMPTION: on-device enforced via `requiresOnDeviceRecognition`; the OS-fallback caveat stated so declarations aren't caught false.
- **Reviewer reachability (Apple 2.1 — the #1 statistical rejection):** demo account is a **Phase 1 product requirement** (seed design in Phase 3, not a Phase 5 afterthought); every feature has a designed empty state; production build accepts the demo login.
- **Photos (Play media policy):** no `READ_MEDIA_IMAGES` in the merged manifest; iOS limited-photos mode works; ≥10-photo offline batch without frame drops on a mid-range device. ASSUMPTION: no custom whole-camera-roll gallery in scope.
- **Login (Apple 4.8):** email+password only — Sign in with Apple does NOT apply. **Locked so nobody adds social login in Phase 4 and triggers 4.8.**

### 12.5 Reviewer walkthrough (commitments; notes text in Phase 5)

Seed (Phase 3): primary credential (`super` on two NYC-renovation projects; yesterday's submitted report so carry-forward demos today; one locked report with amendment; GPS-captioned photos; populated calendar) + **a second disposable credential for the real, irreversible deletion test** (sole-member project; ASSUMPTION: re-provisioned nightly by seed script). Both work on the production build. Script (<10 min): sign in → create a project from scratch (organic bootstrap demo) → carry-forward → weather (location prompt) → camera (prompt) → library attach (prompt) → dictate (mic + speech prompts) → airplane-mode offline demo with visible queue drain on reconnect → locked report + amendment history + PDF share → switch account → delete account with suite disclosure → sign-in fails. AC: an outside dry-run hits everything with no dead ends.

### 12.6 Store positioning (direction; full copy Phase 5)

Store name pattern: **"WorkLog – Construction Daily Log"** (ASSUMPTION: bare "WorkLog" unavailable/too generic; JobSight stays out of the app name per §11 — suite branding appears in the description body only). Subtitle: primary **"Site reports in 5 minutes"**; challenger "Daily logs that hold up"; category keywords go in the keyword field (`daily report, construction log, jobsite diary, superintendent, field report, manpower, site diary, daily log, foreman`). No competitor names anywhere (Play prohibition / Apple 2.3.7). Differentiator order: smart carry-forward (top unmet Raken request) → true offline with no project cap → dispute-grade PDF ("built for the folder your lawyer opens") → JobSight suite peer.

---

## 13. Top risks (merged register)

| # | Risk | Mitigation |
|---|---|---|
| 1 | `expo-speech-recognition` maturity (only unproven dep) | Isolate in M8; capability-gate; keyboard parity everywhere; verify on real iOS 26 + Android devices; fetch current API docs before wiring. |
| 2 | EXIF/GPS provenance mechanism | Location-at-shutter → first-class columns (not picker EXIF, which lacks GPS); graceful null; PDF provenance line; re-injection as severable Should. |
| 3 | Shared-DB migration safety (PunchLog mid-submission) | Additive-only, idempotent guards, RLS in the same migration, delivered to `jobsight-backend`; PM='super' avoids enum surgery entirely. |
| 4 | Precise-location store scrutiny (diverges from PunchLog) | Consistent story across purpose strings, labels, Data Safety, policy; explainers; deny-path fully functional; no background location. |
| 5 | `create_report` natural-key collision offline | Get-or-create RPC (Must) dissolves same-day collisions at push time; grouped park surface for residuals; assisted merge UI (Should); single-device double-create impossible by construction. |
| 6 | Sync correctness under offline abuse (never lose field data) | Replicate `mutationQueue.ts` verbatim; jest-cover all pure modules; every failure path → retry / park-with-surface / user decision. |
| 7 | PDF weight on photo-heavy dispute days | ~40-photo on-device ceiling, print renditions, pdf-lib edge fallback, progress UI; test 50+ photo reports on low-end Android. |
| 8 | Platform-split leakage breaking web bundle | §4.3 grep guard in CI; `*.native.ts` discipline; repository seam is the only screen-facing surface. |
| 9 | Carry-forward manufacturing false records | Review-first sheet, per-line checkboxes, "from yesterday" tint, submit-sheet totals; descriptions/notes never carry. |
| 10 | Fear of Submit → hoarded drafts / sync distrust | Plain lifecycle copy; amendments first-class and easy; offline styled as normal; "Not sent yet" badge on stale drafts. ASSUMPTION: submitted→locked grace window — exact rule set in Phase 2 with the RPC design. |
| 11 | Weather offline gap on the legal record | Manual chips always available; auto-fetch fills on next sync with fetch timestamp; never blocks. |
| 12 | Voice garbage in the legal record | Dictation lands as visible editable text; facts come from chips, not transcription; review sheet re-surfaces dictated lines pre-signature. |
| 13 | Shared edge-function changes (`delete-account` extension) while PunchLog is mid-review — additive-only protects migrations, not function code | Extend behind a WorkLog-scoped code path with PunchLog's existing path untouched; regression-test PunchLog's deletion flow before deploy; coordinate the deploy window with PunchLog's review status. |

---

## 14. Assumptions register (consolidated)

1. "First store submission" = the full M0–M12 build; the walking skeleton (M0–M5) is an internal verification gate, not the submission. Could = last-built, not post-launch (Must-tier M12 deliberately follows it — deletion is built against the complete schema).
2. Permission explainers are routed screens; OS prompts fire at point of use.
3. Lightbox is a route (deep-linkable); capture/tag are sheets.
4. Signature required at submit by default; admin-optional via customization. Drawn image + name + timestamp, not PKI.
5. Photos captured after **submit** become amendment content (submitted reports are author-immutable — see #19).
6. One draft per project per day resolved on the Today tab; project switcher chip on top.
7. "Copy setup from another project" on the blank-start sheet (roster/areas only).
8. Library imports keep EXIF capture time; PDF distinguishes "taken" vs "added".
9. `captured_at` from device clock + TZ offset; server `created_at` is the independent timestamp; skew surfaced, not corrected.
10. Single author per report-day; whole-section LWW is safe; conflict surface covers the residual.
11. `remove_photo` (draft-only) exists though the spec is silent.
12. Dictation is per-field short-burst, not always-listening.
13. PM label stored as a WorkLog-side display field (not an authorization boundary).
14. Deletion anonymization mirrors PunchLog's existing `delete-account` behavior — Phase 3 verifies.
15. Disposable review-deletion account re-provisioned nightly.
16. Store name "WorkLog – Construction Daily Log"; bare name assumed unavailable.
17. `expo-build-properties` needed for iOS 26 SDK / compileSdk alignment — confirm against PunchLog's config.
18. Speech OS-fallback caveat disclosed so on-device declarations aren't caught false.
19. Submitted = **immutable to the author** (corrections via amendment only); the submitted→locked "grace window" governs only when auto-lock fires, never editability — exact auto-lock timing defined in Phase 2 with the RPC design.
20. No custom whole-camera-roll gallery in scope (keeps Play media permissions clean).
21. Project bootstrap surfaces (create project, invite members) are Must-tier **enabling infrastructure** over existing backend primitives, not a feature-set expansion; rich project-management UI (edit/archive/transfer) stays out of v1 scope.
22. The signature PNG (~5–20 KB) is persisted server-side so distribution and regenerated PDFs carry it; transport mechanism (base64 in the `submit_report` payload vs a storage object) decided in Phase 2 (§15 #13).
23. `amended` is a **derived display state** (a locked report with ≥1 amendment), not a fourth lifecycle state — confirmed against the RPC state machine in Phase 2 (§15 #14).
24. Amendments apply to submitted *and* locked reports (the camera "add as amendment" flow requires it) — RPC enforcement matrix in Phase 2 (§15 #14).

**Flagged tradeoffs (stack deviations):** piexifjs (EXIF re-injection, Should — recommended); react-native-calendars (recorded, declined — hand-roll); FlashList (declined — FlatList meets budget); network speech fallback (declined — privacy posture); OS background transfer for uploads (declined — outbox drains on foreground/reconnect).

---

## 15. Open items feeding Phase 2 (Architecture)

1. `create_report` get-or-create RPC contract (returns existing report id on same-day conflict) + client re-parenting detail + grouped park-surface UX for residual failures.
2. Submitted→locked transition rule: who locks, grace window, auto-lock timing — designed with the `submit_report`/`lock_report`/`amend_report` RPCs.
3. EXIF re-injection placement in the photo pipeline (pre-outbox step) + final piexifjs adoption call.
4. Dual PDF renderer consistency contract — **core, not edge-case** (rev 3): M11 distribution emails render server-side, so pdf-lib output is the copy recipients keep. Shared layout constants, a golden-output comparison test on a reference report, and the exact routing rule (on-device share vs server distribution vs >40-photo fallback).
5. Weather edge function contract (Open-Meteo fields, snapshot schema, fill-on-sync trigger, `weather_source` semantics).
6. Pull scopes + cursor keys for the report domain; amendment idempotency detail.
7. Android speech model-download UX placement (first-launch opportunistic vs settings-only).
8. Report customization enforcement split (client hints vs `submit_report` server enforcement against stale config).
9. `report_date` day boundary: **project-local timezone** via an additive nullable `projects.timezone` column (IANA name; falls back to device TZ when unset) — exact rule + migration designed in Phase 2/3. The entire natural key, collision handling, carry-forward, and calendar hang on this.
10. Amendment lifecycle: recommend amendments are **atomic — locked on save**, amendable only by a further amendment, with section-structured content so amendments appear in filters/rollups — confirm in Phase 2.
11. **Project geolocation (rev 3 blocker):** the shared `projects` table has only a text `address` — no coordinates — yet weather auto-fetch (M9) and the wrong-project photo guard (M5) both depend on them. Decide: additive nullable `projects.lat`/`lng` columns vs a WorkLog-side `project_sites` table; population mechanism (server-side geocode of the address at project create/edit — Open-Meteo's keyless geocoding API — plus optional manual pin on the create-project sheet); and the guard's distance threshold. Both features degrade gracefully (no fetch / no flag) while coordinates are null.
12. Invite acceptance flow: `invite-user` emails a link, but the client sets `detectSessionInUrl: false` — define acceptance mechanics compatible with that constraint (OTP code, or deep link handled outside supabase-js URL detection).
13. **Signature persistence (rev 3 blocker):** no mutation kind or storage location exists for the signature today, but server-rendered distribution PDFs and any later regeneration of a locked report's PDF need the bytes server-side. Recommend base64 PNG riding the `submit_report` RPC payload into a `report_signatures` row (small, atomic with submit); alternative is a storage object on the photo-bucket pattern. Include amendment signatures in the decision.
14. **Full report state machine incl. `amended`:** when the state is set/cleared, whether submitted-not-yet-locked reports accept amendments (the camera flow assumes yes — assumption #24), and the complete RPC enforcement matrix (`submit_report`/`lock_report`/`amend_report` legal-transition table).
15. **Amendment rendering in the PDF:** the artifact must show the trail. Recommend original sections printed unaltered + an "Amended" stamp on affected sections + amendment appendix pages (who/when/what, original preserved).
16. **Locked-row immutability vs deletion anonymization:** the M4 locked-row rejection trigger must admit a deliberate, narrow service-role bypass for the `delete-account` anonymization path — design the bypass explicitly rather than growing exceptions later.

---

## 16. Team synthesis

Produced by four parallel specialist reviews (planning, field UX, mobile feasibility, store readiness).

**Agreements (independent convergence):** 5-slot tab bar with a raised center camera *action* (not a route) using the reserved `FIXED_COLORS.camera` token; carry-forward as the default morning path with review-first safeguards; provenance as first-class DB columns; account deletion as the highest store risk; voice as accelerator-never-gate; offline styled as a normal state.

**Conflicts resolved:**
1. *Fifth tab — Reports (planning) vs Photos (UX):* **Photos wins.** §5 pairs calendar + filterable list as one History feature (the list's project filter subsumes a Reports tab); the fast-photo killer feature needs a browse/tag-cleanup surface; the spec's draft tab set included Photos. Planning's underlying point (photos are report-scoped data) is honored in the data model — the Photos tab is a view over report photos, not a separate store.
2. *Weather as Must vs Should:* split — the **section** (manual entry) is Must; **auto-fetch** is Should (M9). Both reviews actually proposed this split; recorded as the unified position.
3. *EXIF plan naïveté:* the spec's `exif: true` wording implies GPS comes from the capture EXIF; feasibility verified it does not (iOS camera case has no GPS tags; PHPicker strips location). Resolved to location-at-shutter → columns; spec's first-class-columns mandate unchanged, mechanism corrected. Carried to Phase 2 as the stated ASSUMPTION the spec requires.

**Adversarial critique (applied):** a follow-up critique pass produced 17 findings — two blockers (sub-role report visibility; the `report_date` day boundary), eight majors, seven minors/nits — with verdict "approve with amendments." All 17 recommendations were folded into rev 2.

**Second critique pass (rev 3, applied):** cross-checked the PRD against the shared-schema definitions in the spec and the second-order implications of the PRD's own decisions. Four blockers — (1) no project-bootstrap surfaces despite the standalone mission (resolved: Must-tier create-project + invite screens over existing backend primitives, M2); (2) project geolocation absent from the shared schema while M5's GPS guard and M9's weather depend on it (§15 #11); (3) §11.6/§11.7 contradiction on section data shape (resolved: section row as concurrency unit, child rows exploded transactionally); (4) M11 distribution email forcing server-side PDF rendering + unspecified signature persistence (§15 #4, #13) — plus five mediums (`amended` state machine, amendment PDF rendering, owner access stated as PDF-only, shared edge-function deploy risk, lock-trigger vs anonymization) and five minors (priority-vs-build-order wording, rollup + notifications screens added to inventory, 5-minute measurement method defined, invite deep-link constraint, `remove_photo` storage policy). All folded into this revision. Pattern worth carrying into Phase 2: every blocker sat where WorkLog touches shared-suite infrastructure it doesn't own.

**Next step:** on approval, Phase 2 (Architecture) — sync design (mutation kinds, pull scopes, conflict surfaces), photo pipeline + provenance mechanism, weather edge function, PDF pipeline, navigation map, `src/` module layout mirroring PunchLog.
