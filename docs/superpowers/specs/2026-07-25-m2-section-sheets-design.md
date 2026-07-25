# WorkLog M2 — Remaining Section Editor Sheets (design)

> Phase 4 / milestone **M2** ("project bootstrap + report CRUD + 11 section sheets").
> The data layer (Repository seam) and the report-detail slice already shipped on
> branch **`m2-report-detail-sections`** (commits `b9556c0` + `157e37c`: report
> screen, Today wiring, section summaries, and two archetype sheets — Crew,
> General notes). This spec covers the **remaining editor sheets** and two design
> changes agreed during brainstorming.

## Prerequisites (base branch)

Implementation **must build on `m2-report-detail-sections`** — every file in this
spec's *Modified* / *Removed* list exists only there, not on `main`. This spec
document was committed on `chore/build-workflow` (which carries unrelated CI /
PR-template / gates work and does **not** contain the report-detail slice), so
before execution the two lines must be unified onto one base (merge
`m2-report-detail-sections` into the working branch, or rebase). A planner or
executor pointed at `main` or `chore/build-workflow` as-is will find every
*Modified* target absent. Resolving this branch topology is a prerequisite, not a
task inside this increment.

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
   (`report_crew`, `report_work_performed` — see `sectionContent.ts:44`). The
   sheet runs **two** `useSectionDraft` instances (one per section); the two
   drafts are correlated by the `trade` string as a **content-level convention**
   (the hook itself is keyed by `(reportId, section)`, not trade — there is no
   third hook argument). This retires the shipped `CrewSectionSheet`.
2. **Weather is auto-populated, not typed.** Weather stops being an editor sheet.
   The report renders its auto snapshot (condition + temp) read-only from the
   `report_weather.auto_*` columns via the existing `getWeather` / `summarizeWeather`.
   The actual fetch is the M9 Open-Meteo edge function; until then the row shows
   "fills on next sync". A manual override (offline fallback, `WeatherOverrideContent`
   → `override_*`) is a **deferred secondary action, not part of this increment** —
   and therefore **no weather pick-list constant is added now** (the read-only row
   renders the raw `auto_condition` string; a `WEATHER_CONDITIONS` constant lands
   with the deferred override sheet, which is its only consumer).

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

### Section rows + tri-state in the report list

`ReportDetailSections` today drives each row off a single boolean `isEnabled`
(interactive+chevron vs dimmed+"Soon"). This increment replaces that binary with
a per-row **display mode** and a **row-group** concept:

- **Row model:** an ordered list of *rows*, where a row is either a single
  `SectionKind` or a **group** of kinds with a group label/icon and a combined
  summary. `ReportDetailSections` iterates rows (not raw `SECTION_META`). The
  crew+work_performed group renders "Crew & work by trade" with a merged summary.
- **Three display modes per row:**
  - `interactive` — a built sheet: full-color summary + chevron, tappable.
  - `readonly` — populated but non-tappable: full-color summary, **no chevron,
    not dimmed, no "Soon" badge**. This is **Weather** (auto-fetched; nothing to
    edit this increment).
  - `pending` — sheet not built yet: dimmed + "Soon" badge (the current dimmed
    behavior, retained for any not-yet-landed kind during the rollout).

`sectionMeta` gains the row-group model (an ordered `REPORT_ROWS` list keyed by a
row id, each mapping to one or more `SectionKind`s + display mode). `summarize.ts`
gains `summarizeCrewWork(crewPayload, workPayload, crewIsComplete)` composing the
two sections into the group's one-line summary (trades + total headcount from
crew, count of logged work items from work_performed). Existing per-kind summaries
are unchanged.

### The combined CrewWork sheet

`CrewWorkSheet` owns two drafts:

```
const crew = useSectionDraft<CrewContent>(reportId, 'crew', initialCrew);
const work = useSectionDraft<WorkPerformedContent>(reportId, 'work_performed', initialWork);
```

The UI is one list of trade cards. Adding a trade appends a `crew` row
(`{trade, headcount:1, hours:8, is_carried_forward:false}`) and hides that trade
from the add-`ChipRow` (preserving `crew.trade` uniqueness, as `CrewSectionSheet`
already does — this is what makes trade-keyed correlation safe). Each card edits
that crew row's steppers and, in the same card, an Area field + note that map to a
`work_performed` row **matched by the same trade** (`{trade, area, note}`); a
trade with no area/note simply has no work_performed row. Removing a trade removes
both its `crew` row and any matching `work_performed` row — an accepted tradeoff
(removing a crewed trade discards its work note; documented so it is intentional,
not a surprise). `flush()` on close flushes both drafts. "No crew today" marks the
crew section complete and clears both.

