/**
 * Generic bad-link landing for `worklog://confirm`.
 *
 * PunchLog's app/confirm.tsx is a LEGACY shim: it exists to catch stragglers
 * from confirm emails PunchLog sent before it switched to invite-style
 * registration, where the old link auto-signed the user in — the
 * account-takeover path this shim was written to defuse (attacker registers
 * the victim's email with a known password, the victim's click confirms it).
 * WorkLog shipped invite-style registration from day one — no prior email
 * template ever pointed here, so there is no in-flight legacy link to defuse
 * (spec L2). This screen is kept anyway as a generic bad-link landing: any
 * stray, malformed, or hand-typed `worklog://confirm` open should read as
 * "link problem" and offer a way back to sign-in, not a blank screen. Like
 * PunchLog's original, it still forwards a well-formed auth fragment to
 * app/set-password.tsx rather than applying it here — that keeps the same
 * property (this screen never signs a user in) even though the exploit it
 * originally closed doesn't apply to WorkLog.
 *
 * This shim must NOT apply the link's tokens or route to the tabs. Instead it
 * hands the auth fragment to set-password through the module-scoped one-shot
 * in src/auth/pendingAuthLink.ts — deliberately NOT a route param, which
 * would put a live access token in the query string, and so in browser
 * history and Referer, on the Expo web build. Handing the fragment over at
 * all matters: `router.replace` fires no deep-link event, and on a warm
 * start set-password's `useURL()` can return the stale launch URL — relying
 * on it re-reading the link would strand the user on the waiting state after
 * the one-shot token was already consumed here.
 *
 * Deliberately a TOP-LEVEL route (see set-password.tsx for why). Requires a
 * dev/production build (custom scheme links don't reach Expo Go).
 */
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useURL } from 'expo-linking';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { planConfirmLanding, stashAuthFragment } from '../src/auth';
import { BrandMark } from '../src/components/BrandMark';
import { useTheme } from '../src/theme';

type Phase = { readonly kind: 'waiting' } | { readonly kind: 'invalid'; readonly message: string };

export default function ConfirmScreen() {
  const router = useRouter();
  const url = useURL();
  const { colors, fonts, radii } = useTheme();

  const [phase, setPhase] = useState<Phase>({ kind: 'waiting' });
  // Forward the link once — useURL can re-emit the same URL.
  const forwardedRef = useRef(false);

  useEffect(() => {
    // The decision lives in src/auth/confirmLanding so it can be tested —
    // tests may not live under app/. Its return type has no variant that
    // applies tokens or enters the app, which is the takeover fix.
    const action = planConfirmLanding(url);
    if (action.kind === 'invalid') {
      setPhase({ kind: 'invalid', message: action.message });
      return;
    }
    if (action.kind !== 'forward' || forwardedRef.current) return;
    forwardedRef.current = true;
    // Hand the raw fragment over in module scope, NOT as a route param: a
    // param would put a live access token in the query string (browser
    // history + Referer on the Expo web build). Tokens stay untouched —
    // set-password applies them and forces the password choice first.
    stashAuthFragment(action.fragment);
    router.replace('/set-password');
  }, [url, router]);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
      <StatusBar style={colors.scheme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.body}>
        <View style={styles.lockup}>
          <BrandMark size={64} />
        </View>
        <Text style={[styles.title, { color: colors.text, fontFamily: fonts.ui.extrabold }]}>
          {phase.kind === 'invalid' ? 'Link problem' : 'Welcome to WorkLog'}
        </Text>

        {/* Needs its own escape for the same reason set-password's 'waiting'
            does — and more urgently, since this generic landing is the screen
            a hash-less or already-consumed link is most likely to reach. */}
        {phase.kind === 'waiting' ? (
          <>
            <Text
              testID="confirm-message"
              style={[styles.copy, { color: colors.muted, fontFamily: fonts.ui.regular }]}
            >
              Open the confirmation link from your email on this phone to finish setting up your
              account.
            </Text>
            <Pressable
              testID="confirm-back"
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
              testID="confirm-message"
              style={[styles.copy, { color: colors.muted, fontFamily: fonts.ui.regular }]}
            >
              {phase.message} Register again from the sign-in screen to get a fresh link.
            </Text>
            <Pressable
              testID="confirm-back"
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
  button: { height: 50, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  buttonText: { fontSize: 16 },
  pressed: { opacity: 0.85 },
});
