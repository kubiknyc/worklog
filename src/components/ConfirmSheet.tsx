/**
 * Confirmation bottom sheet — a heading, optional body, and a cancel/confirm
 * button pair. Used for terminal-move gates (e.g. confirming a submit→locked
 * move on a report), so the confirm button carries the `locked` status color.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../theme';
import { BottomSheet } from './BottomSheet';

type Props = {
  readonly visible: boolean;
  readonly title: string;
  readonly message?: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
};

export function ConfirmSheet({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onClose,
}: Props) {
  const { colors, fonts, radii, reportStatus } = useTheme();
  return (
    <BottomSheet visible={visible} onClose={onClose} title={title}>
      {message ? (
        <Text style={[styles.message, { color: colors.muted, fontFamily: fonts.ui.regular }]}>
          {message}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={cancelLabel}
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
          onPress={onConfirm}
          style={({ pressed }) => [
            styles.btn,
            styles.confirm,
            {
              backgroundColor: reportStatus.locked,
              borderColor: reportStatus.locked,
              borderRadius: radii.button,
            },
            pressed && styles.pressed,
          ]}
        >
          <Text style={[styles.btnText, { color: '#FFFFFF', fontFamily: fonts.ui.bold }]}>
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
