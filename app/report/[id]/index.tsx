/**
 * Report detail (M2) — the daily report's section list. Loads the report, its
 * section rows, and the 1:1 weather row, renders each of the 10 report rows
 * (PRD §7 order, crew + work_performed grouped) with a one-line summary, and
 * opens the matching editor sheet on tap. Section edits autosave locally
 * (useSectionDraft); on sheet close the screen silently reloads so summaries
 * reflect the new content.
 *
 * All report rows are interactive now (`REPORT_ROWS`); a row whose sheet is
 * not yet built would render dimmed with "Soon" via `ReportDetailSections`.
 */
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  DetailSkeleton,
  EmptyState,
  PrimaryButton,
  ReportStatusChip,
} from '../../../src/components';
import { CrewWorkSheet } from '../../../src/components/report/CrewWorkSheet';
import { DelaysSectionSheet } from '../../../src/components/report/DelaysSectionSheet';
import { DeliveriesSectionSheet } from '../../../src/components/report/DeliveriesSectionSheet';
import { EquipmentSectionSheet } from '../../../src/components/report/EquipmentSectionSheet';
import { InspectionsSectionSheet } from '../../../src/components/report/InspectionsSectionSheet';
import { NotesSectionSheet } from '../../../src/components/report/NotesSectionSheet';
import { ReportDetailSections } from '../../../src/components/report/ReportDetailSections';
import { RfisSectionSheet } from '../../../src/components/report/RfisSectionSheet';
import { SafetySectionSheet } from '../../../src/components/report/SafetySectionSheet';
import { VisitorsSectionSheet } from '../../../src/components/report/VisitorsSectionSheet';
import { WeatherSectionSheet } from '../../../src/components/report/WeatherSectionSheet';
import { useRepository } from '../../../src/data';
import type {
  CrewContent,
  DelaysContent,
  DeliveriesContent,
  EquipmentContent,
  GeneralNotesContent,
  InspectionsContent,
  RfisContent,
  SafetyContent,
  VisitorsContent,
  WorkPerformedContent,
} from '../../../src/data/sectionContent';
import { emptyContentFor } from '../../../src/data/sectionContent';
import type { Json, ReportSectionRow } from '../../../src/data/types';
import { useAsyncData } from '../../../src/hooks/useAsyncData';
import { REPORT_ROWS } from '../../../src/report/sectionMeta';
import {
  summarizeCrewWork,
  summarizeSection,
  summarizeWeather,
  type SectionSummary,
} from '../../../src/report/summarize';
import type { SectionKind } from '../../../src/sync/types';
import { useTheme } from '../../../src/theme';

