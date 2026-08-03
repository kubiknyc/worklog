import { fireEvent, render } from '@testing-library/react-native';

import { ThemeProvider } from '../../theme';
import { flushSectionDraft, withFakeTimers } from './sectionDraftTestUtils';

// `mock`-prefixed so Jest allows referencing it inside the factory.
const mockUpdateSection = jest.fn().mockResolvedValue(undefined);
jest.mock('../../data', () => ({
  useRepository: () => ({ updateSection: mockUpdateSection }),
}));
// Deterministic ids: asserting them exactly catches a regression that swaps
// `uuidv4()` for a constant, where two rows collide and editing one edits both.
jest.mock('../../lib/uuid', () => {
  let n = 0;
  return { uuidv4: () => `uuid-${(n += 1)}` };
});

// eslint-disable-next-line import/first
import { DelaysSectionSheet } from './DelaysSectionSheet';

beforeEach(() => mockUpdateSection.mockClear());

test('Add delay writes the new row with its defaults', async () => {
  await withFakeTimers(async () => {
    const { getByLabelText } = render(
      <ThemeProvider>
        <DelaysSectionSheet visible reportId="r1" initial={{ rows: [] }} onClose={jest.fn()} />
      </ThemeProvider>,
    );
    fireEvent.press(getByLabelText('Add delay'));
    await flushSectionDraft();

    // Asserting the defaults, not just the shape: a wrong `duration_hours` or a
    // dropped `is_ongoing` changes what the report claims about the delay.
    expect(mockUpdateSection).toHaveBeenCalledWith(
      'r1',
      'delays',
      {
        rows: [
          {
            id: 'uuid-1',
            cause: '',
            responsible_party: null,
            duration_hours: 0.5,
            is_ongoing: false,
            note: null,
          },
        ],
      },
      false,
    );
  });
});
