// Hinweis im Identitaets-Tab (lib/pq.ts): ein Mensch ohne PQ-Zusage sieht,
// dass er den Quantenschutz einrichten sollte -- erst ab dem Stichtag der
// Kette (pq_zusage_ab). Mit Zusage eine kurze Bestaetigung.
import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useLanguage } from '@/contexts/LanguageContext';
import { useWallet } from '@/contexts/WalletContext';
import { theme } from '@/constants/aequitas-theme';
import { pqStand, type PQStand } from '@/lib/pq';

export function QuantenschutzKarte({ istMensch }: { istMensch: boolean }) {
  const { t } = useLanguage();
  const { signer } = useWallet();
  const [stand, setStand] = useState<PQStand | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (signer) pqStand(signer.address).then(setStand).catch(() => setStand(null));
    }, [signer]),
  );
  const ab = stand?.ab ?? 0;
  if (!istMensch || !ab || ab > Math.floor(Date.now() / 1000)) return null;
  if ((stand?.seit ?? 0) > 0) {
    return (
      <View style={S.karte} testID="pq-aktiv">
        <Text style={S.titel}>{t('pq.titel')}</Text>
        <Text style={S.text}>{t('pq.seit').replace('{datum}', new Date((stand?.seit ?? 0) * 1000).toLocaleDateString())}</Text>
      </View>
    );
  }
  return (
    <View style={S.karte} testID="pq-fehlt">
      <Text style={S.titel}>{t('pq.titel')}</Text>
      <Text style={S.text}>{t('pq.karteText')}</Text>
      <TouchableOpacity style={S.knopf} onPress={() => router.push('/quantenschutz')} accessibilityRole="button">
        <Text style={S.knopfText}>{t('pq.karteLink')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const S = StyleSheet.create({
  karte: { marginHorizontal: 16, marginTop: 12, padding: 14, borderRadius: 14, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border },
  titel: { color: theme.text, fontSize: 15, fontWeight: '700', marginBottom: 4 },
  text: { color: theme.text, fontSize: 14, lineHeight: 20 },
  knopf: { marginTop: 10, backgroundColor: theme.accent, borderRadius: theme.radiusPill, paddingVertical: 11, alignItems: 'center' },
  knopfText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
