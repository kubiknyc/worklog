/**
 * CrewWorkSheet — Crew by trade + Work performed in one trade-centric sheet.
 * Two useSectionDraft instances (crew, work_performed) correlated by trade.
 */
import { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type {
  CrewContent,
  CrewRowContent,
  WorkPerformedContent,
  WorkPerformedRowContent,
} from '../../data/sectionContent';
import { uuidv4 } from '../../lib/uuid';
import { useTheme } from '../../theme';
import { ChipRow } from '../ChipRow';
import { PrimaryButton } from '../PrimaryButton';
import { Stepper } from '../Stepper';
import { TextField } from '../TextField';
import { EntryCard } from './EntryCard';
import { SectionSheetScaffold } from './SectionSheetScaffold';
import { TRADES } from './sectionConstants';
import { useSectionDraft } from './useSectionDraft';

const DEFAULT_HOURS = 8;
const MAX_HOURS = 24;

type Props = {
  readonly visible: boolean;
  readonly reportId: string;
  readonly initialCrew: CrewContent;
  readonly initialWork: WorkPerformedContent;
  readonly onClose: () => void;
  readonly readOnly?: boolean;
};

export function CrewWorkSheet({
  visible,
  reportId,
  initialCrew,
  initialWork,
  onClose,
  readOnly,
}: Props) {
  const { colors, fonts, spacing } = useTheme();
  const crew = useSectionDraft<CrewContent>(reportId, 'crew', initialCrew, { readOnly });
  const work = useSectionDraft<WorkPerformedContent>(reportId, 'work_performed', initialWork, {
    readOnly,
  });

  const setCrewRows = useCallback(
    (rows: readonly CrewRowContent[]) => crew.setDraft({ rows }),
    [crew],
  );
  const setWorkRows = useCallback(
    (rows: readonly WorkPerformedRowContent[]) => work.setDraft({ rows }),
    [work],
  );

  const addTrade = useCallback(
    (trade: string | null) => {
      if (!trade) return;
      setCrewRows([
        ...crew.draft.rows,
        { id: uuidv4(), trade, headcount: 1, hours: DEFAULT_HOURS, is_carried_forward: false },
      ]);
    },
    [crew.draft.rows, setCrewRows],
  );

  const updateCrew = useCallback(
    (trade: string, patch: Partial<CrewRowContent>) =>
      setCrewRows(crew.draft.rows.map((r) => (r.trade === trade ? { ...r, ...patch } : r))),
    [crew.draft.rows, setCrewRows],
  );

  const setWorkFor = useCallback(
    (trade: string, patch: Partial<Pick<WorkPerformedRowContent, 'area' | 'note'>>) => {
      const existing = work.draft.rows.find((r) => r.trade === trade);
      if (existing) {
        setWorkRows(work.draft.rows.map((r) => (r.trade === trade ? { ...r, ...patch } : r)));
      } else {
        setWorkRows([...work.draft.rows, { id: uuidv4(), trade, area: '', note: '', ...patch }]);
      }
    },
    [work.draft.rows, setWorkRows],
  );

  const removeTrade = useCallback(
    (trade: string) => {
      setCrewRows(crew.draft.rows.filter((r) => r.trade !== trade));
      setWorkRows(work.draft.rows.filter((r) => r.trade !== trade));
    },
    [crew.draft.rows, work.draft.rows, setCrewRows, setWorkRows],
  );

  const close = useCallback(() => {
    crew.flush();
    work.flush();
    onClose();
  }, [crew, work, onClose]);

  const noCrew = useCallback(() => {
    // Spec: "No crew today" clears both sections and marks crew complete.
    work.setDraft({ rows: [] });
    work.flush();
    crew.markComplete(true);
    onClose();
  }, [crew, work, onClose]);

  const used = new Set(crew.draft.rows.map((r) => r.trade));
  const available = TRADES.filter((t) => !used.has(t)).map((t) => ({ value: t, label: t }));
  const workFor = (trade: string) => work.draft.rows.find((r) => r.trade === trade);

  return (
    <SectionSheetScaffold
      visible={visible}
      title="Crew & work by trade"
      testID="sheet-crew-work"
      readOnly={readOnly}
      onClose={close}
      onNoneToday={crew.draft.rows.length === 0 ? noCrew : undefined}
      noneLabel="No crew today"
      footer={<PrimaryButton testID="sheet-crew-work-done" label="Done" onPress={close} />}
    >
      {crew.draft.rows.map((row) => (
        <EntryCard
          key={row.id}
          title={row.trade}
          carried={row.is_carried_forward}
          onRemove={() => removeTrade(row.trade)}
        >
          <View style={[styles.steppers, { gap: spacing.xl }]}>
            <View style={styles.block}>
              <Text style={[styles.label, { color: colors.muted, fontFamily: fonts.ui.medium }]}>
                Workers
              </Text>
              <Stepper
                value={row.headcount}
                onChange={(headcount) => updateCrew(row.trade, { headcount })}
                min={0}
                accessibilityLabel={`${row.trade} worker count`}
              />
            </View>
            <View style={styles.block}>
              <Text style={[styles.label, { color: colors.muted, fontFamily: fonts.ui.medium }]}>
                Hours
              </Text>
              <Stepper
                value={row.hours}
                onChange={(hours) => updateCrew(row.trade, { hours })}
                min={0}
                max={MAX_HOURS}
                step={0.5}
                unitLabel="h"
                accessibilityLabel={`${row.trade} hours`}
              />
            </View>
          </View>
          <TextField
            label="Area"
            value={workFor(row.trade)?.area ?? ''}
            onChangeText={(area) => setWorkFor(row.trade, { area })}
            placeholder="Where on site"
          />
          <TextField
            label="What was done"
            value={workFor(row.trade)?.note ?? ''}
            onChangeText={(note) => setWorkFor(row.trade, { note })}
            placeholder="Describe today's work"
            multiline
          />
        </EntryCard>
      ))}

      {available.length > 0 ? (
        <View style={styles.add}>
          <Text style={[styles.addLabel, { color: colors.muted, fontFamily: fonts.ui.semibold }]}>
            {crew.draft.rows.length === 0 ? 'Add a trade' : 'Add another trade'}
          </Text>
          <ChipRow options={available} value={null} onChange={addTrade} />
        </View>
      ) : null}
    </SectionSheetScaffold>
  );
}

const styles = StyleSheet.create({
  steppers: { flexDirection: 'row', flexWrap: 'wrap' },
  block: { gap: 6 },
  label: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 },
  add: { gap: 8, marginTop: 4 },
  addLabel: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 },
});
