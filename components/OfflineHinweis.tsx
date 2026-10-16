import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { theme } from '@/constants/aequitas-theme';
import { useLanguage } from '@/contexts/LanguageContext';

/** Zeigt, dass die angezeigten Werte nicht mehr frisch sind, weil der Knoten
 *  nicht antwortet (hooks/use-abfrage.ts). Bleibt sonst unsichtbar. */
export default function OfflineHinweis({ offline }: { offline: boolean }) {
  const { t } = useLanguage();
  if (!offline) return null;
  return (
    <View style={S.box} accessibilityRole="alert">
      <Text style={S.text}>{t('common.offline')}</Text>
    </View>
  );
}

const S = StyleSheet.create({
  box: {
    marginHorizontal: 16,
    marginVertical: 8,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.gold,
    backgroundColor: 'rgba(245,165,36,0.10)',
  },
  text: { color: theme.gold, fontSize: 13, textAlign: 'center' },
});
