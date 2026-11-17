import React from 'react';
import { Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';

import { theme } from '@/constants/aequitas-theme';
import { useLanguage } from '@/contexts/LanguageContext';

// Markenzeichen auf der Startseite: Aequitas ist faelschungssicher -- ein
// Mensch nur einmal, Quantenschutz der Wallet, Quantengeld. Fuehrt zur Seite
// Quantengeld in der App und zur ausfuehrlichen Seite /quanten der Website.
// Feste Adresse (kein Knoten aus der Konfiguration): reiner Lesestoff.
export const QUANTEN_SEITE = 'https://aequitas.digital/quanten';

export default function FaelschungssicherKarte() {
  const { t } = useLanguage();
  return (
    <View style={S.box} testID="faelschungssicher">
      <Text style={S.titel}>{t('marke.titel')}</Text>
      <Text style={S.leitsatz}>{t('marke.leitsatz')}</Text>
      {(['marke.p1', 'marke.p2', 'marke.p3'] as const).map(k => (
        <Text key={k} style={S.punkt}>{'•  ' + t(k)}</Text>
      ))}
      <View style={S.reihe}>
        <TouchableOpacity testID="marke-quantengeld" style={S.knopf} onPress={() => router.push('/quantengeld')} activeOpacity={0.85}>
          <Text style={S.knopfText}>{t('marke.quantengeld')}</Text>
        </TouchableOpacity>
        <TouchableOpacity testID="marke-mehr" style={[S.knopf, S.knopfZweit]} onPress={() => Linking.openURL(QUANTEN_SEITE)} activeOpacity={0.85}>
          <Text style={S.knopfText}>{t('marke.mehr')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const S = StyleSheet.create({
  box: { marginHorizontal: 16, marginVertical: 10, padding: 16, borderRadius: 16, borderWidth: 1, borderColor: theme.accent, backgroundColor: 'rgba(108,140,255,0.08)' },
  titel: { color: theme.text, fontSize: 18, fontWeight: '800', marginBottom: 4 },
  leitsatz: { color: theme.text, fontSize: 14, fontStyle: 'italic', marginBottom: 10 },
  punkt: { color: theme.text, fontSize: 14, lineHeight: 20, marginBottom: 6 },
  reihe: { flexDirection: 'row', gap: 10, marginTop: 8, flexWrap: 'wrap' },
  knopf: { backgroundColor: '#4f6bed', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14 },
  knopfZweit: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#4f6bed' },
  knopfText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
