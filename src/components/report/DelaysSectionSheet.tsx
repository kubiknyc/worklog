/** DelaysSectionSheet — relational archetype (PRD §7 Delays & impacts). */
import { Ionicons } from '@expo/vector-icons';
import { useCallback } from 'react';
import { Pressable, StyleSheet, Switch, Text } from 'react-native';

import type { DelaysContent, DelayRowContent } from '../../data/sectionContent';
import { uuidv4 } from '../../lib/uuid';
import { useTheme } from '../../theme';
import { ChipRow } from '../ChipRow';
import { PrimaryButton } from '../PrimaryButton';
import { Stepper } from '../Stepper';
import { TextField } from '../TextField';
import { EntryCard } from './EntryCard';
import { SectionSheetScaffold } from './SectionSheetScaffold';
import { DELAY_CAUSES } from './sectionConstants';
import { useSectionDraft } from './useSectionDraft';

type Props = {
  readonly visible: boolean;
  readonly reportId: string;
  readonly initial: DelaysContent;
  readonly onClose: () => void;
  readonly readOnly?: boolean;
};

export function DelaysSectionSheet({ visible, reportId, initial, onClose, readOnly }: Props) {
  const { colors, fonts } = useTheme();
  const { draft, setDraft, flush } = useSectionDraft<DelaysContent>(reportId, 'delays', initial, {
    readOnly,
  });
  const setRows = useCallback((rows: readonly DelayRowContent[]) => setDraft({ rows }), [setDraft]);
  const add = useCallback(
    () =>
      setRows([
        ...draft.rows,
        {
          id: uuidv4(),
          cause: '',
          responsible_party: null,
          duration_hours: 0.5,
          is_ongoing: false,
          note: null,
        },
      ]),
    [draft.rows, setRows],
  );
  const update = useCallback(
    (id: string, patch: Partial<DelayRowContent>) =>
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
      title="Delays"
      testID="sheet-delays"
      readOnly={readOnly}
      onClose={close}
      footer={<PrimaryButton testID="sheet-delays-done" label="Done" onPress={close} />}
    >
      {draft.rows.map((row, i) => (
        <EntryCard key={row.id} title={`Delay ${i + 1}`} onRemove={() => remove(row.id)}>
          <ChipRow
            options={DELAY_CAUSES}
            value={row.cause || null}
            onChange={(v) => update(row.id, { cause: v ?? '' })}
          />
          <TextField
            label="Responsible party"
            value={row.responsible_party ?? ''}
            onChangeText={(v) => update(row.id, { responsible_party: v || null })}
          />
          <Text style={[styles.caption, { color: colors.muted, fontFamily: fonts.ui.medium }]}>
            Duration
          </Text>
          <Stepper
            value={row.duration_hours ?? 0}
            onChange={(duration_hours) => update(row.id, { duration_hours })}
            step={0.5}
            min={0}
            unitLabel="days"
            disabled={row.is_ongoing}
            accessibilityLabel={`Delay ${i + 1} duration`}
          />
          <Switch
            value={row.is_ongoing}
            onValueChange={(is_ongoing) =>
              update(row.id, {
                is_ongoing,
                duration_hours: is_ongoing ? null : (row.duration_hours ?? 0.5),
              })
            }
            trackColor={{ true: colors.accent, false: colors.surface2 }}
            thumbColor={colors.surface}
            accessibilityLabel="Ongoing"
          />
          <Text style={[styles.caption, { color: colors.muted, fontFamily: fonts.ui.medium }]}>
            Ongoing
          </Text>
          <TextField
            label="Note"
            value={row.note ?? ''}
            onChangeText={(v) => update(row.id, { note: v || null })}
            multiline
          />
        </EntryCard>
      ))}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add delay"
        testID="sheet-delays-add"
        onPress={add}
        style={({ pressed }) => [
          styles.addBtn,
          { borderColor: colors.border },
          pressed && styles.pressed,
        ]}
      >
        <Ionicons name="add" size={18} color={colors.accent} />
        <Text style={[styles.addText, { color: colors.accent, fontFamily: fonts.ui.semibold }]}>
          Add delay
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
