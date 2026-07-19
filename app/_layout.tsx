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
import { FONT_MAP, ThemeProvider, useThemeContext } from '../src/theme';

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
          <Stack screenOptions={{ headerShown: false }} />
        </AuthProvider>
      </ThemeHydrationGate>
    </ThemeProvider>
  );
}
