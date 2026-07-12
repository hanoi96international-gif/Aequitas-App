import { Tabs } from 'expo-router';
import React from 'react';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { theme } from '@/constants/aequitas-theme';
import { useLanguage } from '@/contexts/LanguageContext';

export default function TabLayout() {
  const { t } = useLanguage();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: theme.purple,
        tabBarInactiveTintColor: theme.muted,
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarStyle: { backgroundColor: theme.card2, borderTopColor: theme.border },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.home'),
          tabBarIcon: ({ color }) => <IconSymbol size={26} name="house.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="wallet"
        options={{
          title: t('tabs.wallet'),
          tabBarIcon: ({ color }) => <IconSymbol size={26} name="wallet.pass.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="run-node"
        options={{
          title: t('tabs.node'),
          tabBarIcon: ({ color }) => <IconSymbol size={26} name="server.rack" color={color} />,
        }}
      />
      <Tabs.Screen
        name="trade"
        options={{
          title: t('tabs.trade'),
          tabBarIcon: ({ color }) => <IconSymbol size={26} name="arrow.left.arrow.right" color={color} />,
        }}
      />
      <Tabs.Screen
        name="identity"
        options={{
          title: t('tabs.identity'),
          tabBarIcon: ({ color }) => <IconSymbol size={26} name="checkmark.seal.fill" color={color} />,
        }}
      />
    </Tabs>
  );
}
