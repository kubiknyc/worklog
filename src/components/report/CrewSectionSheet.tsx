/**
 * CrewSectionSheet — Crew by trade (PRD §7) and the archetype for the
 * relational sections (equipment, work performed, delays, safety): a list of
 * full-replacement rows edited in place, each carrying steppers, added via a
 * pick list, autosaved through {@link useSectionDraft}.
 *
 * One row per trade: a headcount stepper and an hours stepper (0.5 h steps,
 * default 8 h — PRD §7). Trades are added from the standard {@link TRADES}
 * list, hiding trades already on the report so a trade can't be doubled. A
 * carried-forward row (M6, later) renders tinted until touched; this sheet
 * preserves `is_carried_forward` on edit but never sets it (only carry-forward
 * does).
 *
 * "No crew today" is the deliberate-empty affirmation (writes isComplete=true).
 * All edits are immutable: every mutator returns a new rows array.
 */
import { Ionicons } from '@expo/vector-icons';
import { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { CrewContent, CrewRowContent } from '../../data/sectionContent';
import { uuidv4 } from '../../lib/uuid';
import { useTheme } from '../../theme';
import { ChipRow } from '../ChipRow';
import { PrimaryButton } from '../PrimaryButton';
import { Stepper } from '../Stepper';
import { SectionSheetScaffold } from './SectionSheetScaffold';
import { TRADES } from './sectionConstants';
import { useSectionDraft } from './useSectionDraft';

const DEFAULT_HOURS = 8;
const MAX_HOURS = 24;

type Props = {
  readonly visible: boolean;
  readonly reportId: string;
  readonly initial: CrewContent;
  readonly onClose: () => void;
};

export function CrewSectionSheet({ visible, reportId, initial, onClose }: Props) {
  const { colors, fonts, spacing } = useTheme();
  const { draft, setDraft, markComplete, flush } = useSectionDraft<CrewContent>(
    reportId,
    'crew',
    initial,
  );

  const setRows = useCallback((rows: readonly CrewRowContent[]) => setDraft({ rows }), [setDraft]);

  const addTrade = useCallback(
    (trade: string | null) => {
      if (!trade) return;
      const row: CrewRowContent = {
        id: uuidv4(),
        trade,
        headcount: 1,
        hours: DEFAULT_HOURS,
        is_carried_forward: false,
      };
      setRows([...draft.rows, row]);
    },
    [draft.rows, setRows],
  );

  const updateRow = useCallback(
    (id: string, patch: Partial<CrewRowContent>) => {
      setRows(draft.rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
    },
    [draft.rows, setRows],
  );

  const removeRow = useCallback(
    (id: string) => setRows(draft.rows.filter((row) => row.id !== id)),
    [draft.rows, setRows],
  );

  const close = useCallback(() => {
    flush();
    onClose();
  }, [flush, onClose]);

  const noCrew = useCallback(() => {
    markComplete(true);
    onClose();
  }, [markComplete, onClose]);

  const usedTrades = new Set(draft.rows.map((row) => row.trade));
  const available = TRADES.filter((trade) => !usedTrades.has(trade)).map((trade) => ({
    value: trade,
    label: trade,
  }));

  return (
    <SectionSheetScaffold
      testID="sheet-crew"
      visible={visible}
      title="Crew by trade"
      onClose={close}
      onNoneToday={draft.rows.length === 0 ? noCrew : undefined}
      noneLabel="No crew today"
      footer={<PrimaryButton testID="sheet-crew-done" label="Done" onPress={close} />}
    >
      {draft.rows.map((row) => (
        <View
          key={row.id}
          style={[styles.row, { borderColor: colors.border, backgroundColor: colors.surface2 }]}
        >
          <View style={styles.rowHead}>
            <Text style={[styles.trade, { color: colors.text, fontFamily: fonts.ui.semibold }]}>
              {row.trade}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${row.trade}`}
              onPress={() => removeRow(row.id)}
              hitSlop={8}
              style={({ pressed }) => pressed && styles.pressed}
            >
              <Ionicons name="trash-outline" size={20} color={colors.faint} />
            </Pressable>
          </View>
          <View style={[styles.steppers, { gap: spacing.xl }]}>
            <View style={styles.stepperBlock}>
              <Text
                style={[styles.stepperLabel, { color: colors.muted, fontFamily: fonts.ui.medium }]}
              >
                Workers
              </Text>
              <Stepper
                value={row.headcount}
                onChange={(headcount) => updateRow(row.id, { headcount })}
                min={0}
                accessibilityLabel={`${row.trade} worker count`}
              />
            </View>
            <View style={styles.stepperBlock}>
              <Text
                style={[styles.stepperLabel, { color: colors.muted, fontFamily: fonts.ui.medium }]}
              >
                Hours
              </Text>
              <Stepper
                value={row.hours}
                onChange={(hours) => updateRow(row.id, { hours })}
                min={0}
                max={MAX_HOURS}
                step={0.5}
                unitLabel="h"
                accessibilityLabel={`${row.trade} hours`}
              />
            </View>
          </View>
        </View>
      ))}

      {available.length > 0 ? (
        <View style={styles.addBlock}>
          <Text style={[styles.addLabel, { color: colors.muted, fontFamily: fonts.ui.semibold }]}>
            {draft.rows.length === 0 ? 'Add a trade' : 'Add another trade'}
          </Text>
          <ChipRow options={available} value={null} onChange={addTrade} />
        </View>
      ) : null}
    </SectionSheetScaffold>
  );
}

const styles = StyleSheet.create({
  row: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 10 },
  rowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  trade: { fontSize: 16 },
  steppers: { flexDirection: 'row', flexWrap: 'wrap' },
  stepperBlock: { gap: 6 },
  stepperLabel: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 },
  addBlock: { gap: 8, marginTop: 4 },
  addLabel: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 },
  pressed: { opacity: 0.6 },
});
