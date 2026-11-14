/**
 * True inside a read-only {@link SectionSheetScaffold}. Shared controls
 * (TextField, Stepper, Chip, EntryCard) read it so a submitted/locked report
 * exposes no editable inputs, regardless of how a sheet composes them.
 * Defaults to false so controls outside a sheet are unaffected.
 */
import { createContext, useContext } from 'react';

export const SectionReadOnlyContext = createContext(false);

export function useSectionReadOnly(): boolean {
  return useContext(SectionReadOnlyContext);
}
