import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { ThemeProvider } from '../../theme';

// `mock`-prefixed so Jest allows referencing it inside the factory.
const mockUpdateSection = jest.fn().mockResolvedValue(undefined);
jest.mock('../../data', () => ({
  useRepository: () => ({ updateSection: mockUpdateSection }),
}));

// eslint-disable-next-line import/first
import { EquipmentSectionSheet } from './EquipmentSectionSheet';

test('Add equipment writes a row', async () => {
  const { getByPlaceholderText, getByLabelText } = render(
    <ThemeProvider>
      <EquipmentSectionSheet visible reportId="r1" initial={{ rows: [] }} onClose={jest.fn()} />
    </ThemeProvider>,
  );
  fireEvent.changeText(getByPlaceholderText('Equipment name'), 'Excavator');
  fireEvent.press(getByLabelText('Add equipment'));
  await waitFor(() =>
    expect(mockUpdateSection).toHaveBeenCalledWith('r1', 'equipment', expect.anything(), false),
  );
});
