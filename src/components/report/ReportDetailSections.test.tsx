/**
 * `ReportDetailSections` was at 0% (#24) — the report-detail body, and the file
 * that generates every `report-section-*` testID `.maestro/report-sections.yaml`
 * taps. It is the only untested module in that bucket with a real consumer
 * (`app/report/[id]/index.tsx`), so it is the one worth doing.
 *
 * The load-bearing test here is the last one. `src/maestroSelectors.test.ts`
 * gives `report-section-` a blanket DYNAMIC_TESTIDS exemption: it proves the
 * prefix appears in this file's source, and then every id starting with it is
 * waved through. So the flow could tap `report-section-genral_notes` and the
 * guard would stay green — the #11 hole, in a different family. That check is
 * source text and cannot render; this file can, so the render half belongs here.
 */
import { Ionicons } from '@expo/vector-icons';
import { fireEvent, render } from '@testing-library/react-native';
import * as fs from 'fs';
import * as path from 'path';

import type { ReportRow } from '../../report/sectionMeta';
import { REPORT_ROWS } from '../../report/sectionMeta';
import type { SectionSummary } from '../../report/summarize';
import { ThemeProvider } from '../../theme';
import { ReportDetailSections } from './ReportDetailSections';

const EMPTY: SectionSummary = { text: 'Tap to add', state: 'empty' };
const NONE: SectionSummary = { text: 'None today', state: 'none' };
const FILLED: SectionSummary = { text: '3 trades · 26 on site', state: 'filled' };

/**
 * `summaries` must be TOTAL over `rows` — the component reads
 * `summaries[row.id]` and dereferences it unguarded. The real caller builds the
 * map by walking the same `REPORT_ROWS`, so this mirrors that contract rather
 * than papering over it.
 */
function summariesFor(
  rows: readonly ReportRow[],
  summary: SectionSummary = EMPTY,
): Record<string, SectionSummary> {
  return Object.fromEntries(rows.map((row) => [row.id, summary]));
}

function renderRows(
  rows: readonly ReportRow[],
  summaries: Record<string, SectionSummary> = summariesFor(rows),
  onOpen: (rowId: string) => void = jest.fn(),
) {
  return {
    onOpen,
    ...render(
      <ThemeProvider>
        <ReportDetailSections rows={rows} summaries={summaries} onOpen={onOpen} />
      </ThemeProvider>,
    ),
  };
}

const PENDING_ROW: ReportRow = {
  id: 'photos',
  label: 'Photos',
  icon: 'camera-outline',
  kinds: [],
  mode: 'pending',
};

/** Flattened `color` of the summary line under a row's label. */
function summaryColorOf(getByText: (t: string) => { props: { style: unknown } }, text: string) {
  const style = getByText(text).props.style as readonly { color?: string }[];
  return style.map((s) => s?.color).find(Boolean);
}

describe('row rendering', () => {
  it('renders one row per entry, in the order given', () => {
    const { getAllByTestId } = renderRows(REPORT_ROWS);

    expect(getAllByTestId(/^report-section-/).map((node) => node.props.testID)).toEqual(
      REPORT_ROWS.map((row) => `report-section-${row.id}`),
    );
  });

  it('shows each row label and its summary line', () => {
    const { getByText } = renderRows([REPORT_ROWS[0]], { [REPORT_ROWS[0].id]: FILLED });

    expect(getByText(REPORT_ROWS[0].label)).toBeTruthy();
    expect(getByText('3 trades · 26 on site')).toBeTruthy();
  });

  it('reads the label and the summary together to a screen reader', () => {
    const row = REPORT_ROWS[0];
    const { getByTestId } = renderRows([row], { [row.id]: FILLED });

    // The summary is the only thing distinguishing a filled row from an empty
    // one by voice; a label-only a11y label makes every row sound identical.
    expect(getByTestId(`report-section-${row.id}`).props.accessibilityLabel).toBe(
      `${row.label}. 3 trades · 26 on site`,
    );
  });
});

