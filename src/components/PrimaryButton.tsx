/**
 * PrimaryButton — the full-width confirm button at the bottom of every section
 * sheet and daily-flow footer (PRD §9 AC-R1/R2: primary action in the bottom
 * 40%). `tone` picks the fill: 'primary' = theme accent, 'danger' = theme error
 * for destructive actions (AC-R4). While `busy` it shows a spinner and blocks
 * presses so a double-tap can't fire the action twice.
 */
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { useTheme } from '../theme';

type Tone = 'primary' | 'danger';

type Props = {
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly busy?: boolean;
  readonly tone?: Tone;
};

export function PrimaryButton({
  label,
  onPress,
  disabled = false,
  busy = false,
  tone = 'primary',
}: Props) {
  const { colors, fonts, radii, sizes, error } = useTheme();

  const isBlocked = disabled || busy;
  const backgroundColor = tone === 'danger' ? error : colors.accent;
  // Accent-ink reads on the accent fill; danger fills are dark reds → white.
  const textColor = tone === 'danger' ? '#FFFFFF' : colors.accentInk;

  return (
    <Pressable
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
