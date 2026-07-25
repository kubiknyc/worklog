# WorkLog M2 — Remaining Section Editor Sheets (design)

> Phase 4 / milestone **M2** ("project bootstrap + report CRUD + 11 section sheets").
> The data layer (Repository seam) and the report-detail slice already shipped
> (report screen, Today wiring, section summaries, and two archetype sheets — Crew,
> General notes). This spec covers the **remaining editor sheets** and two design
> changes agreed during brainstorming.

## Prerequisites (base branch) — resolved

Implementation builds on the report-detail slice. As of commit `8e28a81` the
report-detail code, the CI/PR-template/gates work, and this spec are all unified
on branch **`m2-report-detail-sections`** (the earlier split between that branch
and `chore/build-workflow` has been merged/rebased away). Execute directly on
`m2-report-detail-sections`; every *Modified* / *Removed* target below exists
there. (Historical note: this section previously flagged the branches as
divergent — that is now moot.)

## Goal

Complete the section-editing surface so a super can fill an entire daily report
offline. Fold Crew + Work-performed into one trade-centric sheet, build the seven
other list sheets on two established archetypes, and add a Weather sheet that
displays the auto-fetched snapshot **and** always offers a manual override —
**nine sheets this increment** (General notes is already built).

## Two design changes (from brainstorming)

1. **Combine Crew by trade + Work performed into one sheet.** Work-performed is
   already scoped to "today's crewed trades" (PRD §7), so the crewed trades *are*
   its rows. One `CrewWorkSheet` presents a card per trade carrying Workers +
   Hours **and** Area + "what was done". The data model is unchanged: `crew` and
   `work_performed` remain separate `SectionKind`s writing separate server tables
   (`report_crew`, `report_work_performed` — see `sectionContent.ts:44`). The
   sheet runs **two** `useSectionDraft` instances (one per section); the two
   drafts are correlated by the `trade` string as a **content-level convention**
   (the hook itself is keyed by `(reportId, section)`, not trade — there is no
   third hook argument). This retires the shipped `CrewSectionSheet`.
2. **Weather auto-populates, with a manual override always available.** The
   report row and the Weather sheet lead with the auto-fetched snapshot (condition
   + temp) read from `report_weather.auto_*` via the existing `getWeather` /
   `summarizeWeather`. **But manual entry stays in scope this increment** — PRD
   marks manual weather entry as **Must** and auto-fetch as **Should/M9**
   (PRD.md:452), and PRD §7 requires weather input to "never block" with "manual
   chips available" offline (PRD.md:236). So `WeatherSectionSheet` shows the auto
   snapshot read-only **and** a manual override (condition chips + temp stepper)
   that writes `WeatherOverrideContent` → `override_*`; the override is never
   overwritten by a later auto-fetch. This honors the "auto-populate" intent
   (auto is primary/pre-filled) while satisfying the PRD Must (a super can always
   record weather offline). `WEATHER_CONDITIONS` is therefore added this increment
   (its consumer, the override chips, now ships). Only the **M9 fetch itself**
   (Open-Meteo edge function + project geocode) stays deferred — until it lands,
   `auto_*` is null and the override is how weather gets recorded.

## Architecture

### Archetypes (Approach C — bespoke sheets + one tiny presentational helper)

Two shapes carry every list sheet; each sheet stays bespoke and readable, sharing
only visual chrome — **not** a config-driven engine. Every sheet reuses the
existing **`SectionSheetScaffold`** shell (grab handle, scroll body, footer,
optional "None today" row) that Crew and Notes already use; the only new shared
piece is `EntryCard`.

- **Relational** (`{ rows: [...] }`, exploded into child tables server-side):
  Crew&Work, Equipment, Delays, Safety.
- **Entry-list** (`{ entries: [...] }`, stored verbatim as JSON): Deliveries,
  Inspections, Visitors, RFIs.
- **Special**: Weather (1:1 `report_weather` row; auto snapshot + override).
- **Text**: General notes (already built).

