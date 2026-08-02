/**
 * Photos (placeholder until the gallery ships). User-facing copy describes what
 * will appear here rather than naming an internal milestone (#20).
 */
import { View } from 'react-native';

import { EmptyState } from '../../src/components';
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
      <EmptyState
        testID="photos-empty"
        icon="images-outline"
        title="No photos yet"
        subtitle="Photos you attach to a report will be collected here."
      />
    </View>
  );
}
