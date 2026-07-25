import { Text, View } from 'react-native';

import { useTheme } from '../../src/theme';

export default function SettingsScreen() {
  const { colors } = useTheme();
  return (
    <View
      testID="screen-settings"
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.bg,
      }}
    >
      <Text style={{ color: colors.text }}>Settings — M2</Text>
    </View>
  );
}
