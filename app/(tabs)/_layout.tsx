/**
 * Five-slot tab shell (M0): Today · History · [camera] · Photos · Settings.
 *
 * Follows PunchLog's `(tabs)/_layout.tsx` styling idiom — tab bar colors and
 * fonts from `useTheme()` — with WorkLog's slot order and a raised center
 * camera action. The camera slot is a placeholder tab until the capture flow
 * lands in M5; `app/index.tsx` already gates auth before this group renders,
 * so no session guard is duplicated here.
 */
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { Pressable, StyleSheet, View, type GestureResponderEvent } from 'react-native';

import { FIXED_COLORS, useTheme } from '../../src/theme';

type RaisedCameraButtonProps = {
  readonly onPress?: (event: GestureResponderEvent) => void;
};

function RaisedCameraButton({ onPress }: RaisedCameraButtonProps) {
  return (
    <Pressable
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
  const { colors, fonts } = useTheme();

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
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="calendar-today" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
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
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="image-multiple" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
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
