import React, { useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useLanguage } from '@/contexts/LanguageContext';
import { useWallet } from '@/contexts/WalletContext';
import { ausParametern, knotenBinden, kontrollzahl } from '@/lib/knotenBindung';
import { withTimeout } from '@/lib/signer';
import { theme } from '@/constants/aequitas-theme';

// Bestaetigung "diesen Knoten mit meiner Wallet verbinden".
//
// Erreicht ueber den QR-Scanner im Knoten-Tab oder direkt ueber den Deep Link
// aequitasapp://knoten-binden?... (Kamera-App des Telefons). Die Parameter
// kommen damit von aussen und werden erst in lib/knotenBindung.ts geprueft;
// unterschrieben wird nur nach ausdruecklicher Bestaetigung.
const SIGN_TIMEOUT_MS = 60_000;

function kurz(a: string): string {
  return a.slice(0, 8) + '…' + a.slice(-6);
}

export default function KnotenBinden() {
  const { t } = useLanguage();
  const { signer } = useWallet();
  const params = useLocalSearchParams<{ adresse?: string; wallet?: string; beweis?: string }>();
  const b = useMemo(() => ausParametern(params.adresse, params.wallet, params.beweis), [params.adresse, params.wallet, params.beweis]);
  const [laeuft, setLaeuft] = useState(false);
  const [ergebnis, setErgebnis] = useState<{ ok: boolean; text: string } | null>(null);

  async function bestaetigen() {
    if (!b || !signer) return;
    setLaeuft(true);
    setErgebnis(null);
    try {
      const r = await withTimeout(knotenBinden(signer, b), SIGN_TIMEOUT_MS, t('trade.signTimeout'));
      if (r.ok) {
        setErgebnis({ ok: true, text: t('node.bindOk') });
      } else if (r.fehler === 'andere_wallet') {
        setErgebnis({ ok: false, text: t('node.bindOtherWallet') });
      } else if (r.fehler === 'nachweis_ungueltig' || r.fehler === 'unterschrift_ungueltig') {
        setErgebnis({ ok: false, text: t('node.bindProofInvalid') });
      } else {
        setErgebnis({ ok: false, text: t('node.bindRefused').replace('{meldung}', r.meldung ?? '') });
      }
    } catch (e: any) {
      setErgebnis({ ok: false, text: e?.message ?? t('node.bindRefused').replace('{meldung}', '') });
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <SafeAreaView style={S.safe}>
      <ScrollView contentContainerStyle={S.content}>
        <View style={S.card}>
          <Text style={S.title}>{t('node.bindConfirmTitle')}</Text>
          {!b ? (
            <Text style={S.fehler}>{t('node.bindInvalid')}</Text>
          ) : !signer ? (
            <Text style={S.fehler}>{t('node.bindNoWallet')}</Text>
          ) : (
            <>
              <Text style={S.body}>{t('node.bindConfirmBody')}</Text>
              <View style={S.zeile}>
                <Text style={S.schluessel}>{t('node.bindSigningAddress')}</Text>
                <Text style={S.wert}>{kurz(b.adresse)}</Text>
              </View>
              <View style={S.zeile}>
                <Text style={S.schluessel}>{t('node.bindWallet')}</Text>
                <Text style={S.wert}>{kurz(b.wallet)}</Text>
              </View>
              <View style={S.zeile}>
                <Text style={S.schluessel}>{t('node.bindKontrollzahl')}</Text>
                <Text style={S.wert}>{kontrollzahl(b.adresse)}</Text>
              </View>
              <Text style={S.warnung}>{t('node.bindWarning')}</Text>
              {ergebnis ? (
                <Text style={ergebnis.ok ? S.ok : S.fehler}>{ergebnis.text}</Text>
              ) : null}
              {!ergebnis?.ok && (
                <TouchableOpacity style={[S.btn, laeuft && { opacity: 0.6 }]} onPress={bestaetigen} disabled={laeuft} activeOpacity={0.85}>
                  {laeuft ? <ActivityIndicator color="#fff" /> : <Text style={S.btnText}>{t('node.bindConfirmBtn')}</Text>}
                </TouchableOpacity>
              )}
            </>
          )}
          <TouchableOpacity style={S.btnGhost} onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/run-node'))} activeOpacity={0.8}>
            <Text style={S.btnGhostText}>{ergebnis?.ok ? t('node.bindDone') : t('common.cancel')}</Text>
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
  zeile: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.border },
  schluessel: { color: theme.muted, fontSize: 12 },
  wert: { color: theme.text, fontSize: 12, fontWeight: '600', fontFamily: theme.fontMono },
  warnung: { color: theme.gold, fontSize: 12, lineHeight: 18, marginTop: 14 },
  ok: { color: theme.neon, fontSize: 13, lineHeight: 19, marginTop: 14 },
  fehler: { color: '#ff6b6b', fontSize: 13, lineHeight: 19, marginTop: 14 },
  btn: { marginTop: 18, backgroundColor: theme.accent, borderRadius: theme.radiusPill, padding: 15, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  btnGhost: { marginTop: 12, borderWidth: 1, borderColor: theme.border, borderRadius: theme.radiusPill, padding: 13, alignItems: 'center' },
  btnGhostText: { color: theme.text, fontSize: 14, fontWeight: '600' },
});
