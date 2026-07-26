import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { ThemeProvider } from '../../theme';

// `mock`-prefixed so Jest allows referencing it inside the factory.
const mockUpdateSection = jest.fn().mockResolvedValue(undefined);
jest.mock('../../data', () => ({
  useRepository: () => ({ updateSection: mockUpdateSection }),
}));

// eslint-disable-next-line import/first
import { SafetySectionSheet } from './SafetySectionSheet';

test('Nothing to report marks the section complete', async () => {
  const { getByLabelText } = render(
    <ThemeProvider>
      <SafetySectionSheet visible reportId="r1" initial={{ rows: [] }} onClose={jest.fn()} />
    </ThemeProvider>,
  );
  fireEvent.press(getByLabelText('Nothing to report'));
  await waitFor(() =>
    expect(mockUpdateSection).toHaveBeenCalledWith('r1', 'safety', expect.anything(), true),
  );
});