describe('interaction', () => {
  it('reports the row id — not the section kind — when tapped', () => {
    const { getByTestId, onOpen } = renderRows(REPORT_ROWS);

    // crew_work is a GROUP row: its kinds are crew + work_performed, and the
    // screen keys its sheet on the row id. Passing a kind here opens nothing.
    fireEvent.press(getByTestId('report-section-crew_work'));

    expect(onOpen).toHaveBeenCalledWith('crew_work');
  });

  it('opens each row independently', () => {
    const { getByTestId, onOpen } = renderRows(REPORT_ROWS);

    for (const row of REPORT_ROWS) fireEvent.press(getByTestId(`report-section-${row.id}`));

    expect((onOpen as jest.Mock).mock.calls.flat()).toEqual(REPORT_ROWS.map((row) => row.id));
  });

  it('a pending row is inert and says so', () => {
    const { getByTestId, getByText, onOpen } = renderRows([PENDING_ROW]);

    expect(getByText('Soon')).toBeTruthy();
    fireEvent.press(getByTestId('report-section-photos'));

    // The row still renders its summary so the list stays complete while sheets
    // land incrementally — but tapping must not open a sheet that isn't built.
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe('state affordances', () => {
  it('distinguishes filled, deliberate-none and untouched by colour', () => {
    const rows = [
      { ...REPORT_ROWS[0], id: 'a' },
      { ...REPORT_ROWS[0], id: 'b' },
      { ...REPORT_ROWS[0], id: 'c' },
    ];
    const { getByText } = renderRows(rows, { a: FILLED, b: NONE, c: EMPTY });

    const colors = [
      summaryColorOf(getByText, FILLED.text),
      summaryColorOf(getByText, NONE.text),
      summaryColorOf(getByText, EMPTY.text),
    ];

    // "None today" is a legally stronger claim than a blank (PRD §7 Safety), so
    // it must not read as the same untouched grey as "Tap to add".
    expect(new Set(colors).size).toBe(3);
  });

  it('marks a deliberate None with a check, and everything else with a chevron', () => {
    const rows = [
      { ...REPORT_ROWS[0], id: 'a' },
      { ...REPORT_ROWS[0], id: 'b' },
    ];
    const { UNSAFE_getAllByType } = renderRows(rows, { a: NONE, b: EMPTY });

    // The full ordered glyph list, not a count of one name: it also pins that
    // the LEADING icon comes from `row.icon` rather than a hardcoded default.
    expect(UNSAFE_getAllByType(Ionicons).map((icon) => icon.props.name)).toEqual([
      REPORT_ROWS[0].icon,
      'checkmark-circle',
      REPORT_ROWS[0].icon,
      'chevron-forward',
    ]);
  });

  it('a pending row gets neither affordance', () => {
    const { UNSAFE_getAllByType } = renderRows([PENDING_ROW], { photos: NONE });

    // Even an affirmed section must not offer a chevron it cannot act on — the
    // leading glyph is all that renders.
    expect(UNSAFE_getAllByType(Ionicons).map((icon) => icon.props.name)).toEqual([
      PENDING_ROW.icon,
    ]);
  });
});

describe('the Maestro flow taps ids this component really renders', () => {
  const FLOW = path.join('.maestro', 'report-sections.yaml');
  const ID_RE = /^\s*id:\s*['"](report-section-[^'"]+)['"]\s*$/gm;

  const tapped = [
    ...new Set(
      [...fs.readFileSync(path.join(process.cwd(), FLOW), 'utf8').matchAll(ID_RE)].map((m) => m[1]),
    ),
  ];

  it('finds the ids to check', () => {
    // Anti-vacuity: a renamed flow file or a changed id syntax must fail here
    // rather than hand the next test an empty list and report success.
    expect(tapped.length).toBeGreaterThan(0);
  });

  it('every report-section id the flow taps is rendered from REPORT_ROWS', () => {
    const { getAllByTestId } = renderRows(REPORT_ROWS);
    const rendered = new Set(getAllByTestId(/^report-section-/).map((n) => n.props.testID));

    // maestroSelectors.test.ts waves through anything starting with
    // `report-section-`, so a typo'd or dropped row id survives it and fails
    // twenty minutes into a cloud build instead. This is the other half.
    expect(tapped.filter((id) => !rendered.has(id))).toEqual([]);
  });
});
