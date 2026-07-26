import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { ThemeProvider } from '../../theme';

// `mock`-prefixed so Jest allows referencing it inside the factory.
const mockUpdateSection = jest.fn().mockResolvedValue(undefined);
jest.mock('../../data', () => ({
  useRepository: () => ({ updateSection: mockUpdateSection }),
}));

// eslint-disable-next-line import/first
import { DelaysSectionSheet } from './DelaysSectionSheet';

test('Add delay writes an entry', async () => {
  const { getByLabelText } = render(
    <ThemeProvider>
      <DelaysSectionSheet visible reportId="r1" initial={{ rows: [] }} onClose={jest.fn()} />
    </ThemeProvider>,
  );
  fireEvent.press(getByLabelText('Add delay'));
  await waitFor(() =>
    expect(mockUpdateSection).toHaveBeenCalledWith('r1', 'delays', expect.anything(), false),
  );
});
