/**
 * `SheetRow` had no test (#24 item 9) despite two real consumers — the settings
 * list (`app/(tabs)/settings.tsx`) and every report-detail row
 * (`ReportDetailSections`), which is the surface `report-sections.yaml` drives.
 *
 * The traps here are the two "or" props. `label` and `children` are mutually
 * exclusive and `label` silently wins; `leading` and `icon` likewise. Passing
 * both is not a type error, so the losing prop just vanishes at runtime — which
 * is a blank row, not a crash.
 */
import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { ThemeProvider } from '../theme';
import { SheetRow } from './SheetRow';

function wrapper({ children }: { readonly children: ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

describe('SheetRow', () => {
  it('renders its label and fires onPress', () => {
    const onPress = jest.fn();
    render(<SheetRow label="Appearance" accessibilityLabel="Appearance" onPress={onPress} />, {
      wrapper,
    });

    fireEvent.press(screen.getByRole('button', { name: 'Appearance' }));

    expect(screen.getByText('Appearance')).toBeTruthy();
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders children when no label is given', () => {
    render(
      <SheetRow accessibilityLabel="Weather. Tap to add" onPress={jest.fn()}>
        <Text>Weather</Text>
      </SheetRow>,
      { wrapper },
    );

    expect(screen.getByText('Weather')).toBeTruthy();
  });

  it('lets label win over children rather than rendering both', () => {
    render(
      <SheetRow label="Label wins" accessibilityLabel="row" onPress={jest.fn()}>
        <Text>Child loses</Text>
      </SheetRow>,
      { wrapper },
    );

    // Not a type error to pass both, so the losing prop vanishes silently. A
    // caller migrating from label to children sees an unchanged row and no
    // warning — pinning it makes the precedence discoverable.
    expect(screen.getByText('Label wins')).toBeTruthy();
    expect(screen.queryByText('Child loses')).toBeNull();
  });

  it('lets leading win over icon', () => {
    render(
      <SheetRow
        label="row"
        accessibilityLabel="row"
        onPress={jest.fn()}
        icon="cube-outline"
        leading={<Text>LEAD</Text>}
      />,
      { wrapper },
    );

    expect(screen.getByText('LEAD')).toBeTruthy();
  });

  it('forwards testID so flows can key on it instead of copy', () => {
    render(
      <SheetRow
        label="Sync"
        accessibilityLabel="Sync"
        onPress={jest.fn()}
        testID="settings-sync"
        trailing={<Text>3</Text>}
      />,
      { wrapper },
    );

    // Copy here is plain language and expected to change (CLAUDE.md); a flow
    // asserting on the label breaks for reasons unrelated to the behaviour.
    expect(screen.getByTestId('settings-sync')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('exposes an accessibility label distinct from the visible text', () => {
    render(
      <SheetRow label="Weather" accessibilityLabel="Weather. Sunny · 78°F" onPress={jest.fn()} />,
      { wrapper },
    );

    // The row's summary line is often the only thing distinguishing it by
    // voice, so the a11y label must not collapse to the visible label.
    expect(screen.getByLabelText('Weather. Sunny · 78°F')).toBeTruthy();
  });

  it('renders without an icon, leading, trailing or testID', () => {
    render(<SheetRow label="Bare" accessibilityLabel="Bare" onPress={jest.fn()} />, { wrapper });

    expect(screen.getByText('Bare')).toBeTruthy();
  });
});
