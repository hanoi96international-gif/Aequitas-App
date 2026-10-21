// Zwilling bestaetigen -- Seite von A (schon als Mensch registriert).
//
// Der QR-Code kommt von B's Telefon und ist damit Eingabe von aussen: gelesen
// wird er nur mit zwillingQrLesen (lib/zwilling.ts), das alles ausser genau
// dem erwarteten Format ablehnt und nur einen Coordinator aus den EIGENEN
// Kandidaten zulaesst. Unterschrieben wird erst nach ausdruecklicher
// Bestaetigung, mit einer Warnung davor. Kein Deep Link fuehrt hierher mit
// fertigen Daten -- gescannt wird auf diesem Bildschirm.
import React, { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useLanguage } from '@/contexts/LanguageContext';
import { useWallet } from '@/contexts/WalletContext';
import { QrScanner } from '@/components/QrScanner';
import { coordinatorCandidates, zwillingZustimmen } from '@/lib/biometricIdentity';
import { zustimmungMeldungKey, zwillingQrLesen, ZWILLING_GRUPPE_MAX, type ZwillingQr } from '@/lib/zwilling';
import { shortWallet } from '@/lib/format';
import { withTimeout } from '@/lib/signer';
import { theme } from '@/constants/aequitas-theme';

const SIGN_TIMEOUT_MS = 90_000;
const ZWEITER_VERSUCH = new Set(['fehler', 'unbekannt', 'kette_nicht_erreichbar', 'signatur_ungueltig']);

export default function ZwillingBestaetigen() {
  const { t } = useLanguage();
  const { address, signer } = useWallet();
  const [scanOffen, setScanOffen] = useState(false);
  const [qr, setQr] = useState<ZwillingQr | null>(null);
  const [ungueltig, setUngueltig] = useState(false);
  const [laeuft, setLaeuft] = useState(false);
  const [ergebnis, setErgebnis] = useState<{ ok: boolean; text: string; status: string } | null>(null);

  function gescannt(data: string) {
    setScanOffen(false);
    setErgebnis(null);
    const gelesen = zwillingQrLesen(data, coordinatorCandidates());
    setQr(gelesen);
    setUngueltig(!gelesen);
  }

  async function bestaetigen() {
    if (!qr || !signer || !address) return;
    setLaeuft(true);
    setErgebnis(null);
    try {
      const r = await withTimeout(zwillingZustimmen(qr, address, signer), SIGN_TIMEOUT_MS, t('trade.signTimeout'));
      setErgebnis({ ok: r.status === 'zugestimmt', text: t(`identity.${zustimmungMeldungKey(r.status)}`), status: r.status });
    } catch (e: any) {
      setErgebnis({ ok: false, text: e?.message ?? t('identity.zwZustimmungFehler'), status: 'fehler' });
    } finally {
      setLaeuft(false);
    }
  }

  function schliessen() {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/identity');
  }

  // Eine Anfrage nimmt genau eine Zustimmung. Erneut versuchen nur, wenn
  // nichts angekommen sein kann (Netz, Kette, Signatur).
  const fertig = ergebnis !== null && !ZWEITER_VERSUCH.has(ergebnis.status);

  return (
    <SafeAreaView style={S.safe}>
      <ScrollView contentContainerStyle={S.content}>
        <View style={S.card}>
          <Text style={S.title}>{t('identity.zwBestaetigenTitel')}</Text>
          {!qr ? (
            <>
              <Text style={S.body}>{t('identity.zwBestaetigenErklaerung')}</Text>
              {ungueltig ? <Text style={S.fehler}>{t('identity.zwQrUngueltig')}</Text> : null}
              <TouchableOpacity style={S.btn} onPress={() => setScanOffen(true)} activeOpacity={0.85}>
                <Text style={S.btnText}>{t('identity.zwScannen')}</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <View style={S.zeile}>
                <Text style={S.schluessel}>{t('identity.zwWalletDesZwillings')}</Text>
                <Text style={S.wert}>{shortWallet(qr.walletB)}</Text>
              </View>
              <Text style={S.warnung}>{t('identity.zwWarnung', { n: String(ZWILLING_GRUPPE_MAX) })}</Text>
              {ergebnis ? <Text style={ergebnis.ok ? S.ok : S.fehler}>{ergebnis.text}</Text> : null}
              {!fertig ? (
                <TouchableOpacity style={[S.btn, laeuft && S.btnAus]} onPress={bestaetigen} disabled={laeuft || !signer} activeOpacity={0.85}>
                  {laeuft ? <ActivityIndicator color="#fff" /> : <Text style={S.btnText}>{t('identity.zwBestaetigenBtn')}</Text>}
                </TouchableOpacity>
              ) : null}
            </>
          )}
          <TouchableOpacity style={S.btnGhost} onPress={schliessen} activeOpacity={0.8}>
            <Text style={S.btnGhostText}>{ergebnis?.ok ? t('node.bindDone') : t('common.cancel')}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
      <QrScanner visible={scanOffen} onScanned={gescannt} onClose={() => setScanOffen(false)} />
    </SafeAreaView>
  );
}

const S = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 20 },
  card: { backgroundColor: theme.card, borderRadius: theme.radius, padding: 20, borderWidth: 1, borderColor: theme.border },
  title: { color: theme.text, fontSize: 18, fontWeight: '800', marginBottom: 12 },
  body: { color: theme.muted, fontSize: 13, lineHeight: 19, marginBottom: 14 },
  zeile: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.border },
  schluessel: { color: theme.muted, fontSize: 12 },
  wert: { color: theme.text, fontSize: 12, fontWeight: '600', fontFamily: theme.fontMono },
  warnung: { color: theme.gold, fontSize: 13, lineHeight: 19, marginTop: 14 },
  ok: { color: theme.neon, fontSize: 13, lineHeight: 19, marginTop: 14 },
  fehler: { color: '#ff6b6b', fontSize: 13, lineHeight: 19, marginTop: 14 },
  btn: { marginTop: 18, backgroundColor: theme.accent, borderRadius: theme.radiusPill, padding: 15, alignItems: 'center' },
  btnAus: { opacity: 0.6 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  btnGhost: { marginTop: 12, borderWidth: 1, borderColor: theme.border, borderRadius: theme.radiusPill, padding: 13, alignItems: 'center' },
  btnGhostText: { color: theme.text, fontSize: 14, fontWeight: '600' },
});
