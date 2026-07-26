/**
 * EntryCard — the shared bordered card (title + trash + body) every list
 * section sheet repeats. Presentational only; no state.
 */
import { Ionicons } from '@expo/vector-icons';
import { type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../../theme';

type Props = {
  readonly title: string;
  readonly onRemove: () => void;
  /** Seeded by carry-forward (M6); dashed border + affix until touched. */
  readonly carried?: boolean;
  readonly children: ReactNode;
};

export function EntryCard({ title, onRemove, carried = false, children }: Props) {
  const { colors, fonts } = useTheme();
  return (
    <View
      style={[
        styles.card,
        { borderColor: colors.border, backgroundColor: colors.surface2 },
        carried && styles.carried,
      ]}
    >
      <View style={styles.head}>
        <Text style={[styles.title, { color: colors.text, fontFamily: fonts.ui.semibold }]}>
          {title}
          {carried ? (
            <Text style={[styles.affix, { color: colors.faint, fontFamily: fonts.ui.regular }]}>
              {'  · from yesterday'}
            </Text>
          ) : null}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove ${title}`}
          onPress={onRemove}
          hitSlop={8}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <Ionicons name="trash-outline" size={20} color={colors.faint} />
        </Pressable>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 10 },
  carried: { borderStyle: 'dashed' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 16 },
  affix: { fontSize: 12 },
  pressed: { opacity: 0.6 },
});
