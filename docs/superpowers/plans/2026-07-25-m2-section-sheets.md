# M2 Remaining Section Sheets — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the nine remaining daily-report section editor sheets (Crew & work combined, Equipment, Delays, Safety, Deliveries, Inspections, Visitors, RFIs, Weather) on the existing report-detail screen, so a super can fill an entire report offline.

**Architecture:** Two archetypes carry the list sheets — relational (`{rows}`) and entry-list (`{entries}`) — plus a special Weather sheet (auto snapshot + manual override) and the already-built text sheet (Notes). Each sheet is bespoke, reuses the existing `SectionSheetScaffold` shell and a new tiny `EntryCard`, and autosaves through `useSectionDraft`. The report list is driven by a new `REPORT_ROWS` model that groups crew+work_performed into one row.

**Tech Stack:** Expo SDK 54 · React Native 0.81 · React 19 · TypeScript ~5.9 strict · Jest + @testing-library/react-native.

**Spec:** `docs/superpowers/specs/2026-07-25-m2-section-sheets-design.md`

## Global Constraints

- Working directory: `C:\Users\kubik\JOBSIGHT-SUITE\WorkLog`. Base branch: **`m2-report-detail-sections`** (already carries the report-detail slice, spec, and CI/gates as of `8e28a81`).
- `crew` and `work_performed` stay separate `SectionKind`s / server tables; the combined sheet just edits both, correlated by the `trade` string (content convention — `useSectionDraft` is keyed by `(reportId, section)`, no trade argument).
- All row/entry mutations are **immutable** (new array each edit). No `any` — use `unknown` + narrowing. No `console.log`.
- Autosave only: every sheet writes through `useSectionDraft` (~400ms debounce, `flush()` on close, `markComplete(true)` for deliberate-empty). No Save button.
- Deferred (do NOT build): recents chips, voice mic (M8, `accessory` slot stays empty), photo shortcuts (M5), carry-forward (M6), the M9 weather fetch.
- Verification gate on every task: `npm run typecheck` green, `npx eslint <changed files>` clean, `npx prettier --write <changed files>`, relevant `jest` green. Full gate before the final task: `npm run typecheck` · `npx jest` · `npx jest src/platformSplit.test.ts`.
- Commits: conventional format (`feat:`/`test:`/`refactor:`), no AI attribution.
- Section content shapes already exist in `src/data/sectionContent.ts` (`CrewContent`, `CrewRowContent`, `WorkPerformedContent`, `WorkPerformedRowContent`, `EquipmentContent`, `EquipmentRowContent`, `DelaysContent`, `DelayRowContent`, `SafetyContent`, `SafetyRowContent`, `DeliveriesContent`, `DeliveryEntry`, `InspectionsContent`, `InspectionEntry`, `VisitorsContent`, `VisitorEntry`, `RfisContent`, `RfiEntry`, `GeneralNotesContent`, `emptyContentFor`). `WeatherOverrideContent` (`{condition, tempF}`) is in `src/sync/types.ts`. `uuidv4()` is in `src/lib/uuid.ts`.
- Component APIs to reuse: `SectionSheetScaffold({visible,title,onClose,onNoneToday?,noneLabel?,footer?,children})`, `useSectionDraft<T>(reportId, section, initial) → {draft,setDraft,markComplete,flush}`, `Stepper({value,onChange,min?,max?,step?,unitLabel?,accessibilityLabel,formatValue?})`, `ChipRow` (single: `{options,value,onChange}`; multi: `{options,multi:true,values,onChange}`), `TextField({label,value,onChangeText,placeholder?,multiline?})`, `PrimaryButton({label,onPress,busy?})`, `useTheme()`.

---

### Task 1: Add `disabled` prop to Stepper

**Files:**
- Modify: `src/components/Stepper.tsx`
- Test: `src/components/Stepper.test.tsx`

**Interfaces:**
- Produces: `Stepper` accepts optional `disabled?: boolean`. When true, both buttons are non-interactive, the readout is muted, and neither press nor the accessibility increment/decrement actions call `onChange`.
- Consumed by: Task 11 (Delays "Ongoing").

- [ ] **Step 1: Write the failing test** — add to `src/components/Stepper.test.tsx`:

```tsx
import { fireEvent, render } from '@testing-library/react-native';
import { Stepper } from './Stepper';

test('disabled stepper ignores button presses', () => {
  const onChange = jest.fn();
  const { getByLabelText } = render(
    <Stepper value={3} onChange={onChange} disabled accessibilityLabel="Duration" />,
  );
  fireEvent.press(getByLabelText('Increase Duration'));
  fireEvent.press(getByLabelText('Decrease Duration'));
  expect(onChange).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx jest src/components/Stepper.test.tsx -t "disabled stepper"`
Expected: FAIL (currently `onChange` fires because there is no `disabled` gate).

- [ ] **Step 3: Implement** — in `src/components/Stepper.tsx`:
  1. Add `readonly disabled?: boolean;` to `Props`.
  2. Destructure `disabled = false`.
  3. Change bounds: `const atMin = disabled || value <= min;` and `const atMax = disabled || value >= max;`.
  4. In `decrement`/`increment`, first line `if (disabled) return;`.
  5. Readout color: `color: disabled ? colors.faint : colors.text`.
  6. On the root adjustable `View`, add `accessibilityState={{ disabled }}`.

- [ ] **Step 4: Run tests, verify pass**

