import { Text, View } from 'react-native';

import { useTheme } from '../../src/theme';

export default function PhotosScreen() {
  const { colors } = useTheme();
  return (
    <View
      testID="screen-photos"
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.bg,
      }}
    >
      <Text style={{ color: colors.text }}>Photos — M2</Text>
    </View>
  );
}
