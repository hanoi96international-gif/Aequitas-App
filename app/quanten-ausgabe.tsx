import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { useLanguage } from '@/contexts/LanguageContext';
import { bestellen, bestellPfand, losStand, vergessen, zustandLesen, type AusgeberZustand } from '@/lib/quantenSAusgeber';
import { antwortenStand, auftraegeSenden, ausgeben, beauftragen, bestaetigungenAnfordern, bestaetigungenStand, paketSenden } from '@/lib/quantenSAusgeberRunde';
import { ausgeberBriefkasten, BESTELLUNG_TEXT_MAX, bestellungAusText } from '@/lib/quantenSAusgeberGeraet';
import type { RundenBericht } from '@/lib/quantenSPraepAblauf';
import { praepUmgebung } from '@/lib/quantenSPraepGeraet';
import { aeqText } from '@/lib/quantenW';
import { unlockWallet } from '@/lib/wallet';
import { theme, goldTint, goldTintBorder } from '@/constants/aequitas-theme';

// Quantengeld Weg B (4c-3b): die App als Ausgeber. Schritte nach dem Stand der
// eigenen Bestellung (lib/quantenSAusgeber.ts, lib/quantenSAusgeberRunde.ts):
// bestellen -> Los abwarten -> K an die Inhaberin -> ihre Bestellung einfügen
// und beauftragen -> Antworten sammeln -> Bestätigungen -> ausgeben -> Paket.
// Jede Prüfung steht in lib/; die Seite zeigt nur und reicht durch. Was Wert
// bindet (Bestellung mit Pfand, Ausgabe), erst nach ausdrücklicher Bestätigung.

function datum(s: number, lang: string): string {
  return new Date(s * 1000).toLocaleString(lang);
}

