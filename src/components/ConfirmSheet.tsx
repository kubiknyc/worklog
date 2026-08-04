/**
 * Confirmation bottom sheet — a heading, optional body, and a cancel/confirm
 * button pair, used to gate destructive or terminal actions.
 *
 * The confirm button used to fill with the `locked` status colour and hardcode
 * white text: 2.10:1 in the default theme, under half the 4.5:1 AC-S1 floor
 * (#18). It now fills with the theme's `error` colour — semantically right for
 * a destructive gate, where a green "locked" fill never was — and derives its
 * foreground via `onFillColor`, so a palette change cannot silently
 * reintroduce an unreadable pairing.
 *
 * Picking a better literal would not have sufficed: editorial's `locked` green
 * clears 4.5:1 against neither white nor black, so no foreground could rescue
 * it. Status colours are graphical indicators (3:1) and must not be used as
 * text backgrounds at all.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../theme';
import { onFillColor } from '../theme/contrast';
import { BottomSheet } from './BottomSheet';

type Props = {
  readonly visible: boolean;
  readonly title: string;
  readonly message?: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  /**
   * Required testID prefix — yields `<testID>-confirm`, `<testID>-cancel`, and
   * `<testID>-backdrop` on the sheet behind. Required rather than optional
   * because this component exists to gate destructive actions and every one of
   * them needs an end-to-end path: until #23 the buttons carried only
   * `accessibilityLabel`, so a flow could open the confirmation and had no way
   * to complete or dismiss it except `tapOn` visible copy, which
   * `.claude/rules/maestro-testids.md` forbids.
   *
   * Suffixes follow `.maestro/README.md`'s `<action>-confirm` /
   * `<action>-cancel` convention. Both halves of each id are pinned by
   * `src/maestroSelectors.test.ts`: the prefix at the call site, the suffix
   * template here.
   */
  readonly testID: string;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
};

export function ConfirmSheet({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel,
  testID,
  onConfirm,
  onClose,
}: Props) {
  const { colors, fonts, radii, error } = useTheme();
  const confirmInk = onFillColor(error);
  return (
    <BottomSheet visible={visible} onClose={onClose} title={title} testID={testID}>
      {message ? (
        <Text style={[styles.message, { color: colors.muted, fontFamily: fonts.ui.regular }]}>
          {message}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={cancelLabel}
          testID={`${testID}-cancel`}
          onPress={onClose}
          style={({ pressed }) => [
            styles.btn,
            { borderColor: colors.border, borderRadius: radii.button },
            pressed && styles.pressed,
          ]}
        >
          <Text style={[styles.btnText, { color: colors.text, fontFamily: fonts.ui.bold }]}>
            {cancelLabel}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={confirmLabel}
          testID={`${testID}-confirm`}
          onPress={onConfirm}
          style={({ pressed }) => [
            styles.btn,
            styles.confirm,
            {
              backgroundColor: error,
              borderColor: error,
              borderRadius: radii.button,
            },
            pressed && styles.pressed,
          ]}
        >
          <Text style={[styles.btnText, { color: confirmInk, fontFamily: fonts.ui.bold }]}>
            {confirmLabel}
          </Text>
        </Pressable>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  message: { fontSize: 14, lineHeight: 20 },
  actions: { flexDirection: 'row', gap: 10, paddingTop: 2 },
  btn: {
    flex: 1,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  confirm: {},
  btnText: { fontSize: 15 },
  pressed: { opacity: 0.85 },
});