**New shared component `src/components/report/EntryCard.tsx`** — the bordered
card with a title + trash button that every list sheet repeats (currently inline
in Crew). Dumb/presentational: props `title` (string), `onRemove`, optional
`carried` flag (dashed border + "from yesterday" affix), `children`. No state, no
logic. **`title` source:** the row's distinguishing field where one exists —
`trade` (Crew&Work) or equipment `name` (Equipment); otherwise an **ordinal
label** the sheet supplies (`"Delivery 1"`, `"Inspection 1"`, `"Visitor 1"`,
`"Delay 1"`, `"Observation 1"`, `"Item 1"`), matching the approved prototype.

Every sheet autosaves through the existing `useSectionDraft` (optimistic local
state + ~400 ms debounced `updateSection`, flush on close/unmount). Deliberate
empties use `markComplete(true)` ("No crew today" / "Nothing to report"). All row
mutations are immutable (new array each edit).

### Section rows + row groups in the report list

`ReportDetailSections` today drives each row off a single boolean `isEnabled`
(interactive+chevron vs dimmed+"Soon"). This increment replaces that with an
explicit **row model** so crew + work_performed collapse into one row:

- **Concrete shape** (in `sectionMeta.ts`):

  ```ts
  type DisplayMode = 'interactive' | 'pending'; // pending = sheet not built yet
  interface ReportRow {
    readonly id: string;              // stable row key, e.g. 'crew_work', 'weather'
    readonly label: string;
    readonly icon: keyof typeof Ionicons.glyphMap;
    readonly kinds: readonly SectionKind[]; // 1 kind, or [crew, work_performed]
    readonly mode: DisplayMode;
  }
  export const REPORT_ROWS: readonly ReportRow[]; // ordered, PRD §7 order
  ```

- `ReportDetailSections` iterates `REPORT_ROWS` (not raw `SECTION_META`). Its
  `summaries` prop changes from `Record<SectionKind, SectionSummary>` to
  **`Record<string /* row id */, SectionSummary>`**; `app/report/[id]/index.tsx`
  builds it, using `summarizeCrewWork(...)` for the `crew_work` row and the
  existing per-kind summaries elsewhere. `enabledKinds` is dropped in favor of
  each row's `mode`.
- **Weather is `interactive`** — its row shows the auto/override summary and opens
  `WeatherSectionSheet`. (No third "read-only" mode is needed; every non-`pending`
  row is tappable.)

`summarize.ts` gains `summarizeCrewWork(crewPayload, workPayload, crewIsComplete)`
composing the two sections into the group's one-line summary (trades + total
headcount from crew, count of logged work items from work_performed). Existing
per-kind summaries (incl. `summarizeWeather`) are unchanged.

### The combined CrewWork sheet

`CrewWorkSheet` owns two drafts:

```
const crew = useSectionDraft<CrewContent>(reportId, 'crew', initialCrew);
const work = useSectionDraft<WorkPerformedContent>(reportId, 'work_performed', initialWork);
```

The UI is one list of trade cards. Adding a trade appends a `crew` row
(`{trade, headcount:1, hours:8, is_carried_forward:false}`) and hides that trade
from the add-`ChipRow` (preserving `crew.trade` uniqueness, as `CrewSectionSheet`
already does — this is what makes trade-keyed correlation safe; the design assumes
**at most one work_performed row per trade**, an invariant this sheet is the sole
writer of). Each card edits that crew row's steppers and, in the same card, an
Area field + note that map to a `work_performed` row **matched by the same trade**
(`{trade, area, note}`); a trade with no area/note simply has no work_performed
row. Removing a trade removes both its `crew` row and any matching
`work_performed` row — an accepted tradeoff (removing a crewed trade discards its
work note; documented so it is intentional). `flush()` on close flushes both
drafts. "No crew today" marks the crew section complete and clears both.

### Report-screen host

`app/report/[id]/index.tsx` updates:
- Render `REPORT_ROWS` (groups + modes) instead of one-per-kind; build the
  row-id-keyed `summaries` map (using `summarizeCrewWork` for `crew_work`).
