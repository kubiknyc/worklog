/**
 * Camera (placeholder until capture ships). User-facing copy describes the
 * feature rather than naming an internal milestone — "Camera — M5" told crews
 * about a roadmap they have no context for (#20).
 */
import { View } from 'react-native';

import { EmptyState } from '../../src/components';
import { useTheme } from '../../src/theme';

export default function CameraScreen() {
  const { colors } = useTheme();
  return (
    <View
      testID="screen-camera"
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.bg,
      }}
    >
      <EmptyState
        testID="camera-empty"
        icon="camera-outline"
        title="Photo capture isn't ready yet"
        subtitle="You'll be able to take site photos straight into the day's report."
      />
    </View>
  );
}
