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
import { DeliveriesSectionSheet } from './DeliveriesSectionSheet';

beforeEach(() => {
  mockUpdateSection.mockClear();
  __resetUuid();
});

function renderSheet() {
  return render(
    <ThemeProvider>
      <DeliveriesSectionSheet visible reportId="r1" initial={{ entries: [] }} onClose={jest.fn()} />
    </ThemeProvider>,
  );
}

test('Add delivery writes the new entry, not an empty list', async () => {
  await withFakeTimers(async () => {
    const { getByLabelText } = renderSheet();
    fireEvent.press(getByLabelText('Add delivery'));
    await flushSectionDraft();

    // The payload is the point: a stale closure writing `{ entries: [] }` means
    // the user's delivery silently never persists, and `expect.anything()`
    // could not tell the difference.
    expect(mockUpdateSection).toHaveBeenCalledWith(
      'r1',
      'deliveries',
      { entries: [{ id: 'uuid-1', supplier: '', material: '', quantity: 1, unit: 'loads' }] },
      false,
    );
  });
});

test('a second delivery is appended with a distinct id', async () => {
  await withFakeTimers(async () => {
    const { getByLabelText } = renderSheet();
    fireEvent.press(getByLabelText('Add delivery'));
    fireEvent.press(getByLabelText('Add delivery'));
    await flushSectionDraft();

    const content = mockUpdateSection.mock.calls.at(-1)?.[2] as {
      entries: readonly { id: string }[];
    };
    expect(content.entries).toHaveLength(2);
    expect(content.entries[0].id).not.toBe(content.entries[1].id);
  });
});
