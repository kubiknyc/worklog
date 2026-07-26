import { fireEvent, render, waitFor } from '@testing-library/react-native';

import type { CrewContent, WorkPerformedContent } from '../../data/sectionContent';
import { ThemeProvider } from '../../theme';

// `mock`-prefixed so Jest allows referencing it inside the factory
// (babel-plugin-jest-hoist; repo precedent: useSectionDraft.test.tsx).
const mockUpdateSection = jest.fn().mockResolvedValue(undefined);
jest.mock('../../data', () => ({
  useRepository: () => ({ updateSection: mockUpdateSection }),
}));

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

beforeEach(() => mockUpdateSection.mockClear());

test('adding a trade writes the crew section', async () => {
  jest.useFakeTimers();
  try {
    const { getByLabelText } = renderSheet();
    fireEvent.press(getByLabelText('Electrical'));
    jest.advanceTimersByTime(400);
    // Flush the microtask chain the debounced timer callback kicks off
    // (issueWrite chains through a Promise) — fake timers don't do this for us.
    await Promise.resolve();
    await Promise.resolve();
    expect(mockUpdateSection).toHaveBeenCalledWith('r1', 'crew', expect.anything(), false);
  } finally {
    jest.useRealTimers();
  }
});

test('editing the work note writes the work_performed section', async () => {
  const { getByPlaceholderText } = renderSheet({ rows: [crewRow] });
  fireEvent.changeText(getByPlaceholderText("Describe today's work"), 'pulled feeders');
  await waitFor(() =>
    expect(mockUpdateSection).toHaveBeenCalledWith(
      'r1',
      'work_performed',
      expect.anything(),
      false,
    ),
  );
});

test('removing a trade drops both crew and work rows', async () => {
  const { getByLabelText } = renderSheet(
    { rows: [crewRow] },
    { rows: [{ id: 'w1', trade: 'Electrical', area: 'L3', note: 'pulled feeders' }] },
  );
  fireEvent.press(getByLabelText('Remove Electrical'));
  await waitFor(() => {
    expect(mockUpdateSection).toHaveBeenCalledWith('r1', 'crew', { rows: [] }, false);
    expect(mockUpdateSection).toHaveBeenCalledWith('r1', 'work_performed', { rows: [] }, false);
  });
});

test('No crew today marks crew complete', async () => {
  const { getByLabelText } = renderSheet();
  fireEvent.press(getByLabelText('No crew today'));
  await waitFor(() =>
    expect(mockUpdateSection).toHaveBeenCalledWith('r1', 'crew', expect.anything(), true),
  );
});
