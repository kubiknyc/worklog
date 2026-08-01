/** EquipmentSectionSheet — relational archetype, add-by-name (PRD §7 Equipment). */
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text } from 'react-native';

import type { EquipmentContent, EquipmentRowContent } from '../../data/sectionContent';
import { uuidv4 } from '../../lib/uuid';
import { useTheme } from '../../theme';
import { ChipRow } from '../ChipRow';
import { PrimaryButton } from '../PrimaryButton';
import { TextField } from '../TextField';
import { EntryCard } from './EntryCard';
import { SectionSheetScaffold } from './SectionSheetScaffold';
import { EQUIPMENT_STATUS } from './sectionConstants';
import { useSectionDraft } from './useSectionDraft';

type Props = {
  readonly visible: boolean;
  readonly reportId: string;
  readonly initial: EquipmentContent;
  readonly onClose: () => void;
  readonly readOnly?: boolean;
};

export function EquipmentSectionSheet({ visible, reportId, initial, onClose, readOnly }: Props) {
  const { colors, fonts } = useTheme();
  const { draft, setDraft, flush } = useSectionDraft<EquipmentContent>(
    reportId,
    'equipment',
    initial,
    { readOnly },
  );
  const [pendingName, setPendingName] = useState('');
  const setRows = useCallback(
    (rows: readonly EquipmentRowContent[]) => setDraft({ rows }),
    [setDraft],
  );
  const add = useCallback(() => {
    if (!pendingName.trim()) return;
    setRows([
      ...draft.rows,
      { id: uuidv4(), name: pendingName.trim(), status: 'active', on_site: true },
    ]);
    setPendingName('');
  }, [draft.rows, pendingName, setRows]);
  const update = useCallback(
    (id: string, patch: Partial<EquipmentRowContent>) =>
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
      title="Equipment"
      testID="sheet-equipment"
      readOnly={readOnly}
      onClose={close}
      footer={<PrimaryButton testID="sheet-equipment-done" label="Done" onPress={close} />}
    >
      {draft.rows.map((row) => (
        <EntryCard key={row.id} title={row.name} onRemove={() => remove(row.id)}>
          <Switch
            value={row.on_site}
            onValueChange={(on_site) => update(row.id, { on_site })}
            trackColor={{ true: colors.accent, false: colors.surface2 }}
            thumbColor={colors.surface}
            accessibilityLabel={`${row.name} on site`}
          />
          <Text style={[styles.caption, { color: colors.muted, fontFamily: fonts.ui.medium }]}>
            On site
          </Text>
          <ChipRow
            options={EQUIPMENT_STATUS}
            value={row.status}
            onChange={(status) => update(row.id, { status: status ?? 'active' })}
          />
        </EntryCard>
      ))}
      <TextField
        label="Equipment name"
        placeholder="Equipment name"
        value={pendingName}
        onChangeText={setPendingName}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add equipment"
        testID="sheet-equipment-add"
        onPress={add}
        style={({ pressed }) => [
          styles.addBtn,
          { borderColor: colors.border },
          pressed && styles.pressed,
        ]}
      >
        <Ionicons name="add" size={18} color={colors.accent} />
        <Text style={[styles.addText, { color: colors.accent, fontFamily: fonts.ui.semibold }]}>
          Add equipment
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
