/**
 * RecentsRow — a horizontal row of small tappable chips of recently-entered
 * values (supplier names, inspectors, visitor names) that pre-fill a field in
 * one tap. Recents grow organically from day-1 use, so there is no empty-state
 * chrome: when `values` is empty the component renders nothing.
 */
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { useTheme } from '../theme';

type Props = {
  readonly values: readonly string[];
  readonly onPick: (value: string) => void;
};

export function RecentsRow({ values, onPick }: Props) {
  const { colors, fonts, radii, spacing } = useTheme();

  if (values.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[styles.row, { gap: spacing.sm }]}
    >
      {values.map((value) => (
        <Pressable
          key={value}
          accessibilityRole="button"
          accessibilityLabel={value}
          onPress={() => onPick(value)}
          style={({ pressed }) => [
            styles.chip,
            {
              borderColor: colors.border,
              borderRadius: radii.pill,
              backgroundColor: colors.surface2,
            },
            pressed && styles.pressed,
          ]}
        >
          <Text
            numberOfLines={1}
            style={[styles.label, { color: colors.muted, fontFamily: fonts.ui.medium }]}
          >
            {value}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  chip: {
    minHeight: 48,
    justifyContent: 'center',
    borderWidth: 1,
    paddingHorizontal: 12,
  },
  label: { fontSize: 13 },
  pressed: { opacity: 0.8 },
});
