/**
 * Chip behaviour: label rendering, press wiring, accessibilityState mirroring
 * selected/disabled, and the checkmark showing only when selected (color is
 * never the sole selection signal — PRD §9 AC-S2).
 */
import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { ThemeProvider } from '../theme';
import { Chip } from './Chip';

function wrapper({ children }: { readonly children: ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

describe('Chip', () => {
  test('renders its label', () => {
    render(<Chip label="Electrical" selected={false} onPress={jest.fn()} />, { wrapper });
    expect(screen.getByText('Electrical')).toBeTruthy();
  });

  test('fires onPress when tapped', () => {
    const onPress = jest.fn();
    render(<Chip label="Plumbing" selected={false} onPress={onPress} />, { wrapper });

    fireEvent.press(screen.getByRole('button', { name: 'Plumbing' }));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test('accessibilityState reflects selected and disabled', () => {
    render(<Chip label="HVAC" selected onPress={jest.fn()} disabled />, { wrapper });

    const chip = screen.getByLabelText('HVAC');
    expect(chip.props.accessibilityState).toMatchObject({ selected: true, disabled: true });
  });

  test('does not fire onPress while disabled', () => {
    const onPress = jest.fn();
    render(<Chip label="Tile" selected={false} onPress={onPress} disabled />, { wrapper });

    fireEvent.press(screen.getByLabelText('Tile'));

    expect(onPress).not.toHaveBeenCalled();
  });

  test('shows the checkmark only when selected', () => {
    const { rerender } = render(<Chip label="Paint" selected={false} onPress={jest.fn()} />, {
      wrapper,
    });
    expect(screen.queryByTestId('chip-check')).toBeNull();

    rerender(
      <ThemeProvider>
        <Chip label="Paint" selected onPress={jest.fn()} />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('chip-check')).toBeTruthy();
  });
});
