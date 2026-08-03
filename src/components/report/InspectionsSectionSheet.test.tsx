import { fireEvent, render } from '@testing-library/react-native';

import { ThemeProvider } from '../../theme';
import { flushSectionDraft, withFakeTimers } from './sectionDraftTestUtils';

// `mock`-prefixed so Jest allows referencing it inside the factory.
const mockUpdateSection = jest.fn().mockResolvedValue(undefined);
jest.mock('../../data', () => ({
  useRepository: () => ({ updateSection: mockUpdateSection }),
}));
// Deterministic ids: asserting them exactly catches a regression that swaps
// `uuidv4()` for a constant, where two entries collide and editing one edits both.
jest.mock('../../lib/uuid', () => {
  let n = 0;
  return { uuidv4: () => `uuid-${(n += 1)}` };
});

// eslint-disable-next-line import/first
import { InspectionsSectionSheet } from './InspectionsSectionSheet';

beforeEach(() => mockUpdateSection.mockClear());

test('Add inspection writes the new entry with its default result', async () => {
  await withFakeTimers(async () => {
    const { getByLabelText } = render(
      <ThemeProvider>
        <InspectionsSectionSheet
          visible
          reportId="r1"
          initial={{ entries: [] }}
          onClose={jest.fn()}
        />
      </ThemeProvider>,
    );
    fireEvent.press(getByLabelText('Add inspection'));
    await flushSectionDraft();

    // `result: 'passed'` is a claim about a regulatory event — a wrong default
    // here is a wrong statement in the signed report, so it is asserted exactly.
    expect(mockUpdateSection).toHaveBeenCalledWith(
      'r1',
      'inspections',
      { entries: [{ id: 'uuid-1', agency: '', inspector: null, result: 'passed', note: null }] },
      false,
    );
  });
});
