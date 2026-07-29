/**
 * Task 8's retry/discard surface: every queued mutation, plain-language, with
 * a per-row Discard for parked rows and a "Retry now" that re-queues every
 * parked mutation. Presentational — the thin route (`app/settings/sync.tsx`)
 * wires it to `useRepository().listMutations()`, `useSyncActions()`, and
 * `useToast()`, so this component (and its tests) never import a route file.
 *
 * Never-alarm contract (per-row detail): the raw `Mutation.lastError` string
 * is NEVER rendered — an offline device can carry a stack-trace-shaped string
 * like "TypeError: Network request failed", and leaking it breaks AC-O3's
 * plain-language reassurance. `rowDetailOf` maps it to one of three fixed
 * copies instead.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { isLikelyOffline } from '../lib/errors';
import type { Mutation, MutationPayload } from '../sync/types';
import { useTheme } from '../theme';
import { ConfirmSheet } from './ConfirmSheet';
import { EmptyState } from './EmptyState';
import { PrimaryButton } from './PrimaryButton';

/** Plain-language label for a queued mutation's kind. */
export function kindLabelOf(kind: MutationPayload['kind']): string {
  switch (kind) {
    case 'create_report':
      return 'New report';
    case 'update_section':
      return 'Section update';
    case 'submit_report':
      return 'Report submitted';
    case 'lock_report':
      return 'Report locked';
    case 'create_amendment':
      return 'Amendment';
    case 'add_photo':
      return 'Photo';
    case 'update_photo_meta':
      return 'Photo details';
    case 'remove_photo':
      return 'Photo removed';
  }
}

/**
 * Per-row status copy. NEVER surfaces `m.lastError` verbatim (see file
 * header). `isLikelyOffline` is called with the object shape it expects —
 * `isLikelyOffline(m.lastError)` on a bare string always returns false.
 */
export function rowDetailOf(m: Mutation): string {
  if (m.status === 'parked') return "Couldn't send — needs your attention";
  if (isLikelyOffline({ message: m.lastError })) return 'Waiting for connection';
  if (m.lastError !== null) return 'Will retry automatically';
  return 'Waiting to send';
}

/** Discard-confirm body copy: a create_report discard also drops the report's
 * entire queued subtree — that must be stated up front, not discovered after. */
export function confirmMessageOf(kind: MutationPayload['kind']): string {
  if (kind === 'create_report') {
    return 'This removes the report and its changes from this device.';
  }
  return 'This change stays on this device only.';
}

const GUARD_WIN_NOTICE = 'This change was just updated — it no longer needs attention';

type Props = {
  readonly rows: readonly Mutation[];
  /** Web has no local queue; an empty list there is normal, not "caught up". */
  readonly isWeb: boolean;
  readonly onRetry: () => void;
  /** Returns the affected-row count — 0 means a race already un-parked it. */
  readonly onDiscard: (clientId: string) => Promise<number>;
  readonly onNotice: (message: string) => void;
};

export function SyncQueueScreen({ rows, isWeb, onRetry, onDiscard, onNotice }: Props) {
  const { colors, fonts, sizes, spacing } = useTheme();
  const [confirmTarget, setConfirmTarget] = useState<Mutation | null>(null);
  const hasParked = rows.some((m) => m.status === 'parked');

  const handleConfirmDiscard = async () => {
    const target = confirmTarget;
    setConfirmTarget(null);
    if (!target) return;
    const affected = await onDiscard(target.clientId);
    if (affected === 0) {
      onNotice(GUARD_WIN_NOTICE);
    }
  };

  return (
    <View testID="sync-queue-screen" style={[styles.root, { backgroundColor: colors.bg }]}>
      {hasParked ? (
        <View style={{ paddingHorizontal: sizes.screenPad, paddingTop: spacing.md }}>
          <PrimaryButton testID="sync-queue-retry" label="Retry now" onPress={onRetry} />
        </View>
      ) : null}

      {rows.length === 0 ? (
        isWeb ? (
          <View style={styles.centered}>
            <Text style={{ color: colors.muted, fontFamily: fonts.ui.regular }}>
              Sync runs automatically while online
            </Text>
          </View>
        ) : (
          <EmptyState icon="checkmark-circle-outline" title="Nothing queued" />
        )
      ) : (
        <View style={{ padding: sizes.screenPad, gap: spacing.sm }}>
          {rows.map((m) => (
            <View
              key={m.clientId}
              testID={`sync-queue-row-${m.clientId}`}
              style={[styles.row, { backgroundColor: colors.surface2, borderColor: colors.border }]}
            >
              <View style={styles.rowBody}>
                <Text style={[styles.rowLabel, { color: colors.text, fontFamily: fonts.ui.semibold }]}>
                  {kindLabelOf(m.payload.kind)}
                </Text>
                <Text style={[styles.rowDetail, { color: colors.muted, fontFamily: fonts.ui.regular }]}>
                  {rowDetailOf(m)}
                </Text>
              </View>
              {m.status === 'parked' ? (
                <Pressable
                  testID={`sync-queue-discard-${m.clientId}`}
                  accessibilityRole="button"
                  accessibilityLabel={`Discard ${kindLabelOf(m.payload.kind)}`}
                  onPress={() => setConfirmTarget(m)}
                  hitSlop={8}
                  style={({ pressed }) => pressed && styles.pressed}
                >
                  <Text style={{ color: colors.accent, fontFamily: fonts.ui.semibold }}>Discard</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
        </View>
      )}

      <ConfirmSheet
        visible={confirmTarget !== null}
        title="Discard this change?"
        message={confirmTarget ? confirmMessageOf(confirmTarget.payload.kind) : undefined}
        confirmLabel="Discard"
        cancelLabel="Cancel"
        onConfirm={() => void handleConfirmDiscard()}
        onClose={() => setConfirmTarget(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  rowBody: { flex: 1, gap: 2 },
  rowLabel: { fontSize: 15 },
  rowDetail: { fontSize: 13 },
  pressed: { opacity: 0.6 },
});
