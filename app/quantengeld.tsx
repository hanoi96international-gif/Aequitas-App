import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { useLanguage } from '@/contexts/LanguageContext';
import { useWallet } from '@/contexts/WalletContext';
import { COORDINATOR_BASE } from '@/lib/config';
import { coordinatorAdresse } from '@/lib/coordinatorBindung';
import { holeRegisterStand } from '@/lib/prueferRegister';
import {
  holeQuantenAbstimmungen,
  holeQuantenStand,
  ordnungBits,
  quantenAbstimmen,
  quantenStimmenNoetig,
  vorschlagGueltig,
  QUANTEN_MINDEST_PRUEFER,
  QUANTEN_VORLAUF_S,
  type QuantenAbstimmung,
  type QuantenStand,
  type QuantenStimmErgebnis,
} from '@/lib/quantengeld';
import { aeqText, holeQuantenWStand, kennungGueltig, type QuantenWErgebnis } from '@/lib/quantenW';
import { withTimeout } from '@/lib/signer';
import { theme, goldTint, goldTintBorder } from '@/constants/aequitas-theme';

// Dezentrales Quantengeld (lib/quantengeld.ts): Stand ansehen, und als
// Pruefer ueber die Freischaltung eines Parametersatzes abstimmen. Gezaehlt
// wird in der Kette; die Seite zeigt nur, was der Knoten meldet.
const TIMEOUT_MS = 90_000;
const NACHLADEN_MS = 15_000;

