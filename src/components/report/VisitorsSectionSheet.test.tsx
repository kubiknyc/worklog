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
import { VisitorsSectionSheet } from './VisitorsSectionSheet';

beforeEach(() => mockUpdateSection.mockClear());

test('Add visitor writes the new entry, not an empty list', async () => {
  await withFakeTimers(async () => {
    const { getByLabelText } = render(
      <ThemeProvider>
        <VisitorsSectionSheet visible reportId="r1" initial={{ entries: [] }} onClose={jest.fn()} />
      </ThemeProvider>,
    );
    fireEvent.press(getByLabelText('Add visitor'));
    await flushSectionDraft();

    expect(mockUpdateSection).toHaveBeenCalledWith(
      'r1',
      'visitors',
      { entries: [{ id: 'uuid-1', name: '', role: '', time: null }] },
      false,
    );
  });
});
