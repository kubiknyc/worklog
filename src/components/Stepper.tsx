/**
 * Stepper — a controlled numeric −/+ control for counts, hours, quantities, and
 * durations on section-input sheets (headcount, 0.5 h hours, delivery qty,
 * 0.5-day delays). The two buttons are 48×48 px with a ≥12 px gap between them
 * (PRD §9 AC-T2), and each disables at its bound so the value never leaves
 * [min, max].
 *
 * The whole control is one `adjustable` accessibility element: VoiceOver /
 * TalkBack announce "<label>, <value>, adjustable" and a swipe up/down fires
 * the OS `increment`/`decrement` actions, wired through `onAccessibilityAction`
 * (the RN-supported adjustable API) (AC-A1). The value renders in the mono font
 * so digits stay aligned as they change.
 */
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../theme';

type Props = {
  readonly value: number;
  readonly onChange: (value: number) => void;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly unitLabel?: string;
  readonly accessibilityLabel: string;
  readonly formatValue?: (value: number) => string;
  readonly disabled?: boolean;
};

/** Round to one decimal so 0.5-step math never drifts (8 → 8.5, not 8.4999999). */
function roundTo1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function Stepper({
  value,
  onChange,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
  step = 1,
  unitLabel,
  accessibilityLabel,
  formatValue,
  disabled = false,
}: Props) {
  const { colors, fonts, radii } = useTheme();

  const atMin = disabled || value <= min;
  const atMax = disabled || value >= max;

  const decrement = () => {
    if (disabled) return;
    if (atMin) return;
    onChange(Math.max(min, roundTo1(value - step)));
  };
  const increment = () => {
    if (disabled) return;
    if (atMax) return;
    onChange(Math.min(max, roundTo1(value + step)));
  };

  const displayValue = formatValue ? formatValue(value) : String(value);
  const valueText = unitLabel ? `${displayValue} ${unitLabel}` : displayValue;

  const buttonStyle = ({ pressed, disabled }: { pressed: boolean; disabled: boolean }) => [
    styles.btn,
    { borderColor: colors.border, borderRadius: radii.button, backgroundColor: colors.surface2 },
    disabled && styles.disabled,
    pressed && !disabled && styles.pressed,
  ];

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ text: valueText }}
      accessibilityState={{ disabled }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'increment') increment();
        else if (event.nativeEvent.actionName === 'decrement') decrement();
      }}
      style={styles.row}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Decrease ${accessibilityLabel}`}
        accessibilityState={{ disabled: atMin }}
        disabled={atMin}
        onPress={decrement}
        style={({ pressed }) => buttonStyle({ pressed, disabled: atMin })}
      >
        <Ionicons name="remove" size={22} color={atMin ? colors.faint : colors.accent} />
      </Pressable>

      <View style={styles.readout} importantForAccessibility="no-hide-descendants">
        <Text
          style={[
            styles.value,
            { color: disabled ? colors.faint : colors.text, fontFamily: fonts.mono.medium },
          ]}
        >
          {displayValue}
        </Text>
        {unitLabel ? (
          <Text style={[styles.unit, { color: colors.muted, fontFamily: fonts.ui.medium }]}>
            {unitLabel}
          </Text>
        ) : null}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Increase ${accessibilityLabel}`}
        accessibilityState={{ disabled: atMax }}
        disabled={atMax}
        onPress={increment}
        style={({ pressed }) => buttonStyle({ pressed, disabled: atMax })}
      >
        <Ionicons name="add" size={22} color={atMax ? colors.faint : colors.accent} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  btn: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  readout: { minWidth: 56, alignItems: 'center', justifyContent: 'center' },
  value: { fontSize: 20, letterSpacing: 0.5 },
  unit: { fontSize: 11, marginTop: 1 },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.8 },
});
