import { Redirect } from 'expo-router';

import { useAuth } from '../src/auth';
import { AuthSplash } from '../src/components';

/**
 * Entry route — sends users to the right stack based on the restored
 * session. The native splash screen is held by the root layout only until
 * fonts + theme hydrate, not until auth resolves, so by the time this
 * renders the splash is already gone. While the session is still being
 * restored from storage (`status === 'loading'`) this renders the themed
 * AuthSplash (M2) — a branded holding screen rather than a blank window or
 * a flash of the login screen for an already-authenticated user.
 */
export default function Index() {
  const { status } = useAuth();

  if (status === 'loading') return <AuthSplash />;
  return <Redirect href={status === 'authed' ? '/(tabs)' : '/(auth)/login'} />;
}
