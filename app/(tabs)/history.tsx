/**
 * History (M10) — every report for the active project, newest first. Reads
 * `repo.listReports` (native: local SQLite, the offline-first read path; web:
 * the `daily_reports` RLS-scoped select) and opens the existing report route
 * on tap, same as Today's "open today's report" card.
 */
import { router } from 'expo-router';
import { useCallback } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  EmptyState,
  ListSkeleton,
  PrimaryButton,
  ReportStatusChip,
  SheetRow,
} from '../../src/components';
import { useRepository } from '../../src/data';
import type { DailyReportRow } from '../../src/data/types';
import { useAsyncData } from '../../src/hooks/useAsyncData';
import { useRefreshOnFocusAndSync } from '../../src/hooks/useRefreshOnFocusAndSync';
import { useActiveProject } from '../../src/project';
import { useTheme } from '../../src/theme';

/** "2026-07-24" → "Thu, Jul 24" — compact, list-row scale (Today's formatToday
 * is the full-width single-report version of the same parse). */
function formatRowDate(reportDate: string): string {
  const parsed = new Date(`${reportDate}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return reportDate;
  return parsed.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export default function HistoryScreen() {
  const { activeProjectId, ready } = useActiveProject();
  const { colors, fonts, spacing, sizes } = useTheme();
  const repo = useRepository();

  const load = useCallback(async (): Promise<readonly DailyReportRow[]> => {
    if (!activeProjectId) return [];
    return repo.listReports(activeProjectId);
  }, [repo, activeProjectId]);

  const { data: reports, loading, error, reload } = useAsyncData(load, [activeProjectId]);

  // Same refresh triggers as Today: screen focus, and a completed engine pull
  // (a report submitted/locked elsewhere, or the first Tier-2 pull landing).
  useRefreshOnFocusAndSync(reload);

  const openReport = useCallback((reportId: string) => {
    router.push(`/report/${reportId}`);
  }, []);

  return (
    <SafeAreaView
      testID="screen-history"
      style={[styles.root, { backgroundColor: colors.bg }]}
      edges={['top']}
    >
      <ScrollView
        contentContainerStyle={[styles.content, { padding: sizes.screenPad, gap: spacing.md }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.kicker, { color: colors.muted, fontFamily: fonts.ui.semibold }]}>
          HISTORY
        </Text>

        {!ready || (loading && !reports) ? (
          <ListSkeleton count={5} />
        ) : error ? (
          <View style={{ gap: spacing.md }}>
            <EmptyState
              icon="cloud-offline-outline"
              title="Couldn't load history"
              subtitle={error.message}
            />
            <PrimaryButton testID="history-retry" label="Try again" onPress={reload} />
          </View>
        ) : !activeProjectId ? (
          <EmptyState
            testID="history-empty"
            icon="business-outline"
            title="No project yet"
            subtitle="Create or join a project to see its past reports."
          />
        ) : !reports || reports.length === 0 ? (
          <EmptyState
            testID="history-empty"
            icon="time-outline"
            title="No past reports yet"
            subtitle="Reports you finish will be listed here, newest first."
          />
        ) : (
          reports.map((report) => (
            <SheetRow
              key={report.id}
              testID={`history-row-${report.id}`}
              accessibilityLabel={`Report for ${formatRowDate(report.report_date)}, ${report.status}`}
              onPress={() => openReport(report.id)}
              icon="document-text-outline"
              trailing={<ReportStatusChip status={report.status} size="sm" />}
            >
              <Text
                numberOfLines={1}
                style={[styles.rowDate, { color: colors.text, fontFamily: fonts.ui.semibold }]}
              >
                {formatRowDate(report.report_date)}
              </Text>
            </SheetRow>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flexGrow: 1 },
  kicker: { fontSize: 12, letterSpacing: 1.2 },
  rowDate: { fontSize: 15 },
});
