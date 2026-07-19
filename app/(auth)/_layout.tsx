import { Redirect, Stack } from 'expo-router';

import { useAuth } from '../../src/auth';

/**
 * Auth stack — bounce already-signed-in users straight into the app.
 * `status === 'loading'` renders nothing: the root layout already holds the
 * native splash screen open until fonts + theme hydrate, so this screen
 * would otherwise flash under it while the session restore is in flight.
 */
export default function AuthLayout() {
  const { status } = useAuth();

  if (status === 'loading') return null;
  if (status === 'authed') return <Redirect href="/(tabs)" />;

  return <Stack screenOptions={{ headerShown: false }} />;
}
