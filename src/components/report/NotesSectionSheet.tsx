/**
 * NotesSectionSheet — the General Notes editor (PRD §7). The simplest section
 * and the archetype for the JSON-only sections: one full-width multiline field
 * whose text autosaves through {@link useSectionDraft} (no Save button, PRD §6).
 *
 * The mic accessory slot is left for M8 voice — General Notes is a primary
 * voice target, but the field is always a real keyboard input (AC-A3), so it
 * works unchanged before voice ships.
 *
 * Mount with a `key` tied to reportId (useSectionDraft reads `initial` once) —
 * the report screen does this so switching reports remounts the editor.
 */
import { useCallback } from 'react';

import type { GeneralNotesContent } from '../../data/sectionContent';
import { PrimaryButton } from '../PrimaryButton';
import { TextField } from '../TextField';
import { SectionSheetScaffold } from './SectionSheetScaffold';
import { useSectionDraft } from './useSectionDraft';

type Props = {
  readonly visible: boolean;
  readonly reportId: string;
  readonly initial: GeneralNotesContent;
  readonly onClose: () => void;
};

export function NotesSectionSheet({ visible, reportId, initial, onClose }: Props) {
  const { draft, setDraft, flush } = useSectionDraft<GeneralNotesContent>(
    reportId,
    'general_notes',
    initial,
  );

  const close = useCallback(() => {
    flush();
    onClose();
  }, [flush, onClose]);

  return (
    <SectionSheetScaffold
      testID="sheet-notes"
      visible={visible}
      title="General notes"
      onClose={close}
      footer={<PrimaryButton testID="sheet-notes-done" label="Done" onPress={close} />}
    >
      <TextField
        testID="sheet-notes-input"
        label="Notes"
        value={draft.text}
        onChangeText={(text) => setDraft({ text })}
        placeholder="Anything worth recording about today…"
        multiline
      />
    </SectionSheetScaffold>
  );
}