- Refactor the per-kind `activeKind === …` conditional blocks into a small
  registry map `renderSheet(rowId, props)` to keep hosting flat as sheet count
  grows (targeted cleanup of code we're already touching). The current
  `ENABLED_KINDS = ['crew','general_notes']` (`app/report/[id]/index.tsx:41`) is
  removed in favor of each row's `mode`.
- Pass the loaded `crew` + `work_performed` payloads to `CrewWorkSheet`, and the
  `WeatherRow` to `WeatherSectionSheet`.

## Per-sheet field spec

Pick-lists come from `src/components/report/sectionConstants.ts` — all already
exist (`TRADES`, `DELIVERY_UNITS`, `DELAY_CAUSES`, `VISITOR_ROLES`,
`INSPECTION_AGENCIES`, `SAFETY_TYPES`, `INSPECTION_RESULTS`) **except**
`EQUIPMENT_STATUS` (active/idle) and `WEATHER_CONDITIONS` (clear/cloudy/rain/
snow/windy/fog…), both added this increment. Shapes are in
`src/data/sectionContent.ts` (already defined).

**Relational:**
- **Crew & work** — per trade card: Workers `Stepper` (min 0) · Hours `Stepper`
  (0.5 step, default 8, max 24) · Area `TextField` · "What was done" multiline
  `TextField` (voice slot). Add via `TRADES` `ChipRow` (hides already-added).
  "No crew today" affirmation.
- **Equipment** — add by typed name (`TextField` + add); per row: on-site toggle
  + status chips (`EQUIPMENT_STATUS`). The on-site toggle uses React Native's
  built-in `Switch` (no themed Switch exists in `src/components`), themed via
  `trackColor`/`thumbColor` from the palette.
- **Delays** — per row: cause chips (`DELAY_CAUSES`) · responsible-party
  `TextField` · duration `Stepper` (0.5-day) **or** "Ongoing" toggle · note
  multiline (voice). Toggling "Ongoing" nulls `duration_hours` and **disables the
  duration stepper** — this requires a new `disabled?: boolean` prop on
  `Stepper.tsx` (see File list; today it only self-disables its ± buttons at
  min/max, with no parent override).
- **Safety** — "Nothing to report" affirmation **or** per row: type chips
  (`SAFETY_TYPES`) · description multiline (voice) · "Recordable incident"
  toggle (`is_incident`). Note: `SAFETY_TYPES` already includes a `recordable`
  observation type; that chip classifies the observation, while the `is_incident`
  toggle drives history/incident filters — distinct fields (label the toggle
  "Recordable incident").

**Entry-list:**
- **Deliveries** — supplier `TextField` · material `TextField` · quantity
  `Stepper` · unit chips (`DELIVERY_UNITS`). (Ticket photo shortcut → M5.)
- **Inspections** — agency chips (`INSPECTION_AGENCIES`) · inspector `TextField` ·
  result three large chips (`INSPECTION_RESULTS`) · note multiline (voice).
- **Visitors** — name `TextField` · role chips (`VISITOR_ROLES`) · optional
  `HH:MM` time `TextField` (numeric).
- **RFIs** — copy "Questions and issues raised today."; title `TextField`
  (voice) · trade chips (`TRADES`) · "needs answer from" `TextField`.

**Special:**
- **Weather** (`WeatherSectionSheet`) — read-only auto snapshot row (condition +
  temp from `auto_*`, or "will fill on next sync" when null) **and** a manual
  override: condition chips (`WEATHER_CONDITIONS`) + temperature `Stepper` (°F),
  writing `WeatherOverrideContent` via `updateSection('weather', …)`. Copy notes
  the override wins and is never overwritten by the auto fetch.

### Deliberate PRD §7 simplifications (M2)

These depart from the PRD §7 pattern table on purpose; the richer versions depend
on data we do not have locally yet and are deferred with the recents work:
- **Work-performed Area** is a free-text `TextField`, not "area chips (project
  list, grows organically)" — the project area list needs a recents/master store.
- **Equipment** is add-by-typed-name, not "toggles over the project's known list"
  — same reason (no equipment master yet).
