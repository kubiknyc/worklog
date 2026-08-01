/** InspectionsSectionSheet — entry-list archetype (PRD §7 Inspections). */
import { Ionicons } from '@expo/vector-icons';
import { useCallback } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import type { InspectionEntry, InspectionsContent } from '../../data/sectionContent';
import { uuidv4 } from '../../lib/uuid';
import { useTheme } from '../../theme';
import { ChipRow } from '../ChipRow';
import { PrimaryButton } from '../PrimaryButton';
import { TextField } from '../TextField';
import { EntryCard } from './EntryCard';
import { SectionSheetScaffold } from './SectionSheetScaffold';
import { INSPECTION_AGENCIES, INSPECTION_RESULTS } from './sectionConstants';
import { useSectionDraft } from './useSectionDraft';

type Props = {
  readonly visible: boolean;
  readonly reportId: string;
  readonly initial: InspectionsContent;
  readonly onClose: () => void;
  readonly readOnly?: boolean;
};

export function InspectionsSectionSheet({ visible, reportId, initial, onClose, readOnly }: Props) {
  const { colors, fonts } = useTheme();
  const { draft, setDraft, flush } = useSectionDraft<InspectionsContent>(
    reportId,
    'inspections',
    initial,
    { readOnly },
  );
  const setEntries = useCallback(
    (entries: readonly InspectionEntry[]) => setDraft({ entries }),
    [setDraft],
  );
  const add = useCallback(
    () =>
      setEntries([
        ...draft.entries,
        { id: uuidv4(), agency: '', inspector: null, result: 'passed', note: null },
      ]),
    [draft.entries, setEntries],
  );
  const update = useCallback(
    (id: string, patch: Partial<InspectionEntry>) =>
      setEntries(draft.entries.map((e) => (e.id === id ? { ...e, ...patch } : e))),
    [draft.entries, setEntries],
  );
  const remove = useCallback(
    (id: string) => setEntries(draft.entries.filter((e) => e.id !== id)),
    [draft.entries, setEntries],
  );
  const close = useCallback(() => {
    flush();
    onClose();
  }, [flush, onClose]);

  return (
    <SectionSheetScaffold
      visible={visible}
      title="Inspections"
      testID="sheet-inspections"
      readOnly={readOnly}
      onClose={close}
      footer={<PrimaryButton testID="sheet-inspections-done" label="Done" onPress={close} />}
    >
      {draft.entries.map((entry, i) => (
        <EntryCard key={entry.id} title={`Inspection ${i + 1}`} onRemove={() => remove(entry.id)}>
          <Text style={[styles.label, { color: colors.muted, fontFamily: fonts.ui.medium }]}>
            Agency
          </Text>
          <ChipRow
            options={INSPECTION_AGENCIES}
            value={entry.agency || null}
            onChange={(v) => update(entry.id, { agency: v ?? '' })}
          />
          <TextField
            label="Inspector"
            value={entry.inspector ?? ''}
            onChangeText={(v) => update(entry.id, { inspector: v || null })}
          />
          <Text style={[styles.label, { color: colors.muted, fontFamily: fonts.ui.medium }]}>
            Result
          </Text>
          <ChipRow
            options={INSPECTION_RESULTS}
            value={entry.result}
            onChange={(v) =>
              update(entry.id, { result: (v ?? 'passed') as InspectionEntry['result'] })
            }
          />
          <TextField
            label="Note"
            multiline
            value={entry.note ?? ''}
            onChangeText={(v) => update(entry.id, { note: v || null })}
          />
        </EntryCard>
      ))}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add inspection"
        testID="sheet-inspections-add"
        onPress={add}
        style={({ pressed }) => [
          styles.addBtn,
          { borderColor: colors.border },
          pressed && styles.pressed,
        ]}
      >
        <Ionicons name="add" size={18} color={colors.accent} />
        <Text style={[styles.addText, { color: colors.accent, fontFamily: fonts.ui.semibold }]}>
          Add inspection
        </Text>
      </Pressable>
    </SectionSheetScaffold>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 },
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
