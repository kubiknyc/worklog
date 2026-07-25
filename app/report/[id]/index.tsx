/**
 * Report detail (M2) — the daily report's section list. Loads the report, its
 * section rows, and the 1:1 weather row, renders each of the 11 sections
 * (PRD §7 order) with a one-line summary, and opens the matching editor sheet
 * on tap. Section edits autosave locally (useSectionDraft); on sheet close the
 * screen silently reloads so summaries reflect the new content.
 *
 * Only the sections whose editor sheets exist are interactive today
 * (`ENABLED_KINDS`); the rest render read-only as their sheets land across M2.
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
import { CrewSectionSheet } from '../../../src/components/report/CrewSectionSheet';
import { NotesSectionSheet } from '../../../src/components/report/NotesSectionSheet';
import { ReportDetailSections } from '../../../src/components/report/ReportDetailSections';
import { useRepository } from '../../../src/data';
import type { CrewContent, GeneralNotesContent } from '../../../src/data/sectionContent';
import { emptyContentFor } from '../../../src/data/sectionContent';
import type { Json, ReportSectionRow } from '../../../src/data/types';
import { useAsyncData } from '../../../src/hooks/useAsyncData';
import { SECTION_META } from '../../../src/report/sectionMeta';
import {
  summarizeSection,
  summarizeWeather,
  type SectionSummary,
} from '../../../src/report/summarize';
import type { SectionKind } from '../../../src/sync/types';
import { useTheme } from '../../../src/theme';

/** Sections whose editor sheet is built. The rest render dimmed ("Soon"). */
const ENABLED_KINDS: readonly SectionKind[] = ['crew', 'general_notes'];

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
  const [activeKind, setActiveKind] = useState<SectionKind | null>(null);

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
    const out = {} as Record<SectionKind, SectionSummary>;
    for (const meta of SECTION_META) {
      if (meta.kind === 'weather') {
        out.weather = summarizeWeather(data?.weather ?? null);
        continue;
      }
      const row = sectionByKind.get(meta.kind);
      out[meta.kind] = summarizeSection(meta.kind, row?.payload ?? null, row?.is_complete ?? false);
    }
    return out;
  }, [data?.weather, sectionByKind]);

  const closeSheet = useCallback(() => {
    setActiveKind(null);
    reload();
  }, [reload]);

  const contentFor = useCallback(
    <T extends Json>(kind: Exclude<SectionKind, 'weather'>): T => {
      const payload = sectionByKind.get(kind)?.payload;
      return (payload ?? emptyContentFor(kind)) as T;
    },
    [sectionByKind],
  );

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
      <View style={[styles.header, { paddingHorizontal: sizes.screenPad }]}>
        <Pressable
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

          <ReportDetailSections
            summaries={summaries}
            enabledKinds={ENABLED_KINDS}
            onOpen={setActiveKind}
          />
        </ScrollView>
      )}

      {data?.report && activeKind === 'general_notes' ? (
        <NotesSectionSheet
          key={`notes:${reportId}`}
          visible
          reportId={reportId}
          initial={contentFor<GeneralNotesContent>('general_notes')}
          onClose={closeSheet}
        />
      ) : null}

      {data?.report && activeKind === 'crew' ? (
        <CrewSectionSheet
          key={`crew:${reportId}`}
          visible
          reportId={reportId}
          initial={contentFor<CrewContent>('crew')}
          onClose={closeSheet}
        />
      ) : null}
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
