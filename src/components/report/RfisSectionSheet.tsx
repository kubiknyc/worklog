/** RfisSectionSheet — entry-list archetype (PRD §7 RFIs). */
import { Ionicons } from '@expo/vector-icons';
import { useCallback } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import type { RfiEntry, RfisContent } from '../../data/sectionContent';
import { uuidv4 } from '../../lib/uuid';
import { useTheme } from '../../theme';
import { ChipRow } from '../ChipRow';
import { PrimaryButton } from '../PrimaryButton';
import { TextField } from '../TextField';
import { EntryCard } from './EntryCard';
import { SectionSheetScaffold } from './SectionSheetScaffold';
import { TRADES } from './sectionConstants';
import { useSectionDraft } from './useSectionDraft';

type Props = {
  readonly visible: boolean;
  readonly reportId: string;
  readonly initial: RfisContent;
  readonly onClose: () => void;
};

const TRADE_OPTIONS = TRADES.map((t) => ({ value: t, label: t }));

export function RfisSectionSheet({ visible, reportId, initial, onClose }: Props) {
  const { colors, fonts } = useTheme();
  const { draft, setDraft, flush } = useSectionDraft<RfisContent>(reportId, 'rfis', initial);
  const setEntries = useCallback(
    (entries: readonly RfiEntry[]) => setDraft({ entries }),
    [setDraft],
  );
  const add = useCallback(
    () =>
      setEntries([
        ...draft.entries,
        { id: uuidv4(), title: '', trade: null, needs_answer_from: null },
      ]),
    [draft.entries, setEntries],
  );
  const update = useCallback(
    (id: string, patch: Partial<RfiEntry>) =>
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
      title="RFIs"
      testID="sheet-rfis"
      onClose={close}
      footer={<PrimaryButton testID="sheet-rfis-done" label="Done" onPress={close} />}
    >
      <Text style={[styles.caption, { color: colors.muted, fontFamily: fonts.ui.regular }]}>
        Questions and issues raised today.
      </Text>
      {draft.entries.map((entry, i) => (
        <EntryCard key={entry.id} title={`Item ${i + 1}`} onRemove={() => remove(entry.id)}>
          <TextField
            label="Title"
            value={entry.title}
            onChangeText={(title) => update(entry.id, { title })}
          />
          <Text style={[styles.label, { color: colors.muted, fontFamily: fonts.ui.medium }]}>
            Trade
          </Text>
          <ChipRow
            options={TRADE_OPTIONS}
            value={entry.trade}
            onChange={(trade) => update(entry.id, { trade })}
          />
          <TextField
            label="Needs answer from"
            value={entry.needs_answer_from ?? ''}
            onChangeText={(v) => update(entry.id, { needs_answer_from: v || null })}
          />
        </EntryCard>
      ))}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add item"
        testID="sheet-rfis-add"
        onPress={add}
        style={({ pressed }) => [
          styles.addBtn,
          { borderColor: colors.border },
          pressed && styles.pressed,
        ]}
      >
        <Ionicons name="add" size={18} color={colors.accent} />
        <Text style={[styles.addText, { color: colors.accent, fontFamily: fonts.ui.semibold }]}>
          Add item
        </Text>
      </Pressable>
    </SectionSheetScaffold>
  );
}

const styles = StyleSheet.create({
  caption: { fontSize: 13 },
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
