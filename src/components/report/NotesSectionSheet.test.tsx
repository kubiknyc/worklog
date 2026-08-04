import { fireEvent, render } from '@testing-library/react-native';

import { ThemeProvider } from '../../theme';
import { flushSectionDraft, withFakeTimers } from './sectionDraftTestUtils';

/**
 * The only section sheet that had no test at all (#24) — and one a Maestro flow
 * drives via `sheet-notes-done`. Assertions here are on the exact payload, not
 * `expect.anything()`: a stale closure writing `{ text: '' }` would silently
 * discard everything the super typed, and a loose matcher cannot tell that
 * apart from a successful save (#21).
 */
// `mock`-prefixed so Jest allows referencing it inside the factory.
const mockUpdateSection = jest.fn().mockResolvedValue(undefined);
jest.mock('../../data', () => ({
  useRepository: () => ({ updateSection: mockUpdateSection }),
}));

// eslint-disable-next-line import/first
import { NotesSectionSheet } from './NotesSectionSheet';

beforeEach(() => {
  mockUpdateSection.mockClear();
});

function renderSheet(initial = { text: '' }, readOnly = false) {
  return render(
    <ThemeProvider>
      <NotesSectionSheet
        visible
        reportId="r1"
        initial={initial}
        onClose={jest.fn()}
        readOnly={readOnly}
      />
    </ThemeProvider>,
  );
}

test('typing autosaves the note text, with no Save button in the flow', async () => {
  await withFakeTimers(async () => {
    const { getByTestId } = renderSheet();

    fireEvent.changeText(getByTestId('sheet-notes-input'), 'Poured slab on grid C.');
    await flushSectionDraft();

    // PRD §6: there is no Save. If the debounced write does not carry the typed
    // text, the note is simply lost when the sheet closes.
    expect(mockUpdateSection).toHaveBeenCalledWith(
      'r1',
      'general_notes',
      { text: 'Poured slab on grid C.' },
      false,
    );
  });
});

test('the last edit wins rather than an earlier keystroke', async () => {
  await withFakeTimers(async () => {
    const { getByTestId } = renderSheet();

    fireEvent.changeText(getByTestId('sheet-notes-input'), 'Poured');
    fireEvent.changeText(getByTestId('sheet-notes-input'), 'Poured slab');
    await flushSectionDraft();

    // Coalescing must keep the newest draft — writing 'Poured' here would
    // truncate the note back to a half-typed state.
    expect(mockUpdateSection.mock.calls.at(-1)?.[2]).toEqual({ text: 'Poured slab' });
  });
});

test('an existing note is seeded into the field and preserved on an unrelated close', async () => {
  await withFakeTimers(async () => {
    const { getByTestId } = renderSheet({ text: 'Yesterday carried forward' });

    expect(getByTestId('sheet-notes-input').props.value).toBe('Yesterday carried forward');

    fireEvent.press(getByTestId('sheet-notes-done'));
    await flushSectionDraft();

    // Closing without editing must not blank the section — `useSectionDraft`
    // reads `initial` once, so a mis-seeded draft would overwrite real content.
    for (const call of mockUpdateSection.mock.calls) {
      expect(call[2]).toEqual({ text: 'Yesterday carried forward' });
    }
  });
});

test('clearing the field writes the empty note rather than skipping the write', async () => {
  await withFakeTimers(async () => {
    const { getByTestId } = renderSheet({ text: 'Typed by mistake' });

    fireEvent.changeText(getByTestId('sheet-notes-input'), '');
    await flushSectionDraft();

    // Deleting a note is a real edit. Treating empty as "nothing to save"
    // would make the mistaken text permanent.
    expect(mockUpdateSection).toHaveBeenCalledWith('r1', 'general_notes', { text: '' }, false);
  });
});

test('readOnly renders the note but never writes', () => {
  const { getByTestId, queryByTestId } = renderSheet({ text: 'Submitted note' }, true);

  expect(getByTestId('sheet-notes-input').props.value).toBe('Submitted note');
  // The scaffold's "Nothing to report" control must not be offered once the
  // report is past editing.
  expect(queryByTestId('sheet-notes-none')).toBeNull();

  fireEvent.press(getByTestId('sheet-notes-done'));

  expect(mockUpdateSection).not.toHaveBeenCalled();
});
