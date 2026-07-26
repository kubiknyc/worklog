import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { ThemeProvider } from '../../theme';

// `mock`-prefixed so Jest allows referencing it inside the factory.
const mockUpdateSection = jest.fn().mockResolvedValue(undefined);
jest.mock('../../data', () => ({
  useRepository: () => ({ updateSection: mockUpdateSection }),
}));

// eslint-disable-next-line import/first
import { WeatherSectionSheet } from './WeatherSectionSheet';

test('choosing a condition writes the weather override', async () => {
  const { getByLabelText } = render(
    <ThemeProvider>
      <WeatherSectionSheet visible reportId="r1" initialWeather={null} onClose={jest.fn()} />
    </ThemeProvider>,
  );
  fireEvent.press(getByLabelText('Rain'));
  await waitFor(() =>
    expect(mockUpdateSection).toHaveBeenCalledWith(
      'r1',
      'weather',
      expect.objectContaining({ condition: 'rain' }),
      false,
    ),
  );
});
