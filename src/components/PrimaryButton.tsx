/**
 * PrimaryButton — the full-width confirm button at the bottom of every section
 * sheet and daily-flow footer (PRD §9 AC-R1/R2: primary action in the bottom
 * 40%). `tone` picks the fill: 'primary' = theme accent, 'danger' = theme error
 * for destructive actions (AC-R4). While `busy` it shows a spinner and blocks
 * presses so a double-tap can't fire the action twice.
 */
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { useTheme } from '../theme';
import { onFillColor } from '../theme/contrast';

type Tone = 'primary' | 'danger';

type Props = {
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly busy?: boolean;
  readonly tone?: Tone;
  /**
   * Stable handle for Maestro flows. Prefer this over asserting on `label` —
   * user-facing copy is plain language and expected to change (CLAUDE.md).
   */
  readonly testID?: string;
};

export function PrimaryButton({
  label,
  onPress,
  disabled = false,
  busy = false,
  tone = 'primary',
  testID,
}: Props) {
  const { colors, fonts, radii, sizes, error } = useTheme();

  const isBlocked = disabled || busy;
  const backgroundColor = tone === 'danger' ? error : colors.accent;
  // Accent-ink is chosen to read on the accent fill. The danger fill is NOT
  // always a dark red — the comment here used to assert it was, but Blueprint's
  // error colour is #FF8A8A, a light red picked for error *text on a dark
  // surface*; white on it is 2.27:1. Derive instead of assuming (#18).
  const textColor = tone === 'danger' ? onFillColor(error) : colors.accentInk;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isBlocked, busy }}
      disabled={isBlocked}
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        { height: sizes.buttonHeight, borderRadius: radii.button, backgroundColor },
        isBlocked && styles.disabled,
        pressed && !isBlocked && styles.pressed,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <Text style={[styles.label, { color: textColor, fontFamily: fonts.ui.bold }]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 16 },
  disabled: { opacity: 0.6 },
  pressed: { opacity: 0.85 },
});
