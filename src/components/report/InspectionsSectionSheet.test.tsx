import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { ThemeProvider } from '../../theme';

// `mock`-prefixed so Jest allows referencing it inside the factory.
const mockUpdateSection = jest.fn().mockResolvedValue(undefined);
jest.mock('../../data', () => ({
  useRepository: () => ({ updateSection: mockUpdateSection }),
}));

// eslint-disable-next-line import/first
import { InspectionsSectionSheet } from './InspectionsSectionSheet';

test('Add inspection writes an entry', async () => {
  const { getByLabelText } = render(
    <ThemeProvider>
      <InspectionsSectionSheet
        visible
        reportId="r1"
        initial={{ entries: [] }}
        onClose={jest.fn()}
      />
    </ThemeProvider>,
  );
  fireEvent.press(getByLabelText('Add inspection'));
  await waitFor(() =>
    expect(mockUpdateSection).toHaveBeenCalledWith('r1', 'inspections', expect.anything(), false),
  );
});
