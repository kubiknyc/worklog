/**
 * Chip — a dumb, controlled selectable pill for section-input surfaces (trade
 * chips, unit chips, cause chips, etc.). Selection is conveyed by an accent
 * fill AND a leading checkmark, never by color alone (PRD §9 AC-S2). The pill
 * clears the ≥48×48 px hit-area floor (AC-T1).
 */
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text } from 'react-native';

import { useTheme } from '../theme';

type Props = {
  readonly label: string;
  readonly selected: boolean;
  readonly onPress: () => void;
  readonly icon?: keyof typeof Ionicons.glyphMap;
  readonly disabled?: boolean;
};

export function Chip({ label, selected, onPress, icon, disabled = false }: Props) {
  const { colors, fonts, radii } = useTheme();
  const textColor = selected ? colors.accentInk : colors.muted;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        { borderColor: colors.border, borderRadius: radii.pill, backgroundColor: colors.surface2 },
        selected && { backgroundColor: colors.accent, borderColor: colors.accent },
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      {selected ? (
        <Ionicons
          testID="chip-check"
          name="checkmark"
          size={16}
          color={colors.accentInk}
          style={styles.check}
        />
      ) : icon ? (
        <Ionicons name={icon} size={16} color={textColor} style={styles.check} />
      ) : null}
      <Text
        numberOfLines={1}
        style={[styles.label, { color: textColor, fontFamily: fonts.ui.semibold }]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: 48,
    minWidth: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  check: { marginLeft: -2 },
  label: { fontSize: 14, letterSpacing: 0.2 },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.8 },
});
