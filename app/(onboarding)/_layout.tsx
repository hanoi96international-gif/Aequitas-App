import { Stack } from 'expo-router';
import React from 'react';

import { useTheme } from '@/src/ui';

// Eigener Einstieg 'welcome' statt 'index': '/' gehoert der App ((app)/(tabs)).
export const unstable_settings = { initialRouteName: 'welcome' };

export default function OnboardingLayout() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        title: '',
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.accent,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="welcome" options={{ headerShown: false }} />
      <Stack.Screen name="create" />
      <Stack.Screen name="restore" />
      <Stack.Screen name="legacy" />
      <Stack.Screen name="language" />
    </Stack>
  );
}
