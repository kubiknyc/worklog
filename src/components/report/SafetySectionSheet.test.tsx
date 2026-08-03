import { fireEvent, render } from '@testing-library/react-native';

import { ThemeProvider } from '../../theme';

// `mock`-prefixed so Jest allows referencing it inside the factory.
const mockUpdateSection = jest.fn().mockResolvedValue(undefined);
jest.mock('../../data', () => ({
  useRepository: () => ({ updateSection: mockUpdateSection }),
}));

// eslint-disable-next-line import/first
import { SafetySectionSheet } from './SafetySectionSheet';
// eslint-disable-next-line import/first
import { SECTION_DRAFT_DEBOUNCE_MS } from './useSectionDraft';

beforeEach(() => {
  mockUpdateSection.mockClear();
});

// Fake timers, not `waitFor`: this test also pays the suite's one-time cost of
// lazily requiring the RN/Expo component stack during its first `render`.
// Waiting the 400ms debounce on the wall clock puts both inside one jest test
// budget, which a cold transform cache blows through. Repo precedent:
// CrewWorkSheet.test.tsx and useSectionDraft.test.tsx.
test('Nothing to report marks the section complete', async () => {
  jest.useFakeTimers();
  try {
    const { getByLabelText } = render(
      <ThemeProvider>
        <SafetySectionSheet visible reportId="r1" initial={{ rows: [] }} onClose={jest.fn()} />
      </ThemeProvider>,
    );
    fireEvent.press(getByLabelText('Nothing to report'));
    jest.advanceTimersByTime(SECTION_DRAFT_DEBOUNCE_MS);
    // Flush the microtask chain the debounced callback kicks off (issueWrite
    // chains through a Promise) — fake timers don't do this for us.
    await Promise.resolve();
    await Promise.resolve();
    expect(mockUpdateSection).toHaveBeenCalledWith('r1', 'safety', expect.anything(), true);
  } finally {
    jest.useRealTimers();
  }
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
