// Registrierung als eineiiger Zwilling -- Seite von B (noch nicht
// registriert; sein Gesicht traf bei der Registrierung den schon
// registrierten Zwilling). Ablauf und Pruefungen: lib/zwilling.ts.
//
// 1. Anfrage beim Coordinator anlegen, als QR-Code zeigen.
// 2. Der registrierte Zwilling scannt ihn und stimmt mit seiner Wallet zu.
// 3. Hier wird begrenzt nachgefragt (alle 3 s, hoechstens so lange, wie die
//    Anfrage gilt -- nach Versuchen UND nach der Uhr --, und nur solange
//    dieser Bildschirm offen ist). Sobald zugestimmt ist, geht es zur
//    Aufnahme; die Richtung der gemeinsamen Aufnahme kommt erst dort.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import { useLanguage } from '@/contexts/LanguageContext';
import { useWallet } from '@/contexts/WalletContext';
import { zwillingAnfrageAnlegen, zwillingStart, type ZwillingAnfrage } from '@/lib/biometricIdentity';
import { walletGruppiert, wartenAufStart, ZWILLING_GRUPPE_MAX } from '@/lib/zwilling';
import { theme } from '@/constants/aequitas-theme';

const NACHFRAGE_MS = 3000;

type Lage = 'start' | 'legt_an' | 'wartet' | 'abgelaufen' | 'ungueltig' | 'fehler';

export default function Zwilling() {
  const { t } = useLanguage();
  const { address } = useWallet();
  const [lage, setLage] = useState<Lage>('start');
  const [anfrage, setAnfrage] = useState<ZwillingAnfrage | null>(null);
  const [fehler, setFehler] = useState('');
  // Abbruch der Nachfrage: beim Schliessen und bei jedem neuen Code.
  const lauf = useRef(0);

  useEffect(() => () => { lauf.current += 1; }, []);

  const anlegen = useCallback(async () => {
    if (!address) return;
    const meinLauf = ++lauf.current;
    setLage('legt_an');
    setFehler('');
    try {
      const a = await zwillingAnfrageAnlegen(address);
      if (meinLauf !== lauf.current) return;
      setAnfrage(a);
      setLage('wartet');
      const r = await wartenAufStart(() => zwillingStart(a.anfrage), {
        intervallMs: NACHFRAGE_MS,
        bisMs: a.gueltigSekunden * 1000,
        abgebrochen: () => meinLauf !== lauf.current,
      });
      if (meinLauf !== lauf.current || r.ergebnis === 'abgebrochen') return;
      if (r.ergebnis === 'bereit') {
        router.replace(`/biometric-capture?zweck=zwilling&anfrage=${a.anfrage}`);
        return;
      }
      setAnfrage(null);
      setLage(r.ergebnis === 'abgelaufen' ? 'abgelaufen' : 'ungueltig');
    } catch (e: any) {
      if (meinLauf !== lauf.current) return;
      setAnfrage(null);
      setFehler(String(e?.message ?? '').includes('zu_viele_anfragen') ? t('identity.zwZuVieleAnfragen') : t('identity.zwAnfrageFehler'));
      setLage('fehler');
    }
  }, [address, t]);

  function schliessen() {
    lauf.current += 1;
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/identity');
  }

  return (
    <SafeAreaView style={S.safe}>
      <ScrollView contentContainerStyle={S.content}>
        <View style={S.card}>
          <Text style={S.title}>{t('identity.zwTitel')}</Text>
          <Text style={S.body}>{t('identity.zwErklaerung', { n: String(ZWILLING_GRUPPE_MAX) })}</Text>

          {lage === 'wartet' && anfrage ? (
            <>
              <View style={S.qrBox}>
                <QRCode value={anfrage.qr} size={220} backgroundColor="#ffffff" color="#000000" />
              </View>
              <Text style={S.body}>{t('identity.zwQrHinweis')}</Text>
              {/* Volle Adresse, in Gruppen: dieselbe Darstellung wie auf dem
                  Bestaetigungsbildschirm des Zwillings -- zum Vergleichen. */}
              <Text style={S.schluessel}>{t('identity.zwDeineWallet')}</Text>
              <Text style={S.wallet} selectable>{walletGruppiert(address ?? '')}</Text>
              <View style={S.warteZeile}>
                <ActivityIndicator color={theme.purple} />
                <Text style={S.warteText}>{t('identity.zwWartet')}</Text>
              </View>
            </>
          ) : null}

          {lage === 'legt_an' ? <ActivityIndicator style={S.abstand} color={theme.purple} /> : null}
          {lage === 'abgelaufen' ? <Text style={S.fehler}>{t('identity.zwAbgelaufen')}</Text> : null}
          {lage === 'ungueltig' ? <Text style={S.fehler}>{t('identity.zwErgebnisNeuAnfangen')}</Text> : null}
          {lage === 'fehler' ? <Text style={S.fehler}>{fehler}</Text> : null}

          {lage === 'start' || lage === 'abgelaufen' || lage === 'ungueltig' || lage === 'fehler' ? (
            <TouchableOpacity style={S.btn} onPress={anlegen} activeOpacity={0.85} disabled={!address}>
              <Text style={S.btnText}>{lage === 'start' ? t('identity.zwCodeErstellen') : t('identity.zwNeuerCode')}</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity style={S.btnGhost} onPress={schliessen} activeOpacity={0.8}>
            <Text style={S.btnGhostText}>{t('common.cancel')}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const S = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 20 },
  card: { backgroundColor: theme.card, borderRadius: theme.radius, padding: 20, borderWidth: 1, borderColor: theme.border },
  title: { color: theme.text, fontSize: 18, fontWeight: '800', marginBottom: 12 },
  body: { color: theme.muted, fontSize: 13, lineHeight: 19, marginBottom: 14 },
  qrBox: { alignSelf: 'center', padding: 14, backgroundColor: '#ffffff', borderRadius: theme.radiusSm, marginBottom: 14 },
  warteZeile: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  warteText: { color: theme.text, fontSize: 13, flex: 1, lineHeight: 19 },
  abstand: { marginVertical: 16 },
  schluessel: { color: theme.muted, fontSize: 12, marginBottom: 4 },
  wallet: { color: theme.text, fontSize: 15, fontWeight: '600', fontFamily: theme.fontMono, lineHeight: 22, marginBottom: 14 },
  fehler: { color: '#ff6b6b', fontSize: 13, lineHeight: 19, marginBottom: 8 },
  btn: { marginTop: 14, backgroundColor: theme.accent, borderRadius: theme.radiusPill, padding: 15, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  btnGhost: { marginTop: 12, borderWidth: 1, borderColor: theme.border, borderRadius: theme.radiusPill, padding: 13, alignItems: 'center' },
  btnGhostText: { color: theme.text, fontSize: 14, fontWeight: '600' },
});
