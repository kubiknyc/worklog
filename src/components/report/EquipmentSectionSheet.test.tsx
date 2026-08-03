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
// `__resetUuid` keeps the counter per-test: without it the ids a test asserts
// depend on how many rows earlier tests in the file happened to create.
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
import { EquipmentSectionSheet } from './EquipmentSectionSheet';

beforeEach(() => {
  mockUpdateSection.mockClear();
  __resetUuid();
});

function renderSheet() {
  return render(
    <ThemeProvider>
      <EquipmentSectionSheet visible reportId="r1" initial={{ rows: [] }} onClose={jest.fn()} />
    </ThemeProvider>,
  );
}

test('Add equipment writes the typed name, trimmed, with its defaults', async () => {
  await withFakeTimers(async () => {
    const { getByPlaceholderText, getByLabelText } = renderSheet();
    fireEvent.changeText(getByPlaceholderText('Equipment name'), '  Excavator  ');
    fireEvent.press(getByLabelText('Add equipment'));
    await flushSectionDraft();

    // The name is the whole point of the interaction, and `expect.anything()`
    // passed even if the row carried an empty or untrimmed one.
    expect(mockUpdateSection).toHaveBeenCalledWith(
      'r1',
      'equipment',
      { rows: [{ id: 'uuid-1', name: 'Excavator', status: 'active', on_site: true }] },
      false,
    );
  });
});

test('Add equipment with a blank name writes nothing', async () => {
  await withFakeTimers(async () => {
    const { getByPlaceholderText, getByLabelText } = renderSheet();
    fireEvent.changeText(getByPlaceholderText('Equipment name'), '   ');
    fireEvent.press(getByLabelText('Add equipment'));
    await flushSectionDraft();

    expect(mockUpdateSection).not.toHaveBeenCalled();
  });
});
