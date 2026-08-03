import { fireEvent, render } from '@testing-library/react-native';

import { ThemeProvider } from '../../theme';

// `mock`-prefixed so Jest allows referencing it inside the factory.
const mockUpdateSection = jest.fn().mockResolvedValue(undefined);
jest.mock('../../data', () => ({
  useRepository: () => ({ updateSection: mockUpdateSection }),
}));

// eslint-disable-next-line import/first
import { WeatherSectionSheet } from './WeatherSectionSheet';
// eslint-disable-next-line import/first
import { SECTION_DRAFT_DEBOUNCE_MS } from './useSectionDraft';

// Fake timers, not `waitFor`: this test also pays the suite's one-time cost of
// lazily requiring the RN/Expo component stack during its first `render`.
// Waiting the 400ms debounce on the wall clock puts both inside one jest test
// budget, which a cold transform cache blows through. Repo precedent:
// CrewWorkSheet.test.tsx and useSectionDraft.test.tsx.
test('choosing a condition writes the weather override', async () => {
  jest.useFakeTimers();
  try {
    const { getByLabelText } = render(
      <ThemeProvider>
        <WeatherSectionSheet visible reportId="r1" initialWeather={null} onClose={jest.fn()} />
      </ThemeProvider>,
    );
    fireEvent.press(getByLabelText('Rain'));
    jest.advanceTimersByTime(SECTION_DRAFT_DEBOUNCE_MS);
    // Flush the microtask chain the debounced callback kicks off (issueWrite
    // chains through a Promise) — fake timers don't do this for us.
    await Promise.resolve();
    await Promise.resolve();
    expect(mockUpdateSection).toHaveBeenCalledWith(
      'r1',
      'weather',
      expect.objectContaining({ condition: 'rain' }),
      false,
    );
  } finally {
    jest.useRealTimers();
  }
});
