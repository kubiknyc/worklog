import { router } from 'expo-router';
import { Text, View } from 'react-native';

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
        justifyContent: 'center',
        backgroundColor: colors.bg,
        gap: 16,
      }}
    >
      <Text style={{ color: colors.text }}>Settings — M2</Text>
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
