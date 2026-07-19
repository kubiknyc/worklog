/**
 * Themed full-screen splash shown while the session is being restored, so the
 * app never flashes the login screen before routing an already-signed-in user.
 *
 * Branded lockup: the WorkLog wordmark over the company sub-line, with a
 * spinner below. (PunchLog's version rendered its BrandMark logo; WorkLog has
 * no graphic mark yet, so the lockup mirrors login.tsx's text wordmark.)
 * Stays lightweight (no heavy timeline animation) since it renders on the
 * session-restore hot path.
 */
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../theme';

export function AuthSplash() {
  const { colors, fonts } = useTheme();
  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <View style={styles.lockup}>
        <Text style={[styles.brand, { fontFamily: fonts.serif.bold, color: colors.text }]}>
          WorkLog
        </Text>
        <Text style={[styles.brandSub, { fontFamily: fonts.ui.medium, color: colors.muted }]}>
          Keystone Build Group
        </Text>
      </View>
      <ActivityIndicator size="small" color={colors.accent} style={styles.spinner} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  lockup: { alignItems: 'center', gap: 2 },
  brand: { fontSize: 30, letterSpacing: -0.5 },
  brandSub: { fontSize: 13 },
  spinner: { position: 'absolute', bottom: 72 },
});
