import { Redirect } from 'expo-router';

import { useAuth } from '../src/auth';

/**
 * Entry route — sends users to the right stack based on the restored
 * session. While the session is being restored from storage (`status ===
 * 'loading'`) this renders nothing, so the native splash screen — held open
 * by the root layout until fonts + theme hydrate — stays visible instead of
 * flashing the login screen for an already-authenticated user.
 */
export default function Index() {
  const { status } = useAuth();

  if (status === 'loading') return null;
  return <Redirect href={status === 'authed' ? '/(tabs)' : '/(auth)/login'} />;
}
