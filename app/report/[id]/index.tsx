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
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  BottomSheet,
  ConnectedSyncStatusBanner,
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
import { SubmitReportSheet } from '../../../src/components/report/SubmitReportSheet';
import { VisitorsSectionSheet } from '../../../src/components/report/VisitorsSectionSheet';
import { WeatherSectionSheet } from '../../../src/components/report/WeatherSectionSheet';
import { useAuth } from '../../../src/auth';
import { useRepository } from '../../../src/data';
import { canEditSection } from '../../../src/data/lifecycleGuards';
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
import { useRefreshOnFocusAndSync } from '../../../src/hooks/useRefreshOnFocusAndSync';
import { useReparentRedirect } from '../../../src/hooks/useReparentRedirect';
import { REPORT_ROWS } from '../../../src/report/sectionMeta';
import {
  summarizeCrewWork,
  summarizeSection,
  summarizeWeather,
  type SectionSummary,
} from '../../../src/report/summarize';
import type { SectionKind } from '../../../src/sync/types';
import { useTheme } from '../../../src/theme';
import { hitSlopFor } from '../../../src/theme/touchTarget';

/** Kept beside the slop it feeds — changing one without the other is the bug. */
const BACK_ICON_SIZE = 26;

/** "2026-07-24" → "Thursday, Jul 24" (parsed at local noon to dodge TZ skew). */
function formatReportDate(reportDate: string): string {
  const parsed = new Date(`${reportDate}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return reportDate;
  return parsed.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

export default function ReportDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const reportId = id ?? '';
  const { colors, fonts, spacing, sizes, error: errorColor } = useTheme();
  const repo = useRepository();
  const { userId, profile } = useAuth();
  const [activeRowId, setActiveRowId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const report = await repo.getReport(reportId);
    const [sections, weather, members] = await Promise.all([
      repo.listSections(reportId),
      repo.getWeather(reportId),
      report ? repo.listMembers(report.project_id) : Promise.resolve([] as const),
    ]);
    return { report, sections, weather, members };
  }, [repo, reportId]);

  const { data, loading, error, reload } = useAsyncData(load, [reportId]);

  const me = useMemo(
    () => (data?.members ?? []).find((m) => m.user_id === userId) ?? null,
    [data?.members, userId],
  );
  const isSuper = me?.role === 'super';

  const [submitOpen, setSubmitOpen] = useState(false);
  const [lockConfirmOpen, setLockConfirmOpen] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleSubmit = useCallback(
    async (input: { signerTitle: string | null; signaturePngBase64: string }) => {
      setActionPending(true);
      setActionError(null);
      try {
        await repo.submitReport(reportId, {
          signerName: profile?.full_name ?? '',
          signerTitle: input.signerTitle,
          signaturePngBase64: input.signaturePngBase64,
        });
        setSubmitOpen(false);
        reload();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Could not submit this report.');
      } finally {
        setActionPending(false);
      }
    },
    [repo, reportId, profile?.full_name, reload],
  );

  const handleLock = useCallback(async () => {
    setActionPending(true);
    setActionError(null);
    try {
      await repo.lockReport(reportId);
      setLockConfirmOpen(false);
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not lock this report.');
    } finally {
      setActionPending(false);
    }
  }, [repo, reportId, reload]);

  // Sheet close is not the only thing that invalidates this screen: a completed
  // engine pull can land newer rows in SQLite while the report is open. Latent
  // today (tier-1 pulls carry projects/memberships/profiles, not report rows),
  // real the moment M4 cadence work pulls daily_reports — wired now so the gap
  // never opens (#26). Safe mid-edit: the sheets seed their draft once at mount
  // (useSectionDraft) and key off route state, so a refetch can't reset an open
  // sheet, and reload() is the silent mode that never nulls `data`.
  useRefreshOnFocusAndSync(reload);

  // Task 8: follow a same-day reparent off THIS report's loser id onto the
  // winner. The identity pair comes from the already-loaded report (not the
  // route id alone — the loser id resolves to nothing after the rename).
  const reparentIdentity = useMemo(
    () =>
      data?.report
        ? { projectId: data.report.project_id, reportDate: data.report.report_date }
        : null,
    [data?.report],
  );
  useReparentRedirect(reportId, reparentIdentity);

  const readOnly = data?.report ? !canEditSection(data.report.status) : false;

  // Submit/Lock have no web UI yet: SubmitReportSheet is a native-only stub
  // on web (dead tap target), and BottomSheet works there but M4a ships no
  // web lifecycle UI at all — that's a deliberate M4b+ decision, not an
  // oversight, so both actions are gated together for consistency.
  const lifecycleActionsAvailable = Platform.OS !== 'web';

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
            readOnly={readOnly}
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
            readOnly={readOnly}
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
            readOnly={readOnly}
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
            readOnly={readOnly}
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
            readOnly={readOnly}
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
            readOnly={readOnly}
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
            readOnly={readOnly}
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
            readOnly={readOnly}
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
            readOnly={readOnly}
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
            readOnly={readOnly}
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
          // 26px icon + 10px slop was 46px — two short of the floor (#19).
          hitSlop={hitSlopFor(BACK_ICON_SIZE)}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <Ionicons name="chevron-back" size={BACK_ICON_SIZE} color={colors.text} />
        </Pressable>
        <Text style={[styles.title, { color: colors.text, fontFamily: fonts.ui.extrabold }]}>
          Daily report
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      {/* Fixed chrome (sibling of the header, outside the ScrollView and
          every loading/error branch): Maestro asserts sync-status-<state>
          here without scrolling, in any screen state. */}
      <View style={{ paddingHorizontal: sizes.screenPad, paddingBottom: 4 }}>
        <ConnectedSyncStatusBanner />
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
            <PrimaryButton testID="report-retry" label="Try again" onPress={reload} />
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
            <ReportStatusChip status={data.report.status} testID="report-status" />
          </View>

          <ReportDetailSections rows={REPORT_ROWS} summaries={summaries} onOpen={setActiveRowId} />

          {lifecycleActionsAvailable && isSuper && data.report.status === 'draft' ? (
            <PrimaryButton
              testID="report-submit"
              label="Submit report"
              onPress={() => {
                setActionError(null);
                setSubmitOpen(true);
              }}
            />
          ) : null}
          {lifecycleActionsAvailable && isSuper && data.report.status === 'submitted' ? (
            <PrimaryButton
              testID="report-lock"
              label="Lock report"
              onPress={() => {
                setActionError(null);
                setLockConfirmOpen(true);
              }}
            />
          ) : null}
        </ScrollView>
      )}

      {renderActiveSheet()}

      <SubmitReportSheet
        visible={submitOpen}
        defaultSignerTitle={me?.title ?? null}
        onSubmit={handleSubmit}
        onClose={() => setSubmitOpen(false)}
        submitting={actionPending}
        errorText={actionError}
      />
      <BottomSheet
        visible={lockConfirmOpen}
        onClose={() => setLockConfirmOpen(false)}
        title="Lock report"
      >
        <Text style={{ color: colors.muted, fontFamily: fonts.ui.regular, fontSize: 14 }}>
          Locking is final — after this, changes go through a formal amendment. Reports also lock
          automatically 24 hours after submission.
        </Text>
        {actionError ? (
          <Text style={{ color: errorColor, fontFamily: fonts.ui.semibold, fontSize: 14 }}>
            {actionError}
          </Text>
        ) : null}
        <PrimaryButton
          testID="report-lock-confirm"
          label={actionPending ? 'Locking…' : 'Lock report'}
          disabled={actionPending}
          onPress={handleLock}
        />
        <Pressable
          testID="report-lock-cancel"
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          hitSlop={8}
          style={({ pressed }) => [styles.cancelLink, pressed && styles.pressed]}
          onPress={() => setLockConfirmOpen(false)}
        >
          <Text style={{ color: colors.accent, fontFamily: fonts.ui.semibold, fontSize: 15 }}>
            Cancel
          </Text>
        </Pressable>
      </BottomSheet>
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
  cancelLink: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
});
