import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useLanguage } from '@/contexts/LanguageContext';
import { useWallet } from '@/contexts/WalletContext';
import { theme } from '@/constants/aequitas-theme';
import { getUnternehmen, postUnternehmen } from '@/lib/api';
import { withTimeout } from '@/lib/signer';
import { buergschaftNachricht, suchen, verzeichnisLesen, webseiteBestaetigt, type VerzeichnisEintrag } from '@/lib/unternehmen';

// "Wo kann ich AEQ ausgeben?" -- das Register der Unternehmen mit dem, was
// es zeigt statt verspricht: echte Kundschaft (verschiedene verifizierte
// Menschen in 90 Tagen), Buergen, Weitergabe im Netz. Ort, Annahme-Regel und
// Webseite sind selbst angegeben; die Webseite prueft die App selbst ueber
// /.well-known/aequitas.txt.

export default function VerzeichnisSeite() {
  const { t } = useLanguage();
  const { address, signer } = useWallet();
  const [alle, setAlle] = useState<VerzeichnisEintrag[] | null>(null);
  const [q, setQ] = useState('');
  const [bestaetigt, setBestaetigt] = useState<Record<string, boolean>>({});
  const [meldung, setMeldung] = useState<Record<string, string>>({});

  useEffect(() => {
    getUnternehmen()
      .then((d) => setAlle(verzeichnisLesen(d)))
      .catch(() => setAlle([]));
  }, []);

  async function pruefeWebseite(e: VerzeichnisEintrag) {
    const ok = await webseiteBestaetigt(e.webseite, e.adresse);
    setBestaetigt((b) => ({ ...b, [e.adresse]: ok }));
  }

  async function buergen(e: VerzeichnisEintrag) {
    if (!address || !signer) return;
    try {
      const zeit = Math.floor(Date.now() / 1000);
      const m = address.toLowerCase();
      const sig = await withTimeout(signer.signMessage(buergschaftNachricht(e.adresse, m, zeit)), 60_000, t('trade.signTimeout'));
      const r = await postUnternehmen('buergschaft', { unternehmen: e.adresse, mensch: m, zeit, sig });
      setMeldung((x) => ({ ...x, [e.adresse]: r.ok ? t('verzeichnis.buergenOk') : t('firma.fehler').replace('{meldung}', r.fehler ?? '') }));
    } catch (err: any) {
      setMeldung((x) => ({ ...x, [e.adresse]: t('firma.fehler').replace('{meldung}', String(err?.message ?? err).slice(0, 200)) }));
    }
  }

  const prozent = (x: number | null) => (x === null ? '–' : Math.round(x * 100) + ' %');
  const liste = alle ? suchen(alle, q) : [];

  return (
    <SafeAreaView style={S.safe}>
      <ScrollView contentContainerStyle={S.content} keyboardShouldPersistTaps="handled">
        <Text style={S.h1}>{t('verzeichnis.titel')}</Text>
        <Text style={S.body}>{t('verzeichnis.intro')}</Text>
        <TextInput style={S.input} value={q} onChangeText={setQ} placeholder={t('verzeichnis.suchen')} placeholderTextColor={theme.muted} />
        {alle === null ? <ActivityIndicator color={theme.accent} /> : null}
        {alle !== null && liste.length === 0 ? <Text style={S.body}>{t('verzeichnis.leer')}</Text> : null}
        {liste.slice(0, 200).map((e) => (
          <View key={e.adresse} style={S.card}>
            <Text style={S.title}>{e.name || e.adresse.slice(0, 10) + '…'}</Text>
            <Text style={S.klein}>
              {e.kategorie}
              {e.ort ? ' · ' + e.ort : ''} · {t('verzeichnis.selbstAngegeben')}
            </Text>
            {e.annahme ? <Text style={S.body}>{t('verzeichnis.annahme')}: {e.annahme}</Text> : null}
            <View style={S.zahlen}>
              <Text style={S.zahl}>{t('verzeichnis.kundschaft').replace('{n}', e.kundschaft === null ? '–' : String(e.kundschaft))}</Text>
              <Text style={S.zahl}>{t('verzeichnis.buergen').replace('{n}', String(e.buergen))}</Text>
              <Text style={S.zahl}>{t('verzeichnis.weitergabe').replace('{p}', prozent(e.weitergabe))}</Text>
            </View>
            {e.webseite ? (
              <View style={S.reihe}>
                <TouchableOpacity onPress={() => Linking.openURL(e.webseite)}>
                  <Text style={S.link}>{e.webseite.replace('https://', '')}</Text>
                </TouchableOpacity>
                {bestaetigt[e.adresse] === undefined ? (
                  <TouchableOpacity onPress={() => pruefeWebseite(e)}>
                    <Text style={S.klein}>{t('verzeichnis.webseitePruefen')}</Text>
                  </TouchableOpacity>
                ) : (
                  <Text style={bestaetigt[e.adresse] ? S.ok : S.warnung}>
                    {bestaetigt[e.adresse] ? t('verzeichnis.webseiteBestaetigt') : t('verzeichnis.webseiteNichtBestaetigt')}
                  </Text>
                )}
              </View>
            ) : null}
            {signer ? (
              <TouchableOpacity style={S.btnGhost} onPress={() => buergen(e)}>
                <Text style={S.btnGhostText}>{t('verzeichnis.buergenBtn')}</Text>
              </TouchableOpacity>
            ) : null}
            {meldung[e.adresse] ? <Text style={S.klein}>{meldung[e.adresse]}</Text> : null}
          </View>
        ))}
        <Text style={S.klein}>{t('verzeichnis.buergenHinweis')}</Text>
        <TouchableOpacity style={S.btnGhost} onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/wallet'))}>
          <Text style={S.btnGhostText}>{t('common.cancel')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const S = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 20, gap: 12 },
  h1: { color: theme.text, fontSize: 22, fontWeight: '800' },
  card: { backgroundColor: theme.card, borderRadius: theme.radius, padding: 16, borderWidth: 1, borderColor: theme.border },
  title: { color: theme.text, fontSize: 16, fontWeight: '800' },
  body: { color: theme.muted, fontSize: 13, lineHeight: 19, marginTop: 6 },
  klein: { color: theme.muted, fontSize: 11.5, lineHeight: 16, marginTop: 4 },
  zahlen: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 },
  zahl: { color: theme.text, fontSize: 12, fontWeight: '600' },
  reihe: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  link: { color: theme.accent, fontSize: 13 },
  ok: { color: theme.neon, fontSize: 12 },
  warnung: { color: theme.gold, fontSize: 12 },
  input: {
    color: theme.text, backgroundColor: theme.card, borderRadius: 8, borderWidth: 1, borderColor: theme.border,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 14,
  },
  btnGhost: { marginTop: 10, borderWidth: 1, borderColor: theme.border, borderRadius: theme.radiusPill, padding: 10, alignItems: 'center' },
  btnGhostText: { color: theme.text, fontSize: 13, fontWeight: '600' },
});