function datum(s: number, lang: string): string {
  return new Date(s * 1000).toLocaleDateString(lang, { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function Quantengeld() {
  const { t, lang } = useLanguage();
  const { signer } = useWallet();
  const ich = signer?.address.toLowerCase() ?? '';
  const [stand, setStand] = useState<QuantenStand | null>(null);
  const [abst, setAbst] = useState<QuantenAbstimmung[] | null>(null);
  const [pruefer, setPruefer] = useState<string[] | null>(null);
  const [geladen, setGeladen] = useState(false);
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const [meldung, setMeldung] = useState<{ ok: boolean; text: string } | null>(null);
  const [satz, setSatz] = useState('');
  const [ordnung, setOrdnung] = useState('');
  const [tage, setTage] = useState('30');
  // Note oder Token nachsehen (lib/quantenW.ts): nur Anzeige.
  const [kennung, setKennung] = useState('');
  const [wErgebnis, setWErgebnis] = useState<QuantenWErgebnis | null>(null);
  const [wLaeuft, setWLaeuft] = useState(false);

  const laden = useCallback(async () => {
    const [s, a, r] = await Promise.all([holeQuantenStand(), holeQuantenAbstimmungen(), holeRegisterStand()]);
    setStand(s);
    setAbst(a);
    setPruefer(r ? r.pruefer : null);
    setGeladen(true);
  }, []);

  useFocusEffect(
    useCallback(() => {
      laden();
      const timer = setInterval(laden, NACHLADEN_MS);
      return () => clearInterval(timer);
    }, [laden]),
  );

  const binPruefer = !!pruefer && pruefer.includes(ich);
  const anzahlPruefer = pruefer?.length ?? 0;
  const mindestPruefer = stand?.mindestPruefer ?? QUANTEN_MINDEST_PRUEFER;
  const noetigGesamt = quantenStimmenNoetig(anzahlPruefer, mindestPruefer);

  function ergebnisText(r: QuantenStimmErgebnis): { ok: boolean; text: string } {
    if (r.ok && r.eingereicht) return { ok: true, text: t('node.qOkEingereicht') };
    if (r.ok) return { ok: true, text: t('node.qOk').replace('{stimmen}', String(r.stimmen ?? '?')).replace('{noetig}', String(r.noetig ?? '?')) };
    if (r.fehler === 'kein_pq') return { ok: false, text: t('node.qFehlerPQ') };
    if (r.fehler === 'eingabe') return { ok: false, text: t('node.qFehlerEingabe') };
    return { ok: false, text: t('node.qFehler').replace('{meldung}', r.meldung ?? r.fehler ?? '') };
  }

  async function stimmen(s: string, o: string, ab: number) {
    if (!signer) return;
    const url = coordinatorAdresse(COORDINATOR_BASE) ?? '';
    setLaeuft(s + '|' + ab);
    setMeldung(null);
    try {
      const r = await withTimeout(quantenAbstimmen(signer, url, s, o, ab), TIMEOUT_MS, t('trade.signTimeout'));
      setMeldung(ergebnisText(r));
      await laden();
    } catch (e: any) {
      setMeldung({ ok: false, text: t('node.qFehler').replace('{meldung}', String(e?.message ?? e)) });
    } finally {
      setLaeuft(null);
    }
  }

  // Jede Stimme erst nach ausdruecklicher Bestaetigung: sie bezeugt Hardware
  // und Gutachten. Bei wenigen Pruefern ein Hinweis: unter der Mindestzahl
  // schaltet nichts frei; knapp darueber entscheiden wenige Stimmen.
  function bestaetigen(s: string, o: string, ab: number) {
    const ersetzt = (k: 'node.qWenigePruefer' | 'node.qZuWenigePruefer') => '\n\n' + t(k)
      .replace('{n}', String(anzahlPruefer))
      .replace('{noetig}', String(noetigGesamt))
      .replace('{mindest}', String(mindestPruefer));
    const warnung = anzahlPruefer > 0 && anzahlPruefer < mindestPruefer
      ? ersetzt('node.qZuWenigePruefer')
      : anzahlPruefer > 0 && noetigGesamt === mindestPruefer
        ? ersetzt('node.qWenigePruefer')
        : '';
    Alert.alert(t('node.qBestaetigenTitel'), t('node.qBestaetigenText') + warnung, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('node.qZustimmen'), style: 'destructive', onPress: () => stimmen(s, o, ab) },
    ]);
  }

  async function nachsehen() {
    setWLaeuft(true);
    try {
      setWErgebnis(await holeQuantenWStand(kennung));
    } finally {
      setWLaeuft(false);
    }
  }

  const kennungOk = kennungGueltig(kennung.trim().toLowerCase());

  const jetzt = Math.floor(Date.now() / 1000);
  const tageZahl = /^[0-9]{1,4}$/.test(tage) ? parseInt(tage, 10) : 0;
  const neuAb = jetzt + Math.max(tageZahl, 0) * 86400 + 3600;
  const neuOk = vorschlagGueltig(satz.trim(), ordnung.trim(), neuAb, jetzt) && tageZahl * 86400 >= QUANTEN_VORLAUF_S;

  return (
    <SafeAreaView style={S.safe}>
      <ScrollView contentContainerStyle={S.content} keyboardShouldPersistTaps="handled">
        <View style={S.card}>
          <Text style={S.title}>{t('node.qTitle')}</Text>
          <Text style={S.body}>{t('node.qKarte')}</Text>
          {!geladen ? (
            <ActivityIndicator color={theme.accent} />
          ) : !stand ? (
            <Text style={S.muted}>{t('node.valNichtLesbar')}</Text>
          ) : (
            <>
              <Zeile k={t('node.qStatus')} v={stand.aktiv ? t('node.qAktiv') : t('node.qSchlafend')} />
              <Zeile k={t('node.qTopf')} v={stand.gedecktAeq.toFixed(4) + ' AEQ'} />
              <Zeile k={t('node.qNoten')} v={String(stand.noten)} />
              <Zeile k={t('node.qPruefer')} v={pruefer ? String(anzahlPruefer) : '–'} last />
              <Text style={S.sub}>{t('node.qSaetze')}</Text>
              {stand.saetze.length === 0 ? (
                <Text style={S.muted}>{t('node.qKeinSatz')}</Text>
              ) : (
                stand.saetze.map((s) => (
                  <Zeile key={s.name} k={s.name} v={t('node.qBits').replace('{bits}', String(s.ordnungBits)) + ' · ' + t('node.qAb') + ' ' + datum(s.ab, lang)} />
                ))
              )}
            </>
          )}
        </View>

        <View style={[S.card, S.hinweisKarte]}>
          <Text style={S.hinweisText}>{t('node.qWarum')}</Text>
        </View>

        <View style={S.card}>
          <Text style={S.title}>{t('node.qAbstimmungen')}</Text>
          {meldung ? <Text style={meldung.ok ? S.ok : S.fehler}>{meldung.text}</Text> : null}
          {!binPruefer && geladen ? <Text style={S.muted}>{t('node.qNurPruefer')}</Text> : null}
          {abst === null ? (
            geladen ? <Text style={S.muted}>{t('node.valNichtLesbar')}</Text> : null
          ) : abst.length === 0 ? (
            <Text style={S.muted}>{t('node.qKeineAbstimmung')}</Text>
          ) : (
            abst.map((a) => (
              <View key={a.satz + a.ab + a.ordnung.slice(-8)} style={S.vorschlag}>
                <Text style={S.vorschlagName}>{a.satz}</Text>
                <Text style={S.muted}>
                  {t('node.qBits').replace('{bits}', String(ordnungBits(a.ordnung)))} · {t('node.qAb')} {datum(a.ab, lang)}
                </Text>
                <Text style={S.stimmen}>{t('node.qStimmen').replace('{stimmen}', String(a.stimmen)).replace('{noetig}', String(a.noetig))}</Text>
                {binPruefer ? (
                  <TouchableOpacity
                    style={[S.btn, laeuft !== null && { opacity: 0.6 }]}
                    disabled={laeuft !== null}
                    onPress={() => bestaetigen(a.satz, a.ordnung, a.ab)}
                    activeOpacity={0.85}
                  >
                    {laeuft === a.satz + '|' + a.ab ? <ActivityIndicator color="#fff" /> : <Text style={S.btnText}>{t('node.qZustimmen')}</Text>}
                  </TouchableOpacity>
                ) : null}
              </View>
            ))
          )}
        </View>

        <View style={S.card}>
          <Text style={S.title}>{t('node.qwTitel')}</Text>
          <Text style={S.body}>{t('node.qwText')}</Text>
          <TextInput
            style={S.input}
            value={kennung}
            onChangeText={(v) => { setKennung(v.replace(/[^0-9a-fA-F]/g, '').slice(0, 64)); setWErgebnis(null); }}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={64}
            placeholder="K"
            placeholderTextColor={theme.muted}
          />
          {kennung.length > 0 && !kennungOk ? <Text style={S.muted}>{t('node.qwUngueltig')}</Text> : null}
          <TouchableOpacity
            style={[S.btn, (!kennungOk || wLaeuft) && { opacity: 0.5 }]}
            disabled={!kennungOk || wLaeuft}
            onPress={nachsehen}
            activeOpacity={0.85}
          >
            {wLaeuft ? <ActivityIndicator color="#fff" /> : <Text style={S.btnText}>{t('node.qwAnzeigen')}</Text>}
          </TouchableOpacity>
          {wErgebnis ? <WAnsicht e={wErgebnis} t={t} /> : null}
        </View>

        {binPruefer ? (
          <View style={S.card}>
            <Text style={S.title}>{t('node.qVorschlagen')}</Text>
            <Text style={S.label}>{t('node.qSatzName')}</Text>
            <TextInput style={S.input} value={satz} onChangeText={setSatz} autoCapitalize="none" autoCorrect={false} maxLength={32} placeholderTextColor={theme.muted} />
            <Text style={S.label}>{t('node.qOrdnung')}</Text>
            <TextInput style={[S.input, { minHeight: 70 }]} value={ordnung} onChangeText={(v) => setOrdnung(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad" multiline maxLength={2500} placeholderTextColor={theme.muted} />
            {ordnung ? <Text style={S.muted}>{t('node.qBits').replace('{bits}', String(ordnungBits(ordnung)))}</Text> : null}
            <Text style={S.label}>{t('node.qAbTage')}</Text>
            <TextInput style={S.input} value={tage} onChangeText={(v) => setTage(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad" maxLength={4} placeholderTextColor={theme.muted} />
            <TouchableOpacity
              style={[S.btn, (!neuOk || laeuft !== null) && { opacity: 0.5 }]}
              disabled={!neuOk || laeuft !== null}
              onPress={() => bestaetigen(satz.trim(), ordnung.trim(), neuAb)}
              activeOpacity={0.85}
            >
              <Text style={S.btnText}>{t('node.qVorschlagen')}</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

// Der Stand einer Note (W) oder eines Tokens (S), wie der Knoten ihn meldet.
function WAnsicht({ e, t }: { e: QuantenWErgebnis; t: (k: any) => string }) {
  if (!e.ok) {
    const text = e.grund === 'unbekannt' ? t('node.qwUnbekannt') : e.grund === 'eingabe' ? t('node.qwUngueltig') : t('node.qwFehler');
    return <Text style={[S.muted, { marginTop: 12 }]}>{text}</Text>;
  }
  const s = e.stand;
  return (
    <View style={{ marginTop: 12 }}>
      {!s.aktiv ? <Text style={[S.muted, { marginBottom: 8 }]}>{t('node.qwSchlafend')}</Text> : null}
      {s.art === 'tot' ? (
        <Text style={S.body}>{t('node.qwTot')}</Text>
      ) : s.art === 'w' ? (
        <>
          <Text style={S.vorschlagName}>{t('node.qwNote')}</Text>
          <Zeile k={t('node.qwWert')} v={aeqText(s.wertMikro)} />
          <Text style={S.muted}>{t('node.qwStellen').replace('{frei}', String(s.frei)).replace('{n}', String(s.n))}</Text>
          <Text style={S.muted}>
            {t('node.qwPruefung').replace('{k}', String(s.kNote)).replace('{tol}', String(s.tol)).replace('{t}', String(s.t)).replace('{v}', String(s.v))}
          </Text>
          {s.v === 1 ? <Text style={S.fehler}>{t('node.qwEinValidator')}</Text> : null}
          {s.fehl > 0 ? <Text style={S.muted}>{t('node.qwFehl').replace('{fehl}', String(s.fehl))}</Text> : null}
          {s.gesperrt ? <Text style={S.fehler}>{t('node.qwGesperrt')}</Text> : null}
          {s.anfrage ? (
            <Text style={S.stimmen}>
              {t(s.anfrage.einloesen ? 'node.qwEinloesung' : 'node.qwLaeuft').replace('{offen}', String(s.anfrage.offen)).replace('{k}', String(s.anfrage.k))}
            </Text>
          ) : null}
        </>
      ) : (
        <>
          <Text style={S.vorschlagName}>{t('node.qwToken')}</Text>
          <Zeile k={t('node.qwWert')} v={aeqText(s.wertMikro)} />
          <Zeile k={t('node.qwInhaber')} v={s.inhaber.slice(0, 10) + '…' + s.inhaber.slice(-6)} />
          {s.v !== null ? (
            <Text style={S.muted}>
              {t('node.qwGeheimnisS').replace('{v}', String(s.v)).replace('{t}', String(s.t)).replace('{tol}', String(s.tol))}
            </Text>
          ) : null}
          {s.v === 1 ? <Text style={S.fehler}>{t('node.qwEinValidator')}</Text> : null}
          <Text style={S.muted}>{s.gebunden ? t('node.qwGebunden') : t('node.qwNichtGebunden')}</Text>
          {s.fehl > 0 ? <Text style={S.muted}>{t('node.qwFehl').replace('{fehl}', String(s.fehl))}</Text> : null}
          {s.anmeldung ? (
            <Text style={S.stimmen}>
              {t('node.qwEinloesung').replace('{offen}', String(s.anmeldung.offen)).replace('{k}', String(s.anmeldung.probe))}
            </Text>
          ) : null}
        </>
      )}
    </View>
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
  body: { color: theme.text, fontSize: 13, lineHeight: 19, marginBottom: 12 },
  sub: { color: theme.muted, fontSize: 11, marginTop: 14, marginBottom: 6, fontWeight: '600' },
  muted: { color: theme.muted, fontSize: 12, lineHeight: 17 },
  hinweisKarte: { backgroundColor: goldTint, borderColor: goldTintBorder },
  hinweisText: { color: theme.gold, fontSize: 12, lineHeight: 18 },
  zeile: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: theme.border },
  key: { color: theme.muted, fontSize: 12 },
  val: { color: theme.text, fontSize: 12, fontWeight: '600', fontFamily: theme.fontMono, flexShrink: 1, textAlign: 'right' },
  vorschlag: { borderWidth: 1, borderColor: theme.border, borderRadius: theme.radiusSm, padding: 12, marginTop: 10 },
  vorschlagName: { color: theme.text, fontSize: 15, fontWeight: '700', marginBottom: 4 },
  stimmen: { color: theme.gold, fontSize: 13, fontWeight: '700', marginTop: 6 },
  btn: { marginTop: 12, backgroundColor: theme.accent, borderRadius: theme.radiusPill, padding: 14, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  label: { color: theme.muted, fontSize: 12, marginTop: 10, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: theme.border, borderRadius: theme.radiusSm, color: theme.text, padding: 10, fontFamily: theme.fontMono, fontSize: 12 },
  ok: { color: theme.neon, fontSize: 13, marginBottom: 8 },
  fehler: { color: '#ff6b6b', fontSize: 13, marginBottom: 8 },
});
