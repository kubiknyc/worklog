/**
 * Today (M2) — the entry point into the current day's report. Resolves the
 * active project, computes today's date in the PROJECT's timezone
 * (computeReportDate, never the naive device day), and either opens the
 * existing draft or offers to start one. Creating is an explicit tap
 * (get-or-create create_report), never a side effect of viewing — Today reads
 * the local row first (PRD §11.7), so a same-day double-create can't happen.
 */
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  ConnectedSyncStatusBanner,
  DetailSkeleton,
  EmptyState,
  PrimaryButton,
  ReportStatusChip,
  useToast,
} from '../../src/components';
import { useRepository } from '../../src/data';
import { computeReportDate } from '../../src/data/reportDate';
import { useAsyncData } from '../../src/hooks/useAsyncData';
import { useActiveProject } from '../../src/project';
import { syncStatusHub } from '../../src/sync/statusHub';
import { useTheme } from '../../src/theme';

/** "2026-07-24" → "Thursday, July 24". */
function formatToday(reportDate: string): string {
  const parsed = new Date(`${reportDate}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return reportDate;
  return parsed.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

export default function TodayScreen() {
  const { activeProjectId, ready } = useActiveProject();
  const { colors, fonts, spacing, sizes, radii } = useTheme();
  const repo = useRepository();
  const toast = useToast();
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    if (!activeProjectId) return { project: null, report: null, reportDate: null };
    const project = await repo.getProject(activeProjectId);
    const reportDate = computeReportDate(project?.timezone ?? null, new Date());
    const report = await repo.getReportByDate(activeProjectId, reportDate);
    return { project, report, reportDate };
  }, [repo, activeProjectId]);

  const { data, loading, error, reload } = useAsyncData(load, [activeProjectId]);

  // Returning from the report screen (status/edits may have changed) refreshes
  // the report row and recounts the sync queue for the status pill.
  useFocusEffect(
    useCallback(() => {
      reload();
      void syncStatusHub.refresh();
    }, [reload]),
  );

  const startReport = useCallback(async () => {
    if (!data?.project || !data.reportDate || starting) return;
    setStarting(true);
    try {
      const row = await repo.createReport(data.project.id, data.reportDate);
      router.push(`/report/${row.id}`);
    } catch {
      toast.show("Couldn't start the report. It'll retry when you're back online.");
    } finally {
      setStarting(false);
    }
  }, [data?.project, data?.reportDate, repo, starting, toast]);

  const openReport = useCallback((reportId: string) => {
    router.push(`/report/${reportId}`);
  }, []);

  return (
    <SafeAreaView
      testID="screen-today"
      style={[styles.root, { backgroundColor: colors.bg }]}
      edges={['top']}
    >
      {/* Fixed chrome (outside the ScrollView, present in every branch): the
          Maestro flow asserts sync-status-<state> here without scrolling. */}
      <View style={{ paddingHorizontal: sizes.screenPad, paddingTop: spacing.sm }}>
        <ConnectedSyncStatusBanner />
      </View>
      <ScrollView
        contentContainerStyle={{ padding: sizes.screenPad, gap: spacing.lg }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.kicker, { color: colors.muted, fontFamily: fonts.ui.semibold }]}>
          TODAY
        </Text>

        {!ready || (loading && !data) ? (
          <DetailSkeleton />
        ) : error ? (
          <View style={styles.block}>
            <EmptyState
              icon="cloud-offline-outline"
              title="Couldn't load Today"
              subtitle={error.message}
            />
            <PrimaryButton testID="today-retry" label="Try again" onPress={reload} />
          </View>
        ) : !activeProjectId || !data?.project ? (
          <EmptyState
            icon="business-outline"
            title="No project yet"
            subtitle="Create or join a project to start filing daily reports."
          />
        ) : (
          <>
            <Text style={[styles.date, { color: colors.text, fontFamily: fonts.serif.bold }]}>
              {data.reportDate ? formatToday(data.reportDate) : ''}
            </Text>
            <Text style={[styles.project, { color: colors.muted, fontFamily: fonts.ui.medium }]}>
              {data.project.name}
            </Text>

            {data.report ? (
              <Pressable
                testID="today-open-report"
                accessibilityRole="button"
                accessibilityLabel="Open today's report"
                onPress={() => openReport(data.report!.id)}
                style={({ pressed }) => [
                  styles.card,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    borderRadius: radii.card,
                  },
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.cardBody}>
                  <Text
                    style={[styles.cardTitle, { color: colors.text, fontFamily: fonts.ui.bold }]}
                  >
                    {"Today's report"}
                  </Text>
                  <ReportStatusChip status={data.report.status} size="sm" />
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.faint} />
              </Pressable>
            ) : (
              <View style={styles.block}>
                <Text style={[styles.hint, { color: colors.muted, fontFamily: fonts.ui.regular }]}>
                  No report for today yet.
                </Text>
                <PrimaryButton
                  testID="today-start-report"
                  label="Start today's report"
                  onPress={startReport}
                  busy={starting}
                />
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  kicker: { fontSize: 12, letterSpacing: 1.2 },
  date: { fontSize: 28, letterSpacing: -0.6 },
  project: { fontSize: 15, marginTop: -8 },
  block: { gap: 14 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  cardBody: { gap: 8, flex: 1 },
  cardTitle: { fontSize: 17 },
  hint: { fontSize: 15 },
  pressed: { opacity: 0.85 },
});
