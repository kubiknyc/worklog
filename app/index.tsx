import { Redirect } from 'expo-router';

import { useAuth } from '../src/auth';

/**
 * Entry route — sends users to the right stack based on the restored
 * session. The native splash screen is held by the root layout only until
 * fonts + theme hydrate, not until auth resolves, so by the time this
 * renders the splash is already gone. While the session is still being
 * restored from storage (`status === 'loading'`) this renders nothing —
 * a brief blank window rather than a flash of the login screen for an
 * already-authenticated user (known deferral to M2, which should give this
 * a proper loading state).
 */
export default function Index() {
  const { status } = useAuth();

  if (status === 'loading') return null;
  return <Redirect href={status === 'authed' ? '/(tabs)' : '/(auth)/login'} />;
}
