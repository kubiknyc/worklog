/**
 * "Run your own company?" — the form half of Today's create-company offer.
 * CreateCompanySection decides whether it shows and handles what happens
 * after; this card only collects the name and calls the data-layer helper.
 * Failure copy is chosen there from the error code.
 *
 * Sits ABOVE "Create a project" on purpose: creating a project first makes the
 * user a project member, and the server then refuses this for good.
 *
 * PL002 (already affiliated) is handed straight to the section, which reloads
 * the account and decides: a lost-response success, a membership, or a refusal
 * that will repeat — the card never shows that message itself.
 */
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';

import { createOwnCompany } from '../data/createOwnCompany';
import { useTheme } from '../theme';
import { PrimaryButton } from './PrimaryButton';
import { TextField } from './TextField';

interface Props {
  readonly onCreated: () => Promise<void> | void;
  readonly onAlreadyAffiliated: (message: string) => Promise<void> | void;
}

export function CreateCompanyCard({ onCreated, onAlreadyAffiliated }: Props) {
  const { colors, fonts, radii, spacing, error: errorColor } = useTheme();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // State is not synchronous: a tap on the button and a Return on the field in
  // the same tick would both read `saving === false` and send two requests.
  const savingRef = useRef(false);

  // accessibilityLiveRegion below covers Android only; iOS needs an explicit
  // announcement (the same pattern as ToastProvider).
  useEffect(() => {
    if (error) AccessibilityInfo.announceForAccessibility(error);
  }, [error]);

  const submit = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const result = await createOwnCompany(name);
      if (result.kind === 'created') {
        await onCreated();
        return;
      }
      if (result.kind === 'alreadyAffiliated') {
        await onAlreadyAffiliated(result.message);
        return;
      }
      setError(result.message);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <View
      testID="today-company-card"
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: radii.card,
          padding: spacing.lg,
          gap: spacing.md,
        },
      ]}
    >
      <Text style={[styles.title, { color: colors.text, fontFamily: fonts.ui.bold }]}>
        Run your own company?
      </Text>
      <Text style={[styles.body, { color: colors.muted, fontFamily: fonts.ui.regular }]}>
        Set it up here before you create a project. You&apos;ll be its administrator.
      </Text>
      <TextField
        testID="today-company-name"
        label="Company name"
        value={name}
        onChangeText={setName}
        autoCapitalize="words"
        returnKeyType="done"
        onSubmitEditing={() => void submit()}
      />
      {error ? (
        <Text
          testID="today-company-error"
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={[styles.body, { color: errorColor, fontFamily: fonts.ui.medium }]}
        >
          {error}
        </Text>
      ) : null}
      <PrimaryButton
        testID="today-company-submit"
        label="Set up my company"
        onPress={() => void submit()}
        busy={saving}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1 },
  title: { fontSize: 17 },
  body: { fontSize: 15 },
});
