/**
 * Root layout: loads fonts and holds the native splash screen until the
 * persisted theme/density selection has hydrated (M8 item 4b — a returning
 * user must never see a Blueprint flash before their saved theme lands),
 * then wraps the navigation Stack in ThemeProvider + AuthProvider.
 */
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, type ReactNode } from 'react';

import { AuthProvider } from '../src/auth';
import { ToastProvider } from '../src/components';
import { RepositoryProvider } from '../src/data';
import { initObservability } from '../src/lib/observability';
import { ActiveProjectProvider } from '../src/project';
import { FONT_MAP, ThemeProvider, useThemeContext } from '../src/theme';

// Before render, so a crash during provider setup is still reported. No-op
// when EXPO_PUBLIC_SENTRY_DSN is unset (local dev, web export, jest).
initObservability();

SplashScreen.preventAutoHideAsync();

/** Holds the splash until the persisted theme/density selection has landed. */
function ThemeHydrationGate({ children }: { readonly children: ReactNode }) {
  const { isHydrated } = useThemeContext();

  useEffect(() => {
    if (isHydrated) {
      void SplashScreen.hideAsync();
    }
  }, [isHydrated]);

  if (!isHydrated) {
    return null;
  }
  return <>{children}</>;
}

export default function RootLayout() {
  const [loaded, error] = useFonts(FONT_MAP);

  if (!loaded && !error) {
    return null;
  }

  return (
    <ThemeProvider>
      <ThemeHydrationGate>
        <AuthProvider>
          {/* ActiveProjectProvider needs the session (userId scopes its
              persisted key, memberships validate the choice) so it sits INSIDE
              AuthProvider — but it holds ids only, never data, so it stays
              OUTSIDE RepositoryProvider and its native hydration gate.
              ToastProvider is innermost of the providers so its pill can
              overlay every screen the Stack renders. */}
          <ActiveProjectProvider>
            <RepositoryProvider>
              <ToastProvider>
                <Stack screenOptions={{ headerShown: false }} />
              </ToastProvider>
            </RepositoryProvider>
          </ActiveProjectProvider>
        </AuthProvider>
      </ThemeHydrationGate>
    </ThemeProvider>
  );
}
