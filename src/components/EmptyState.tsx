/**
 * Centered empty-state: icon, title, optional subtitle.
 */
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../theme';

type Props = {
  readonly icon?: keyof typeof Ionicons.glyphMap;
  readonly title: string;
  readonly subtitle?: string;
};

export function EmptyState({ icon = 'file-tray-outline', title, subtitle }: Props) {
  const { colors, fonts } = useTheme();

  return (
    <View style={styles.root}>
      <View
        style={[styles.iconWrap, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <Ionicons name={icon} size={30} color={colors.faint} />
      </View>
      <Text style={[styles.title, { color: colors.text, fontFamily: fonts.serif.semibold }]}>
        {title}
      </Text>
      {subtitle ? (
        <Text style={[styles.subtitle, { color: colors.muted, fontFamily: fonts.ui.regular }]}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 56,
    paddingHorizontal: 32,
    gap: 10,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  title: { fontSize: 17, textAlign: 'center', letterSpacing: -0.2 },
  subtitle: { fontSize: 14, textAlign: 'center', lineHeight: 20, maxWidth: 280 },
});