- **RFIs "needs answer from"** is a free-text `TextField`, not a chip.
- **Visitors time** is an `HH:MM` `TextField`, not a 15-min wheel picker — a wheel
  picker would add a dependency (reconciles with the `VisitorEntry.time`
  doc-comment in `sectionContent.ts:107`).

**Also deferred within these sheets:** recents chips (suppliers/inspectors/names);
voice mic (`accessory` slot reserved, wired in M8); delivery/RFI/safety photo
shortcuts (M5).

## Testing (representative per archetype)

react-native-testing-library interaction tests covering the shared behaviors —
add row/entry, edit a control, remove, "None"/"Nothing" affirmation
(`markComplete`), autosave calls `updateSection` (repository mocked):

- **CrewWorkSheet** — the combined archetype: add trade, edit steppers + work
  note, verify **both** `updateSection('crew', …)` and
  `updateSection('work_performed', …)` fire; remove-trade drops both; "No crew today".
- **DeliveriesSheet** — entry-list archetype: add/edit (stepper + unit chips +
  text) / remove.
- **SafetySheet** — relational + affirmation + incident toggle.
- **WeatherSectionSheet** — special: setting a condition chip / temp writes
  `updateSection('weather', …)` with `WeatherOverrideContent`.

Pure additions get unit tests: `summarizeCrewWork` extends `summarize.test.ts`;
the `sectionMeta` row model gets a new `src/report/sectionMeta.test.ts`. The new
`Stepper` `disabled` prop gets a case in the existing `Stepper.test.tsx` (no
press when disabled). `EntryCard` is logic-free, but a small render test follows
the `Chip.test.tsx` precedent. Remaining sheets rely on the shared archetype +
typecheck/lint.

## File list

**New:**
- `src/components/report/EntryCard.tsx` (+ `EntryCard.test.tsx`)
- `src/components/report/CrewWorkSheet.tsx` (replaces `CrewSectionSheet.tsx`)
- `src/components/report/EquipmentSectionSheet.tsx`
- `src/components/report/DelaysSectionSheet.tsx`
- `src/components/report/SafetySectionSheet.tsx`
- `src/components/report/DeliveriesSectionSheet.tsx`
- `src/components/report/InspectionsSectionSheet.tsx`
- `src/components/report/VisitorsSectionSheet.tsx`
- `src/components/report/RfisSectionSheet.tsx`
- `src/components/report/WeatherSectionSheet.tsx`
- `src/report/sectionMeta.test.ts` (row model)
- Sheet tests: `CrewWorkSheet.test.tsx`, `DeliveriesSectionSheet.test.tsx`,
  `SafetySectionSheet.test.tsx`, `WeatherSectionSheet.test.tsx`

**Modified:**
- `src/report/sectionMeta.ts` — `REPORT_ROWS` row model + display mode.
- `src/report/summarize.ts` (+ `.test.ts`) — `summarizeCrewWork`.
- `src/components/report/ReportDetailSections.tsx` — render `REPORT_ROWS`;
  `summaries` keyed by row id; drop `enabledKinds` for per-row `mode`.
- `src/components/report/sectionConstants.ts` — add `EQUIPMENT_STATUS`, `WEATHER_CONDITIONS`.
- `src/components/Stepper.tsx` (+ `Stepper.test.tsx`) — add optional `disabled`
  prop (grays buttons + readout, ignores presses) for the Delays "Ongoing" case.
- `app/report/[id]/index.tsx` — sheet registry, row model, pass crew+work + weather payloads.

**Removed:** `src/components/report/CrewSectionSheet.tsx`. (No RNTL test exists for
it today — `CrewWorkSheet.test.tsx` writes that coverage net-new.)

## Verification gates

`npm run typecheck` · `eslint` · `prettier` · full `jest` · platform-split grep
(`src/platformSplit.test.ts`) — all green before commit. No native imports in the
web graph. Sheets stay presentational; policy logic (summaries, row model) stays
pure.

## Out of scope (this increment)

- **M9 weather fetch** (Open-Meteo edge function + project geocode) — `auto_*`
  stays null until then; the manual override is how weather is recorded meanwhile.
- Recents store; voice (M8); photo shortcuts (M5); carry-forward (M6).
