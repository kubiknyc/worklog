import { fireEvent, render } from '@testing-library/react-native';

import type { CrewContent, WorkPerformedContent } from '../../data/sectionContent';
import { ThemeProvider } from '../../theme';
import { flushSectionDraft, withFakeTimers } from './sectionDraftTestUtils';

// `mock`-prefixed so Jest allows referencing it inside the factory
// (babel-plugin-jest-hoist; repo precedent: useSectionDraft.test.tsx).
const mockUpdateSection = jest.fn().mockResolvedValue(undefined);
jest.mock('../../data', () => ({
  useRepository: () => ({ updateSection: mockUpdateSection }),
}));
// Deterministic ids: asserting them exactly catches a regression that swaps
// `uuidv4()` for a constant, where two rows collide and editing one edits both.
// `__resetUuid` keeps the counter per-test: without it the ids a test asserts
// depend on how many entries earlier tests in the file happened to create.
jest.mock('../../lib/uuid', () => {
  let n = 0;
  return {
    uuidv4: () => `uuid-${(n += 1)}`,
    __resetUuid: () => {
      n = 0;
    },
  };
});
const { __resetUuid } = jest.requireMock('../../lib/uuid') as { __resetUuid: () => void };

// eslint-disable-next-line import/first
import { CrewWorkSheet } from './CrewWorkSheet';

const crewRow = {
  id: 'c1',
  trade: 'Electrical',
  headcount: 4,
  hours: 8,
  is_carried_forward: false,
};

function renderSheet(
  initialCrew: CrewContent = { rows: [] },
  initialWork: WorkPerformedContent = { rows: [] },
) {
  return render(
    <ThemeProvider>
      <CrewWorkSheet
        visible
        reportId="r1"
        initialCrew={initialCrew}
        initialWork={initialWork}
        onClose={jest.fn()}
      />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  mockUpdateSection.mockClear();
  __resetUuid();
});

test('adding a trade writes the crew row with its defaults', async () => {
  await withFakeTimers(async () => {
    const { getByLabelText } = renderSheet();
    fireEvent.press(getByLabelText('Electrical'));
    await flushSectionDraft();

    // `headcount: 1` / `hours: 8` are the day's labour claim. Asserting only the
    // section name let a stale closure write `{ rows: [] }` unnoticed.
    expect(mockUpdateSection).toHaveBeenCalledWith(
      'r1',
      'crew',
      {
        rows: [
          { id: 'uuid-1', trade: 'Electrical', headcount: 1, hours: 8, is_carried_forward: false },
        ],
      },
      false,
    );
  });
});

test('editing the work note writes the typed text', async () => {
  await withFakeTimers(async () => {
    const { getByPlaceholderText } = renderSheet({ rows: [crewRow] });
    fireEvent.changeText(getByPlaceholderText("Describe today's work"), 'pulled feeders');
    await flushSectionDraft();

    // The note *is* the work record — `expect.anything()` passed on an empty one.
    expect(mockUpdateSection).toHaveBeenCalledWith(
      'r1',
      'work_performed',
      { rows: [{ id: 'uuid-1', trade: 'Electrical', area: '', note: 'pulled feeders' }] },
      false,
    );
  });
});

test('removing a trade drops both crew and work rows', async () => {
  await withFakeTimers(async () => {
    const { getByLabelText } = renderSheet(
      { rows: [crewRow] },
      { rows: [{ id: 'w1', trade: 'Electrical', area: 'L3', note: 'pulled feeders' }] },
    );
    fireEvent.press(getByLabelText('Remove Electrical'));
    await flushSectionDraft();

    expect(mockUpdateSection).toHaveBeenCalledWith('r1', 'crew', { rows: [] }, false);
    expect(mockUpdateSection).toHaveBeenCalledWith('r1', 'work_performed', { rows: [] }, false);
  });
});

test('No crew today marks crew complete with an empty row list', async () => {
  await withFakeTimers(async () => {
    const { getByLabelText } = renderSheet();
    fireEvent.press(getByLabelText('No crew today'));
    await flushSectionDraft();

    // Complete-with-stale-rows would misstate the day, so the payload is exact.
    expect(mockUpdateSection).toHaveBeenCalledWith('r1', 'crew', { rows: [] }, true);
  });
});
