/**
 * ReportDetailSections — the report-detail body: one tappable row per section
 * in PRD §7 display order, each showing its label, a one-line summary, and a
 * state affordance (accent chevron when filled, a check when a deliberate
 * "None today", muted chevron when untouched). Presentational only — it takes
 * precomputed {@link SectionSummary}s and reports taps up via `onOpen`.
 *
 * `enabledKinds` gates which rows are interactive: a section whose editor sheet
 * has not been built yet renders its summary but sits dimmed and non-pressable,
 * so the list is always complete (all 11 sections visible) while the sheets
 * land incrementally across M2.
 */
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { SECTION_META } from '../../report/sectionMeta';
import type { SectionSummary } from '../../report/summarize';
import type { SectionKind } from '../../sync/types';
import { useTheme } from '../../theme';
import { SheetRow } from '../SheetRow';

type Props = {
  readonly summaries: Readonly<Record<SectionKind, SectionSummary>>;
  /** Sections whose editor sheet exists; others render read-only/dimmed. */
  readonly enabledKinds: readonly SectionKind[];
  readonly onOpen: (kind: SectionKind) => void;
};

export function ReportDetailSections({ summaries, enabledKinds, onOpen }: Props) {
  const { colors, fonts, spacing, reportStatus } = useTheme();
  const enabled = new Set(enabledKinds);

  return (
    <View style={{ gap: spacing.sm }}>
      {SECTION_META.map((meta) => {
        const summary = summaries[meta.kind];
        const isEnabled = enabled.has(meta.kind);
        // Filled → primary text; deliberate none → locked-green; empty → faint.
        const summaryColor =
          summary.state === 'filled'
            ? colors.text
            : summary.state === 'none'
              ? reportStatus.locked
              : colors.faint;

        const trailing = !isEnabled ? (
          <Text style={[styles.soon, { color: colors.faint, fontFamily: fonts.ui.semibold }]}>
            Soon
          </Text>
        ) : summary.state === 'none' ? (
          <Ionicons name="checkmark-circle" size={20} color={reportStatus.locked} />
        ) : (
          <Ionicons name="chevron-forward" size={18} color={colors.faint} />
        );

        return (
          <View key={meta.kind} style={!isEnabled && styles.dimmed}>
            <SheetRow
              testID={`report-section-${meta.kind}`}
              onPress={() => isEnabled && onOpen(meta.kind)}
              accessibilityLabel={`${meta.label}. ${summary.text}`}
              icon={meta.icon}
              trailing={trailing}
            >
              <Text
                numberOfLines={1}
                style={[styles.label, { color: colors.text, fontFamily: fonts.ui.semibold }]}
              >
                {meta.label}
              </Text>
              <Text
                numberOfLines={1}
                style={[styles.summary, { color: summaryColor, fontFamily: fonts.ui.regular }]}
              >
                {summary.text}
              </Text>
            </SheetRow>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  dimmed: { opacity: 0.5 },
  label: { fontSize: 15 },
  summary: { fontSize: 13, marginTop: 2 },
  soon: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 },
});
