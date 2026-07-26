import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { ThemeProvider } from '../../theme';

// `mock`-prefixed so Jest allows referencing it inside the factory.
const mockUpdateSection = jest.fn().mockResolvedValue(undefined);
jest.mock('../../data', () => ({
  useRepository: () => ({ updateSection: mockUpdateSection }),
}));

// eslint-disable-next-line import/first
import { RfisSectionSheet } from './RfisSectionSheet';

test('Add item writes an entry', async () => {
  const { getByLabelText } = render(
    <ThemeProvider>
      <RfisSectionSheet visible reportId="r1" initial={{ entries: [] }} onClose={jest.fn()} />
    </ThemeProvider>,
  );
  fireEvent.press(getByLabelText('Add item'));
  await waitFor(() =>
    expect(mockUpdateSection).toHaveBeenCalledWith('r1', 'rfis', expect.anything(), false),
  );
});