### Report-screen host

`app/report/[id]/index.tsx` updates:
- Render the section **rows** (groups + display modes) instead of one-per-kind.
- Refactor the per-kind `activeKind === …` conditional blocks into a small
  registry map `renderSheet(rowKey, props)` to keep hosting flat as sheet count
  grows (targeted cleanup of code we're already touching). `ENABLED_KINDS`
  (currently `['crew','general_notes']`, `index.tsx:44`) is superseded by the row
  model's display modes.
- Pass the loaded `crew` + `work_performed` payloads to `CrewWorkSheet`, and the
  `WeatherRow` to the read-only weather row.

## Per-sheet field spec

Pick-lists come from `src/components/report/sectionConstants.ts` — all already
exist (`TRADES`, `DELIVERY_UNITS`, `DELAY_CAUSES`, `VISITOR_ROLES`,
`INSPECTION_AGENCIES`, `SAFETY_TYPES`, `INSPECTION_RESULTS`) **except**
`EQUIPMENT_STATUS` (active/idle), added this increment. Shapes are in
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
  `TextField` · duration `Stepper` (0.5-day) **or** "Ongoing" toggle (nulls
  duration, disables the stepper) · note multiline (voice).
- **Safety** — "Nothing to report" affirmation **or** per row: type chips
  (`SAFETY_TYPES`) · description multiline (voice) · "Recordable incident"
  toggle (`is_incident`). Note: `SAFETY_TYPES` already includes a `recordable`
  observation type; that chip classifies the observation, while the `is_incident`
  toggle drives history/incident filters — they are distinct fields (label the
  toggle "Recordable incident" to reduce overlap confusion).

**Entry-list:**
- **Deliveries** — supplier `TextField` · material `TextField` · quantity
  `Stepper` · unit chips (`DELIVERY_UNITS`). (Ticket photo shortcut → M5.)
- **Inspections** — agency chips (`INSPECTION_AGENCIES`) · inspector `TextField` ·
  result three large chips (`INSPECTION_RESULTS`) · note multiline (voice).
- **Visitors** — name `TextField` · role chips (`VISITOR_ROLES`) · optional
  `HH:MM` time `TextField` (numeric).
- **RFIs** — copy "Questions and issues raised today."; title `TextField`
  (voice) · trade chips (`TRADES`) · "needs answer from" `TextField`.

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

Pure additions get unit tests: `summarizeCrewWork` extends `summarize.test.ts`;
the `sectionMeta` row-group model gets a new `src/report/sectionMeta.test.ts`.
`EntryCard` is logic-free, but a small render test follows the `Chip.test.tsx`
precedent for shared presentational components. Remaining sheets rely on the
shared archetype + typecheck/lint.

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
- `src/report/sectionMeta.test.ts` (row-group model)
- Sheet tests: `CrewWorkSheet.test.tsx`, `DeliveriesSectionSheet.test.tsx`,
  `SafetySectionSheet.test.tsx`

**Modified:**
- `src/report/sectionMeta.ts` — row-group model + per-row display mode.
- `src/report/summarize.ts` (+ `.test.ts`) — `summarizeCrewWork`.
- `src/components/report/ReportDetailSections.tsx` — render rows/groups; tri-state
  display mode (interactive / readonly / pending); weather read-only.
- `src/components/report/sectionConstants.ts` — add `EQUIPMENT_STATUS`.
- `app/report/[id]/index.tsx` — sheet registry, row model, pass crew+work/weather.

**Removed:** `src/components/report/CrewSectionSheet.tsx` (its Crew test folds into `CrewWorkSheet.test.tsx`).

## Verification gates

`npm run typecheck` · `eslint` · `prettier` · full `jest` · platform-split grep
(`src/platformSplit.test.ts`) — all green before commit. No native imports in the
web graph. Sheets stay presentational; policy logic (summaries, row-group model)
stays pure.

## Out of scope (this increment)

- M9 weather fetch (Open-Meteo edge function + project geocode) — weather is
  display-only until then.
- Manual weather override sheet + its `WEATHER_CONDITIONS` constant (deferred
  secondary action).
- Recents store; voice (M8); photo shortcuts (M5); carry-forward (M6).
- A read-only weather detail route (the weather row stays non-interactive).
