import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { ThemeProvider } from '../../theme';

// `mock`-prefixed so Jest allows referencing it inside the factory.
const mockUpdateSection = jest.fn().mockResolvedValue(undefined);
jest.mock('../../data', () => ({
  useRepository: () => ({ updateSection: mockUpdateSection }),
}));

// eslint-disable-next-line import/first
import { DeliveriesSectionSheet } from './DeliveriesSectionSheet';

test('Add delivery writes an entry', async () => {
  const { getByLabelText } = render(
    <ThemeProvider>
      <DeliveriesSectionSheet visible reportId="r1" initial={{ entries: [] }} onClose={jest.fn()} />
    </ThemeProvider>,
  );
  fireEvent.press(getByLabelText('Add delivery'));
  await waitFor(() =>
    expect(mockUpdateSection).toHaveBeenCalledWith('r1', 'deliveries', expect.anything(), false),
  );
});
