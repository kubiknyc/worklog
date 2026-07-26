import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { ThemeProvider } from '../../theme';

// `mock`-prefixed so Jest allows referencing it inside the factory.
const mockUpdateSection = jest.fn().mockResolvedValue(undefined);
jest.mock('../../data', () => ({
  useRepository: () => ({ updateSection: mockUpdateSection }),
}));

// eslint-disable-next-line import/first
import { VisitorsSectionSheet } from './VisitorsSectionSheet';

test('Add visitor writes an entry', async () => {
  const { getByLabelText } = render(
    <ThemeProvider>
      <VisitorsSectionSheet visible reportId="r1" initial={{ entries: [] }} onClose={jest.fn()} />
    </ThemeProvider>,
  );
  fireEvent.press(getByLabelText('Add visitor'));
  await waitFor(() =>
    expect(mockUpdateSection).toHaveBeenCalledWith('r1', 'visitors', expect.anything(), false),
  );
});
