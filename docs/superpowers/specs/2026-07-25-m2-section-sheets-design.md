# WorkLog M2 — Remaining Section Editor Sheets (design)

> Phase 4 / milestone **M2** ("project bootstrap + report CRUD + 11 section sheets").
> The data layer (Repository seam) and the report-detail slice already shipped
> (branch `m2-report-detail-sections`: report screen, Today wiring, section
> summaries, and two archetype sheets — Crew, General notes). This spec covers
> the **remaining editor sheets** and two design changes agreed during
> brainstorming.

## Goal

Complete the section-editing surface so a super can fill an entire daily report
offline. Build the eight remaining editor sheets on two established archetypes,
fold Crew + Work-performed into one trade-centric sheet, and make Weather an
auto-populated display rather than a manual-entry sheet.

## Two design changes (from brainstorming)

1. **Combine Crew by trade + Work performed into one sheet.** Work-performed is
   already scoped to "today's crewed trades" (PRD §7), so the crewed trades *are*
   its rows. One `CrewWorkSheet` presents a card per trade carrying Workers +
   Hours **and** Area + "what was done". The data model is unchanged: `crew` and
   `work_performed` remain separate `SectionKind`s writing separate server tables
   (`report_crew`, `report_work_performed`). The sheet runs **two**
   `useSectionDraft` instances (one per section), both keyed by trade, and writes
   both on edit. This retires the shipped `CrewSectionSheet`.
2. **Weather is auto-populated, not typed.** Weather stops being an editor sheet.
   The report renders its auto snapshot (condition + temp) read-only from the
   `report_weather.auto_*` columns. The actual fetch is the M9 Open-Meteo edge
   function; until then the row shows "fills on next sync". A manual override
   (offline fallback, `WeatherOverrideContent` → `override_*`) is a **deferred
   secondary action**, not part of this increment.

## Architecture

### Archetypes (Approach C — bespoke sheets + one tiny presentational helper)

Two shapes carry every list sheet; each sheet stays bespoke and readable, sharing
only visual chrome — **not** a config-driven engine.

- **Relational** (`{ rows: [...] }`, exploded into child tables server-side):
  Crew&Work, Equipment, Delays, Safety.
- **Entry-list** (`{ entries: [...] }`, stored verbatim as JSON): Deliveries,
  Inspections, Visitors, RFIs.
- **Text**: General notes (already built).

**New shared component `src/components/report/EntryCard.tsx`** — the bordered
card with a title + trash button that every list sheet repeats (currently inline
in Crew). Dumb/presentational: props `title`, `onRemove`, optional `carried`
flag (dashed border + "from yesterday" affix), `children`. Crew&Work and all
list sheets consume it. No state, no logic.

Every sheet autosaves through the existing `useSectionDraft` (optimistic local
state + ~400ms debounced `updateSection`, flush on close/unmount). Deliberate
empties use `markComplete(true)` ("No crew today" / "Nothing to report"). All row
mutations are immutable (new array each edit).

### Section groups in the report list

`sectionMeta` gains a notion of a **display group** so the report-detail list can
render crew + work_performed as one row opening one sheet, while the underlying
`SectionKind`s stay distinct. Concretely: introduce an ordered list of
**report rows**, where a row is either a single `SectionKind` or a group of
kinds with a group label/icon and a combined summary. `ReportDetailSections`
iterates rows (not raw `SECTION_META`); the crew+work_performed group renders
"Crew & work by trade" with a merged summary (e.g. "3 trades · 18 on site ·
2 logged"). Weather's row is read-only (no chevron; taps do nothing, or open a
read-only detail — see Out of scope).

`summarize.ts` already summarizes crew and work_performed independently; add a
small `summarizeCrewWork(crewPayload, workPayload, crewIsComplete)` that composes
the two into the group's one-line summary (trades + total headcount from crew,
count of logged work items from work_performed). Existing per-kind summaries are unchanged.

### The combined CrewWork sheet

`CrewWorkSheet` owns two drafts:

```
const crew = useSectionDraft<CrewContent>(reportId, 'crew', initialCrew);
const work = useSectionDraft<WorkPerformedContent>(reportId, 'work_performed', initialWork);
```

The UI is one list of trade cards. Adding a trade appends a `crew` row
(`{trade, headcount:1, hours:8, is_carried_forward:false}`). Each card edits that
crew row's steppers and, in the same card, an Area field + note that map to a
`work_performed` row **keyed by the same trade** (`{trade, area, note}`). A trade
with no area/note simply has no work_performed row. Removing a trade removes both
its crew row and any matching work_performed row. `flush()` on close flushes both
drafts. "No crew today" marks the crew section complete and clears both.

### Report-screen host

`app/report/[id]/index.tsx` updates:
- Render the section **rows** (groups) instead of one-per-kind.
- Register the new sheets in the sheet registry; set enabled rows to the full set
  (Crew&Work, Equipment, Delays, Safety, Deliveries, Inspections, Visitors, RFIs,
  General notes). Weather is display-only.