export default function QuantenAusgabe() {
  const { t, lang } = useLanguage();
  const u = useMemo(() => praepUmgebung(), []);
  const wallet = useMemo(() => ({ entsperren: unlockWallet }), []);
  const [z, setZ] = useState<AusgeberZustand | null>(null);
  const [v, setV] = useState('7');
  const [schwelle, setSchwelle] = useState('4');
  const [aeq, setAeq] = useState('1');
  const [bestText, setBestText] = useState('');
  const [tol, setTol] = useState('2');
  const [wartenAb, setWartenAb] = useState<number | null>(null);
  const [fehlen, setFehlen] = useState<number[] | null>(null);
  const [bericht, setBericht] = useState<RundenBericht | null>(null);
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const [meldung, setMeldung] = useState<{ ok: boolean; text: string } | null>(null);
  const [ladeFehler, setLadeFehler] = useState<string | null>(null);

  const laden = useCallback(async () => {
    try {
      setLadeFehler(null);
      const neu = await zustandLesen(u);
      setZ(neu);
      if (neu?.stand === 'beauftragt') setFehlen((await antwortenStand(u)).fehlen);
      else if (neu?.stand === 'beantwortet') setFehlen((await bestaetigungenStand(u)).fehlen);
      else setFehlen(null);
    } catch (e: any) {
      // Ohne t: laden hängt nur an u (sonst lädt jede neue t-Funktion die Seite neu).
      setLadeFehler(String(e?.message ?? '').slice(0, 200));
    }
  }, [u]);
  useFocusEffect(useCallback(() => void laden(), [laden]));

  const schritt = async (name: string, f: () => Promise<void>) => {
    setLaeuft(name);
    setMeldung(null);
    try {
      await f();
    } catch (e: any) {
      const text = String(e?.message ?? e).slice(0, 200);
      setMeldung({ ok: false, text: `${t('node.qtFehler')} ${text}`.trim() });
      Alert.alert(t('node.qtFehler'), text);
    } finally {
      setLaeuft(null);
      void laden();
    }
  };

  const deckung = Math.round(Number(aeq) * 1_000_000);
  const bestellenFragen = () => {
    if (!Number.isFinite(deckung) || deckung <= 0) return;
    Alert.alert(t('node.qpBestaetigenTitel'), t('node.qaBestellenFrage').replace('{deckung}', aeqText(deckung)).replace('{pfand}', aeqText(bestellPfand(deckung))), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('node.qaBestellen'),
        onPress: () =>
          void schritt('bestellen', async () => {
            await bestellen(u, wallet, Number(v), Number(schwelle), deckung);
            setMeldung({ ok: true, text: t('node.qaBestellt') });
          }),
      },
    ]);
  };
  const losen = () =>
    schritt('los', async () => {
      const r = await losStand(u);
      setWartenAb(r.stand === 'warten' ? r.ab : null);
      const text: Record<typeof r.stand, string> = {
        gelost: 'node.qaGelost', warten: 'node.qaWarten', eingereicht: 'node.qaEingereicht', verworfen: 'node.qaVerworfen', verfallen: 'node.qaVerfallen',
      };
      setMeldung({ ok: r.stand !== 'verworfen' && r.stand !== 'verfallen', text: t(text[r.stand] as any).replace('{datum}', r.stand === 'warten' ? datum(r.ab, lang) : '') });
    });
  const auftragGeben = () =>
    schritt('beauftragen', async () => {
      const r = await beauftragen(u, wallet, bestellungAusText(bestText), Number(tol));
      setBestText('');
      setMeldung({ ok: true, text: t('node.qaGesendet').replace('{n}', String(r.gesendet.length)) });
    });
  const nochmal = () =>
    schritt('nochmal', async () => {
      const r = await auftraegeSenden(u, wallet);
      setMeldung({ ok: true, text: t('node.qaGesendet').replace('{n}', String(r.gesendet.length)) });
    });
  const briefkasten = () =>
    schritt('briefkasten', async () => {
      setBericht(await ausgeberBriefkasten(wallet, u));
    });
  const bestaetigen = () =>
    schritt('bestaetigen', async () => {
      const r = await bestaetigungenAnfordern(u, wallet);
      setMeldung({ ok: true, text: t('node.qaGesendet').replace('{n}', String(r.gesendet.length)) });
    });
  const ausgebenFragen = () =>
    Alert.alert(t('node.qpBestaetigenTitel'), t('node.qaAusgebenFrage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('node.qaAusgeben'),
        onPress: () =>
          void schritt('ausgeben', async () => {
            const r = await ausgeben(u, wallet);
            setMeldung({ ok: true, text: t(r.stand === 'ausgegeben' ? 'node.qaAusgegeben' : 'node.qaAusgabeEingereicht') });
          }),
      },
    ]);
  const paket = () =>
    schritt('paket', async () => {
      const r = await paketSenden(u, wallet);
      setMeldung({ ok: true, text: t('node.qaPaketGesendet').replace('{n}', String(r.briefe)) });
    });
  const vergessenFragen = () =>
    Alert.alert(t('node.qpBestaetigenTitel'), t('node.qaVergessenFrage'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('node.qaVergessen'), style: 'destructive', onPress: () => void schritt('vergessen', async () => { await vergessen(u); setBericht(null); }) },
    ]);

  const jetzt = Math.floor(Date.now() / 1000);
  const abgelaufen = !!z && z.frist !== undefined && jetzt > z.frist;
  const knopf = (name: string, text: string, onPress: () => void, aus = false) => (
    <TouchableOpacity
      key={name}
      style={[S.btn, (laeuft !== null || aus) && { opacity: 0.6 }]}
      disabled={laeuft !== null || aus}
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
    >
      {laeuft === name ? <ActivityIndicator color="#fff" /> : <Text style={S.btnText}>{text}</Text>}
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={S.safe} edges={['top']}>
      <ScrollView contentContainerStyle={S.content}>
        <View style={S.card}>
          <Text style={S.title}>{t('node.qaTitel')}</Text>
          <Text style={S.body}>{t('node.qaText')}</Text>
        </View>

        {!z ? (
          <View style={S.card}>
            <Text style={S.sub}>{t('node.qaNeu')}</Text>
            <Text style={S.label}>{t('node.qaV')}</Text>
            <TextInput style={S.input} value={v} onChangeText={(x) => setV(x.replace(/[^0-9]/g, '').slice(0, 2))} keyboardType="number-pad" />
            <Text style={S.label}>{t('node.qaT')}</Text>
            <TextInput style={S.input} value={schwelle} onChangeText={(x) => setSchwelle(x.replace(/[^0-9]/g, '').slice(0, 2))} keyboardType="number-pad" />
            <Text style={S.label}>{t('node.qaDeckung')}</Text>
            <TextInput style={S.input} value={aeq} onChangeText={(x) => setAeq(x.replace(/[^0-9.]/g, '').slice(0, 12))} keyboardType="decimal-pad" />
            {knopf('bestellen', t('node.qaBestellen'), bestellenFragen, !(deckung > 0))}
          </View>
        ) : (
          <View style={S.card}>
            <Zeile k="K" v={`${z.k.slice(0, 16)}…`} />
            <Zeile k={t('node.qaStand')} v={t(`node.qaStand_${z.stand}` as any)} />
            <Zeile k={t('node.qaGroesse')} v={`v = ${z.v}, t = ${z.t}`} />
            <Zeile k={t('node.qaDeckung')} v={aeqText(z.deckung)} />
            {z.frist !== undefined ? <Zeile k={t('node.qaFrist')} v={datum(z.frist, lang)} last /> : null}
            <TouchableOpacity style={S.btnZweit} onPress={() => Clipboard.setStringAsync(z.k)} accessibilityRole="button">
              <Text style={S.btnZweitText}>{t('node.qaKKopieren')}</Text>
            </TouchableOpacity>

            {z.stand === 'eingereicht' || z.stand === 'bestellt' ? (
              <>
                {wartenAb ? <Text style={[S.muted, { marginTop: 8 }]}>{t('node.qaWarten').replace('{datum}', datum(wartenAb, lang))}</Text> : null}
                {knopf('los', t('node.qaLosen'), losen)}
              </>
            ) : null}

            {z.stand === 'gelost' ? (
              <>
                <Text style={[S.muted, { marginTop: 10 }]}>{t('node.qaKGeben')}</Text>
                <Text style={S.label}>{t('node.qaBestellungInhaberin')}</Text>
                <TextInput
                  style={[S.input, { minHeight: 90, textAlignVertical: 'top' }]}
                  value={bestText}
                  onChangeText={setBestText}
                  multiline
                  maxLength={BESTELLUNG_TEXT_MAX}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TouchableOpacity style={S.btnZweit} onPress={async () => setBestText((await Clipboard.getStringAsync()).slice(0, BESTELLUNG_TEXT_MAX))} accessibilityRole="button">
                  <Text style={S.btnZweitText}>{t('node.qaEinfuegen')}</Text>
                </TouchableOpacity>
                <Text style={S.label}>{t('node.qaTol')}</Text>
                <TextInput style={S.input} value={tol} onChangeText={(x) => setTol(x.replace(/[^0-9]/g, '').slice(0, 2))} keyboardType="number-pad" />
                {knopf('beauftragen', t('node.qaBeauftragen'), auftragGeben, bestText.trim() === '')}
              </>
            ) : null}

            {z.stand === 'beauftragt' || z.stand === 'beantwortet' ? (
              <>
                {fehlen ? (
                  <Text style={[S.muted, { marginTop: 10 }]}>
                    {t(z.stand === 'beauftragt' ? 'node.qaFehlenAntworten' : 'node.qaFehlenBestaetigungen').replace('{liste}', fehlen.length ? fehlen.join(', ') : '–')}
                  </Text>
                ) : null}
                {knopf('briefkasten', t('node.qaBriefkasten'), briefkasten)}
                {z.stand === 'beauftragt' ? knopf('nochmal', t('node.qaNochmal'), nochmal) : knopf('bestaetigen', t('node.qaBestaetigen'), bestaetigen)}
              </>
            ) : null}

            {z.stand === 'bestaetigt' ? knopf('ausgeben', t('node.qaAusgeben'), ausgebenFragen) : null}
            {z.stand === 'ausgegeben' ? knopf('paket', t('node.qaPaket'), paket) : null}
            {abgelaufen ? knopf('vergessen', t('node.qaVergessen'), vergessenFragen) : null}
          </View>
        )}

        {ladeFehler !== null ? (
          <View style={[S.card, S.hinweisKarte]}>
            <Text style={S.fehler}>{`${t('node.qtFehler')} ${ladeFehler}`.trim()}</Text>
          </View>
        ) : null}

        {meldung ? (
          <View style={[S.card, S.hinweisKarte]}>
            <Text style={meldung.ok ? S.ok : S.fehler}>{meldung.text}</Text>
          </View>
        ) : null}

        {bericht ? (
          <View style={S.card}>
            <Text style={S.sub}>{t('node.qrTitel')}</Text>
            <Zeile k={t('node.qrBriefe')} v={String(bericht.briefe)} />
            <Zeile k={t('node.qaAntworten')} v={String(bericht.antworten.length)} />
            <Zeile k={t('node.qaBestaetigungen')} v={String(bericht.bestaetigungen.length)} />
            <Zeile k={t('node.qrAbgelehnt')} v={String(bericht.abgelehnt.length + bericht.abgewiesen.length)} />
            <Zeile k={t('node.qrOffen')} v={String(bericht.offen)} last />
            {bericht.abgelehnt.slice(0, 5).map((a, i) => (
              <Text key={i} style={[S.muted, { marginTop: 4 }]}>{`${a.k.slice(0, 12)}…: ${a.grund.slice(0, 120)}`}</Text>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Zeile({ k, v, last }: { k: string; v: string; last?: boolean }) {
  return (
    <View style={[S.zeile, last && { borderBottomWidth: 0 }]}>
      <Text style={S.key}>{k}</Text>
      <Text style={S.val}>{v}</Text>
    </View>
  );
}

const S = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.bg },
  content: { paddingBottom: 40 },
  card: { marginHorizontal: 20, backgroundColor: theme.card, borderRadius: theme.radius, padding: 20, marginTop: 16, borderWidth: 1, borderColor: theme.border },
  title: { fontSize: 11, color: theme.muted, letterSpacing: 3, marginBottom: 12, fontWeight: '600' },
  body: { color: theme.text, fontSize: 13, lineHeight: 19 },
  sub: { color: theme.muted, fontSize: 11, marginBottom: 6, fontWeight: '600' },
  muted: { color: theme.muted, fontSize: 12, lineHeight: 17 },
  hinweisKarte: { backgroundColor: goldTint, borderColor: goldTintBorder },
  zeile: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: theme.border },
  key: { color: theme.muted, fontSize: 12 },
  val: { color: theme.text, fontSize: 12, fontWeight: '600', fontFamily: theme.fontMono, flexShrink: 1, textAlign: 'right' },
  btn: { marginTop: 12, backgroundColor: theme.accent, borderRadius: theme.radiusPill, padding: 14, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  btnZweit: { marginTop: 10, borderWidth: 1, borderColor: theme.border, borderRadius: theme.radiusPill, padding: 10, alignItems: 'center' },
  btnZweitText: { color: theme.text, fontSize: 13, fontWeight: '600' },
  label: { color: theme.muted, fontSize: 12, marginTop: 10, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: theme.border, borderRadius: theme.radiusSm, color: theme.text, padding: 10, fontFamily: theme.fontMono, fontSize: 12 },
  ok: { color: theme.neon, fontSize: 13 },
  fehler: { color: '#ff6b6b', fontSize: 13 },
});
