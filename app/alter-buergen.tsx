import React, { useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useLanguage } from '@/contexts/LanguageContext';
import { useWallet } from '@/contexts/WalletContext';
import { theme } from '@/constants/aequitas-theme';
import { BUERGEN_NOETIG, buergen, leseQr } from '@/lib/altersbuergschaft';
import { withTimeout } from '@/lib/signer';

// Fuer das Alter eines Menschen buergen (lib/altersbuergschaft.ts).
// Erreicht ueber den QR-Scanner im Wallet-Tab. Unterschrieben wird erst nach
// ausdruecklicher Bestaetigung; die Unterschrift ist oeffentlich zurechenbar.

function kurz(a: string): string {
  return a.slice(0, 8) + '…' + a.slice(-6);
}

export default function AlterBuergen() {
  const { t } = useLanguage();
  const { address, signer } = useWallet();
  const p = useLocalSearchParams<{ wallet?: string; anfrage?: string }>();
  const ziel = useMemo(() => leseQr(`aequitas-alter:${p.wallet ?? ''}:${p.anfrage ?? ''}`), [p.wallet, p.anfrage]);
  const [laeuft, setLaeuft] = useState(false);
  const [ergebnis, setErgebnis] = useState<{ ok: boolean; text: string } | null>(null);
  const [kenne, setKenne] = useState(false);

  async function bestaetigen() {
    if (!ziel || !signer || !address) return;
    setLaeuft(true);
    setErgebnis(null);
    try {
      const r = await withTimeout(buergen(signer, address, ziel.wallet, ziel.anfrage), 60_000, t('trade.signTimeout'));
      setErgebnis(
        r.ok
          ? { ok: true, text: t('buergen.ok').replace('{n}', String(r.buergen)).replace('{noetig}', String(BUERGEN_NOETIG)) }
          : { ok: false, text: t('buergen.fehler').replace('{grund}', r.grund ?? '') },
      );
    } catch (e: any) {
      setErgebnis({ ok: false, text: t('buergen.fehler').replace('{grund}', String(e?.message ?? e).slice(0, 120)) });
    } finally {
      setLaeuft(false);
    }
  }

  const selbst = !!ziel && !!address && ziel.wallet === address.toLowerCase();

  return (
    <SafeAreaView style={S.safe}>
      <ScrollView contentContainerStyle={S.content}>
        <View style={S.card}>
          <Text style={S.title}>{t('buergen.titel')}</Text>
          {!ziel ? (
            <Text style={S.fehler}>{t('buergen.ungueltig')}</Text>
          ) : !signer || !address ? (
            <Text style={S.fehler}>{t('buergen.keineWallet')}</Text>
          ) : selbst ? (
            <Text style={S.fehler}>{t('buergen.eigene')}</Text>
          ) : (
            <>
              <Text style={S.body}>{t('buergen.text')}</Text>
              <Text style={S.wert}>{kurz(ziel.wallet)}</Text>
              <Text style={S.warnung}>{t('buergen.warnung')}</Text>
              <TouchableOpacity style={S.checkRow} onPress={() => setKenne((v) => !v)} activeOpacity={0.8}>
                <View style={[S.checkbox, kenne && S.checkboxAn]}>{kenne ? <Text style={S.btnText}>✓</Text> : null}</View>
                <Text style={S.body}>{t('buergen.bestaetigung')}</Text>
              </TouchableOpacity>
              {ergebnis ? <Text style={ergebnis.ok ? S.ok : S.fehler}>{ergebnis.text}</Text> : null}
              {!ergebnis?.ok && (
                <TouchableOpacity style={[S.btn, (!kenne || laeuft) && { opacity: 0.5 }]} onPress={bestaetigen} disabled={!kenne || laeuft}>
                  {laeuft ? <ActivityIndicator color="#fff" /> : <Text style={S.btnText}>{t('buergen.unterschreiben')}</Text>}
                </TouchableOpacity>
              )}
            </>
          )}
          <TouchableOpacity style={S.btnGhost} onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/wallet'))}>
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
  body: { color: theme.muted, fontSize: 13, lineHeight: 19, marginBottom: 10, flexShrink: 1 },
  wert: { color: theme.text, fontSize: 13, fontWeight: '600', fontFamily: theme.fontMono, marginBottom: 10 },
  warnung: { color: theme.gold, fontSize: 12, lineHeight: 18, marginBottom: 6 },
  ok: { color: theme.neon, fontSize: 13, lineHeight: 19, marginTop: 12 },
  fehler: { color: '#ff6b6b', fontSize: 13, lineHeight: 19, marginTop: 12 },
  btn: { marginTop: 16, backgroundColor: theme.accent, borderRadius: theme.radiusPill, padding: 15, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  btnGhost: { marginTop: 12, borderWidth: 1, borderColor: theme.border, borderRadius: theme.radiusPill, padding: 13, alignItems: 'center' },
  btnGhostText: { color: theme.text, fontSize: 14, fontWeight: '600' },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' },
  checkboxAn: { backgroundColor: theme.accent, borderColor: theme.accent },
});
