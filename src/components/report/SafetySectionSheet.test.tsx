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
import { SafetySectionSheet } from './SafetySectionSheet';

beforeEach(() => {
  mockUpdateSection.mockClear();
  __resetUuid();
});

test('Nothing to report marks the section complete with an empty row list', async () => {
  await withFakeTimers(async () => {
    const { getByLabelText } = render(
      <ThemeProvider>
        <SafetySectionSheet visible reportId="r1" initial={{ rows: [] }} onClose={jest.fn()} />
      </ThemeProvider>,
    );
    fireEvent.press(getByLabelText('Nothing to report'));
    await flushSectionDraft();

    // "Nothing to report" must write an empty list, not merely flip the flag:
    // a complete section carrying stale rows misstates the day.
    expect(mockUpdateSection).toHaveBeenCalledWith('r1', 'safety', { rows: [] }, true);
  });
});

test('Add observation writes the new row with its defaults', async () => {
  await withFakeTimers(async () => {
    const { getByLabelText } = render(
      <ThemeProvider>
        <SafetySectionSheet visible reportId="r1" initial={{ rows: [] }} onClose={jest.fn()} />
      </ThemeProvider>,
    );
    fireEvent.press(getByLabelText('Add observation'));
    await flushSectionDraft();

    // `is_incident: false` is the safety-critical default — a row that defaulted
    // to `true` would report an incident that did not happen, and vice versa.
    expect(mockUpdateSection).toHaveBeenCalledWith(
      'r1',
      'safety',
      { rows: [{ id: 'uuid-1', obs_type: '', description: '', is_incident: false }] },
      false,
    );
  });
});

test('readOnly renders content but hides None today and never writes', async () => {
  const onClose = jest.fn();
  const { getByTestId, queryByTestId } = render(
    <ThemeProvider>
      <SafetySectionSheet visible reportId="r1" initial={{ rows: [] }} onClose={onClose} readOnly />
    </ThemeProvider>,
  );
  expect(queryByTestId('sheet-safety-none')).toBeNull();
  fireEvent.press(getByTestId('sheet-safety-done'));
  expect(onClose).toHaveBeenCalled();
  expect(mockUpdateSection).not.toHaveBeenCalled();
});
