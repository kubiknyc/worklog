/**
 * ReportDetailSections — the report-detail body: one tappable row per report
 * row in PRD §7 display order (crew + work_performed grouped into one row),
 * each showing its label, a one-line summary, and a state affordance (accent
 * chevron when filled, a check when a deliberate "None today", muted chevron
 * when untouched). Presentational only — it takes precomputed
 * {@link SectionSummary}s and reports taps up via `onOpen`.
 *
 * `row.mode === 'pending'` gates which rows are interactive: a row whose
 * editor sheet has not been built yet renders its summary but sits dimmed and
 * non-pressable, so the list is always complete while sheets land incrementally.
 */
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import type { ReportRow } from '../../report/sectionMeta';
import type { SectionSummary } from '../../report/summarize';
import { useTheme } from '../../theme';
import { SheetRow } from '../SheetRow';

type Props = {
  readonly rows: readonly ReportRow[];
  readonly summaries: Record<string, SectionSummary>;
  readonly onOpen: (rowId: string) => void;
};

export function ReportDetailSections({ rows, summaries, onOpen }: Props) {
  const { colors, fonts, spacing, reportStatus } = useTheme();

  return (
    <View style={{ gap: spacing.sm }}>
      {rows.map((row) => {
        const summary = summaries[row.id];
        const isInteractive = row.mode === 'interactive';
        // Filled → primary text; deliberate none → locked-green; empty → faint.
        const summaryColor =
          summary.state === 'filled'
            ? colors.text
            : summary.state === 'none'
              ? reportStatus.locked
              : colors.faint;

        const trailing = !isInteractive ? (
          <Text style={[styles.soon, { color: colors.faint, fontFamily: fonts.ui.semibold }]}>
            Soon
          </Text>
        ) : summary.state === 'none' ? (
          <Ionicons name="checkmark-circle" size={20} color={reportStatus.locked} />
        ) : (
          <Ionicons name="chevron-forward" size={18} color={colors.faint} />
        );

        return (
          <View key={row.id} style={!isInteractive && styles.dimmed}>
            <SheetRow
              testID={`report-section-${row.id}`}
              onPress={() => isInteractive && onOpen(row.id)}
              accessibilityLabel={`${row.label}. ${summary.text}`}
              icon={row.icon}
              trailing={trailing}
            >
              <Text
                numberOfLines={1}
                style={[styles.label, { color: colors.text, fontFamily: fonts.ui.semibold }]}
              >
                {row.label}
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
