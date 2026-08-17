/**
 * Tab shell (M0): Today · History · Settings.
 *
 * Follows PunchLog's `(tabs)/_layout.tsx` styling idiom — tab bar colors and
 * fonts from `useTheme()`. `app/index.tsx` only gates the `/` route, so a
 * signed-out user deep-linking or web-refreshing directly on a `/(tabs)/*`
 * route would render straight into the tab shell without this guard — mirrors
 * PunchLog's `(tabs)/_layout.tsx` session check.
 *
 * The camera and photos slots are hidden (`href: null`) until the capture flow
 * lands in M5. Both screens are placeholders reading "Photo capture isn't
 * ready yet" / "No photos yet", and App Store Review 2.1 rejects apps that
 * ship visibly unfinished features. The routes still exist and still render,
 * so M5 does not have to rebuild them — the slots, and the raised centre
 * camera button (recoverable from this commit's parent), come back with it.
 */
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Redirect, Tabs } from 'expo-router';

import { useAuth } from '../../src/auth';
import { useActiveProjectSync } from '../../src/hooks/useActiveProjectSync';
import { useTheme } from '../../src/theme';

export default function TabsLayout() {
  const { status } = useAuth();
  const { colors, fonts } = useTheme();
  // Task 11 bridge: keeps sync_meta.active_project_id in step with whichever
  // project the user is looking at, so the pull orchestrator's per-report
  // pull scopes to it. Mounted once here (Jest ignores `app/`, so this call
  // is untested by design — useActiveProjectSync.ts carries the coverage).
  useActiveProjectSync();

  if (status === 'loading') return null;
  if (status === 'signedOut') return <Redirect href="/(auth)/login" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarLabelStyle: { fontFamily: fonts.ui.semibold, fontSize: 11 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Today',
          tabBarButtonTestID: 'tab-today',
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="calendar-today" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
          tabBarButtonTestID: 'tab-history',
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="history" color={color} size={size} />
          ),
        }}
      />
      {/* Hidden until M5 ships capture — see the file header. */}
      <Tabs.Screen name="camera" options={{ href: null }} />
      <Tabs.Screen name="photos" options={{ href: null }} />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarButtonTestID: 'tab-settings',
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="cog" color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
