/** VisitorsSectionSheet — entry-list archetype (PRD §7 Visitors). */
import { Ionicons } from '@expo/vector-icons';
import { useCallback } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import type { VisitorEntry, VisitorsContent } from '../../data/sectionContent';
import { uuidv4 } from '../../lib/uuid';
import { useTheme } from '../../theme';
import { ChipRow } from '../ChipRow';
import { PrimaryButton } from '../PrimaryButton';
import { TextField } from '../TextField';
import { EntryCard } from './EntryCard';
import { SectionSheetScaffold } from './SectionSheetScaffold';
import { VISITOR_ROLES } from './sectionConstants';
import { useSectionDraft } from './useSectionDraft';

type Props = {
  readonly visible: boolean;
  readonly reportId: string;
  readonly initial: VisitorsContent;
  readonly onClose: () => void;
  readonly readOnly?: boolean;
};

export function VisitorsSectionSheet({ visible, reportId, initial, onClose, readOnly }: Props) {
  const { colors, fonts } = useTheme();
  const { draft, setDraft, flush } = useSectionDraft<VisitorsContent>(
    reportId,
    'visitors',
    initial,
    { readOnly },
  );
  const setEntries = useCallback(
    (entries: readonly VisitorEntry[]) => setDraft({ entries }),
    [setDraft],
  );
  const add = useCallback(
    () => setEntries([...draft.entries, { id: uuidv4(), name: '', role: '', time: null }]),
    [draft.entries, setEntries],
  );
  const update = useCallback(
    (id: string, patch: Partial<VisitorEntry>) =>
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
      title="Visitors"
      testID="sheet-visitors"
      readOnly={readOnly}
      onClose={close}
      footer={<PrimaryButton testID="sheet-visitors-done" label="Done" onPress={close} />}
    >
      {draft.entries.map((entry, i) => (
        <EntryCard key={entry.id} title={`Visitor ${i + 1}`} onRemove={() => remove(entry.id)}>
          <TextField
            label="Name"
            value={entry.name}
            onChangeText={(name) => update(entry.id, { name })}
          />
          <Text style={[styles.label, { color: colors.muted, fontFamily: fonts.ui.medium }]}>
            Role
          </Text>
          <ChipRow
            options={VISITOR_ROLES}
            value={entry.role || null}
            onChange={(v) => update(entry.id, { role: v ?? '' })}
          />
          <TextField
            label="Time"
            value={entry.time ?? ''}
            onChangeText={(v) => update(entry.id, { time: v || null })}
            placeholder="HH:MM"
            keyboardType="numbers-and-punctuation"
          />
        </EntryCard>
      ))}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add visitor"
        testID="sheet-visitors-add"
        onPress={add}
        style={({ pressed }) => [
          styles.addBtn,
          { borderColor: colors.border },
          pressed && styles.pressed,
        ]}
      >
        <Ionicons name="add" size={18} color={colors.accent} />
        <Text style={[styles.addText, { color: colors.accent, fontFamily: fonts.ui.semibold }]}>
          Add visitor
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
