/**
 * "Run your own company?" — shown on Today's no-project state to someone with
 * no project, no company and no parked company (see `canCreateOwnCompany`).
 * Typically a founder who declined the parked company on the website: they
 * are confirmed, have nothing, and registering again only sends an
 * account-exists email.
 *
 * Sits ABOVE "Create a project" on purpose: creating a project first makes the
 * user a project member, and the server then refuses this for good.
 *
 * Calls the data-layer helper only; failure copy is chosen there from the
 * error code. On success the caller confirms it and reloads the account
 * (`onCreated`). On PL002 the caller reloads too (`onRecheck`): a create whose
 * response was lost leaves the account already affiliated, and the reload
 * then hides this card; otherwise the message stays up.
 */
import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { createOwnCompany } from '../data/createOwnCompany';
import { useTheme } from '../theme';
import { PrimaryButton } from './PrimaryButton';
import { TextField } from './TextField';

interface Props {
  readonly onCreated: () => Promise<void> | void;
  readonly onRecheck: () => Promise<void> | void;
}

export function CreateCompanyCard({ onCreated, onRecheck }: Props) {
  const { colors, fonts, radii, error: errorColor } = useTheme();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // State is not synchronous, so a double tap would read `saving === false`
  // twice and create two requests.
  const savingRef = useRef(false);

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
      setError(result.message);
      if (result.kind === 'alreadyAffiliated') await onRecheck();
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
        { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card },
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
  card: { borderWidth: 1, padding: 16, gap: 12 },
  title: { fontSize: 17 },
  body: { fontSize: 15 },
});
