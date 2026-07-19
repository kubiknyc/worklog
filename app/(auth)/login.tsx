/**
 * Login screen — always renders in the Blueprint theme regardless of the
 * device's saved appearance (PRD §3 M0: "always Blueprint"), so it reads
 * `PALETTES.blueprint` / `FONTS` directly rather than through `useTheme()`.
 *
 * M2 auth: real Supabase email/password auth. On success, onAuthStateChange
 * flips AuthProvider's `status` to 'authed' and the (auth) layout guard
 * redirects into the tabs — no manual navigation here. The two demo rows
 * sign in with the seeded demo accounts (jobsight-backend/supabase/seed.sql).
 * Invite acceptance and password reset land on app/set-password.tsx in a
 * later milestone (M2, P2-9) — "Forgot password?" below only sends the
 * email; it does not link anywhere yet.
 */
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth, validateCredentials } from '../../src/auth';
import { ERROR_COLORS, FONTS, PALETTES } from '../../src/theme';

const C = PALETTES.blueprint;
const ERROR_TEXT = ERROR_COLORS.blueprint;

// Seeded demo accounts (see jobsight-backend/supabase/seed.sql) — dev builds
// by default, no .env entry needed; set `EXPO_PUBLIC_DEMO_LOGINS=off` to hide
// them from a dev session (e.g. screenshot runs). Keeping `__DEV__` in the
// gate lets Metro/terser dead-code-eliminate the password literal and account
// list from production bundles regardless of env configuration.
interface DemoAccount {
  readonly role: string;
  readonly name: string;
  readonly email: string;
}

const DEMO_LOGINS_ENABLED = __DEV__ && process.env.EXPO_PUBLIC_DEMO_LOGINS !== 'off';

const DEMO_PASSWORD = DEMO_LOGINS_ENABLED ? 'punchlist123' : '';

const DEMO_ACCOUNTS: readonly DemoAccount[] = DEMO_LOGINS_ENABLED
  ? [
      { role: 'Superintendent', name: 'Site Superintendent', email: 'super@keystonebuild.com' },
      { role: 'Subcontractor', name: 'A. Cruz · Plumbing', email: 'cruz@keystonebuild.com' },
    ]
  : [];

