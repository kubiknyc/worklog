/**
 * Thin route for Task 8's retry/discard surface — wires the presentational
 * `SyncQueueScreen` to the real repository, sync actions, and toast context.
 * Jest ignores `app/` entirely; this file stays free of logic worth testing.
 *
 * The header exists because headers are disabled globally
 * (`app/_layout.tsx`, `<Stack screenOptions={{ headerShown: false }} />`) and
 * this route had no in-content back control. On iOS there is no hardware back,
 * so the only exit was a horizontal edge-swipe drag — which PRD AC-T3 forbids
 * as the sole path ("taps and vertical swipes only") and AC-T4 requires a tap
 * equivalent for. The sibling detail route already did this correctly; the
 * invariant was simply dropped here (#23). Pattern copied from `report-back`,
 * but NOT its old hit target: `hitSlopFor` derives the slop so the tappable
 * area clears the 48px floor instead of landing at 46px (#19).
 */
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SyncQueueScreen } from '../../src/components';
import { useToast } from '../../src/components/ToastProvider';
import { useRepository, useSyncActions } from '../../src/data';
import { useAsyncData } from '../../src/hooks/useAsyncData';
import { useRefreshOnQueueChange } from '../../src/hooks/useRefreshOnQueueChange';
import { useTheme } from '../../src/theme';
import { hitSlopFor } from '../../src/theme/touchTarget';

const BACK_ICON_SIZE = 26;

export default function SyncQueueRoute() {
  const repo = useRepository();
  const { retrySync, discardSync, degraded } = useSyncActions();
  const { show } = useToast();
  const { colors, fonts, sizes } = useTheme();
  const { data, reload } = useAsyncData(() => repo.listMutations(), [repo]);
  // `handleRetry`'s own reload() only lands after the whole drain resolves, so
  // without this the screen keeps offering Discard on rows that are already
  // unparked and in flight. Counts change the moment retryParked() unparks.
  useRefreshOnQueueChange(reload);

  const handleRetry = async () => {
    await retrySync();
    reload();
  };

  const handleDiscard = async (clientId: string) => {
    const affected = await discardSync(clientId);
    reload();
    return affected;
  };

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top']}>
      <View style={[styles.header, { paddingHorizontal: sizes.screenPad }]}>
        <Pressable
          testID="sync-back"
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          hitSlop={hitSlopFor(BACK_ICON_SIZE)}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <Ionicons name="chevron-back" size={BACK_ICON_SIZE} color={colors.text} />
        </Pressable>
        <Text style={[styles.title, { color: colors.text, fontFamily: fonts.ui.extrabold }]}>
          Sync queue
        </Text>
        {/* Balances the back control so the title stays optically centred. */}
        <View style={styles.headerSpacer} />
      </View>
      <SyncQueueScreen
        rows={data ?? []}
        isWeb={Platform.OS === 'web'}
        degraded={degraded}
        onRetry={() => void handleRetry()}
        onDiscard={handleDiscard}
        onNotice={show}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', height: 52, gap: 8 },
  title: { fontSize: 18, flex: 1, textAlign: 'center' },
  headerSpacer: { width: BACK_ICON_SIZE },
  pressed: { opacity: 0.6 },
});
