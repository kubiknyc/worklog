/**
 * SubmitReportSheet — the draft → submitted confirmation (M4a). Captures the
 * signer's display title and a drawn signature (react-native-signature-canvas,
 * WebView-backed — native-only, hence the .native.tsx split; the web build gets
 * the null stub sibling). The signature is REQUIRED: submit stays disabled
 * until a stroke lands (server enforces 22023 on empty bytea regardless).
 * The caller owns the repository call; this sheet only collects input.
 */
import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import SignatureScreen, { type SignatureViewRef } from 'react-native-signature-canvas';

import { useTheme } from '../../theme';
import { BottomSheet } from '../BottomSheet';
import { PrimaryButton } from '../PrimaryButton';
import { TextField } from '../TextField';

type Props = {
  readonly visible: boolean;
  readonly defaultSignerTitle: string | null;
  readonly onSubmit: (input: { signerTitle: string | null; signaturePngBase64: string }) => void;
  readonly onClose: () => void;
  readonly submitting: boolean;
  readonly errorText: string | null;
};

/** Strip react-native-signature-canvas's data-URL prefix — the payload carries bare base64. */
function toBareBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
}

export function SubmitReportSheet({
  visible,
  defaultSignerTitle,
  onSubmit,
  onClose,
  submitting,
  errorText,
}: Props) {
  const { colors, fonts, radii, error } = useTheme();
  const sigRef = useRef<SignatureViewRef>(null);
  const [signerTitle, setSignerTitle] = useState(defaultSignerTitle ?? '');
  const [hasSignature, setHasSignature] = useState(false);

  const handleOK = useCallback(
    (dataUrl: string) => {
      onSubmit({
        signerTitle: signerTitle.trim() === '' ? null : signerTitle.trim(),
        signaturePngBase64: toBareBase64(dataUrl),
      });
    },
    [onSubmit, signerTitle],
  );

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Submit report">
      <Text style={[styles.blurb, { color: colors.muted, fontFamily: fonts.ui.regular }]}>
        Submitting freezes all sections for today. Sign below to confirm.
      </Text>
      <TextField
        testID="submit-signer-title"
        label="Your title"
        value={signerTitle}
        onChangeText={setSignerTitle}
        placeholder="Superintendent"
      />
      <View
        testID="submit-signature-canvas"
        style={[styles.canvas, { borderColor: colors.border, borderRadius: radii.button }]}
      >
        <SignatureScreen
          ref={sigRef}
          onOK={handleOK}
          onBegin={() => setHasSignature(true)}
          onClear={() => setHasSignature(false)}
          descriptionText=""
          webStyle=".m-signature-pad--footer { display: none; } body,html { height: 100%; }"
        />
      </View>
      {errorText ? (
        <Text style={[styles.error, { color: error, fontFamily: fonts.ui.semibold }]}>
          {errorText}
        </Text>
      ) : null}
      <Pressable
        testID="submit-clear-signature"
        accessibilityRole="button"
        accessibilityLabel="Clear signature"
        hitSlop={8}
        style={styles.clearLink}
        onPress={() => sigRef.current?.clearSignature()}
      >
        <Text
          style={[styles.clearLinkText, { color: colors.accent, fontFamily: fonts.ui.semibold }]}
        >
          Clear signature
        </Text>
      </Pressable>
      <PrimaryButton
        testID="submit-confirm"
        label="Submit report"
        busy={submitting}
        disabled={!hasSignature || submitting}
        onPress={() => sigRef.current?.readSignature()}
      />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  blurb: { fontSize: 14, marginBottom: 4 },
  canvas: { height: 220, borderWidth: 1, overflow: 'hidden' },
  error: { fontSize: 14 },
  // 48px min touch target (repo a11y convention) — PrimaryButton has no
  // secondary/ghost variant (only `tone: 'primary' | 'danger'`), so the clear
  // action is a plain text Pressable rather than a second filled button.
  clearLink: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  clearLinkText: { fontSize: 15 },
});
