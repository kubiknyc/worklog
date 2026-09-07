/**
 * Set-password screen — invite AND signup-confirmation deep links land here
 * (ported from PunchLog's app/set-password.tsx):
 * `worklog://set-password#access_token=…&refresh_token=…&type=…`.
 * Password recovery no longer lands here: `resetPassword` (AuthProvider)
 * points at the site's `/welcome` instead, which exchanges the emailed
 * token_hash on a button tap so a mail scanner's GET can't burn it, then
 * lets the user choose a new password in the browser. `type=recovery`
 * handling below is kept for legacy access_token-style links already in
 * flight. Signup confirmations arrive here because registration is
 * invite-style — no password is collected at sign-up; this screen is where
 * it's chosen.
 *
 * Besides the deep link, the auth fragment can arrive from app/confirm.tsx
 * via the module-scoped one-shot in src/auth/pendingAuthLink.ts. It is NOT a
 * route param: that would put a live access token in the query string
 * (browser history + Referer on the Expo web build). The stashed fragment,
 * when present, wins over `useURL()`, which fires no event after an in-app
 * `router.replace` and can return a stale launch URL.
 *
 * Deliberately a TOP-LEVEL route: the (auth) group bounces authed users to
 * the tabs, and `setSession` makes the caller authed the moment the tokens
 * are applied — inside (auth) this screen would be yanked away mid-flow.
 * Requires a dev/production build (custom scheme links don't reach Expo Go).
 */
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useURL } from 'expo-linking';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  applyAuthTokens,
  checkPasswordStrength,
  parseAuthLink,
  takeAuthFragment,
  updateAuthPassword,
  validatePasswordChoice,
  type AuthLinkType,
} from '../src/auth';
import { BrandMark } from '../src/components/BrandMark';
import { readFreshPendingCount, syncStatusHub } from '../src/sync/statusHub';
import { useTheme } from '../src/theme';

type Phase =
  | { readonly kind: 'waiting' }
  | { readonly kind: 'ready'; readonly linkType: AuthLinkType }
  | { readonly kind: 'invalid'; readonly message: string }
  /**
   * spec A5 — the link belongs to a different user than the one currently
   * signed in, and that user has unsynced queued mutations. Applying the new
   * session would rebuild RepositoryProvider and wipe the current user's
   * local cache (including the queue) before it ever reaches the server, so
   * the swap never happens; the user has to clear their own queue first.
   */
  | { readonly kind: 'blocked' };

/**
 * Read a TRUSTWORTHY pending-mutation count from the sync status hub for the
 * queue-loss guard (spec A5). Do not read `syncStatusHub.getState().pending`
 * directly here: the hub's idle state publishes `pending: 0` both genuinely
 * (nothing queued) and transiently (no producer installed yet on a cold
 * start, or `setCounter`'s idle reset before the first real recount lands).
 * On a cold start via someone else's confirm link, `applyAuthTokens` can run
 * before RepositoryProvider has attached the real counter/engine — a raw
 * read of the idle `0` would let the session swap proceed and wipe the
 * signed-in user's offline queue.
 *
 * `readFreshPendingCount` forces a real recount and fails CLOSED — treat as
 * blocked — when no producer is installed yet or the count errored, so this
 * producer maps that untrustworthy case to a sentinel guaranteed to read as
 * "pending work exists" at the `pending > 0` check in applyAuthTokens.
 */
const pendingMutationCount = (): Promise<number> =>
  readFreshPendingCount(syncStatusHub).then((count) => count ?? Number.POSITIVE_INFINITY);

