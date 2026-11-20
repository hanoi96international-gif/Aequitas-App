import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  abholen,
  bestellungAnzeigen,
  einloesen,
  neu,
  standardUmgebung,
  stelleLesen,
  validatorenLesen,
  vergessen,
  zustandAnzeigen,
  type Vorlage,
} from '@/lib/quantenSInhaberin';
import type { Bestellung } from '@/lib/quantenS';
import { theme, goldTint, goldTintBorder } from '@/constants/aequitas-theme';

// Quantengeld S: die App als Inhaberin eines Tokens (lib/quantenSInhaberin.ts).
// Drei Schritte: bestellen (Bestellung an den Ausgeber), abholen (nur mit K,
// direkt bei den Validatoren), einloesen (Vorlage als QR fuer die Stelle).
// Jede Pruefung steht in lib/quantenS.ts; die Seite zeigt nur und reicht durch.
type Anzeige = Awaited<ReturnType<typeof zustandAnzeigen>>;

export default function QuantenToken() {
  const { t } = useLanguage();
  const u = React.useMemo(() => standardUmgebung(), []);
  const [zustand, setZustand] = useState<Anzeige>(null);
  const [n, setN] = useState('1104');
  const [v, setV] = useState('1');
  const [stelle0, setStelle0] = useState('');
  const [stelle1, setStelle1] = useState('');
  const [bestellung, setBestellung] = useState<Bestellung | null>(null);
  const [k, setK] = useState('');
  const [validatoren, setValidatoren] = useState('');
  const [vorlage, setVorlage] = useState<Vorlage | null>(null);
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const [meldung, setMeldung] = useState<{ ok: boolean; text: string } | null>(null);

  const laden = useCallback(async () => {
    try {
      const z = await zustandAnzeigen(u);
      setZustand(z);
      // Eine offene Bestellung (noch kein Token) wieder zeigen, etwa nach einem Neustart.
      if (z && !z.k) setBestellung(await bestellungAnzeigen(u));
    } catch {
      setZustand(null);
    }
  }, [u]);
  useFocusEffect(useCallback(() => void laden(), [laden]));

  const schritt = async (name: string, f: () => Promise<void>) => {
    setLaeuft(name);
    setMeldung(null);
    try {
      await f();
    } catch (e: any) {
      setMeldung({ ok: false, text: `${t('node.qtFehler')} ${e?.message ?? ''}`.trim() });
    } finally {
      setLaeuft(null);
      void laden();
    }
  };

  const anlegen = () =>
    schritt('neu', async () => {
      const best = await neu(u, Number(n), Number(v), [stelleLesen(stelle0), stelleLesen(stelle1)]);
      setBestellung(best);
      setVorlage(null);
      setMeldung({ ok: true, text: t('node.qtAngelegt') });
    });
  const holen = () =>
    schritt('abholen', async () => {
      await abholen(u, k, validatorenLesen(validatoren));
      setMeldung({ ok: true, text: t('node.qtAbgeholt') });
    });
  const vorlegen = (b: 0 | 1) =>
    schritt('einloesen', async () => {
      const vl = await einloesen(u, b, (s) =>
        setMeldung({ ok: true, text: t(s === 'binden' ? 'node.qtBinden' : s === 'waehlen' ? 'node.qtWaehlen' : 'node.qtVorlageFertig') }),
      );
      setVorlage(vl);
    });
  const loeschen = () =>
    Alert.alert(t('node.qtVergessen'), t('node.qtVergessenFrage'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('node.qtVergessen'), style: 'destructive', onPress: () => void schritt('vergessen', async () => { await vergessen(u); setBestellung(null); setVorlage(null); }) },
    ]);

  const bestellungText = bestellung ? JSON.stringify(bestellung) : '';
  const vorlageText = vorlage ? JSON.stringify(vorlage) : '';
  const beschaeftigt = laeuft !== null;
  return (
    <SafeAreaView style={S.safe} edges={['top']}>
      <ScrollView contentContainerStyle={S.content} keyboardShouldPersistTaps="handled">
        <View style={[S.card, S.hinweisKarte]}>
          <Text style={S.title}>{t('node.qtTitel')}</Text>
          <Text style={S.hinweisText}>{t('node.qtText')}</Text>
        </View>

        <View style={S.card}>
          <Text style={S.title}>{t('node.qtStand')}</Text>
          {!zustand ? (
            <Text style={S.muted}>{t('node.qtKeiner')}</Text>
          ) : (
            <>
              <Text style={S.body}>{zustand.k ? t('node.qtToken').replace('{k}', zustand.k.slice(0, 12) + '…') : t('node.qtBestellt')}</Text>
              <Text style={S.muted}>{t('node.qtGroesse').replace('{n}', String(zustand.n)).replace('{v}', String(zustand.v))}</Text>
              {zustand.gebunden ? <Text style={S.muted}>{t('node.qwGebunden')}</Text> : null}
            </>
          )}
        </View>

        {!zustand ? (
          <View style={S.card}>
            <Text style={S.title}>{t('node.qtSchritt1')}</Text>
            <Text style={S.body}>{t('node.qtBestellenText')}</Text>
            <Text style={S.label}>n</Text>
            <TextInput style={S.input} value={n} onChangeText={(x) => setN(x.replace(/[^0-9]/g, ''))} keyboardType="number-pad" maxLength={5} />
            <Text style={S.label}>v</Text>
            <TextInput style={S.input} value={v} onChangeText={(x) => setV(x.replace(/[^0-9]/g, ''))} keyboardType="number-pad" maxLength={2} />
            <Text style={S.label}>{t('node.qtStelle').replace('{b}', '0')}</Text>
            <TextInput style={S.input} value={stelle0} onChangeText={setStelle0} autoCapitalize="none" autoCorrect={false} multiline placeholder="0x…=04…" placeholderTextColor={theme.muted} />
            <Text style={S.label}>{t('node.qtStelle').replace('{b}', '1')}</Text>
            <TextInput style={S.input} value={stelle1} onChangeText={setStelle1} autoCapitalize="none" autoCorrect={false} multiline placeholder="0x…=04…" placeholderTextColor={theme.muted} />
            <TouchableOpacity style={[S.btn, beschaeftigt && { opacity: 0.5 }]} disabled={beschaeftigt} onPress={anlegen} activeOpacity={0.85}>
              {laeuft === 'neu' ? <ActivityIndicator color="#fff" /> : <Text style={S.btnText}>{t('node.qtAnlegen')}</Text>}
            </TouchableOpacity>
          </View>
        ) : null}

        {zustand && !zustand.k && bestellung ? (
          <View style={S.card}>
            <Text style={S.title}>{t('node.qtSchritt1')}</Text>
            <Text style={S.muted}>{t('node.qtBestellungHinweis')}</Text>
            <View style={[S.qr, { alignSelf: 'center', marginTop: 12 }]}>
              <QRCode value={bestellungText} size={260} backgroundColor="#ffffff" color="#000000" ecl="L" />
            </View>
            <TouchableOpacity style={S.btnZweit} onPress={() => Clipboard.setStringAsync(bestellungText)} accessibilityRole="button">
              <Text style={S.btnZweitText}>{t('node.qtKopieren')}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {zustand && !zustand.k ? (
          <View style={S.card}>
            <Text style={S.title}>{t('node.qtSchritt2')}</Text>
            <Text style={S.body}>{t('node.qtAbholenText')}</Text>
            <Text style={S.label}>K</Text>
            <TextInput style={S.input} value={k} onChangeText={(x) => setK(x.replace(/[^0-9a-fA-F]/g, '').slice(0, 64))} autoCapitalize="none" autoCorrect={false} maxLength={64} placeholder="K" placeholderTextColor={theme.muted} />
            <Text style={S.label}>{t('node.qtValidatoren')}</Text>
            <TextInput style={[S.input, { minHeight: 60 }]} value={validatoren} onChangeText={setValidatoren} autoCapitalize="none" autoCorrect={false} multiline placeholder="0x…=https://…/api" placeholderTextColor={theme.muted} />
            <TouchableOpacity style={[S.btn, (beschaeftigt || k.length !== 64) && { opacity: 0.5 }]} disabled={beschaeftigt || k.length !== 64} onPress={holen} activeOpacity={0.85}>
              {laeuft === 'abholen' ? <ActivityIndicator color="#fff" /> : <Text style={S.btnText}>{t('node.qtAbholen')}</Text>}
            </TouchableOpacity>
          </View>
        ) : null}

        {zustand?.k ? (
          <View style={S.card}>
            <Text style={S.title}>{t('node.qtSchritt3')}</Text>
            <Text style={S.body}>{t('node.qtEinloesenText')}</Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {([0, 1] as const).map((b) => (
                <TouchableOpacity key={b} style={[S.btn, { flex: 1 }, beschaeftigt && { opacity: 0.5 }]} disabled={beschaeftigt} onPress={() => vorlegen(b)} activeOpacity={0.85}>
                  {laeuft === 'einloesen' ? <ActivityIndicator color="#fff" /> : <Text style={S.btnText}>{t('node.qtStelle').replace('{b}', String(b))}</Text>}
                </TouchableOpacity>
              ))}
            </View>
            {vorlage ? (
              <View style={{ marginTop: 16, alignItems: 'center' }}>
                <View style={S.qr}>
                  <QRCode value={vorlageText} size={260} backgroundColor="#ffffff" color="#000000" ecl="L" />
                </View>
                {/* Kein Kopieren: die Vorlage wirkt bei dieser Stelle wie Bargeld, und
                    die Zwischenablage koennen andere Apps lesen. Nur als QR, nur dort zeigen. */}
                <Text style={[S.muted, { marginTop: 10 }]}>{t('node.qtVorlageHinweis').replace('{b}', String(vorlage.b))}</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {meldung ? (
          <View style={S.card}>
            <Text style={meldung.ok ? S.ok : S.fehler}>{meldung.text}</Text>
          </View>
        ) : null}

        {zustand ? (
          <TouchableOpacity style={[S.card, { alignItems: 'center' }]} onPress={loeschen} disabled={beschaeftigt} accessibilityRole="button">
            <Text style={S.muted}>{t('node.qtVergessen')}</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const S = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.bg },
  content: { paddingBottom: 40 },
  card: { marginHorizontal: 20, backgroundColor: theme.card, borderRadius: theme.radius, padding: 20, marginTop: 16, borderWidth: 1, borderColor: theme.border },
  hinweisKarte: { backgroundColor: goldTint, borderColor: goldTintBorder },
  hinweisText: { color: theme.gold, fontSize: 12, lineHeight: 18 },
  title: { fontSize: 11, color: theme.muted, letterSpacing: 3, marginBottom: 12, fontWeight: '600' },
  body: { color: theme.text, fontSize: 13, lineHeight: 19, marginBottom: 12 },
  muted: { color: theme.muted, fontSize: 12, lineHeight: 17 },
  label: { color: theme.muted, fontSize: 12, marginTop: 10, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: theme.border, borderRadius: theme.radiusSm, color: theme.text, padding: 10, fontFamily: theme.fontMono, fontSize: 12 },
  btn: { marginTop: 12, backgroundColor: theme.accent, borderRadius: theme.radiusPill, padding: 14, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  btnZweit: { marginTop: 10, borderWidth: 1, borderColor: theme.border, borderRadius: theme.radiusPill, padding: 10, alignItems: 'center' },
  btnZweitText: { color: theme.text, fontSize: 13, fontWeight: '600' },
  qr: { backgroundColor: '#ffffff', padding: 12, borderRadius: theme.radiusSm },
  ok: { color: theme.neon, fontSize: 13 },
  fehler: { color: '#ff6b6b', fontSize: 13 },
});
