/**
 * Shared modal bottom sheet: dimmed backdrop (tap to dismiss), a surface panel
 * anchored to the bottom with a grab handle and an optional title. Sheets in the
 * write path (status, create, confirm) compose this for one look.
 */
import { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '../theme';

type Props = {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly title?: string;
  readonly children: ReactNode;
};

export function BottomSheet({ visible, onClose, title, children }: Props) {
  const { colors, fonts, radii } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        style={styles.backdrop}
        onPress={onClose}
      />
      {/*
       * Keyboard avoidance: text inputs in sheets must not hide behind the
       * keyboard.
       * - iOS: the Modal window never resizes, so pad by the keyboard overlap
       *   ('padding' — the RN convention; house pattern in login.tsx).
       * - Android: behavior stays undefined. windowSoftInputMode defaults to
       *   adjustResize (Expo softwareKeyboardLayoutMode 'resize'), and an RN
       *   Modal's dialog window inherits it, so the window itself shrinks and
       *   the bottom-anchored sheet rides above the keyboard natively; adding
       *   'padding' on top would double-shift the sheet. This holds with
       *   edgeToEdgeEnabled (app.json) — edge-to-edge keyboard handling is
       *   managed by react-native-edge-to-edge under Expo, keeping resize
       *   semantics intact.
       * When the keyboard is closed the padding is 0, so layout is unchanged.
       */}
      <KeyboardAvoidingView
        style={styles.anchor}
        pointerEvents="box-none"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <SafeAreaView edges={['bottom']} style={styles.safe}>
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderTopLeftRadius: radii.card,
                borderTopRightRadius: radii.card,
              },
            ]}
          >
            <View style={[styles.handle, { backgroundColor: colors.faint }]} />
            {title ? (
              <Text style={[styles.title, { color: colors.text, fontFamily: fonts.ui.extrabold }]}>
                {title}
              </Text>
            ) : null}
            {children}
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  anchor: { flex: 1, justifyContent: 'flex-end' },
  safe: { width: '100%' },
  sheet: { borderTopWidth: 1, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, gap: 12 },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center' },
  title: { fontSize: 19, letterSpacing: -0.3 },
});
