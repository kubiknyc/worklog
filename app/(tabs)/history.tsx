/**
 * History (placeholder until the report list ships). Copy is user-facing, so it
 * describes what will appear here rather than naming an internal milestone —
 * "History — M2" leaked the roadmap to site crews (#20).
 */
import { View } from 'react-native';

import { EmptyState } from '../../src/components';
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
      <EmptyState
        testID="history-empty"
        icon="time-outline"
        title="No past reports yet"
        subtitle="Reports you finish will be listed here, newest first."
      />
    </View>
  );
}
