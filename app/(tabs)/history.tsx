import { Text, View } from 'react-native';

import { useTheme } from '../../src/theme';

export default function HistoryScreen() {
  const { colors } = useTheme();
  return (
    <View
      testID="screen-history"
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.bg,
      }}
    >
      <Text style={{ color: colors.text }}>History — M2</Text>
    </View>
  );
}
