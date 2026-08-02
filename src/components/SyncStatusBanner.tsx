/**
 * Glanceable sync status pill (PRD AC-O3): plain-language reassurance that
 * offline work is safe. Offline/queued is a NORMAL state — neutral colors,
 * never red (PRD §9). Task 8: tappable via an injected `onPress` — the
 * connected wrapper routes it to `/settings/sync`, the retry/discard surface.
 *
 * Machine-readable state for Maestro: the outer node carries the static
 * `sync-status` testID, the label Text carries `sync-status-<state>` —
 * E2E flows assert on the id, never the copy.
 */
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useSyncActions } from '../data/RepositoryProvider';
import { useSyncStatus } from '../hooks/useSyncStatus';
import type { HubSyncState } from '../sync/statusHub';
import { useTheme } from '../theme';
import { hitSlopFor } from '../theme/touchTarget';

/**
 * Rendered height of the pill: `paddingVertical: 5` on each side plus the
 * 12.5px label's line box (~17px). Kept beside the styles it derives from so a
 * padding or font-size change here is visibly a touch-target change too.
 */
const PILL_CONTENT_HEIGHT = 27;

export type SyncBannerState =
  'synced' | 'queued' | 'syncing' | 'attention' | 'degraded' | 'offline';

/**
 * Precedence (Task 11 extends the pinned M2/M3 table with two rows):
 * parked > degraded > offline > syncing > countError > lastError > pending > synced.
 *
 * `degraded` (the provider fell back to the online-only Supabase repo)
 * outranks everything below it except an unwedging `parked` row — a fallback
 * changes what the app IS, so it must be visible over a transient sync detail.
 * `offline` (`!online && pending > 0`) outranks `syncing`/`countError`/
 * `lastError`/`pending` because those are all sync-in-progress-or-failed
 * states that can't be true while genuinely offline; it's really disambiguating
 * "queued" into an offline-flavored variant. `!online && pending === 0`
 * deliberately falls through every offline check to `synced` below — nothing
 * is queued, so "all saved" is true and there is nothing to alarm about
 * (never-alarm contract, AC-O6).
 *
 * `syncing` still outranks `countError` — a transient count failure must
 * never mask an in-progress send. `lastError` (Task 8: the M3 engine's last
 * *sync* error, distinct from the hub's own `countError`) slots between
 * `countError` and `pending` — a real send failure outranks "changes waiting"
 * but never outranks an in-flight count problem or an active sync.
 */
export function bannerStateOf(s: HubSyncState, degraded = false): SyncBannerState {
  if (s.parked > 0) return 'attention';
  if (degraded) return 'degraded';
  if (!s.online && s.pending > 0) return 'offline';
  if (s.syncing) return 'syncing';
  if (s.countError) return 'attention';
  if (s.lastError !== null) return 'attention';
  if (s.pending > 0) return 'queued';
  return 'synced';
}

/** AC-O3 copy (plus the countError and lastError attention sub-copies). */
export function bannerLabelOf(state: SyncBannerState, s: HubSyncState): string {
  switch (state) {
    case 'synced':
      return 'All saved to the cloud';
    case 'queued':
      return `${s.pending} ${s.pending === 1 ? 'change' : 'changes'} waiting to send`;
    case 'syncing':
      return 'Sending…';
    case 'degraded':
      return 'Offline features unavailable — using online mode';
    case 'offline':
      // The count IS the message (never-alarm, AC-O6) — being offline with
      // work queued is a normal, expected state, not a problem to flag.
      return `${s.pending} ${s.pending === 1 ? 'change' : 'changes'} waiting to send — offline`;
    case 'attention':
      if (s.parked > 0) {
        return `${s.parked} ${s.parked === 1 ? 'change needs' : 'changes need'} attention`;
      }
      if (s.countError) return "Can't check sync status";
      return 'Sync problem — tap to review';
  }
}

type Props = {
  readonly syncState: HubSyncState;
  /**
   * True when the provider has fallen back to the online-only Supabase repo
   * (Task 11). Optional so every existing call site keeps compiling; defaults
   * to false (the pre-Task-11 behavior).
   */
  readonly degraded?: boolean;
  /** When provided, the pill becomes pressable (Task 8: routes to the queue screen). */
  readonly onPress?: () => void;
};

export function SyncStatusBanner({ syncState, degraded = false, onPress }: Props) {
  const { colors, fonts, priority } = useTheme();
  const state = bannerStateOf(syncState, degraded);
  const label = bannerLabelOf(state, syncState);
  // Neutral for synced/queued/syncing/degraded/offline (offline — and a
  // degraded fallback — are normal, explained states, never conveyed as an
  // error; PRD §9: never red for anything but a genuine unwedging need).
  // `attention` reuses the per-theme amber priority.medium token (AC-S1 ratios
  // for this usage: #E8A100 ≈6.8:1 on Blueprint's dark surface, #A36C00 ≈4:1
  // on Editorial, #855700 ≈5.6:1 on Béton — all clear the ≥3:1 UI floor and
  // the state is never conveyed by color alone, AC-S2: dot + label).
  const color = state === 'attention' ? priority.medium : colors.muted;

  return (
    <Pressable
      testID="sync-status"
      accessible
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={label}
      // Android announces the pill's state changes; iOS VoiceOver reads the
      // label on focus (AC-A1 scoped — no announceForAccessibility in M2).
      accessibilityLiveRegion="polite"
      onPress={onPress}
      // The pill is deliberately small — it sits in fixed chrome on every
      // screen — but small is not the same as hard to hit. Its rendered box is
      // ~27px (5px padding each side plus a 12.5px label), so it needs slop to
      // clear the 48px floor. Extends the touch area without moving pixels (#19).
      hitSlop={hitSlopFor(PILL_CONTENT_HEIGHT)}
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
    </Pressable>
  );
}

/**
 * Self-subscribing wrapper for screen mounts: confines the per-nudge re-render
 * to the pill instead of the whole screen subtree (section edits nudge every
 * 400ms-debounced autosave). Tapping it opens the retry/discard queue screen.
 */
export function ConnectedSyncStatusBanner() {
  const { degraded } = useSyncActions();
  return (
    <SyncStatusBanner
      syncState={useSyncStatus()}
      degraded={degraded}
      onPress={() => router.push('/settings/sync')}
    />
  );
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