export default function LoginScreen() {
  const { signIn, resetPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);

  const submit = async (nextEmail: string, nextPassword: string) => {
    if (submitting || sendingReset) return;
    setError(null);
    setNotice(null);
    const invalid = validateCredentials(nextEmail, nextPassword);
    if (invalid) {
      setError(invalid.message);
      return;
    }
    setSubmitting(true);
    const message = await signIn(nextEmail, nextPassword);
    if (message) {
      setError(message);
      setSubmitting(false);
    }
    // On success the layout guard redirects and this screen unmounts.
  };

  const onDemoPress = (acc: DemoAccount) => {
    setEmail(acc.email);
    setPassword(DEMO_PASSWORD);
    void submit(acc.email, DEMO_PASSWORD);
  };

  const onForgotPress = async () => {
    if (submitting || sendingReset) return;
    setError(null);
    setNotice(null);
    const trimmed = email.trim();
    if (!trimmed.includes('@')) {
      setError('Enter your email above first, then tap "Forgot password?".');
      return;
    }
    setSendingReset(true);
    const message = await resetPassword(trimmed);
    setSendingReset(false);
    if (message) {
      setError(message);
      return;
    }
    // GoTrue answers success for unknown emails too — don't confirm accounts.
    setNotice('If that email has an account, a reset link is on its way. Open it on this phone.');
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Wordmark */}
          <View style={styles.lockup}>
            <Text style={styles.brand}>WorkLog</Text>
            <Text style={styles.brandSub}>Keystone Build Group</Text>
          </View>

          <Text style={styles.heading}>Sign in</Text>

          <View style={styles.field}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              accessibilityLabel="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="you@keystonebuild.com"
              placeholderTextColor={C.faint}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              editable={!submitting}
              style={styles.input}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Password</Text>
            <TextInput
              accessibilityLabel="Password"
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor={C.faint}
              secureTextEntry
              editable={!submitting}
              onSubmitEditing={() => void submit(email, password)}
              style={styles.input}
            />
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}
          {notice ? <Text style={styles.notice}>{notice}</Text> : null}

          <Pressable
            onPress={() => void submit(email, password)}
            disabled={submitting}
            style={({ pressed }) => [
              styles.primaryBtn,
              pressed && styles.pressed,
              submitting && styles.btnDisabled,
            ]}
          >
            {submitting ? (
              <ActivityIndicator color={C.accentInk} />
            ) : (
              <Text style={styles.primaryBtnText}>Log in</Text>
            )}
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={() => void onForgotPress()}
            disabled={submitting || sendingReset}
            style={styles.forgotLink}
          >
            {sendingReset ? (
              <ActivityIndicator size="small" color={C.accent} />
            ) : (
              <Text style={styles.forgotText}>Forgot password?</Text>
            )}
          </Pressable>

          {/* Demo-account shortcuts — env-gated, dev builds only. */}
          {DEMO_LOGINS_ENABLED && (
            <>
              {/* Divider */}
              <View style={styles.divider}>
                <View style={styles.line} />
                <Text style={styles.dividerText}>Demo accounts</Text>
                <View style={styles.line} />
              </View>

              {DEMO_ACCOUNTS.map((acc) => (
                <Pressable
                  key={acc.email}
                  onPress={() => onDemoPress(acc)}
                  disabled={submitting}
                  style={({ pressed }) => [styles.demoRow, pressed && styles.pressed]}
                >
                  <View style={styles.demoAvatar}>
                    <Text style={styles.demoAvatarInitial}>{acc.role.charAt(0)}</Text>
                  </View>
                  <View style={styles.flex}>
                    <Text style={styles.demoRole}>{acc.role}</Text>
                    <Text style={styles.demoEmail}>{acc.email}</Text>
                  </View>
                </Pressable>
              ))}

              <Text style={styles.footnote}>
                Tap a demo account to sign in instantly, or enter your own credentials above.
              </Text>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 32,
  },
  lockup: { alignItems: 'center', marginBottom: 28 },
  brand: {
    fontFamily: FONTS.serif.bold,
    fontSize: 34,
    letterSpacing: -0.5,
    color: C.text,
  },
  brandSub: {
    fontFamily: FONTS.ui.medium,
    fontSize: 13,
    color: C.muted,
    marginTop: 2,
  },
  heading: {
    fontFamily: FONTS.ui.extrabold,
    fontSize: 28,
    letterSpacing: -0.5,
    color: C.text,
    marginBottom: 20,
  },
  field: { marginBottom: 14 },
  label: {
    fontFamily: FONTS.ui.semibold,
    fontSize: 12,
    color: C.muted,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  input: {
    height: 50,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(120,180,220,0.25)',
    paddingHorizontal: 14,
    color: C.text,
    fontFamily: FONTS.ui.regular,
    fontSize: 15,
  },
  error: {
    fontFamily: FONTS.ui.medium,
    fontSize: 13,
    color: ERROR_TEXT,
    marginBottom: 12,
  },
  notice: {
    fontFamily: FONTS.ui.medium,
    fontSize: 13,
    color: C.muted,
    marginBottom: 12,
    lineHeight: 18,
  },
  primaryBtn: {
    height: 50,
    borderRadius: 14,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  btnDisabled: { opacity: 0.7 },
  primaryBtnText: {
    fontFamily: FONTS.ui.bold,
    fontSize: 16,
    color: C.accentInk,
  },
  forgotLink: { alignSelf: 'center', paddingVertical: 12, marginTop: 4, minHeight: 40 },
  forgotText: {
    fontFamily: FONTS.ui.semibold,
    fontSize: 13,
    color: C.accent,
  },
  pressed: { opacity: 0.85 },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 14,
    gap: 12,
  },
  line: { flex: 1, height: 1, backgroundColor: C.border },
  dividerText: {
    fontFamily: FONTS.ui.semibold,
    fontSize: 12,
    color: C.faint,
  },
  demoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
  },
  demoAvatar: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: C.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  demoAvatarInitial: {
    fontFamily: FONTS.ui.bold,
    fontSize: 15,
    color: C.accent,
  },
  demoRole: {
    fontFamily: FONTS.ui.bold,
    fontSize: 14,
    color: C.text,
  },
  demoEmail: {
    fontFamily: FONTS.mono.regular,
    fontSize: 12,
    color: C.muted,
    marginTop: 1,
  },
  footnote: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12,
    color: C.faint,
    textAlign: 'center',
    marginTop: 18,
    lineHeight: 17,
  },
});
