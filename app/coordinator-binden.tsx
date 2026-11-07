import React, { useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useLanguage } from '@/contexts/LanguageContext';
import { useWallet } from '@/contexts/WalletContext';
import { COORDINATOR_BASE } from '@/lib/config';
import {
  coordinatorAdresse,
  coordinatorFreigeben,
  holeBesitznachweis,
  schluesselKurz,
  type Besitznachweis,
  type NachweisFehler,
} from '@/lib/coordinatorBindung';
import { withTimeout } from '@/lib/signer';
import { theme } from '@/constants/aequitas-theme';

// Pruefer: den Schluessel des eigenen Coordinators mit der Wallet freigeben
// (lib/coordinatorBindung.ts). Erreicht aus dem Knoten-Tab oder ueber
// aequitasapp://coordinator-binden?url=https://... -- die Adresse kommt dann
// von aussen und wird erst in coordinatorAdresse geprueft. Unterschrieben wird
// nur nach ausdruecklicher Bestaetigung, mit sichtbarem Schluessel.
const NETZ_TIMEOUT_MS = 20_000;
const SIGN_TIMEOUT_MS = 60_000;

function kurz(a: string): string {
  return a.slice(0, 8) + '…' + a.slice(-6);
}

export default function CoordinatorBinden() {
  const { t } = useLanguage();
  const { signer } = useWallet();
  const params = useLocalSearchParams<{ url?: string }>();
  const vorgabe = useMemo(() => coordinatorAdresse(params.url) ?? coordinatorAdresse(COORDINATOR_BASE) ?? '', [params.url]);
  const [url, setUrl] = useState(vorgabe);
  const [nachweis, setNachweis] = useState<Besitznachweis | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [ergebnis, setErgebnis] = useState<{ ok: boolean; text: string; warnung?: boolean } | null>(null);

  function nachweisFehlerText(f: NachweisFehler, meldung?: string): string {
    switch (f) {
      case 'adresse':
        return t('node.pruefFehlerAdresse');
      case 'andere_wallet':
        return t('node.pruefFehlerWallet');
      case 'kein_nachweis':
        return t('node.pruefFehlerKeinNachweis').replace('{meldung}', meldung ?? '');
      case 'antwort_ungueltig':
        return t('node.pruefFehlerAntwort');
      default:
        return t('node.pruefFehlerErreichbar').replace('{meldung}', meldung ?? '');
    }
  }

  async function holen() {
    if (!signer) return;
    setLaeuft(true);
    setErgebnis(null);
    setNachweis(null);
    try {
      const r = await withTimeout(holeBesitznachweis(url, signer.address), NETZ_TIMEOUT_MS, t('node.pruefFehlerErreichbar').replace('{meldung}', 'timeout'));
      if (r.ok) setNachweis(r.nachweis);
      else setErgebnis({ ok: false, text: nachweisFehlerText(r.fehler, r.meldung) });
    } catch (e: any) {
      setErgebnis({ ok: false, text: e?.message ?? t('node.pruefFehlerErreichbar').replace('{meldung}', '') });
    } finally {
      setLaeuft(false);
    }
  }

  async function freigeben() {
    if (!signer || !nachweis) return;
    setLaeuft(true);
    setErgebnis(null);
    try {
      const r = await withTimeout(coordinatorFreigeben(signer, nachweis), SIGN_TIMEOUT_MS, t('trade.signTimeout'));
      if (r.ok && r.tauglich) setErgebnis({ ok: true, text: t('node.pruefOk') });
      else if (r.ok) setErgebnis({ ok: true, warnung: true, text: t('node.pruefOkUntauglich') });
      else if (r.fehler === 'andere_wallet') setErgebnis({ ok: false, text: t('node.pruefFehlerWallet') });
      else if (r.fehler === 'unterschrift_ungueltig') setErgebnis({ ok: false, text: t('node.bindProofInvalid') });
      else setErgebnis({ ok: false, text: t('node.pruefFehlerAbgelehnt').replace('{meldung}', r.meldung ?? '') });
    } catch (e: any) {
      setErgebnis({ ok: false, text: e?.message ?? t('node.pruefFehlerAbgelehnt').replace('{meldung}', '') });
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <SafeAreaView style={S.safe}>
      <ScrollView contentContainerStyle={S.content} keyboardShouldPersistTaps="handled">
        <View style={S.card}>
          <Text style={S.title}>{t('node.pruefTitle')}</Text>
          {!signer ? (
            <Text style={S.fehler}>{t('node.bindNoWallet')}</Text>
          ) : !nachweis ? (
            <>
              <Text style={S.body}>{t('node.pruefDesc')}</Text>
              <Text style={S.label}>{t('node.pruefUrlLabel')}</Text>
              <TextInput
                style={S.input}
                value={url}
                onChangeText={(v) => setUrl(v)}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                placeholder="https://…/coordinator"
                placeholderTextColor={theme.muted}
                maxLength={200}
              />
              {ergebnis ? <Text style={ergebnis.ok ? S.ok : S.fehler}>{ergebnis.text}</Text> : null}
              <TouchableOpacity
                style={[S.btn, (laeuft || !coordinatorAdresse(url)) && { opacity: 0.6 }]}
                onPress={holen}
                disabled={laeuft || !coordinatorAdresse(url)}
                activeOpacity={0.85}
              >
                {laeuft ? <ActivityIndicator color="#fff" /> : <Text style={S.btnText}>{t('node.pruefHolen')}</Text>}
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={S.body}>{t('node.pruefConfirmBody')}</Text>
              <View style={S.zeile}>
                <Text style={S.schluessel}>{t('node.pruefAdresse')}</Text>
                <Text style={S.wert} numberOfLines={2}>{nachweis.url.replace(/^https:\/\//, '')}</Text>
              </View>
              <View style={S.zeile}>
                <Text style={S.schluessel}>{t('node.pruefSchluessel')}</Text>
                <Text style={S.wert}>{schluesselKurz(nachweis.schluessel)}</Text>
              </View>
              <View style={S.zeile}>
                <Text style={S.schluessel}>{t('node.bindWallet')}</Text>
                <Text style={S.wert}>{kurz(nachweis.wallet)}</Text>
              </View>
              <Text style={S.warnung}>{t('node.pruefWarnung')}</Text>
              {ergebnis ? (
                <Text style={ergebnis.warnung ? S.warnung : ergebnis.ok ? S.ok : S.fehler}>{ergebnis.text}</Text>
              ) : null}
              {!ergebnis?.ok && (
                <TouchableOpacity style={[S.btn, laeuft && { opacity: 0.6 }]} onPress={freigeben} disabled={laeuft} activeOpacity={0.85}>
                  {laeuft ? <ActivityIndicator color="#fff" /> : <Text style={S.btnText}>{t('node.pruefFreigeben')}</Text>}
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
  label: { color: theme.muted, fontSize: 12, marginBottom: 6 },
  input: { color: theme.text, borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 12, fontSize: 13, fontFamily: theme.fontMono },
  zeile: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.border, gap: 12 },
  schluessel: { color: theme.muted, fontSize: 12 },
  wert: { color: theme.text, fontSize: 12, fontWeight: '600', fontFamily: theme.fontMono, flexShrink: 1, textAlign: 'right' },
  warnung: { color: theme.gold, fontSize: 12, lineHeight: 18, marginTop: 14 },
  ok: { color: theme.neon, fontSize: 13, lineHeight: 19, marginTop: 14 },
  fehler: { color: '#ff6b6b', fontSize: 13, lineHeight: 19, marginTop: 14 },
  btn: { marginTop: 18, backgroundColor: theme.accent, borderRadius: theme.radiusPill, padding: 15, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  btnGhost: { marginTop: 12, borderWidth: 1, borderColor: theme.border, borderRadius: theme.radiusPill, padding: 13, alignItems: 'center' },
  btnGhostText: { color: theme.text, fontSize: 14, fontWeight: '600' },
});