Run: `npx jest src/components/Stepper.test.tsx`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/components/Stepper.tsx src/components/Stepper.test.tsx
git add src/components/Stepper.tsx src/components/Stepper.test.tsx
git commit -m "feat: add disabled prop to Stepper for the Delays Ongoing case"
```

---

### Task 2: EntryCard shared component

**Files:**
- Create: `src/components/report/EntryCard.tsx`
- Test: `src/components/report/EntryCard.test.tsx`
- Modify: `src/components/index.ts` (export)

**Interfaces:**
- Produces: `EntryCard({ title, onRemove, carried?, children })` — bordered card, header with `title` (+ " · from yesterday" when `carried`), a trash button (accessibilityLabel `Remove ${title}`) → `onRemove`, then `children`.
- Consumed by: every list sheet (Tasks 6, 8–14).

- [ ] **Step 1: Write the failing test** — `src/components/report/EntryCard.test.tsx`:

```tsx
import { fireEvent, render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { ThemeProvider } from '../../theme';
import { EntryCard } from './EntryCard';

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

test('renders title and fires onRemove', () => {
  const onRemove = jest.fn();
  const { getByText, getByLabelText } = wrap(
    <EntryCard title="Delivery 1" onRemove={onRemove}>
      <Text>body</Text>
    </EntryCard>,
  );
  expect(getByText('Delivery 1')).toBeTruthy();
  fireEvent.press(getByLabelText('Remove Delivery 1'));
  expect(onRemove).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx jest src/components/report/EntryCard.test.tsx`
Expected: FAIL ("Cannot find module './EntryCard'").

- [ ] **Step 3: Implement** — `src/components/report/EntryCard.tsx`:

```tsx
/**
 * EntryCard — the shared bordered card (title + trash + body) every list
 * section sheet repeats. Presentational only; no state.
 */
import { Ionicons } from '@expo/vector-icons';
import { type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../../theme';

type Props = {
  readonly title: string;
  readonly onRemove: () => void;
  /** Seeded by carry-forward (M6); dashed border + affix until touched. */
  readonly carried?: boolean;
  readonly children: ReactNode;
};

export function EntryCard({ title, onRemove, carried = false, children }: Props) {
  const { colors, fonts } = useTheme();
  return (
    <View
      style={[
        styles.card,
        { borderColor: colors.border, backgroundColor: colors.surface2 },
        carried && styles.carried,
      ]}
    >
      <View style={styles.head}>
        <Text style={[styles.title, { color: colors.text, fontFamily: fonts.ui.semibold }]}>
          {title}
          {carried ? (
            <Text style={[styles.affix, { color: colors.faint, fontFamily: fonts.ui.regular }]}>
              {'  · from yesterday'}
            </Text>
          ) : null}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove ${title}`}
          onPress={onRemove}
          hitSlop={8}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <Ionicons name="trash-outline" size={20} color={colors.faint} />
        </Pressable>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 10 },
  carried: { borderStyle: 'dashed' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 16 },
  affix: { fontSize: 12 },
  pressed: { opacity: 0.6 },
});
```

- [ ] **Step 4: Export** — add to `src/components/index.ts` under the report section:

```ts
export { EntryCard } from './report/EntryCard';
```

- [ ] **Step 5: Run tests + typecheck, verify pass**

Run: `npx jest src/components/report/EntryCard.test.tsx && npm run typecheck`
Expected: PASS + clean.

- [ ] **Step 6: Commit**

```bash
npx prettier --write "src/components/report/EntryCard.tsx" "src/components/report/EntryCard.test.tsx" "src/components/index.ts"
git add "src/components/report/EntryCard.tsx" "src/components/report/EntryCard.test.tsx" "src/components/index.ts"
git commit -m "feat: add shared EntryCard for section list sheets"
```

---

### Task 3: Section-constant additions

**Files:**
- Modify: `src/components/report/sectionConstants.ts`
- Modify: `src/components/index.ts` (export)

**Interfaces:**
- Produces: `EQUIPMENT_STATUS: readonly ChipOption[]` (active/idle) and `WEATHER_CONDITIONS: readonly ChipOption[]` (clear/cloudy/rain/snow/windy/fog).
- Consumed by: Task 7 (Weather), Task 10 (Equipment).

- [ ] **Step 1: Implement** — append to `src/components/report/sectionConstants.ts`:

```ts
/** Equipment on-site status (PRD §7 Equipment: idle/active). */
export const EQUIPMENT_STATUS: readonly ChipOption[] = [
  { value: 'active', label: 'Active' },
  { value: 'idle', label: 'Idle' },
] as const;

/** Weather condition chips for the manual override (PRD §7 Weather). */
export const WEATHER_CONDITIONS: readonly ChipOption[] = [
  { value: 'clear', label: 'Clear' },
  { value: 'cloudy', label: 'Cloudy' },
  { value: 'rain', label: 'Rain' },
  { value: 'snow', label: 'Snow' },
  { value: 'windy', label: 'Windy' },
  { value: 'fog', label: 'Fog' },
] as const;
```

- [ ] **Step 2: Export** — in `src/components/index.ts`, extend the existing `sectionConstants` re-export to include `EQUIPMENT_STATUS` and `WEATHER_CONDITIONS`.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
npx prettier --write "src/components/report/sectionConstants.ts" "src/components/index.ts"
git add "src/components/report/sectionConstants.ts" "src/components/index.ts"
git commit -m "feat: add EQUIPMENT_STATUS and WEATHER_CONDITIONS pick-lists"
```

---

### Task 4: summarizeCrewWork

**Files:**
- Modify: `src/report/summarize.ts`
- Test: `src/report/summarize.test.ts`

**Interfaces:**
- Produces: `summarizeCrewWork(crew: Json, work: Json, crewIsComplete: boolean): SectionSummary`.
- Consumed by: Task 15 (report screen builds the `crew_work` row summary).

- [ ] **Step 1: Write the failing test** — add to `src/report/summarize.test.ts`:

```ts
import { summarizeCrewWork } from './summarize';

describe('summarizeCrewWork', () => {
  const crew = {
    rows: [
      { id: '1', trade: 'Electrical', headcount: 4, hours: 8, is_carried_forward: false },
      { id: '2', trade: 'Plumbing', headcount: 2, hours: 8, is_carried_forward: false },
    ],
  };
  test('composes trades, headcount, and logged work', () => {
    const work = { rows: [{ id: 'w1', trade: 'Electrical', area: 'L3', note: 'pulled feeders' }] };
    expect(summarizeCrewWork(crew, work, false)).toEqual({
      text: '2 trades · 6 on site · 1 logged',
      state: 'filled',
    });
  });
  test('omits logged when no work rows', () => {
    expect(summarizeCrewWork(crew, { rows: [] }, false).text).toBe('2 trades · 6 on site');
  });
  test('empty + complete reads None today', () => {
    expect(summarizeCrewWork({ rows: [] }, { rows: [] }, true)).toEqual({
      text: 'None today',
      state: 'none',
    });
  });
  test('empty + not complete reads Tap to add', () => {
    expect(summarizeCrewWork({ rows: [] }, { rows: [] }, false).state).toBe('empty');
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx jest src/report/summarize.test.ts -t summarizeCrewWork`
Expected: FAIL ("summarizeCrewWork is not a function").

- [ ] **Step 3: Implement** — add to `src/report/summarize.ts` (reuses the module-private `listAt`, `numberOf`, `plural`, `fromCount` already defined there):

```ts
/** Combined summary for the crew + work_performed report row. */
export function summarizeCrewWork(crew: Json, work: Json, crewIsComplete: boolean): SectionSummary {
  const crewRows = listAt(crew, 'rows');
  const heads = crewRows.reduce<number>((sum, row) => sum + numberOf(row, 'headcount'), 0);
  const logged = listAt(work, 'rows').length;
  return fromCount(crewRows.length, crewIsComplete, () => {
    const base = `${plural(crewRows.length, 'trade')} · ${heads} on site`;
    return logged > 0 ? `${base} · ${logged} logged` : base;
  });
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npx jest src/report/summarize.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/report/summarize.ts src/report/summarize.test.ts
git add src/report/summarize.ts src/report/summarize.test.ts
git commit -m "feat: add summarizeCrewWork for the combined report row"
```

---

### Task 5: REPORT_ROWS row model in sectionMeta

**Files:**
- Modify: `src/report/sectionMeta.ts`
- Test: `src/report/sectionMeta.test.ts`

**Interfaces:**
- Produces: `type DisplayMode = 'interactive' | 'pending'`; `interface ReportRow { id, label, icon, kinds, mode }`; `REPORT_ROWS: readonly ReportRow[]`.
- Consumed by: Task 15 (`ReportDetailSections`, report screen). Existing `SECTION_META`/`sectionMetaFor` stay untouched.

- [ ] **Step 1: Write the failing test** — `src/report/sectionMeta.test.ts`:

```ts
import { SECTION_KINDS } from '../sync/types';
import { REPORT_ROWS } from './sectionMeta';

test('REPORT_ROWS covers every SectionKind exactly once', () => {
  const kinds = REPORT_ROWS.flatMap((r) => r.kinds);
  expect([...kinds].sort()).toEqual([...SECTION_KINDS].sort());
});

test('crew and work_performed share one row', () => {
  const row = REPORT_ROWS.find((r) => r.kinds.includes('crew'));
  expect(row?.kinds).toEqual(['crew', 'work_performed']);
});

test('row ids are unique', () => {
  const ids = REPORT_ROWS.map((r) => r.id);
  expect(new Set(ids).size).toBe(ids.length);
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx jest src/report/sectionMeta.test.ts`
Expected: FAIL ("REPORT_ROWS ... undefined").

- [ ] **Step 3: Implement** — add to `src/report/sectionMeta.ts` (the `Ionicons` and `SectionKind` imports already exist there):

```ts
export type DisplayMode = 'interactive' | 'pending';

export interface ReportRow {
  readonly id: string;
  readonly label: string;
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly kinds: readonly SectionKind[];
  readonly mode: DisplayMode;
}

/** Report-detail rows in PRD §7 display order; crew+work_performed grouped. */
export const REPORT_ROWS: readonly ReportRow[] = [
  { id: 'weather', label: 'Weather', icon: 'partly-sunny-outline', kinds: ['weather'], mode: 'interactive' },
  { id: 'crew_work', label: 'Crew & work by trade', icon: 'people-outline', kinds: ['crew', 'work_performed'], mode: 'interactive' },
  { id: 'deliveries', label: 'Deliveries', icon: 'cube-outline', kinds: ['deliveries'], mode: 'interactive' },
  { id: 'equipment', label: 'Equipment', icon: 'build-outline', kinds: ['equipment'], mode: 'interactive' },
  { id: 'inspections', label: 'Inspections', icon: 'clipboard-outline', kinds: ['inspections'], mode: 'interactive' },
  { id: 'safety', label: 'Safety', icon: 'shield-checkmark-outline', kinds: ['safety'], mode: 'interactive' },
  { id: 'delays', label: 'Delays & impacts', icon: 'time-outline', kinds: ['delays'], mode: 'interactive' },
  { id: 'visitors', label: 'Visitors', icon: 'walk-outline', kinds: ['visitors'], mode: 'interactive' },
  { id: 'rfis', label: 'RFIs / issues', icon: 'help-circle-outline', kinds: ['rfis'], mode: 'interactive' },
  { id: 'general_notes', label: 'General notes', icon: 'document-text-outline', kinds: ['general_notes'], mode: 'interactive' },
] as const;
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npx jest src/report/sectionMeta.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/report/sectionMeta.ts src/report/sectionMeta.test.ts
git add src/report/sectionMeta.ts src/report/sectionMeta.test.ts
git commit -m "feat: add REPORT_ROWS row model (crew+work grouped)"
```

---

### Task 6: CrewWorkSheet (relational archetype)

**Files:**
- Create: `src/components/report/CrewWorkSheet.tsx`
- Test: `src/components/report/CrewWorkSheet.test.tsx`

**Interfaces:**
- Produces: `CrewWorkSheet({ visible, reportId, initialCrew: CrewContent, initialWork: WorkPerformedContent, onClose })`.
- Consumed by: Task 15 (report-screen registry).

- [ ] **Step 1: Write the failing test** — `src/components/report/CrewWorkSheet.test.tsx`:

```tsx
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { CrewWorkSheet } from './CrewWorkSheet';

const updateSection = jest.fn().mockResolvedValue(undefined);
jest.mock('../../data', () => ({ useRepository: () => ({ updateSection }) }));

function renderSheet() {
  const { ThemeProvider } = jest.requireActual('../../theme');
  return render(
    <ThemeProvider>
      <CrewWorkSheet
        visible
        reportId="r1"
        initialCrew={{ rows: [] }}
        initialWork={{ rows: [] }}
        onClose={jest.fn()}
      />
    </ThemeProvider>,
  );
}

beforeEach(() => updateSection.mockClear());

test('adding a trade writes the crew section', async () => {
  const { getByLabelText } = renderSheet();
  fireEvent.press(getByLabelText('Electrical'));
  await waitFor(() =>
    expect(updateSection).toHaveBeenCalledWith('r1', 'crew', expect.anything(), false),
  );
});

test('No crew today marks crew complete', async () => {
  const { getByLabelText } = renderSheet();
  fireEvent.press(getByLabelText('No crew today'));
  await waitFor(() =>
    expect(updateSection).toHaveBeenCalledWith('r1', 'crew', expect.anything(), true),
  );
});
```

> Note: `useSectionDraft` debounces `setDraft` ~400ms but writes `markComplete` immediately; `waitFor` covers both. If the debounced assertion is flaky, wrap the trade-add case with `jest.useFakeTimers()` + `jest.advanceTimersByTime(400)`.

- [ ] **Step 2: Run it, verify it fails**

Run: `npx jest src/components/report/CrewWorkSheet.test.tsx`
Expected: FAIL ("Cannot find module './CrewWorkSheet'").

- [ ] **Step 3: Implement** — `src/components/report/CrewWorkSheet.tsx`:

```tsx
/**
 * CrewWorkSheet — Crew by trade + Work performed in one trade-centric sheet.
 * Two useSectionDraft instances (crew, work_performed) correlated by trade.
 */
import { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type {
  CrewContent,
  CrewRowContent,
  WorkPerformedContent,
  WorkPerformedRowContent,
} from '../../data/sectionContent';
import { uuidv4 } from '../../lib/uuid';
import { useTheme } from '../../theme';
import { ChipRow } from '../ChipRow';
import { PrimaryButton } from '../PrimaryButton';
import { Stepper } from '../Stepper';
import { TextField } from '../TextField';
import { EntryCard } from './EntryCard';
import { SectionSheetScaffold } from './SectionSheetScaffold';
import { TRADES } from './sectionConstants';
import { useSectionDraft } from './useSectionDraft';

const DEFAULT_HOURS = 8;
const MAX_HOURS = 24;

type Props = {
  readonly visible: boolean;
  readonly reportId: string;
  readonly initialCrew: CrewContent;
  readonly initialWork: WorkPerformedContent;
  readonly onClose: () => void;
};

export function CrewWorkSheet({ visible, reportId, initialCrew, initialWork, onClose }: Props) {
  const { colors, fonts, spacing } = useTheme();
  const crew = useSectionDraft<CrewContent>(reportId, 'crew', initialCrew);
  const work = useSectionDraft<WorkPerformedContent>(reportId, 'work_performed', initialWork);

  const setCrewRows = useCallback(
    (rows: readonly CrewRowContent[]) => crew.setDraft({ rows }),
    [crew],
  );
  const setWorkRows = useCallback(
    (rows: readonly WorkPerformedRowContent[]) => work.setDraft({ rows }),
    [work],
  );

  const addTrade = useCallback(
    (trade: string | null) => {
      if (!trade) return;
      setCrewRows([
        ...crew.draft.rows,
        { id: uuidv4(), trade, headcount: 1, hours: DEFAULT_HOURS, is_carried_forward: false },
      ]);
    },
    [crew.draft.rows, setCrewRows],
  );

  const updateCrew = useCallback(
    (trade: string, patch: Partial<CrewRowContent>) =>
      setCrewRows(crew.draft.rows.map((r) => (r.trade === trade ? { ...r, ...patch } : r))),
    [crew.draft.rows, setCrewRows],
  );

  const setWorkFor = useCallback(
    (trade: string, patch: Partial<Pick<WorkPerformedRowContent, 'area' | 'note'>>) => {
      const existing = work.draft.rows.find((r) => r.trade === trade);
      if (existing) {
        setWorkRows(work.draft.rows.map((r) => (r.trade === trade ? { ...r, ...patch } : r)));
      } else {
        setWorkRows([...work.draft.rows, { id: uuidv4(), trade, area: '', note: '', ...patch }]);
      }
    },
    [work.draft.rows, setWorkRows],
  );

  const removeTrade = useCallback(
    (trade: string) => {
      setCrewRows(crew.draft.rows.filter((r) => r.trade !== trade));
      setWorkRows(work.draft.rows.filter((r) => r.trade !== trade));
    },
    [crew.draft.rows, work.draft.rows, setCrewRows, setWorkRows],
  );

  const close = useCallback(() => {
    crew.flush();
    work.flush();
    onClose();
  }, [crew, work, onClose]);

  const noCrew = useCallback(() => {
    crew.markComplete(true);
    onClose();
  }, [crew, onClose]);

  const used = new Set(crew.draft.rows.map((r) => r.trade));
  const available = TRADES.filter((t) => !used.has(t)).map((t) => ({ value: t, label: t }));
  const workFor = (trade: string) => work.draft.rows.find((r) => r.trade === trade);

  return (
    <SectionSheetScaffold
      visible={visible}
      title="Crew & work by trade"
      onClose={close}
      onNoneToday={crew.draft.rows.length === 0 ? noCrew : undefined}
      noneLabel="No crew today"
      footer={<PrimaryButton label="Done" onPress={close} />}
    >
      {crew.draft.rows.map((row) => (
        <EntryCard
          key={row.id}
          title={row.trade}
          carried={row.is_carried_forward}
          onRemove={() => removeTrade(row.trade)}
        >
          <View style={[styles.steppers, { gap: spacing.xl }]}>
            <View style={styles.block}>
              <Text style={[styles.label, { color: colors.muted, fontFamily: fonts.ui.medium }]}>
                Workers
              </Text>
              <Stepper
                value={row.headcount}
                onChange={(headcount) => updateCrew(row.trade, { headcount })}
                min={0}
                accessibilityLabel={`${row.trade} worker count`}
              />
            </View>
            <View style={styles.block}>
              <Text style={[styles.label, { color: colors.muted, fontFamily: fonts.ui.medium }]}>
                Hours
              </Text>
              <Stepper
                value={row.hours}
                onChange={(hours) => updateCrew(row.trade, { hours })}
                min={0}
                max={MAX_HOURS}
                step={0.5}
                unitLabel="h"
                accessibilityLabel={`${row.trade} hours`}
              />
            </View>
          </View>
          <TextField
            label="Area"
            value={workFor(row.trade)?.area ?? ''}
            onChangeText={(area) => setWorkFor(row.trade, { area })}
            placeholder="Where on site"
          />
          <TextField
            label="What was done"
            value={workFor(row.trade)?.note ?? ''}
            onChangeText={(note) => setWorkFor(row.trade, { note })}
            placeholder="Describe today's work"
            multiline
          />
        </EntryCard>
      ))}

      {available.length > 0 ? (
        <View style={styles.add}>
          <Text style={[styles.addLabel, { color: colors.muted, fontFamily: fonts.ui.semibold }]}>
            {crew.draft.rows.length === 0 ? 'Add a trade' : 'Add another trade'}
          </Text>
          <ChipRow options={available} value={null} onChange={addTrade} />
        </View>
      ) : null}
    </SectionSheetScaffold>
  );
}

const styles = StyleSheet.create({
  steppers: { flexDirection: 'row', flexWrap: 'wrap' },
  block: { gap: 6 },
  label: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 },
  add: { gap: 8, marginTop: 4 },
  addLabel: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 },
});
```

- [ ] **Step 4: Run tests + typecheck, verify pass**

Run: `npx jest src/components/report/CrewWorkSheet.test.tsx && npm run typecheck`
Expected: PASS + clean. (If the debounced add-trade assertion is flaky, apply the fake-timers note from Step 1.)

- [ ] **Step 5: Commit**

```bash
npx prettier --write "src/components/report/CrewWorkSheet.tsx" "src/components/report/CrewWorkSheet.test.tsx"
git add "src/components/report/CrewWorkSheet.tsx" "src/components/report/CrewWorkSheet.test.tsx"
git commit -m "feat: add combined CrewWorkSheet (crew + work_performed)"
```

---

### Task 7: WeatherSectionSheet (special)

**Files:**
- Create: `src/components/report/WeatherSectionSheet.tsx`
- Test: `src/components/report/WeatherSectionSheet.test.tsx`

**Interfaces:**
- Produces: `WeatherSectionSheet({ visible, reportId, initialWeather: WeatherRow | null, onClose })`. Derives the override initial from `initialWeather.override_condition/override_temp_f`; writes `WeatherOverrideContent` via `updateSection('weather', …)`.
- Consumed by: Task 15.

- [ ] **Step 1: Write the failing test** — `src/components/report/WeatherSectionSheet.test.tsx`:

```tsx
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { WeatherSectionSheet } from './WeatherSectionSheet';

const updateSection = jest.fn().mockResolvedValue(undefined);
jest.mock('../../data', () => ({ useRepository: () => ({ updateSection }) }));

test('choosing a condition writes the weather override', async () => {
  const { ThemeProvider } = jest.requireActual('../../theme');
  const { getByLabelText } = render(
    <ThemeProvider>
      <WeatherSectionSheet visible reportId="r1" initialWeather={null} onClose={jest.fn()} />
    </ThemeProvider>,
  );
  fireEvent.press(getByLabelText('Rain'));
  await waitFor(() =>
    expect(updateSection).toHaveBeenCalledWith(
      'r1',
      'weather',
      expect.objectContaining({ condition: 'rain' }),
      false,
    ),
  );
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx jest src/components/report/WeatherSectionSheet.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement** — `src/components/report/WeatherSectionSheet.tsx`:

```tsx
/**
 * WeatherSectionSheet — read-only auto snapshot + always-available manual
 * override (PRD weather Must). Override writes WeatherOverrideContent; the
 * auto fetch (M9) never overwrites it.
 */
import { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { WeatherRow } from '../../data/types';
import type { WeatherOverrideContent } from '../../sync/types';
import { useTheme } from '../../theme';
import { ChipRow } from '../ChipRow';
import { PrimaryButton } from '../PrimaryButton';
import { Stepper } from '../Stepper';
import { SectionSheetScaffold } from './SectionSheetScaffold';
import { WEATHER_CONDITIONS } from './sectionConstants';
import { useSectionDraft } from './useSectionDraft';

const MIN_F = -30;
const MAX_F = 130;
const DEFAULT_F = 60;

type Props = {
  readonly visible: boolean;
  readonly reportId: string;
  readonly initialWeather: WeatherRow | null;
  readonly onClose: () => void;
};

export function WeatherSectionSheet({ visible, reportId, initialWeather, onClose }: Props) {
  const { colors, fonts } = useTheme();
  const initial: WeatherOverrideContent = {
    condition: initialWeather?.override_condition ?? null,
    tempF: initialWeather?.override_temp_f ?? null,
  };
  const { draft, setDraft, flush } = useSectionDraft<WeatherOverrideContent>(
    reportId,
    'weather',
    initial,
  );

  const autoCondition = initialWeather?.auto_condition ?? null;
  const autoTemp = initialWeather?.auto_temp_f ?? null;
  const autoText =
    autoCondition || typeof autoTemp === 'number'
      ? [autoCondition, typeof autoTemp === 'number' ? `${Math.round(autoTemp)}°F` : null]
          .filter(Boolean)
          .join(' · ')
      : 'Will fill on next sync';

  const close = useCallback(() => {
    flush();
    onClose();
  }, [flush, onClose]);

  return (
    <SectionSheetScaffold
      visible={visible}
      title="Weather"
      onClose={close}
      footer={<PrimaryButton label="Done" onPress={close} />}
    >
      <View style={[styles.auto, { borderColor: colors.border, backgroundColor: colors.surface2 }]}>
        <Text style={[styles.autoLabel, { color: colors.muted, fontFamily: fonts.ui.medium }]}>
          Auto-fetched
        </Text>
        <Text style={[styles.autoText, { color: colors.text, fontFamily: fonts.ui.semibold }]}>
          {autoText}
        </Text>
      </View>

      <Text style={[styles.label, { color: colors.muted, fontFamily: fonts.ui.semibold }]}>
        Condition (manual override)
      </Text>
      <ChipRow
        options={WEATHER_CONDITIONS}
        value={draft.condition}
        onChange={(condition) => setDraft({ ...draft, condition })}
      />

      <Text style={[styles.label, { color: colors.muted, fontFamily: fonts.ui.semibold }]}>
        Temperature
      </Text>
      <Stepper
        value={draft.tempF ?? DEFAULT_F}
        onChange={(tempF) => setDraft({ ...draft, tempF })}
        min={MIN_F}
        max={MAX_F}
        unitLabel="°F"
        accessibilityLabel="Temperature"
      />

      <Text style={[styles.hint, { color: colors.faint, fontFamily: fonts.ui.regular }]}>
        A manual override is never overwritten by the automatic fetch.
      </Text>
    </SectionSheetScaffold>
  );
}

const styles = StyleSheet.create({
  auto: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 4 },
  autoLabel: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 },
  autoText: { fontSize: 16 },
  label: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 4 },
  hint: { fontSize: 13, marginTop: 4 },
});
```

- [ ] **Step 4: Run tests + typecheck, verify pass**

Run: `npx jest src/components/report/WeatherSectionSheet.test.tsx && npm run typecheck`
Expected: PASS + clean.

- [ ] **Step 5: Commit**

```bash
npx prettier --write "src/components/report/WeatherSectionSheet.tsx" "src/components/report/WeatherSectionSheet.test.tsx"
git add "src/components/report/WeatherSectionSheet.tsx" "src/components/report/WeatherSectionSheet.test.tsx"
git commit -m "feat: add WeatherSectionSheet (auto snapshot + manual override)"
```

---

### Task 8: DeliveriesSectionSheet (entry-list archetype)

**Files:**
- Create: `src/components/report/DeliveriesSectionSheet.tsx`
- Test: `src/components/report/DeliveriesSectionSheet.test.tsx`

**Interfaces:**
- Produces: `DeliveriesSectionSheet({ visible, reportId, initial: DeliveriesContent, onClose })`.
- Consumed by: Task 15.

- [ ] **Step 1: Write the failing test** — `src/components/report/DeliveriesSectionSheet.test.tsx`:

```tsx
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { DeliveriesSectionSheet } from './DeliveriesSectionSheet';

const updateSection = jest.fn().mockResolvedValue(undefined);
jest.mock('../../data', () => ({ useRepository: () => ({ updateSection }) }));

test('Add delivery writes an entry', async () => {
  const { ThemeProvider } = jest.requireActual('../../theme');
  const { getByLabelText } = render(
    <ThemeProvider>
      <DeliveriesSectionSheet visible reportId="r1" initial={{ entries: [] }} onClose={jest.fn()} />
    </ThemeProvider>,
  );
  fireEvent.press(getByLabelText('Add delivery'));
  await waitFor(() =>
    expect(updateSection).toHaveBeenCalledWith('r1', 'deliveries', expect.anything(), false),
  );
});
```

- [ ] **Step 2: Run it, verify it fails** — `npx jest src/components/report/DeliveriesSectionSheet.test.tsx` → FAIL (module missing).

- [ ] **Step 3: Implement** — `src/components/report/DeliveriesSectionSheet.tsx`. This is the **entry-list archetype**; later sibling tasks mirror it exactly, swapping only the entry shape, pick-lists, and per-entry fields.

```tsx
/** DeliveriesSectionSheet — entry-list archetype (PRD §7 Deliveries). */
import { Ionicons } from '@expo/vector-icons';
import { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { DeliveriesContent, DeliveryEntry } from '../../data/sectionContent';
import { uuidv4 } from '../../lib/uuid';
import { useTheme } from '../../theme';
import { ChipRow } from '../ChipRow';
import { PrimaryButton } from '../PrimaryButton';
import { Stepper } from '../Stepper';
import { TextField } from '../TextField';
import { EntryCard } from './EntryCard';
import { SectionSheetScaffold } from './SectionSheetScaffold';
import { DELIVERY_UNITS } from './sectionConstants';
import { useSectionDraft } from './useSectionDraft';

type Props = {
  readonly visible: boolean;
  readonly reportId: string;
  readonly initial: DeliveriesContent;
  readonly onClose: () => void;
};

export function DeliveriesSectionSheet({ visible, reportId, initial, onClose }: Props) {
  const { colors, fonts } = useTheme();
  const { draft, setDraft, flush } = useSectionDraft<DeliveriesContent>(
    reportId,
    'deliveries',
    initial,
  );
  const setEntries = useCallback(
    (entries: readonly DeliveryEntry[]) => setDraft({ entries }),
    [setDraft],
  );
  const add = useCallback(
    () =>
      setEntries([
        ...draft.entries,
        { id: uuidv4(), supplier: '', material: '', quantity: 1, unit: 'loads' },
      ]),
    [draft.entries, setEntries],
  );
  const update = useCallback(
    (id: string, patch: Partial<DeliveryEntry>) =>
      setEntries(draft.entries.map((e) => (e.id === id ? { ...e, ...patch } : e))),
    [draft.entries, setEntries],
  );
  const remove = useCallback(
    (id: string) => setEntries(draft.entries.filter((e) => e.id !== id)),
    [draft.entries, setEntries],
  );
  const close = useCallback(() => {
    flush();
    onClose();
  }, [flush, onClose]);

  return (
    <SectionSheetScaffold
      visible={visible}
      title="Deliveries"
      onClose={close}
      footer={<PrimaryButton label="Done" onPress={close} />}
    >
      {draft.entries.map((entry, i) => (
        <EntryCard key={entry.id} title={`Delivery ${i + 1}`} onRemove={() => remove(entry.id)}>
          <TextField
            label="Supplier"
            value={entry.supplier}
            onChangeText={(supplier) => update(entry.id, { supplier })}
          />
          <TextField
            label="Material"
            value={entry.material}
            onChangeText={(material) => update(entry.id, { material })}
          />
          <Text style={[styles.label, { color: colors.muted, fontFamily: fonts.ui.medium }]}>
            Quantity
          </Text>
          <Stepper
            value={entry.quantity}
            onChange={(quantity) => update(entry.id, { quantity })}
            min={0}
            accessibilityLabel={`Delivery ${i + 1} quantity`}
          />
          <ChipRow
            options={DELIVERY_UNITS}
            value={entry.unit}
            onChange={(unit) => update(entry.id, { unit: unit ?? 'loads' })}
          />
        </EntryCard>
      ))}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add delivery"
        onPress={add}
        style={({ pressed }) => [
          styles.addBtn,
          { borderColor: colors.border },
          pressed && styles.pressed,
        ]}
      >
        <Ionicons name="add" size={18} color={colors.accent} />
        <Text style={[styles.addText, { color: colors.accent, fontFamily: fonts.ui.semibold }]}>
          Add delivery
        </Text>
      </Pressable>
    </SectionSheetScaffold>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 },
  addBtn: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 14,
    padding: 12,
  },
  addText: { fontSize: 14 },
  pressed: { opacity: 0.8 },
});
```

- [ ] **Step 4: Run tests + typecheck** — `npx jest src/components/report/DeliveriesSectionSheet.test.tsx && npm run typecheck` → PASS + clean.

- [ ] **Step 5: Commit**

```bash
npx prettier --write "src/components/report/DeliveriesSectionSheet.tsx" "src/components/report/DeliveriesSectionSheet.test.tsx"
git add "src/components/report/DeliveriesSectionSheet.tsx" "src/components/report/DeliveriesSectionSheet.test.tsx"
git commit -m "feat: add DeliveriesSectionSheet (entry-list archetype)"
```

---

### Task 9: SafetySectionSheet (relational + affirmation)

**Files:**
- Create: `src/components/report/SafetySectionSheet.tsx`
- Test: `src/components/report/SafetySectionSheet.test.tsx`

**Interfaces:**
- Produces: `SafetySectionSheet({ visible, reportId, initial: SafetyContent, onClose })`.
- Consumed by: Task 15.

- [ ] **Step 1: Write the failing test** — `src/components/report/SafetySectionSheet.test.tsx`:

```tsx
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { SafetySectionSheet } from './SafetySectionSheet';

const updateSection = jest.fn().mockResolvedValue(undefined);
jest.mock('../../data', () => ({ useRepository: () => ({ updateSection }) }));

test('Nothing to report marks the section complete', async () => {
  const { ThemeProvider } = jest.requireActual('../../theme');
  const { getByLabelText } = render(
    <ThemeProvider>
      <SafetySectionSheet visible reportId="r1" initial={{ rows: [] }} onClose={jest.fn()} />
    </ThemeProvider>,
  );
  fireEvent.press(getByLabelText('Nothing to report'));
  await waitFor(() =>
    expect(updateSection).toHaveBeenCalledWith('r1', 'safety', expect.anything(), true),
  );
});
```

- [ ] **Step 2: Run it, verify it fails** — FAIL (module missing).

- [ ] **Step 3: Implement** — `src/components/report/SafetySectionSheet.tsx`. **Relational archetype** — copy the `useSectionDraft` + `setEntries`-equivalent (`setRows`) + `add`/`update`/`remove`/`close` structure and the dashed "Add …" `Pressable` **verbatim from Task 8**, changing: content type `SafetyContent`, section `'safety'`, list key `rows` of `SafetyRowContent` (`{id, obs_type, description, is_incident}`), `EntryCard` title `Observation ${i + 1}`, add-button label "Add observation", new row `{id: uuidv4(), obs_type: '', description: '', is_incident: false}`. Add `markComplete` to the destructure. Per-card fields:
  - Type: `ChipRow` single over `SAFETY_TYPES` — `value={row.obs_type || null}`, `onChange={(v) => update(row.id, { obs_type: v ?? '' })}`.
  - Description: `TextField multiline` — `value={row.description ?? ''}`, `onChangeText={(v) => update(row.id, { description: v || null })}`.
  - Incident: RN `Switch` (`import { Switch } from 'react-native'`) — `value={row.is_incident}`, `onValueChange={(is_incident) => update(row.id, { is_incident })}`, `trackColor={{ true: colors.accent, false: colors.surface2 }}`, `thumbColor={colors.surface}`, `accessibilityLabel="Recordable incident"`; with an adjacent caption `Text` "Recordable incident".
  Wire the scaffold: `onNoneToday={draft.rows.length === 0 ? () => { markComplete(true); onClose(); } : undefined}`, `noneLabel="Nothing to report"`.

- [ ] **Step 4: Run tests + typecheck** — PASS + clean.

- [ ] **Step 5: Commit**

```bash
npx prettier --write "src/components/report/SafetySectionSheet.tsx" "src/components/report/SafetySectionSheet.test.tsx"
git add "src/components/report/SafetySectionSheet.tsx" "src/components/report/SafetySectionSheet.test.tsx"
git commit -m "feat: add SafetySectionSheet (relational + affirmation)"
```

---

### Task 10: EquipmentSectionSheet

**Files:**
- Create: `src/components/report/EquipmentSectionSheet.tsx`

**Interfaces:**
- Produces: `EquipmentSectionSheet({ visible, reportId, initial: EquipmentContent, onClose })`. Consumed by Task 15.

Follow the **entry-list archetype structure from Task 8** (same `useSectionDraft` + `setRows` + `update`/`remove`/`close` + dashed add-button), with content type `EquipmentContent`, section `'equipment'`, list key `rows` of `EquipmentRowContent` `{id, name, status, on_site}`, `EntryCard` titled by `row.name`.

- [ ] **Step 1: Implement** with these specifics:
  - **Add-by-name** (replaces the picker): a local `const [pendingName, setPendingName] = useState('')`; a `TextField` bound to it + an "Add equipment" `Pressable` (accessibilityLabel "Add equipment"); on press, if `pendingName.trim()`, `setRows([...draft.rows, {id: uuidv4(), name: pendingName.trim(), status: 'active', on_site: true}])` then `setPendingName('')`.
  - Per card: on-site RN `Switch` (`value={row.on_site}`, `onValueChange={(on_site) => update(row.id, { on_site })}`, themed as in Task 9, `accessibilityLabel={`${row.name} on site`}`) + status `ChipRow` single over `EQUIPMENT_STATUS` (`value={row.status}`, `onChange={(status) => update(row.id, { status: status ?? 'active' })}`).
  - No "None today" affirmation.
- [ ] **Step 2: Typecheck + lint** — `npm run typecheck && npx eslint src/components/report/EquipmentSectionSheet.tsx` → clean.
- [ ] **Step 3: Commit**

```bash
npx prettier --write "src/components/report/EquipmentSectionSheet.tsx"
git add "src/components/report/EquipmentSectionSheet.tsx"
git commit -m "feat: add EquipmentSectionSheet"
```

---

### Task 11: DelaysSectionSheet

**Files:**
- Create: `src/components/report/DelaysSectionSheet.tsx`

**Interfaces:**
- Produces: `DelaysSectionSheet({ visible, reportId, initial: DelaysContent, onClose })`. Consumed by Task 15.

Follow the **entry-list archetype structure from Task 8** with content type `DelaysContent`, section `'delays'`, list key `rows` of `DelayRowContent` `{id, cause, responsible_party, duration_hours, is_ongoing, note}`, `EntryCard` titled `Delay ${i + 1}`, add-button "Add delay" (new row `{id: uuidv4(), cause: '', responsible_party: null, duration_hours: 0.5, is_ongoing: false, note: null}`).

- [ ] **Step 1: Implement** per-card fields:
  - Cause: `ChipRow` single over `DELAY_CAUSES` (`value={row.cause || null}`, `onChange={(v) => update(row.id, { cause: v ?? '' })}`).
  - Responsible party: `TextField` (`value={row.responsible_party ?? ''}`, `onChangeText={(v) => update(row.id, { responsible_party: v || null })}`).
  - Duration `Stepper` (`value={row.duration_hours ?? 0}`, `step={0.5}`, `min={0}`, `unitLabel="days"`, `disabled={row.is_ongoing}`, `onChange={(duration_hours) => update(row.id, { duration_hours })}`, `accessibilityLabel={`Delay ${i + 1} duration`}`).
  - Ongoing: RN `Switch` (`accessibilityLabel="Ongoing"`, themed as Task 9) — `onValueChange={(is_ongoing) => update(row.id, { is_ongoing, duration_hours: is_ongoing ? null : (row.duration_hours ?? 0.5) })}` (toggling on nulls the duration; the stepper's `disabled` from Task 1 grays it).
  - Note: `TextField multiline` (`value={row.note ?? ''}`, `onChangeText={(v) => update(row.id, { note: v || null })}`).
- [ ] **Step 2: Typecheck + lint** → clean.
- [ ] **Step 3: Commit**

```bash
npx prettier --write "src/components/report/DelaysSectionSheet.tsx"
git add "src/components/report/DelaysSectionSheet.tsx"
git commit -m "feat: add DelaysSectionSheet (ongoing disables duration)"
```

---

### Task 12: InspectionsSectionSheet

**Files:**
- Create: `src/components/report/InspectionsSectionSheet.tsx`

**Interfaces:**
- Produces: `InspectionsSectionSheet({ visible, reportId, initial: InspectionsContent, onClose })`. Consumed by Task 15.

Follow the **entry-list archetype from Task 8** with content type `InspectionsContent`, section `'inspections'`, list key `entries` of `InspectionEntry` `{id, agency, inspector, result, note}`, `EntryCard` titled `Inspection ${i + 1}`, add-button "Add inspection" (new entry `{id: uuidv4(), agency: '', inspector: null, result: 'passed', note: null}`).

- [ ] **Step 1: Implement** per-entry fields:
  - Agency: `ChipRow` single over `INSPECTION_AGENCIES` (`value={entry.agency || null}`, `onChange={(v) => update(entry.id, { agency: v ?? '' })}`).
  - Inspector: `TextField` (`value={entry.inspector ?? ''}`, `onChangeText={(v) => update(entry.id, { inspector: v || null })}`).
  - Result: `ChipRow` single over `INSPECTION_RESULTS` (`value={entry.result}`, `onChange={(v) => update(entry.id, { result: (v ?? 'passed') as InspectionEntry['result'] })}`).
  - Note: `TextField multiline` (`value={entry.note ?? ''}`, `onChangeText={(v) => update(entry.id, { note: v || null })}`).
- [ ] **Step 2: Typecheck + lint** → clean.
- [ ] **Step 3: Commit**

```bash
npx prettier --write "src/components/report/InspectionsSectionSheet.tsx"
git add "src/components/report/InspectionsSectionSheet.tsx"
git commit -m "feat: add InspectionsSectionSheet"
```

---

### Task 13: VisitorsSectionSheet

**Files:**
- Create: `src/components/report/VisitorsSectionSheet.tsx`

**Interfaces:**
- Produces: `VisitorsSectionSheet({ visible, reportId, initial: VisitorsContent, onClose })`. Consumed by Task 15.

Follow the **entry-list archetype from Task 8** with content type `VisitorsContent`, section `'visitors'`, list key `entries` of `VisitorEntry` `{id, name, role, time}`, `EntryCard` titled `Visitor ${i + 1}`, add-button "Add visitor" (new entry `{id: uuidv4(), name: '', role: '', time: null}`).

- [ ] **Step 1: Implement** per-entry fields:
  - Name: `TextField` (`value={entry.name}`, `onChangeText={(name) => update(entry.id, { name })}`).
  - Role: `ChipRow` single over `VISITOR_ROLES` (`value={entry.role || null}`, `onChange={(v) => update(entry.id, { role: v ?? '' })}`).
  - Time: `TextField` (`value={entry.time ?? ''}`, `onChangeText={(v) => update(entry.id, { time: v || null })}`, `placeholder="HH:MM"`, `keyboardType="numbers-and-punctuation"`).
- [ ] **Step 2: Typecheck + lint** → clean.
- [ ] **Step 3: Commit**

```bash
npx prettier --write "src/components/report/VisitorsSectionSheet.tsx"
git add "src/components/report/VisitorsSectionSheet.tsx"
git commit -m "feat: add VisitorsSectionSheet"
```

---

### Task 14: RfisSectionSheet

**Files:**
- Create: `src/components/report/RfisSectionSheet.tsx`

**Interfaces:**
- Produces: `RfisSectionSheet({ visible, reportId, initial: RfisContent, onClose })`. Consumed by Task 15.

Follow the **entry-list archetype from Task 8** with content type `RfisContent`, section `'rfis'`, list key `entries` of `RfiEntry` `{id, title, trade, needs_answer_from}`, `EntryCard` titled `Item ${i + 1}`, add-button "Add item" (new entry `{id: uuidv4(), title: '', trade: null, needs_answer_from: null}`). Render a muted caption `Text` "Questions and issues raised today." as the first child of the scaffold body.

- [ ] **Step 1: Implement** per-entry fields:
  - Title: `TextField` (`value={entry.title}`, `onChangeText={(title) => update(entry.id, { title })}`).
  - Trade: `ChipRow` single over `TRADES.map((t) => ({ value: t, label: t }))` (`value={entry.trade}`, `onChange={(trade) => update(entry.id, { trade })}`).
  - Needs answer from: `TextField` (`value={entry.needs_answer_from ?? ''}`, `onChangeText={(v) => update(entry.id, { needs_answer_from: v || null })}`).
- [ ] **Step 2: Typecheck + lint** → clean.
- [ ] **Step 3: Commit**

```bash
npx prettier --write "src/components/report/RfisSectionSheet.tsx"
git add "src/components/report/RfisSectionSheet.tsx"
git commit -m "feat: add RfisSectionSheet"
```

---

### Task 15: Integrate row model + wire all sheets into the report screen

**Files:**
- Modify: `src/components/report/ReportDetailSections.tsx`
- Modify: `app/report/[id]/index.tsx`
- Remove: `src/components/report/CrewSectionSheet.tsx`
- Modify: `src/components/index.ts` (if it re-exports `CrewSectionSheet` — drop it; the screen imports sheets by path)

**Interfaces:**
- Consumes: `REPORT_ROWS`/`ReportRow` (Task 5), `summarizeCrewWork` (Task 4), all sheets (Tasks 6–14).
- Produces: the fully wired report screen; `ReportDetailSections` now takes `rows: readonly ReportRow[]`, `summaries: Record<string, SectionSummary>` (keyed by `ReportRow.id`), `onOpen: (rowId: string) => void`.

This task is atomic (component prop change + host rewrite + deletion must land together to keep typecheck green).

- [ ] **Step 1: Rewrite `ReportDetailSections.tsx`** to iterate `REPORT_ROWS`:
  - New `Props`: `{ rows: readonly ReportRow[]; summaries: Record<string, SectionSummary>; onOpen: (rowId: string) => void }`.
  - For each row: `const summary = summaries[row.id]`; `const isInteractive = row.mode === 'interactive'`. Render the same `SheetRow` markup as today (leading `row.icon`, label `row.label`, summary line tinted by `summary.state` via the existing color logic), but: interactive → chevron trailing + `onPress={() => onOpen(row.id)}`; `pending` → wrap in the dimmed style + "Soon" trailing + no-op `onPress`.
  - Replace the `enabledKinds`/`SECTION_META` imports with `REPORT_ROWS`/`ReportRow` from `../../report/sectionMeta` (keep the `SectionSummary` import from `../../report/summarize`).

- [ ] **Step 2: Rewrite the sheet-hosting + summaries in `app/report/[id]/index.tsx`:**
  - Build `summaries: Record<string, SectionSummary>` by iterating `REPORT_ROWS`: for `row.id === 'weather'` use `summarizeWeather(data?.weather ?? null)`; for `row.id === 'crew_work'` use `summarizeCrewWork(sectionByKind.get('crew')?.payload ?? null, sectionByKind.get('work_performed')?.payload ?? null, sectionByKind.get('crew')?.is_complete ?? false)`; else `summarizeSection(row.kinds[0] as Exclude<SectionKind,'weather'>, r?.payload ?? null, r?.is_complete ?? false)` where `r = sectionByKind.get(row.kinds[0])`.
  - Replace `activeKind: SectionKind | null` state with `activeRowId: string | null`; `closeSheet` sets it to `null` and calls `reload()`.
  - Replace the two `activeKind === …` blocks with a per-`activeRowId` render (a `switch`/lookup) mounting the matching sheet with `key={`${activeRowId}:${reportId}`}`, `visible`, `onClose={closeSheet}`, and initials via the existing `contentFor<T>(kind)` helper:
    - `crew_work` → `<CrewWorkSheet initialCrew={contentFor<CrewContent>('crew')} initialWork={contentFor<WorkPerformedContent>('work_performed')} …/>`
    - `weather` → `<WeatherSectionSheet initialWeather={data?.weather ?? null} …/>`
    - `deliveries`→`DeliveriesSectionSheet`, `equipment`→`EquipmentSectionSheet`, `inspections`→`InspectionsSectionSheet`, `safety`→`SafetySectionSheet`, `delays`→`DelaysSectionSheet`, `visitors`→`VisitorsSectionSheet`, `rfis`→`RfisSectionSheet`, `general_notes`→`NotesSectionSheet`, each with `initial={contentFor<XContent>(kind)}`.
  - Pass `rows={REPORT_ROWS}` `summaries={summaries}` `onOpen={setActiveRowId}` to `ReportDetailSections`. Delete `ENABLED_KINDS` and the `CrewSectionSheet` import; add imports for the eight new sheets + `summarizeCrewWork` + the extra content types (`CrewContent`, `WorkPerformedContent`, `DeliveriesContent`, etc.) from `../../../src/data/sectionContent`.

- [ ] **Step 3: Delete the retired sheet**

```bash
git rm "src/components/report/CrewSectionSheet.tsx"
```
Remove any `CrewSectionSheet` re-export from `src/components/index.ts`.

- [ ] **Step 4: Full verification**

Run: `npm run typecheck && npx eslint "app/report/[id]/index.tsx" "src/components/report/ReportDetailSections.tsx" && npx jest && npx jest src/platformSplit.test.ts`
Expected: typecheck clean, lint clean, all jest suites pass, platform-split grep returns nothing.

- [ ] **Step 5: Prettier + commit**

```bash
npx prettier --write "app/report/[id]/index.tsx" "src/components/report/ReportDetailSections.tsx" "src/components/index.ts"
git add -A
git commit -m "feat: wire all M2 section sheets into the report screen via REPORT_ROWS"
```

---

## Definition of Done

- All 10 report rows render with live summaries; every row opens its editor sheet (Weather included); crew + work_performed edit in one sheet and write both sections.
- `npm run typecheck` green under strict; `npx jest` green (incl. new CrewWork/Deliveries/Safety/Weather interaction tests, `summarizeCrewWork`, `sectionMeta`, `Stepper.disabled`, `EntryCard`); `npx jest src/platformSplit.test.ts` green.
- No `CrewSectionSheet` remains; no `console.log`; no `any`.
- Deferred items (recents, voice, photos, carry-forward, M9 fetch) are absent by design.
