// Hinweis oben auf der Startseite, solange einer meiner Server auf die
// Bestaetigung wartet (contexts/BindungsanfragenContext.tsx). Fuehrt in den
// Node-Tab -- dort stehen Kontrollzahl, Bestaetigen und Ablehnen. Hier wird
// nichts bestaetigt.
import React from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';

import { goldTint, goldTintBorder, theme } from '@/constants/aequitas-theme';
import { useBindungsanfragen } from '@/contexts/BindungsanfragenContext';
import { useLanguage } from '@/contexts/LanguageContext';

export default function BindungsHinweis() {
  const { t } = useLanguage();
  const { anfragen } = useBindungsanfragen();
  if (anfragen.length === 0) return null;
  const text = anfragen.length === 1
    ? t('home.bindHinweisText').replace('{ip}', anfragen[0].ip)
    : t('home.bindHinweisMehrere').replace('{n}', String(anfragen.length));
  return (
    <TouchableOpacity style={S.karte} onPress={() => router.push('/(tabs)/run-node')} activeOpacity={0.85}
      accessibilityRole="button">
      <Text style={S.titel}>{t('home.bindHinweisTitel')}</Text>
      <Text style={S.text}>{text}</Text>
      <Text style={S.link}>{t('home.bindHinweisLink')}</Text>
    </TouchableOpacity>
  );
}

const S = StyleSheet.create({
  karte: {
    marginHorizontal: 16, marginTop: 12, padding: 14, borderRadius: 14,
    backgroundColor: goldTint, borderWidth: 1, borderColor: goldTintBorder,
  },
  titel: { color: theme.gold, fontSize: 15, fontWeight: '700', marginBottom: 4 },
  text: { color: theme.text, fontSize: 14, lineHeight: 20 },
  link: { color: theme.gold, fontSize: 14, fontWeight: '700', marginTop: 8 },
});
