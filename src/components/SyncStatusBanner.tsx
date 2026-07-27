/**
 * Glanceable sync status pill (PRD AC-O3): plain-language reassurance that
 * offline work is safe. Offline/queued is a NORMAL state — neutral colors,
 * never red (PRD §9). Not tappable in M2; the tap-through retry surface is M3.
 *
 * Machine-readable state for Maestro: the outer node carries the static
 * `sync-status` testID, the label Text carries `sync-status-<state>` —
 * E2E flows assert on the id, never the copy.
 *
 * In M2 only `synced` and `queued` are reachable (no engine sets `syncing`,
 * nothing parks). `syncing`/`attention` render correctly but wait for M3's
 * producers.
 */
import { StyleSheet, Text, View } from 'react-native';

import { useSyncStatus } from '../hooks/useSyncStatus';
import type { HubSyncState } from '../sync/statusHub';
import { useTheme } from '../theme';

export type SyncBannerState = 'synced' | 'queued' | 'syncing' | 'attention';

/**
 * Precedence: parked > syncing > countError > pending > synced. `syncing`
 * outranks `countError` deliberately — once M3 lands, a transient count
 * failure must not mask an in-progress send.
 */
export function bannerStateOf(s: HubSyncState): SyncBannerState {
  if (s.parked > 0) return 'attention';
  if (s.syncing) return 'syncing';
  if (s.countError) return 'attention';
  if (s.pending > 0) return 'queued';
  return 'synced';
}

/** AC-O3 copy (plus the M2-only countError string — recorded in the M3 handoff). */
export function bannerLabelOf(state: SyncBannerState, s: HubSyncState): string {
  switch (state) {
    case 'synced':
      return 'All saved to the cloud';
    case 'queued':
      return `${s.pending} ${s.pending === 1 ? 'change' : 'changes'} waiting to send`;
    case 'syncing':
      return 'Sending…';
    case 'attention':
      if (s.parked > 0) {
        return `${s.parked} ${s.parked === 1 ? 'change needs' : 'changes need'} attention`;
      }
      return "Can't check sync status";
  }
}

type Props = {
  readonly syncState: HubSyncState;
};

export function SyncStatusBanner({ syncState }: Props) {
  const { colors, fonts, priority } = useTheme();
  const state = bannerStateOf(syncState);
  const label = bannerLabelOf(state, syncState);
  // Neutral for synced/queued/syncing (offline is a normal state, no red).
  // `attention` reuses the per-theme amber priority.medium token (AC-S1 ratios
  // for this usage: #E8A100 ≈6.8:1 on Blueprint's dark surface, #A36C00 ≈4:1
  // on Editorial, #855700 ≈5.6:1 on Béton — all clear the ≥3:1 UI floor and
  // the state is never conveyed by color alone, AC-S2: dot + label).
  const color = state === 'attention' ? priority.medium : colors.muted;

  return (
    <View
      testID="sync-status"
      accessible
      accessibilityLabel={label}
      // Android announces the pill's state changes; iOS VoiceOver reads the
      // label on focus (AC-A1 scoped — no announceForAccessibility in M2).
      accessibilityLiveRegion="polite"
      style={[styles.pill, { backgroundColor: `${color}14` }]}
    >
      <View style={[styles.dot, { backgroundColor: color }]} />
      {/* The machine-readable state id rides the label Text, not the decorative
          dot: Android prunes text-less leaf Views inside an `accessible`
          parent from the accessibility tree Maestro reads. */}
      <Text
        testID={`sync-status-${state}`}
        style={[styles.label, { color, fontFamily: fonts.ui.semibold }]}
      >
        {label}
      </Text>
    </View>
  );
}

/**
 * Self-subscribing wrapper for screen mounts: confines the per-nudge re-render
 * to the pill instead of the whole screen subtree (section edits nudge every
 * 400ms-debounced autosave).
 */
export function ConnectedSyncStatusBanner() {
  return <SyncStatusBanner syncState={useSyncStatus()} />;
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    gap: 6,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  label: { fontSize: 12.5, letterSpacing: 0.2 },
});