- Refactor the per-kind `activeKind === …` conditional blocks into a small
  registry map `renderSheet(rowKey, props)` to keep hosting flat as sheet count
  grows (targeted cleanup of code we're already touching).
- Pass the loaded `crew` + `work_performed` payloads to `CrewWorkSheet`, and the
  `WeatherRow` to the read-only weather affordance.

## Per-sheet field spec

Pick-lists come from `src/components/report/sectionConstants.ts` (add
`WEATHER_CONDITIONS`, `EQUIPMENT_STATUS`). Shapes are in
`src/data/sectionContent.ts` (already defined).

**Relational:**
- **Crew & work** — per trade card: Workers `Stepper` (min 0) · Hours `Stepper`
  (0.5 step, default 8, max 24) · Area `TextField` · "What was done" multiline
  `TextField` (voice slot). Add via `TRADES` `ChipRow` (hides already-added).
  "No crew today" affirmation.
- **Equipment** — add by typed name (`TextField` + add); per row: on-site toggle
  (Switch) + status chips (`EQUIPMENT_STATUS`: active/idle).
- **Delays** — per row: cause chips (`DELAY_CAUSES`) · responsible-party
  `TextField` · duration `Stepper` (0.5-day) **or** "Ongoing" toggle (nulls
  duration, disables the stepper) · note multiline (voice).
- **Safety** — "Nothing to report" affirmation **or** per row: type chips
  (`SAFETY_TYPES`) · description multiline (voice) · "Recordable incident"
  toggle (`is_incident`).

**Entry-list:**
- **Deliveries** — supplier `TextField` · material `TextField` · quantity
  `Stepper` · unit chips (`DELIVERY_UNITS`). (Ticket photo shortcut → M5.)
- **Inspections** — agency chips (`INSPECTION_AGENCIES`) · inspector `TextField` ·
  result three large chips (`INSPECTION_RESULTS`) · note multiline (voice).
- **Visitors** — name `TextField` · role chips (`VISITOR_ROLES`) · optional
  `HH:MM` time `TextField` (numeric; a wheel picker would add a dependency —
  deferred).
- **RFIs** — copy "Questions and issues raised today."; title `TextField`
  (voice) · trade chips (`TRADES`) · "needs answer from" `TextField`.

**Deferred within these sheets:** recents chips (suppliers/inspectors/names) —
free-text + static lists for now; voice mic (`accessory` slot reserved, wired in
M8); delivery/RFI/safety photo shortcuts (M5).

## Testing (representative per archetype)

react-native-testing-library interaction tests covering the shared behaviors —
add row/entry, edit a control, remove, "None"/"Nothing" affirmation
(`markComplete`), autosave calls `updateSection` (repository mocked):

- **CrewWorkSheet** — the combined archetype: add trade, edit steppers + work
  note, verify **both** `updateSection('crew', …)` and
  `updateSection('work_performed', …)` fire; "No crew today".
- **DeliveriesSheet** — entry-list archetype: add/edit (stepper + unit chips +
  text) / remove.
- **SafetySheet** — relational + affirmation + incident toggle.

Pure additions (`summarizeCrewWork`, any `sectionMeta` group helper) get unit
tests alongside the existing `summarize.test.ts`. Remaining sheets rely on the
shared archetype + typecheck/lint.

## File list

**New:**
- `src/components/report/EntryCard.tsx`
- `src/components/report/CrewWorkSheet.tsx` (replaces `CrewSectionSheet.tsx`)
- `src/components/report/EquipmentSectionSheet.tsx`
- `src/components/report/DelaysSectionSheet.tsx`
- `src/components/report/SafetySectionSheet.tsx`
- `src/components/report/DeliveriesSectionSheet.tsx`
- `src/components/report/InspectionsSectionSheet.tsx`
- `src/components/report/VisitorsSectionSheet.tsx`
- `src/components/report/RfisSectionSheet.tsx`
- Tests: `CrewWorkSheet.test.tsx`, `DeliveriesSectionSheet.test.tsx`,
  `SafetySectionSheet.test.tsx`

**Modified:**
- `src/report/sectionMeta.ts` — section-group model (crew+work_performed group).
- `src/report/summarize.ts` (+ `.test.ts`) — `summarizeCrewWork`.
- `src/components/report/ReportDetailSections.tsx` — render groups; weather read-only.
- `src/components/report/sectionConstants.ts` — `WEATHER_CONDITIONS`, `EQUIPMENT_STATUS`.
- `app/report/[id]/index.tsx` — sheet registry, enabled rows, pass crew+work/weather.

**Removed:** `src/components/report/CrewSectionSheet.tsx` (+ any Crew test folds into `CrewWorkSheet.test.tsx`).

## Verification gates

`npm run typecheck` · `eslint` · `prettier` · full `jest` · platform-split grep
(`src/platformSplit.test.ts`) — all green before commit. No native imports in the
web graph. Sheets stay presentational; policy logic (summaries, group model)
stays pure.

## Out of scope (this increment)

- M9 weather fetch (Open-Meteo edge function + project geocode) — weather is
  display-only until then.
- Manual weather override sheet (deferred secondary action).
- Recents store; voice (M8); photo shortcuts (M5); carry-forward (M6).
- A read-only weather detail route (the row can stay non-interactive for now).
