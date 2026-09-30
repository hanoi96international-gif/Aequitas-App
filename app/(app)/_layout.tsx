import { Stack } from 'expo-router';
import React from 'react';

import { useI18n } from '@/src/i18n';
import { useTheme } from '@/src/ui';

// Entsperrter Bereich: Tabs plus Stapel-Bildschirme darueber.
export default function AppLayout() {
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.accent,
        headerTitleStyle: { color: colors.text },
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="security" options={{ title: t('security.title') }} />
      <Stack.Screen name="backup" options={{ title: t('backup.title') }} />
      <Stack.Screen name="remove" options={{ title: t('remove.title') }} />
      <Stack.Screen name="settings/language" options={{ title: t('more.language') }} />
    </Stack>
  );
}
