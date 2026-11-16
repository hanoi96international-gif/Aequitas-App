// Hinweis im Identitaets-Tab (lib/pq.ts): Quantenschutz ab Werk. Ist die
// Wallet ein Mensch und kennt die App den Hash aus der Seed-Phrase, richtet
// die Karte die Zusage selbst ein (quantenschutzAutomatisch) -- der Mensch
// muss nichts tun. Nur ohne gemerkten Hash (Wallet ohne Phrase in der App)
// bleibt der Weg ueber die Phrase. Steht auf der Kette ein fremder Hash,
// warnt sie. Erst ab dem Stichtag der Kette (pq_zusage_ab).
import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useLanguage } from '@/contexts/LanguageContext';
import { useWallet } from '@/contexts/WalletContext';
import { theme } from '@/constants/aequitas-theme';
import { pqStand, quantenschutzAutomatisch, type PQStand, type QuantenschutzAuto } from '@/lib/pq';

export function QuantenschutzKarte({ istMensch }: { istMensch: boolean }) {
  const { t } = useLanguage();
  const { signer } = useWallet();
  const [stand, setStand] = useState<PQStand | null>(null);
  const [auto, setAuto] = useState<QuantenschutzAuto | 'laeuft' | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (!signer) return;
      let aus = false;
      (async () => {
        const s = await pqStand(signer.address).catch(() => null);
        if (aus) return;
        setStand(s);
        if (!istMensch || !s || !s.ab || s.ab > Math.floor(Date.now() / 1000) || s.seit > 0) return;
        setAuto('laeuft');
        const r = await quantenschutzAutomatisch(signer, istMensch);
        if (aus) return;
        setAuto(r);
        if (r === 'eingerichtet') setStand(await pqStand(signer.address).catch(() => s));
      })();
      return () => {
        aus = true;
      };
    }, [signer, istMensch]),
  );
  const ab = stand?.ab ?? 0;
  if (!istMensch || !ab || ab > Math.floor(Date.now() / 1000)) return null;
  if (auto === 'fremd') {
    return (
      <View style={[S.karte, S.warnung]} testID="pq-fremd">
        <Text style={S.titel}>{t('pq.titel')}</Text>
        <Text style={S.text}>{t('pq.fremd')}</Text>
      </View>
    );
  }
  if ((stand?.seit ?? 0) > 0) {
    return (
      <View style={S.karte} testID="pq-aktiv">
        <Text style={S.titel}>{t('pq.titel')}</Text>
        <Text style={S.text}>{t('pq.seit').replace('{datum}', new Date((stand?.seit ?? 0) * 1000).toLocaleDateString())}</Text>
      </View>
    );
  }
  if (auto === 'laeuft') {
    return (
      <View style={S.karte} testID="pq-laeuft">
        <Text style={S.titel}>{t('pq.titel')}</Text>
        <Text style={S.text}>{t('pq.autoLaeuft')}</Text>
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
  warnung: { borderColor: '#c0392b' },
  titel: { color: theme.text, fontSize: 15, fontWeight: '700', marginBottom: 4 },
  text: { color: theme.text, fontSize: 14, lineHeight: 20 },
  knopf: { marginTop: 10, backgroundColor: theme.accent, borderRadius: theme.radiusPill, paddingVertical: 11, alignItems: 'center' },
  knopfText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