export default function SetPasswordScreen() {
  const router = useRouter();
  const url = useURL();
  const { colors, error: errorColor, fonts, radii } = useTheme();

  // The confirm.tsx shim hands the auth fragment over in module scope (see
  // pendingAuthLink). Read it exactly once per mount and prefer it over
  // useURL(), which fires no event after an in-app router.replace and can
  // return a STALE launch URL — applying an earlier link's tokens.
  // A ref sentinel, NOT useState(() => takeAuthFragment()): a state initializer
  // must be pure, and React's dev/StrictMode double-invocation would consume
  // the one-shot fragment on the throwaway call and leave null behind —
  // silently breaking the very hand-off this exists for.
  const stashedRef = useRef<string | null | undefined>(undefined);
  if (stashedRef.current === undefined) stashedRef.current = takeAuthFragment();
  const stashedFragment = stashedRef.current;
  const linkUrl = stashedFragment ? `worklog://set-password#${stashedFragment}` : url;

  const [phase, setPhase] = useState<Phase>({ kind: 'waiting' });
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Apply the link's tokens once — useURL can re-emit the same URL.
  const appliedRef = useRef(false);
  const savingRef = useRef(false);

  useEffect(() => {
    const parsed = parseAuthLink(linkUrl);
    if (parsed.kind === 'error') {
      setPhase({ kind: 'invalid', message: parsed.message });
      return;
    }
    if (parsed.kind !== 'session' || appliedRef.current) return;
    appliedRef.current = true;
    let ignore = false;
    void applyAuthTokens(parsed.accessToken, parsed.refreshToken, pendingMutationCount).then(
      (result) => {
        if (ignore) return;
        switch (result.kind) {
          case 'ok':
            setPhase({ kind: 'ready', linkType: parsed.linkType });
            return;
          case 'blockedPendingSync':
            appliedRef.current = false;
            setPhase({ kind: 'blocked' });
            return;
          case 'rejected':
            appliedRef.current = false;
            setPhase({ kind: 'invalid', message: 'This link is no longer valid.' });
            return;
        }
      },
    );
    return () => {
      ignore = true;
    };
  }, [linkUrl]);

  const onSave = async () => {
    // Ref, not the isSaving state: a second tap in the same tick can run
    // before React has flushed setIsSaving(true), and a double PUT 401s the
    // second call — surfacing "this link is no longer valid" over a save that
    // actually succeeded.
    if (savingRef.current) return;
    savingRef.current = true;
    setFormError(null);
    try {
      // Registration collects no password, so this is the ONLY place an app
      // user chooses a credential. The gate lives in src/auth/passwordChoice
      // so it can be tested — tests may not live under app/.
      const choice = validatePasswordChoice(password, confirm);
      if (choice.kind === 'error') {
        setFormError(choice.message);
        return;
      }
      setIsSaving(true);
      const result = await updateAuthPassword(password);
      switch (result.kind) {
        case 'ok':
          // Through app/index.tsx, not straight to the tabs — it's the single
          // place that gates on the welcome-seen flag.
          router.replace('/');
          return;
        case 'expired':
          // Retrying cannot work — the link is spent. Send them to the one
          // path that can still get them a password.
          setPhase({
            kind: 'invalid',
            message: 'This link is no longer valid.',
          });
          return;
        case 'rejected':
          setFormError(result.message);
          return;
        case 'failed':
          setFormError("Couldn't set your password. Check your connection and try again.");
          return;
      }
    } catch {
      // updateAuthPassword is contracted to resolve, not throw, but if that
      // ever changes the user must see a retryable error rather than a frozen
      // screen.
      setFormError("Couldn't set your password. Check your connection and try again.");
    } finally {
      // Both flags, on EVERY path — including a throw. setIsSaving used to sit
      // after the await, so a rejected promise left the button disabled for
      // good: the exact dead end this guard exists to avoid causing.
      setIsSaving(false);
      savingRef.current = false;
    }
  };

  const inputStyle = [
    styles.input,
    { backgroundColor: colors.surface2, borderColor: colors.border, color: colors.text },
    { fontFamily: fonts.ui.regular },
  ];

  const liveStrength = password.length > 0 ? checkPasswordStrength(password) : null;

  const isRecovery = phase.kind === 'ready' && phase.linkType === 'recovery';
  const title =
    phase.kind === 'invalid'
      ? 'Link problem'
      : phase.kind === 'blocked'
        ? 'Sign in and sync first'
        : isRecovery
          ? 'Reset your password'
          : 'Welcome to WorkLog';
  const readyCopy = isRecovery
    ? 'Choose a new password for your account.'
    : 'Choose a password to finish setting up your account.';

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
      <StatusBar style={colors.scheme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.body}>
        <View style={styles.lockup}>
          <BrandMark size={64} />
        </View>
        <Text style={[styles.title, { color: colors.text, fontFamily: fonts.ui.extrabold }]}>
          {title}
        </Text>

        {/* 'waiting' needs its own escape: a link that arrives without a
            parseable fragment (already-consumed one-shot token, a stale warm
            start) would otherwise pin the user here with nothing to tap. */}
        {phase.kind === 'waiting' ? (
          <>
            <Text style={[styles.copy, { color: colors.muted, fontFamily: fonts.ui.regular }]}>
              Open the link from your email on this phone to set your password.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.replace('/(auth)/login')}
              style={({ pressed }) => [
                styles.button,
                { backgroundColor: colors.accent, borderRadius: radii.button },
                pressed && styles.pressed,
              ]}
            >
              <Text
                style={[styles.buttonText, { color: colors.accentInk, fontFamily: fonts.ui.bold }]}
              >
                Go to sign in
              </Text>
            </Pressable>
          </>
        ) : null}

        {phase.kind === 'invalid' ? (
          <>
            <Text
              testID="set-password-error"
              style={[styles.copy, { color: colors.muted, fontFamily: fonts.ui.regular }]}
            >
              {phase.message} Request a new reset link from the sign-in screen, or ask your
              superintendent for a fresh invite.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.replace('/(auth)/login')}
              style={({ pressed }) => [
                styles.button,
                { backgroundColor: colors.accent, borderRadius: radii.button },
                pressed && styles.pressed,
              ]}
            >
              <Text
                style={[styles.buttonText, { color: colors.accentInk, fontFamily: fonts.ui.bold }]}
              >
                Go to sign in
              </Text>
            </Pressable>
          </>
        ) : null}

        {phase.kind === 'blocked' ? (
          <>
            <Text
              testID="set-password-error"
              style={[styles.copy, { color: colors.muted, fontFamily: fonts.ui.regular }]}
            >
              This link belongs to a different account, and this device has unsynced work queued for
              the account you&apos;re signed in as now. Sign in as that account and let it finish
              syncing, then open the link again.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.replace('/(auth)/login')}
              style={({ pressed }) => [
                styles.button,
                { backgroundColor: colors.accent, borderRadius: radii.button },
                pressed && styles.pressed,
              ]}
            >
              <Text
                style={[styles.buttonText, { color: colors.accentInk, fontFamily: fonts.ui.bold }]}
              >
                Go to sign in
              </Text>
            </Pressable>
          </>
        ) : null}

        {phase.kind === 'ready' ? (
          <>
            <Text style={[styles.copy, { color: colors.muted, fontFamily: fonts.ui.regular }]}>
              {readyCopy}
            </Text>
            <TextInput
              testID="set-password-input"
              accessibilityLabel="New password"
              value={password}
              onChangeText={setPassword}
              placeholder="New password"
              placeholderTextColor={colors.faint}
              secureTextEntry
              autoCapitalize="none"
              editable={!isSaving}
              style={inputStyle}
            />
            {/* Progressive feedback, matching the website's meter — otherwise
                the strength floor only ever surfaces as a rejection after the
                user has committed to a password. */}
            {liveStrength ? (
              <Text
                testID="set-password-strength"
                accessibilityLiveRegion="polite"
                style={[styles.copy, { color: colors.muted, fontFamily: fonts.ui.regular }]}
              >
                Strength: {liveStrength.label}
                {liveStrength.suggestion ? ` — ${liveStrength.suggestion}` : ''}
              </Text>
            ) : null}
            <TextInput
              testID="set-password-confirm-input"
              accessibilityLabel="Confirm password"
              value={confirm}
              onChangeText={setConfirm}
              placeholder="Confirm password"
              placeholderTextColor={colors.faint}
              secureTextEntry
              autoCapitalize="none"
              editable={!isSaving}
              style={inputStyle}
            />
            {formError ? (
              <Text
                testID="set-password-error"
                style={[styles.error, { color: errorColor, fontFamily: fonts.ui.medium }]}
              >
                {formError}
              </Text>
            ) : null}
            <Pressable
              testID="set-password-submit"
              accessibilityRole="button"
              accessibilityLabel="Save password"
              disabled={isSaving}
              onPress={() => void onSave()}
              style={({ pressed }) => [
                styles.button,
                { backgroundColor: colors.accent, borderRadius: radii.button },
                pressed && styles.pressed,
                isSaving && styles.disabled,
              ]}
            >
              {isSaving ? (
                <ActivityIndicator color={colors.accentInk} />
              ) : (
                <Text
                  style={[
                    styles.buttonText,
                    { color: colors.accentInk, fontFamily: fonts.ui.bold },
                  ]}
                >
                  Save password
                </Text>
              )}
            </Pressable>
          </>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { flex: 1, justifyContent: 'center', padding: 24, gap: 14 },
  lockup: { alignItems: 'center', marginBottom: 4 },
  title: { fontSize: 24, letterSpacing: -0.3 },
  copy: { fontSize: 14.5, lineHeight: 21 },
  input: { height: 50, borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, fontSize: 15 },
  error: { fontSize: 13 },
  button: { height: 50, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  buttonText: { fontSize: 16 },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.7 },
});
