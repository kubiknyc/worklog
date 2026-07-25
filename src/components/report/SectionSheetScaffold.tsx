/**
 * SectionSheetScaffold — the shared shell for the 11 section-input sheets
 * (PRD §7). Composes {@link BottomSheet} (which owns the modal chrome, backdrop,
 * grab handle, title, and keyboard avoidance) and adds the two things every
 * section sheet needs:
 *
 *  - a vertically-scrolling body capped at ~85% of the window height, because
 *    section sheets are tall and must scroll rather than push the footer
 *    off-screen (PRD §9 AC-R3: draft sections scroll vertically, no h-tabs);
 *  - a footer pinned at the sheet bottom holding the primary action, so the
 *    confirm sits in the reachable bottom 40% (AC-R1/R2). The footer defaults
 *    to a "Done" button that closes the sheet.
 *
 * When `onNoneToday` is set, a full-width affirmation row renders above the
 * footer — the explicit "None today" / "Nothing to report" tap that a deliberate
 * empty is (legally stronger than a blank; PRD §7 Safety row).
 *
 * BottomSheet already wraps its children in a KeyboardAvoidingView, so this
 * scaffold does NOT add its own — double-wrapping would double-shift the sheet.
 */
import { Ionicons } from '@expo/vector-icons';
import { type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions } from 'react-native';

import { useTheme } from '../../theme';
import { BottomSheet } from '../BottomSheet';
import { PrimaryButton } from '../PrimaryButton';

type Props = {
  readonly visible: boolean;
  readonly title: string;
  readonly onClose: () => void;
  readonly onNoneToday?: () => void;
  readonly noneLabel?: string;
  readonly footer?: ReactNode;
  readonly children: ReactNode;
  /**
   * Selector prefix for Maestro flows, e.g. `sheet-crew`. The affirmation row
   * becomes `<testID>-none` and the default footer `<testID>-done`, so every
   * section sheet exposes the same two handles without each one restating them.
   * A sheet supplying its own `footer` owns that button's testID.
   */
  readonly testID?: string;
};

export function SectionSheetScaffold({
  visible,
  title,
  onClose,
  onNoneToday,
  noneLabel = 'None today',
  footer,
  children,
  testID,
}: Props) {
  const { colors, fonts, radii } = useTheme();
  const { height } = useWindowDimensions();

  return (
    <BottomSheet visible={visible} onClose={onClose} title={title}>
      <ScrollView
        style={{ maxHeight: height * 0.85 }}
        contentContainerStyle={styles.bodyContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>

      {onNoneToday ? (
        <Pressable
          testID={testID ? `${testID}-none` : undefined}
          accessibilityRole="button"
          accessibilityLabel={noneLabel}
          onPress={onNoneToday}
          style={({ pressed }) => [
            styles.none,
            { borderColor: colors.border, borderRadius: radii.button },
            pressed && styles.pressed,
          ]}
        >
          <Ionicons name="checkmark-circle-outline" size={18} color={colors.muted} />
          <Text style={[styles.noneText, { color: colors.muted, fontFamily: fonts.ui.semibold }]}>
            {noneLabel}
          </Text>
        </Pressable>
      ) : null}

      {footer ?? (
        <PrimaryButton
          testID={testID ? `${testID}-done` : undefined}
          label="Done"
          onPress={onClose}
        />
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  bodyContent: { gap: 12, paddingBottom: 4 },
  none: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    paddingHorizontal: 14,
  },
  noneText: { fontSize: 15 },
  pressed: { opacity: 0.8 },
});
