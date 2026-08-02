/**
 * Settings. The tab bar already titles this screen, so it carries no heading of
 * its own — it used to render "Settings — M2", leaking an internal milestone
 * name to users (#20). Rows are top-aligned so the list grows downward as
 * settings are added.
 */
import { router } from 'expo-router';
import { View } from 'react-native';

import { SheetRow } from '../../src/components';
import { useTheme } from '../../src/theme';

export default function SettingsScreen() {
  const { colors, sizes } = useTheme();
  return (
    <View
      testID="screen-settings"
      style={{
        flex: 1,
        alignItems: 'center',
        backgroundColor: colors.bg,
        paddingTop: sizes.screenPad,
        gap: 16,
      }}
    >
      <View style={{ width: '100%', paddingHorizontal: sizes.screenPad }}>
        <SheetRow
          testID="settings-sync-link"
          icon="sync-outline"
          label="Sync queue"
          accessibilityLabel="Sync queue"
          onPress={() => router.push('/settings/sync')}
        />
      </View>
    </View>
  );
}
