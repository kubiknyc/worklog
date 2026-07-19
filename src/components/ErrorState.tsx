/**
 * Centered error-state: red alert icon, message, and a "Try again" retry button.
 */
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../theme';

type Props = {
  readonly message?: string;
  readonly onRetry: () => void;
};

export function ErrorState({ message = 'Something went wrong.', onRetry }: Props) {
  const { colors, fonts, radii, error } = useTheme();

  return (
    <View style={styles.root}>
      <View
        style={[styles.iconWrap, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <Ionicons name="alert-circle-outline" size={30} color={error} />
      </View>
      <Text style={[styles.message, { color: colors.text, fontFamily: fonts.ui.medium }]}>
        {message}
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={onRetry}
        style={({ pressed }) => [
          styles.retry,
          {
            borderColor: colors.border,
            backgroundColor: colors.surface,
            borderRadius: radii.button,
          },
          pressed && styles.pressed,
        ]}
      >
        <Ionicons name="refresh" size={16} color={colors.accent} />
        <Text style={[styles.retryText, { color: colors.accent, fontFamily: fonts.ui.bold }]}>
          Try again
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 56,
    paddingHorizontal: 32,
    gap: 12,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  message: { fontSize: 15, textAlign: 'center', lineHeight: 21, maxWidth: 300 },
  retry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    height: 46,
    paddingHorizontal: 20,
    marginTop: 2,
  },
  retryText: { fontSize: 15 },
  pressed: { opacity: 0.85 },
});
