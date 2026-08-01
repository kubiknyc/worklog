/** SafetySectionSheet — relational archetype + affirmation (PRD §7 Safety). */
import { Ionicons } from '@expo/vector-icons';
import { useCallback } from 'react';
import { Pressable, StyleSheet, Switch, Text } from 'react-native';

import type { SafetyContent, SafetyRowContent } from '../../data/sectionContent';
import { uuidv4 } from '../../lib/uuid';
import { useTheme } from '../../theme';
import { ChipRow } from '../ChipRow';
import { PrimaryButton } from '../PrimaryButton';
import { TextField } from '../TextField';
import { EntryCard } from './EntryCard';
import { SectionSheetScaffold } from './SectionSheetScaffold';
import { SAFETY_TYPES } from './sectionConstants';
import { useSectionDraft } from './useSectionDraft';

type Props = {
  readonly visible: boolean;
  readonly reportId: string;
  readonly initial: SafetyContent;
  readonly onClose: () => void;
  readonly readOnly?: boolean;
};

export function SafetySectionSheet({ visible, reportId, initial, onClose, readOnly }: Props) {
  const { colors, fonts } = useTheme();
  const { draft, setDraft, markComplete, flush } = useSectionDraft<SafetyContent>(
    reportId,
    'safety',
    initial,
    { readOnly },
  );
  const setRows = useCallback(
    (rows: readonly SafetyRowContent[]) => setDraft({ rows }),
    [setDraft],
  );
  const add = useCallback(
    () =>
      setRows([...draft.rows, { id: uuidv4(), obs_type: '', description: '', is_incident: false }]),
    [draft.rows, setRows],
  );
  const update = useCallback(
    (id: string, patch: Partial<SafetyRowContent>) =>
      setRows(draft.rows.map((r) => (r.id === id ? { ...r, ...patch } : r))),
    [draft.rows, setRows],
  );
  const remove = useCallback(
    (id: string) => setRows(draft.rows.filter((r) => r.id !== id)),
    [draft.rows, setRows],
  );
  const close = useCallback(() => {
    flush();
    onClose();
  }, [flush, onClose]);

  return (
    <SectionSheetScaffold
      visible={visible}
      title="Safety"
      testID="sheet-safety"
      readOnly={readOnly}
      onClose={close}
      onNoneToday={
        draft.rows.length === 0
          ? () => {
              markComplete(true);
              onClose();
            }
          : undefined
      }
      noneLabel="Nothing to report"
      footer={<PrimaryButton testID="sheet-safety-done" label="Done" onPress={close} />}
    >
      {draft.rows.map((row, i) => (
        <EntryCard key={row.id} title={`Observation ${i + 1}`} onRemove={() => remove(row.id)}>
          <ChipRow
            options={SAFETY_TYPES}
            value={row.obs_type || null}
            onChange={(v) => update(row.id, { obs_type: v ?? '' })}
          />
          <TextField
            label="Description"
            value={row.description ?? ''}
            onChangeText={(v) => update(row.id, { description: v || null })}
            multiline
          />
          <Switch
            value={row.is_incident}
            onValueChange={(is_incident) => update(row.id, { is_incident })}
            trackColor={{ true: colors.accent, false: colors.surface2 }}
            thumbColor={colors.surface}
            accessibilityLabel="Recordable incident"
          />
          <Text style={[styles.caption, { color: colors.muted, fontFamily: fonts.ui.medium }]}>
            Recordable incident
          </Text>
        </EntryCard>
      ))}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add observation"
        testID="sheet-safety-add"
        onPress={add}
        style={({ pressed }) => [
          styles.addBtn,
          { borderColor: colors.border },
          pressed && styles.pressed,
        ]}
      >
        <Ionicons name="add" size={18} color={colors.accent} />
        <Text style={[styles.addText, { color: colors.accent, fontFamily: fonts.ui.semibold }]}>
          Add observation
        </Text>
      </Pressable>
    </SectionSheetScaffold>
  );
}

const styles = StyleSheet.create({
  caption: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 },
  addBtn: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 14,
    padding: 12,
  },
  addText: { fontSize: 14 },
  pressed: { opacity: 0.8 },
});
