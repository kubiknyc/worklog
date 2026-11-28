import { fireEvent, render } from '@testing-library/react-native';
import { type ReactElement } from 'react';
import { Text } from 'react-native';

import { ThemeProvider } from '../../theme';
import { EntryCard } from './EntryCard';
import { SectionReadOnlyContext } from './SectionReadOnlyContext';

const wrap = (ui: ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

test('renders title and fires onRemove', () => {
  const onRemove = jest.fn();
  const { getByText, getByLabelText } = wrap(
    <EntryCard title="Delivery 1" onRemove={onRemove}>
      <Text>body</Text>
    </EntryCard>,
  );
  expect(getByText('Delivery 1')).toBeTruthy();
  fireEvent.press(getByLabelText('Remove Delivery 1'));
  expect(onRemove).toHaveBeenCalledTimes(1);
});

test('hides the remove button under the read-only context', () => {
  const { queryByLabelText } = wrap(
    <SectionReadOnlyContext.Provider value>
      <EntryCard title="Delivery 1" onRemove={jest.fn()}>
        <Text>body</Text>
      </EntryCard>
    </SectionReadOnlyContext.Provider>,
  );
  expect(queryByLabelText('Remove Delivery 1')).toBeNull();
});
