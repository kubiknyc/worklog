import { Text, View } from 'react-native';

import { useTheme } from '../../src/theme';

export default function TodayScreen() {
  const { colors } = useTheme();
  return (
    <View
      testID="screen-today"
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.bg,
      }}
    >
      <Text style={{ color: colors.text }}>Today — M2</Text>
    </View>
  );
}
