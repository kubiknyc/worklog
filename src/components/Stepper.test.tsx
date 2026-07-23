/**
 * Stepper behaviour: clamping at min/max, disabled state at the bounds,
 * float-safe 0.5-step math (8 → 8.5, never 8.4999999), one onChange per press,
 * and the adjustable accessibility increment/decrement handlers (AC-A1).
 */
import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { ThemeProvider } from '../theme';
import { Stepper } from './Stepper';

function wrapper({ children }: { readonly children: ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

const LABEL = 'Carpenters headcount';

describe('Stepper', () => {
  test('increments by step and fires onChange once per press', () => {
    const onChange = jest.fn();
    render(<Stepper value={3} onChange={onChange} accessibilityLabel={LABEL} />, { wrapper });

    fireEvent.press(screen.getByLabelText(`Increase ${LABEL}`));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(4);
  });

  test('decrements by step', () => {
    const onChange = jest.fn();
    render(<Stepper value={3} onChange={onChange} accessibilityLabel={LABEL} />, { wrapper });

    fireEvent.press(screen.getByLabelText(`Decrease ${LABEL}`));

    expect(onChange).toHaveBeenCalledWith(2);
  });

  test('0.5-step math stays exact — 8 → 8.5, no float drift', () => {
    const onChange = jest.fn();
    const { rerender } = render(
      <Stepper value={8} onChange={onChange} step={0.5} accessibilityLabel="Hours" />,
      { wrapper },
    );

    fireEvent.press(screen.getByLabelText('Increase Hours'));
    expect(onChange).toHaveBeenLastCalledWith(8.5);

    rerender(
      <ThemeProvider>
        <Stepper value={8.5} onChange={onChange} step={0.5} accessibilityLabel="Hours" />
      </ThemeProvider>,
    );
    fireEvent.press(screen.getByLabelText('Increase Hours'));
    expect(onChange).toHaveBeenLastCalledWith(9);

    // Every emitted value is a clean 1-decimal number, never 8.4999999.
    for (const [emitted] of onChange.mock.calls) {
      expect(emitted).toBe(Math.round(emitted * 10) / 10);
    }
  });

  test('clamps at max and disables the increment button', () => {
    const onChange = jest.fn();
    render(<Stepper value={5} onChange={onChange} max={5} accessibilityLabel={LABEL} />, {
      wrapper,
    });

    const plus = screen.getByLabelText(`Increase ${LABEL}`);
    expect(plus.props.accessibilityState).toMatchObject({ disabled: true });

    fireEvent.press(plus);
    expect(onChange).not.toHaveBeenCalled();
  });

  test('clamps at min and disables the decrement button', () => {
    const onChange = jest.fn();
    render(<Stepper value={0} onChange={onChange} min={0} accessibilityLabel={LABEL} />, {
      wrapper,
    });

    const minus = screen.getByLabelText(`Decrease ${LABEL}`);
    expect(minus.props.accessibilityState).toMatchObject({ disabled: true });

    fireEvent.press(minus);
    expect(onChange).not.toHaveBeenCalled();
  });

  test('adjustable increment/decrement handlers adjust the value', () => {
    const onChange = jest.fn();
    render(<Stepper value={4} onChange={onChange} accessibilityLabel={LABEL} />, { wrapper });

    const control = screen.getByLabelText(LABEL);
    fireEvent(control, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(onChange).toHaveBeenLastCalledWith(5);

    fireEvent(control, 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    expect(onChange).toHaveBeenLastCalledWith(3);
  });
});
