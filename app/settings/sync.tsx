/**
 * Thin route for Task 8's retry/discard surface — wires the presentational
 * `SyncQueueScreen` to the real repository, sync actions, and toast context.
 * Jest ignores `app/` entirely; this file stays free of logic worth testing.
 */
import { Platform } from 'react-native';

import { SyncQueueScreen } from '../../src/components';
import { useToast } from '../../src/components/ToastProvider';
import { useRepository, useSyncActions } from '../../src/data';
import { useAsyncData } from '../../src/hooks/useAsyncData';
import { useRefreshOnQueueChange } from '../../src/hooks/useRefreshOnQueueChange';

export default function SyncQueueRoute() {
  const repo = useRepository();
  const { retrySync, discardSync } = useSyncActions();
  const { show } = useToast();
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
    <SyncQueueScreen
      rows={data ?? []}
      isWeb={Platform.OS === 'web'}
      onRetry={() => void handleRetry()}
      onDiscard={handleDiscard}
      onNotice={show}
    />
  );
}