/** "2026-07-24" → "Thursday, Jul 24" (parsed at local noon to dodge TZ skew). */
function formatReportDate(reportDate: string): string {
  const parsed = new Date(`${reportDate}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return reportDate;
  return parsed.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

export default function ReportDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const reportId = id ?? '';
  const { colors, fonts, spacing, sizes } = useTheme();
  const repo = useRepository();
  const [activeRowId, setActiveRowId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [report, sections, weather] = await Promise.all([
      repo.getReport(reportId),
      repo.listSections(reportId),
      repo.getWeather(reportId),
    ]);
    return { report, sections, weather };
  }, [repo, reportId]);

  const { data, loading, error, reload } = useAsyncData(load, [reportId]);

  const sectionByKind = useMemo(() => {
    const map = new Map<Exclude<SectionKind, 'weather'>, ReportSectionRow>();
    for (const row of data?.sections ?? []) map.set(row.section, row);
    return map;
  }, [data?.sections]);

  const summaries = useMemo(() => {
    const out: Record<string, SectionSummary> = {};
    for (const row of REPORT_ROWS) {
      if (row.id === 'weather') {
        out[row.id] = summarizeWeather(data?.weather ?? null);
        continue;
      }
      if (row.id === 'crew_work') {
        const crewRow = sectionByKind.get('crew');
        const workRow = sectionByKind.get('work_performed');
        out[row.id] = summarizeCrewWork(
          crewRow?.payload ?? null,
          workRow?.payload ?? null,
          crewRow?.is_complete ?? false,
        );
        continue;
      }
      const kind = row.kinds[0] as Exclude<SectionKind, 'weather'>;
      const sectionRow = sectionByKind.get(kind);
      out[row.id] = summarizeSection(
        kind,
        sectionRow?.payload ?? null,
        sectionRow?.is_complete ?? false,
      );
    }
    return out;
  }, [data?.weather, sectionByKind]);

  const closeSheet = useCallback(() => {
    setActiveRowId(null);
    reload();
  }, [reload]);

  const contentFor = useCallback(
    <T extends Json>(kind: Exclude<SectionKind, 'weather'>): T => {
      const payload = sectionByKind.get(kind)?.payload;
      return (payload ?? emptyContentFor(kind)) as T;
    },
    [sectionByKind],
  );

  const renderActiveSheet = () => {
    if (!data?.report || !activeRowId) return null;
    const key = `${activeRowId}:${reportId}`;
    switch (activeRowId) {
      case 'crew_work':
        return (
          <CrewWorkSheet
            key={key}
            visible
            reportId={reportId}
            initialCrew={contentFor<CrewContent>('crew')}
            initialWork={contentFor<WorkPerformedContent>('work_performed')}
            onClose={closeSheet}
          />
        );
      case 'weather':
        return (
          <WeatherSectionSheet
            key={key}
            visible
            reportId={reportId}
            initialWeather={data?.weather ?? null}
            onClose={closeSheet}
          />
        );
      case 'deliveries':
        return (
          <DeliveriesSectionSheet
            key={key}
            visible
            reportId={reportId}
            initial={contentFor<DeliveriesContent>('deliveries')}
            onClose={closeSheet}
          />
        );
      case 'equipment':
        return (
          <EquipmentSectionSheet
            key={key}
            visible
            reportId={reportId}
            initial={contentFor<EquipmentContent>('equipment')}
            onClose={closeSheet}
          />
        );
      case 'inspections':
        return (
          <InspectionsSectionSheet
            key={key}
            visible
            reportId={reportId}
            initial={contentFor<InspectionsContent>('inspections')}
            onClose={closeSheet}
          />
        );
      case 'safety':
        return (
          <SafetySectionSheet
            key={key}
            visible
            reportId={reportId}
            initial={contentFor<SafetyContent>('safety')}
            onClose={closeSheet}
          />
        );
      case 'delays':
        return (
          <DelaysSectionSheet
            key={key}
            visible
            reportId={reportId}
            initial={contentFor<DelaysContent>('delays')}
            onClose={closeSheet}
          />
        );
      case 'visitors':
        return (
          <VisitorsSectionSheet
            key={key}
            visible
            reportId={reportId}
            initial={contentFor<VisitorsContent>('visitors')}
            onClose={closeSheet}
          />
        );
      case 'rfis':
        return (
          <RfisSectionSheet
            key={key}
            visible
            reportId={reportId}
            initial={contentFor<RfisContent>('rfis')}
            onClose={closeSheet}
          />
        );
      case 'general_notes':
        return (
          <NotesSectionSheet
            key={key}
            visible
            reportId={reportId}
            initial={contentFor<GeneralNotesContent>('general_notes')}
            onClose={closeSheet}
          />
        );
      default:
        return null;
    }
  };

  return (
    <SafeAreaView
      testID="screen-report"
      style={[styles.root, { backgroundColor: colors.bg }]}
      edges={['top', 'bottom']}
    >
      <View style={[styles.header, { paddingHorizontal: sizes.screenPad }]}>
        <Pressable
          testID="report-back"
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          hitSlop={10}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <Text style={[styles.title, { color: colors.text, fontFamily: fonts.ui.extrabold }]}>
          Daily report
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      {loading && !data ? (
        <View style={{ padding: sizes.screenPad }}>
          <DetailSkeleton />
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <EmptyState
            icon="cloud-offline-outline"
            title="Couldn't load this report"
            subtitle={error.message}
          />
          <View style={{ paddingHorizontal: sizes.screenPad, width: '100%' }}>
            <PrimaryButton label="Try again" onPress={reload} />
          </View>
        </View>
      ) : !data?.report ? (
        <View style={styles.centered}>
          <EmptyState
            icon="document-outline"
            title="Report not found"
            subtitle="It may not have synced to this device yet."
          />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: sizes.screenPad, gap: spacing.lg, paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.metaRow}>
            <Text style={[styles.date, { color: colors.text, fontFamily: fonts.serif.semibold }]}>
              {formatReportDate(data.report.report_date)}
            </Text>
            <ReportStatusChip status={data.report.status} />
          </View>

          <ReportDetailSections rows={REPORT_ROWS} summaries={summaries} onOpen={setActiveRowId} />
        </ScrollView>
      )}

      {renderActiveSheet()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', height: 52, gap: 8 },
  title: { fontSize: 18, flex: 1, textAlign: 'center' },
  headerSpacer: { width: 26 },
  centered: { flex: 1, justifyContent: 'center', gap: 16 },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  date: { fontSize: 22, letterSpacing: -0.4, flexShrink: 1 },
  pressed: { opacity: 0.6 },
});
