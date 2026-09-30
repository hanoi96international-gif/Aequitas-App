import { Tabs } from 'expo-router';
import React from 'react';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useI18n } from '@/src/i18n';
import { useTheme } from '@/src/ui';

// Vier Reiter (docs/NEUBAU_ANALYSE.md 4): Uebersicht, Zahlen, Tausch, Mehr.
export default function TabsLayout() {
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textTertiary,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: t('tabs.overview'), tabBarIcon: ({ color }) => <IconSymbol size={24} name="house.fill" color={color} /> }}
      />
      <Tabs.Screen
        name="pay"
        options={{ title: t('tabs.pay'), tabBarIcon: ({ color }) => <IconSymbol size={24} name="paperplane.fill" color={color} /> }}
      />
      <Tabs.Screen
        name="exchange"
        options={{ title: t('tabs.exchange'), tabBarIcon: ({ color }) => <IconSymbol size={24} name="arrow.left.arrow.right" color={color} /> }}
      />
      <Tabs.Screen
        name="more"
        options={{ title: t('tabs.more'), tabBarIcon: ({ color }) => <IconSymbol size={24} name="ellipsis.circle.fill" color={color} /> }}
      />
    </Tabs>
  );
}
