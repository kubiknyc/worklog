/**
 * Register screen — self-serve "create a company" sign-up, reached from the
 * login screen. Mirrors the marketing website's form: creates the company and
 * makes this user its admin (joining an existing company stays invite-only).
 *
 * Invite-style registration: NO password is collected here. On success the
 * server emails a confirmation link that deep-links to app/set-password.tsx,
 * where the user chooses their password — so this screen ends on a
 * "check your email" state, not in the tabs. The success copy is identical
 * whether or not the account already existed (the server's 200 is
 * byte-identical on purpose — no account enumeration; don't add copy that
 * diverges).
 *
 * Styling matches login.tsx (static blueprint palette) — the two screens sit
 * side by side in the pre-auth stack and should be visually indistinguishable
 * in chrome.
 */
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { registerCompany, validateRegistration } from '../../src/auth';
import type { FieldErrors, RegisterInput } from '../../src/auth';
import { BrandMark } from '../../src/components/BrandMark';
import { PRIVACY_URL, TERMS_URL } from '../../src/lib/legal';
import { FIXED_COLORS, FONTS, PALETTES } from '../../src/theme';

const C = PALETTES.blueprint;

const EMPTY_FORM: RegisterInput = {
  companyName: '',
  fullName: '',
  email: '',
};

interface FieldSpec {
  readonly field: keyof RegisterInput;
  readonly label: string;
  readonly placeholder: string;
  readonly testID: string;
  readonly email?: boolean;
}

const FIELDS: readonly FieldSpec[] = [
  {
    field: 'companyName',
    label: 'Company name',
    placeholder: 'Keystone Build Group',
    testID: 'register-company-name',
  },
  {
    field: 'fullName',
    label: 'Your name',
    placeholder: 'Sam Keystone',
    testID: 'register-full-name',
  },
  {
    field: 'email',
    label: 'Email',
    placeholder: 'you@company.com',
    testID: 'register-email',
    email: true,
  },
];

