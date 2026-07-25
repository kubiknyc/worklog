/**
 * A tappable row inside a BottomSheet: optional leading icon/element, a text
 * label or arbitrary children, and an optional trailing accessory (e.g. a
 * selected check). Keeps the sheet lists visually consistent.
 */
import { Ionicons } from '@expo/vector-icons';
import { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../theme';

type Props = {
  readonly onPress: () => void;
  readonly accessibilityLabel: string;
  readonly icon?: keyof typeof Ionicons.glyphMap;
  readonly label?: string;
  readonly leading?: ReactNode;
  readonly trailing?: ReactNode;
  readonly children?: ReactNode;
  /**
   * Stable handle for Maestro flows. Prefer this over asserting on
   * `accessibilityLabel` — user-facing copy is plain language and expected to
   * change (CLAUDE.md).
   */
  readonly testID?: string;
};

export function SheetRow({
  onPress,
  accessibilityLabel,
  icon,
  label,
  leading,
  trailing,
  children,
  testID,
}: Props) {
  const { colors, fonts, radii } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: colors.surface2, borderColor: colors.border, borderRadius: radii.pill },
        pressed && styles.pressed,
      ]}
    >
      {leading ??
        (icon ? (
          <View style={styles.iconWrap}>
            <Ionicons name={icon} size={20} color={colors.accent} />
          </View>
        ) : null)}
      <View style={styles.body}>
        {label ? (
          <Text
            numberOfLines={1}
            style={[styles.label, { color: colors.text, fontFamily: fonts.ui.semibold }]}
          >
            {label}
          </Text>
        ) : (
          children
        )}
      </View>
      {trailing ?? null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, padding: 12 },
  iconWrap: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1 },
  label: { fontSize: 15 },
  pressed: { opacity: 0.8 },
});
