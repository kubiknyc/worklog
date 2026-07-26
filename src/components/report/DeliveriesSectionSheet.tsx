/** DeliveriesSectionSheet — entry-list archetype (PRD §7 Deliveries). */
import { Ionicons } from '@expo/vector-icons';
import { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { DeliveriesContent, DeliveryEntry } from '../../data/sectionContent';
import { uuidv4 } from '../../lib/uuid';
import { useTheme } from '../../theme';
import { ChipRow } from '../ChipRow';
import { PrimaryButton } from '../PrimaryButton';
import { Stepper } from '../Stepper';
import { TextField } from '../TextField';
import { EntryCard } from './EntryCard';
import { SectionSheetScaffold } from './SectionSheetScaffold';
import { DELIVERY_UNITS } from './sectionConstants';
import { useSectionDraft } from './useSectionDraft';

type Props = {
  readonly visible: boolean;
  readonly reportId: string;
  readonly initial: DeliveriesContent;
  readonly onClose: () => void;
};

export function DeliveriesSectionSheet({ visible, reportId, initial, onClose }: Props) {
  const { colors, fonts } = useTheme();
  const { draft, setDraft, flush } = useSectionDraft<DeliveriesContent>(
    reportId,
    'deliveries',
    initial,
  );
  const setEntries = useCallback(
    (entries: readonly DeliveryEntry[]) => setDraft({ entries }),
    [setDraft],
  );
  const add = useCallback(
    () =>
      setEntries([
        ...draft.entries,
        { id: uuidv4(), supplier: '', material: '', quantity: 1, unit: 'loads' },
      ]),
    [draft.entries, setEntries],
  );
  const update = useCallback(
    (id: string, patch: Partial<DeliveryEntry>) =>
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
      title="Deliveries"
      testID="sheet-deliveries"
      onClose={close}
      footer={<PrimaryButton testID="sheet-deliveries-done" label="Done" onPress={close} />}
    >
      {draft.entries.map((entry, i) => (
        <EntryCard key={entry.id} title={`Delivery ${i + 1}`} onRemove={() => remove(entry.id)}>
          <TextField
            label="Supplier"
            value={entry.supplier}
            onChangeText={(supplier) => update(entry.id, { supplier })}
          />
          <TextField
            label="Material"
            value={entry.material}
            onChangeText={(material) => update(entry.id, { material })}
          />
          <Text style={[styles.label, { color: colors.muted, fontFamily: fonts.ui.medium }]}>
            Quantity
          </Text>
          <Stepper
            value={entry.quantity}
            onChange={(quantity) => update(entry.id, { quantity })}
            min={0}
            accessibilityLabel={`Delivery ${i + 1} quantity`}
          />
          <ChipRow
            options={DELIVERY_UNITS}
            value={entry.unit}
            onChange={(unit) => update(entry.id, { unit: unit ?? 'loads' })}
          />
        </EntryCard>
      ))}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add delivery"
        testID="sheet-deliveries-add"
        onPress={add}
        style={({ pressed }) => [
          styles.addBtn,
          { borderColor: colors.border },
          pressed && styles.pressed,
        ]}
      >
        <Ionicons name="add" size={18} color={colors.accent} />
        <Text style={[styles.addText, { color: colors.accent, fontFamily: fonts.ui.semibold }]}>
          Add delivery
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