export default function RegisterScreen() {
  const router = useRouter();
  const [form, setForm] = useState<RegisterInput>(EMPTY_FORM);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [topError, setTopError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDone, setIsDone] = useState(false);

  const setField = (field: keyof RegisterInput, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const submit = async () => {
    if (isSubmitting) return;
    setTopError(null);
    const nextErrors = validateRegistration(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setIsSubmitting(true);
    let result: Awaited<ReturnType<typeof registerCompany>>;
    try {
      result = await registerCompany({
        companyName: form.companyName.trim(),
        fullName: form.fullName.trim(),
        email: form.email.trim(),
      });
    } catch {
      // The seam resolves with {kind} rather than throwing, but if that
      // contract ever changes the user must see an error, not a silent stop.
      setTopError("Couldn't create your account. Check your connection and try again.");
      return;
    } finally {
      setIsSubmitting(false);
    }

    switch (result.kind) {
      case 'ok':
        setIsDone(true);
        return;
      case 'invalid':
        if (result.field) {
          setErrors({ [result.field]: result.message });
        } else {
          setTopError(result.message);
        }
        return;
      case 'rateLimited':
        setTopError('Too many attempts today. Try again tomorrow.');
        return;
      case 'failed':
        setTopError("Couldn't create your account. Check your connection and try again.");
        return;
    }
  };

  // back() pops to the login instance we were pushed from; replace would stack
  // a second login. The fallback covers a direct web navigation to /register.
  const backToSignIn = () => (router.canGoBack() ? router.back() : router.replace('/(auth)/login'));

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
          <View style={styles.lockup}>
            <View style={styles.logoMark}>
              <BrandMark size={64} />
            </View>
            <Text style={styles.brand}>WorkLog</Text>
          </View>

          {isDone ? (
            <>
              <Text testID="register-done-heading" style={styles.heading}>
                Check your email
              </Text>
              <Text style={styles.copy}>
                {/* On web the confirm link lands on the website, not this app —
                    "on this phone" would misdirect (matches the client field the
                    seam sends). */}
                {Platform.OS === 'web'
                  ? `We sent a confirmation link to ${form.email.trim()}. Open it to confirm your email and choose your password.`
                  : `We sent a confirmation link to ${form.email.trim()}. Open it on this phone to confirm your email and choose your password.`}
              </Text>
              <Pressable
                testID="register-back"
                accessibilityRole="button"
                onPress={backToSignIn}
                style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
              >
                <Text style={styles.primaryBtnText}>Back to sign in</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.heading}>Create a company account</Text>
              <Text style={styles.copy}>
                Set up your company on WorkLog. You&#39;ll be the admin — you can create projects
                and invite your team once you&#39;re in. Joining an existing company? Ask them for
                an invite instead.
              </Text>

              {FIELDS.map(({ field, label, placeholder, email, testID }) => (
                <View key={field} style={styles.field}>
                  <Text style={styles.label}>{label}</Text>
                  <TextInput
                    testID={testID}
                    accessibilityLabel={label}
                    value={form[field]}
                    onChangeText={(value) => setField(field, value)}
                    placeholder={placeholder}
                    placeholderTextColor={C.faint}
                    autoCapitalize={email ? 'none' : 'words'}
                    autoComplete={email ? 'email' : undefined}
                    keyboardType={email ? 'email-address' : 'default'}
                    editable={!isSubmitting}
                    style={styles.input}
                  />
                  {errors[field] ? <Text style={styles.fieldError}>{errors[field]}</Text> : null}
                </View>
              ))}

              {topError ? (
                <Text testID="register-error" style={styles.error}>
                  {topError}
                </Text>
              ) : null}

              {/* EULA acceptance (App Store 5.1.1(i) / Guideline 1.2): both
                  documents are one tap away before the account exists. */}
              <Text style={styles.legal}>
                By creating an account you agree to the{' '}
                <Text
                  accessibilityRole="link"
                  style={styles.legalLink}
                  onPress={() => void Linking.openURL(TERMS_URL).catch(() => {})}
                >
                  Terms of Service
                </Text>{' '}
                and{' '}
                <Text
                  accessibilityRole="link"
                  style={styles.legalLink}
                  onPress={() => void Linking.openURL(PRIVACY_URL).catch(() => {})}
                >
                  Privacy Policy
                </Text>
                .
              </Text>

              <Pressable
                testID="register-submit"
                accessibilityRole="button"
                onPress={() => void submit()}
                disabled={isSubmitting}
                style={({ pressed }) => [
                  styles.primaryBtn,
                  pressed && styles.pressed,
                  isSubmitting && styles.btnDisabled,
                ]}
              >
                {isSubmitting ? (
                  <ActivityIndicator color={C.accentInk} />
                ) : (
                  <Text style={styles.primaryBtnText}>Create account</Text>
                )}
              </Pressable>

              <Pressable
                testID="register-back"
                accessibilityRole="button"
                onPress={backToSignIn}
                disabled={isSubmitting}
                style={styles.backLink}
              >
                <Text style={styles.backText}>Back to sign in</Text>
              </Pressable>
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
  lockup: { alignItems: 'center', marginBottom: 24 },
  logoMark: { marginBottom: 14 },
  brand: {
    fontFamily: FONTS.serif.bold,
    fontSize: 34,
    letterSpacing: -0.5,
    color: C.text,
  },
  heading: {
    fontFamily: FONTS.ui.extrabold,
    fontSize: 26,
    letterSpacing: -0.5,
    color: C.text,
    marginBottom: 10,
  },
  copy: {
    fontFamily: FONTS.ui.regular,
    fontSize: 14,
    lineHeight: 20,
    color: C.muted,
    marginBottom: 18,
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
  fieldError: {
    fontFamily: FONTS.ui.medium,
    fontSize: 13,
    color: FIXED_COLORS.error,
    marginTop: 6,
  },
  error: {
    fontFamily: FONTS.ui.medium,
    fontSize: 13,
    color: FIXED_COLORS.error,
    marginBottom: 12,
  },
  legal: {
    fontFamily: FONTS.ui.regular,
    fontSize: 12.5,
    lineHeight: 18,
    color: C.muted,
    marginBottom: 4,
  },
  legalLink: {
    fontFamily: FONTS.ui.semibold,
    color: C.accent,
    textDecorationLine: 'underline',
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
  backLink: { alignSelf: 'center', paddingVertical: 12, marginTop: 4, minHeight: 40 },
  backText: {
    fontFamily: FONTS.ui.semibold,
    fontSize: 13,
    color: C.accent,
  },
  pressed: { opacity: 0.85 },
});
