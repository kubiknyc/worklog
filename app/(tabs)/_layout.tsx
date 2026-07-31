/**
 * Five-slot tab shell (M0): Today · History · [camera] · Photos · Settings.
 *
 * Follows PunchLog's `(tabs)/_layout.tsx` styling idiom — tab bar colors and
 * fonts from `useTheme()` — with WorkLog's slot order and a raised center
 * camera action. The camera slot is a placeholder tab until the capture flow
 * lands in M5. `app/index.tsx` only gates the `/` route, so a signed-out user
 * deep-linking or web-refreshing directly on a `/(tabs)/*` route would render
 * straight into the tab shell without this guard — mirrors PunchLog's
 * `(tabs)/_layout.tsx` session check.
 */
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Redirect, Tabs } from 'expo-router';
import { Pressable, StyleSheet, View, type GestureResponderEvent } from 'react-native';

import { useAuth } from '../../src/auth';
import { useActiveProjectSync } from '../../src/hooks/useActiveProjectSync';
import { FIXED_COLORS, useTheme } from '../../src/theme';

type RaisedCameraButtonProps = {
  readonly onPress?: (event: GestureResponderEvent) => void;
};

function RaisedCameraButton({ onPress }: RaisedCameraButtonProps) {
  return (
    <Pressable
      testID="tab-camera"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Capture photo"
      style={styles.cameraWrap}
    >
      <View style={styles.cameraCircle}>
        <MaterialCommunityIcons name="camera" size={28} color="#FFFFFF" />
      </View>
    </Pressable>
  );
}

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
      <Tabs.Screen
        name="camera"
        options={{
          title: '',
          tabBarButton: (props) => <RaisedCameraButton onPress={props.onPress} />,
        }}
      />
      <Tabs.Screen
        name="photos"
        options={{
          title: 'Photos',
          tabBarButtonTestID: 'tab-photos',
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="image-multiple" color={color} size={size} />
          ),
        }}
      />
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

const styles = StyleSheet.create({
  cameraWrap: { top: -18, justifyContent: 'center', alignItems: 'center' },
  cameraCircle: {
    width: 56,
    height: 56,
    borderRadius: 28, // >=48px touch target (PRD §9 AC)
    backgroundColor: FIXED_COLORS.camera,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
});
