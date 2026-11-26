import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
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
import { aeqText, holeQuantenWStand, holeQuantenWUeberblick, kennungGueltig, type QuantenWErgebnis, type QuantenWUeberblick } from '@/lib/quantenW';
import { PRAEP_PFAND_MIKRO, holePraepPfandAb, holeRegister, meinStand, pfandZurueckEinreichen, praepEinreichen, type Register } from '@/lib/quantenSPraeparator';
import type { RundenBericht } from '@/lib/quantenSPraepAblauf';
import { ibmZugangDa, ibmZugangLoeschen, ibmZugangSetzen, praepRundeJetzt } from '@/lib/quantenSPraepGeraet';
import { unlockWallet } from '@/lib/wallet';
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
  // Ueberblick W/S (GET /api/quanten-w/stand); null: Knoten meldet ihn nicht.
  const [ueberblick, setUeberblick] = useState<QuantenWUeberblick | null>(null);
  // Register der Praeparatoren (Weg B); null: Knoten meldet es nicht.
  const [register, setRegister] = useState<Register | null>(null);
  // Stichtag der Pfaender (P2); null: schlafend oder nicht lesbar.
  const [pfaenderAb, setPfaenderAb] = useState<number | null>(null);

  const laden = useCallback(async () => {
    const [s, a, r, u, reg, pab] = await Promise.all([holeQuantenStand(), holeQuantenAbstimmungen(), holeRegisterStand(), holeQuantenWUeberblick(), holeRegister(), holePraepPfandAb()]);
    setStand(s);
    setUeberblick(u);
    setRegister(reg);
    setPfaenderAb(pab);
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

  async function nachsehen(k: string = kennung) {
    setWLaeuft(true);
    try {
      setWErgebnis(await holeQuantenWStand(k));
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

        {ueberblick ? (
          <View style={S.card}>
            <Text style={S.title}>{t('node.qwuTitel')}</Text>
            {!ueberblick.aktiv ? <Text style={[S.muted, { marginBottom: 8 }]}>{t('node.qwSchlafend')}</Text> : null}
            <Zeile k={t('node.qwuLebend')} v={String(ueberblick.tokenS + ueberblick.notenW)} />
            <Zeile k={t('node.qwuEingeloest')} v={String(ueberblick.eingeloest)} />
            <Zeile k={t('node.qwuTot')} v={String(ueberblick.tot)} />
            <Zeile k={t('node.qwuTopf')} v={aeqText(ueberblick.topfMikro)} last />
            <Text style={S.sub}>{t('node.qwuZuletzt')}</Text>
            {ueberblick.zuletzt.length === 0 ? (
              <Text style={S.muted}>{t('node.qwuKeine')}</Text>
            ) : (
              ueberblick.zuletzt.map((e) => (
                <TouchableOpacity
                  key={e.k}
                  onPress={() => { setKennung(e.k); nachsehen(e.k); }}
                  accessibilityRole="button"
                  activeOpacity={0.7}
                >
                  <Zeile
                    k={e.k.slice(0, 10) + '… · ' + datum(e.ende, lang)}
                    v={e.urteil === 'eingeloest' ? t('node.qwTotEingeloest') : t('node.qwTotErloschen')}
                  />
                </TouchableOpacity>
              ))
            )}
            <Text style={[S.muted, { marginTop: 8 }]}>{t('node.qwuHinweis')}</Text>
          </View>
        ) : null}

        {register ? <PraepKarte reg={register} pfaenderAb={pfaenderAb} signer={signer} t={t} lang={lang} neuLaden={laden} /> : null}

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
            onPress={() => nachsehen()}
            activeOpacity={0.85}
          >
            {wLaeuft ? <ActivityIndicator color="#fff" /> : <Text style={S.btnText}>{t('node.qwAnzeigen')}</Text>}
          </TouchableOpacity>
          {wErgebnis ? <WAnsicht e={wErgebnis} t={t} /> : null}
          <TouchableOpacity style={S.btn} onPress={() => router.push('/quanten-token')} activeOpacity={0.85} accessibilityRole="button">
            <Text style={S.btnText}>{t('node.qtOeffnen')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={S.btn} onPress={() => router.push('/quanten-ausgabe')} activeOpacity={0.85} accessibilityRole="button">
            <Text style={S.btnText}>{t('node.qaOeffnen')}</Text>
          </TouchableOpacity>
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

// Weg B (lib/quantenSPraeparator.ts): sich als Praeparatorin melden oder
// abmelden -- mit der Menschen-Wallet, erst nach ausdruecklicher Bestaetigung.
// Solange Weg B im Knoten schlaeft (aktiv = false), nur Anzeige.
function PraepKarte({ reg, pfaenderAb, signer, t, lang, neuLaden }: {
  reg: Register;
  pfaenderAb: number | null;
  signer: { address: string; signMessage(m: string): Promise<string> } | null | undefined;
  t: (k: any) => string;
  lang: string;
  neuLaden: () => Promise<void>;
}) {
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState<{ ok: boolean; text: string } | null>(null);
  const jetzt = Math.floor(Date.now() / 1000);
  // P2: ab dem Stichtag der Pfaender kostet Melden 10 AEQ Pfand (die Kette nimmt
  // es selbst; die App nennt es VORHER und laesst es bestaetigen).
  const pfaenderAktiv = pfaenderAb !== null && jetzt >= pfaenderAb;
  const mein = signer ? meinStand(reg, signer.address, jetzt, pfaenderAktiv) : null;
  const eigenerEintrag = signer ? reg.eintraege.find((e) => e.konto === signer.address.toLowerCase()) : undefined;
  const aeq = (mikro: number) => (mikro / 1_000_000).toLocaleString(lang, { maximumFractionDigits: 6 });
  const aktiv = reg.eintraege.filter((e) => e.abgemeldet === undefined).length;

  async function einreichen(art: 'melden' | 'abmelden' | 'zurueck') {
    if (!signer) return;
    setLaeuft(true);
    setMeldung(null);
    try {
      if (art === 'zurueck') await withTimeout(pfandZurueckEinreichen(signer.address), TIMEOUT_MS, t('trade.signTimeout'));
      else await withTimeout(praepEinreichen(art, signer.address, signer, Math.floor(Date.now() / 1000)), TIMEOUT_MS, t('trade.signTimeout'));
      setMeldung({ ok: true, text: t('node.qpOk') });
      await neuLaden();
    } catch (e: any) {
      setMeldung({ ok: false, text: t('node.qpFehler').replace('{meldung}', String(e?.message ?? e).slice(0, 200)) });
    } finally {
      setLaeuft(false);
    }
  }

  function bestaetigen(art: 'melden' | 'abmelden') {
    let text = t(art === 'melden' ? 'node.qpBestaetigenMelden' : 'node.qpBestaetigenAbmelden');
    if (art === 'melden' && pfaenderAktiv) text += '\n\n' + t('node.qpPfandHinweis').replace('{aeq}', aeq(PRAEP_PFAND_MIKRO));
    if (art === 'abmelden' && eigenerEintrag?.pfand) text += '\n\n' + t('node.qpPfandAbmelden');
    Alert.alert(t('node.qpBestaetigenTitel'), text, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t(art === 'melden' ? 'node.qpMelden' : 'node.qpAbmelden'), onPress: () => einreichen(art) },
    ]);
  }

  let standText = '';
  if (mein?.art === 'nicht_gemeldet') standText = t('node.qpNicht');
  else if (mein?.art === 'wartet') standText = t('node.qpWartet').replace('{datum}', datum(mein.imLosAb, lang));
  else if (mein?.art === 'im_los') standText = t('node.qpImLos');
  else if (mein?.art === 'abgemeldet') standText = t('node.qpAbgemeldet').replace('{datum}', datum(mein.neuAb, lang));
  else if (mein?.art === 'nachlegen') standText = t('node.qpNachlegen').replace('{aeq}', aeq(PRAEP_PFAND_MIKRO));
  else if (mein?.art === 'pfand_wartet') standText = t('node.qpPfandWartet').replace('{datum}', datum(mein.zurueckAb, lang));
  else if (mein?.art === 'pfand_zurueck') standText = t('node.qpPfandZurueckMoeglich').replace('{aeq}', aeq(mein.pfand));
  if (eigenerEintrag?.pfand && mein?.art !== 'pfand_zurueck') standText += ' ' + t('node.qpPfandLiegt').replace('{aeq}', aeq(eigenerEintrag.pfand));
  const kannMelden = reg.aktiv && !!signer && (mein?.art === 'nicht_gemeldet' || mein?.art === 'nachlegen');
  const kannZurueck = reg.aktiv && !!signer && mein?.art === 'pfand_zurueck';
  const kannAbmelden = reg.aktiv && !!signer && (mein?.art === 'wartet' || mein?.art === 'im_los');

  return (
    <View style={S.card}>
      <Text style={S.title}>{t('node.qpTitel')}</Text>
      <Text style={S.body}>{t('node.qpText')}</Text>
      {!reg.aktiv ? <Text style={[S.muted, { marginBottom: 8 }]}>{t('node.qpSchlafend')}</Text> : null}
      <Text style={S.stimmen}>{t('node.qpZahl').replace('{n}', String(aktiv))}</Text>
      {!signer ? <Text style={S.muted}>{t('node.qpKeineWallet')}</Text> : <Text style={[S.muted, { marginTop: 8 }]}>{standText}</Text>}
      {meldung ? <Text style={[meldung.ok ? S.ok : S.fehler, { marginTop: 8 }]}>{meldung.text}</Text> : null}
      {kannMelden || kannAbmelden ? (
        <TouchableOpacity
          style={[S.btn, laeuft && { opacity: 0.6 }]}
          disabled={laeuft}
          onPress={() => bestaetigen(kannMelden ? 'melden' : 'abmelden')}
          activeOpacity={0.85}
          accessibilityRole="button"
        >
          {laeuft ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={S.btnText}>{t(kannMelden ? (mein?.art === 'nachlegen' ? 'node.qpNachlegenBtn' : 'node.qpMelden') : 'node.qpAbmelden')}</Text>
          )}
        </TouchableOpacity>
      ) : null}
      {kannZurueck ? (
        <TouchableOpacity
          style={[S.btn, laeuft && { opacity: 0.6 }]}
          disabled={laeuft}
          onPress={() => einreichen('zurueck')}
          activeOpacity={0.85}
          accessibilityRole="button"
        >
          {laeuft ? <ActivityIndicator color="#fff" /> : <Text style={S.btnText}>{t('node.qpPfandZurueckBtn')}</Text>}
        </TouchableOpacity>
      ) : null}
      {reg.aktiv && signer && mein && mein.art !== 'nicht_gemeldet' ? <PraepRunde t={t} /> : null}
    </View>
  );
}

// Weg B (4c-3a, lib/quantenSPraepGeraet.ts): die Praeparatorin arbeitet ihren
// Briefkasten ab -- Auftraege mit dem eigenen IBM-Zugang messen und
// beantworten, Bestaetigungen, Oeffnungen. Der IBM-Zugang liegt nur im
// SecureStore dieses Geraets; die App zeigt ihn nie wieder an (nur "gespeichert").
// Auch nach dem Abmelden sichtbar: Auftraege von vorher bleiben gueltig.
function PraepRunde({ t }: { t: (k: any) => string }) {
  const [da, setDa] = useState<boolean | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [crn, setCrn] = useState('');
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState<{ ok: boolean; text: string } | null>(null);
  const [bericht, setBericht] = useState<RundenBericht | null>(null);

  useEffect(() => {
    let weg = false;
    ibmZugangDa().then((d) => { if (!weg) setDa(d); }, () => { if (!weg) setDa(false); });
    return () => { weg = true; };
  }, []);

  function fehler(e: any) {
    setMeldung({ ok: false, text: t('node.qrFehler').replace('{meldung}', String(e?.message ?? e).slice(0, 200)) });
  }

  async function speichern() {
    setLaeuft(true);
    setMeldung(null);
    try {
      await ibmZugangSetzen({ apiKey, crn });
      setApiKey('');
      setCrn('');
      setDa(true);
      setMeldung({ ok: true, text: t('node.qrGespeichert') });
    } catch (e: any) {
      fehler(e);
    } finally {
      setLaeuft(false);
    }
  }

  function loeschen() {
    Alert.alert(t('node.qpBestaetigenTitel'), t('node.qrLoeschenFrage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('node.qrLoeschen'),
        style: 'destructive',
        onPress: async () => {
          try {
            await ibmZugangLoeschen();
            setDa(false);
            setBericht(null);
          } catch (e: any) {
            fehler(e);
          }
        },
      },
    ]);
  }

  async function rundeStarten() {
    setLaeuft(true);
    setMeldung(null);
    try {
      // Bewusst ohne kurze Frist: eine Messung bei IBM wartet bis zu 2 Stunden in
      // der Schlange (FRIST_MS in quantenSPraepIbm.ts begrenzt sie).
      setBericht(await praepRundeJetzt({ entsperren: unlockWallet }));
    } catch (e: any) {
      fehler(e);
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <View style={{ marginTop: 14 }}>
      <Text style={S.sub}>{t('node.qrTitel')}</Text>
      <Text style={S.muted}>{t('node.qrText')}</Text>
      {da === null ? <ActivityIndicator color={theme.muted} style={{ marginTop: 8 }} /> : null}
      {da === false ? (
        <>
          <Text style={S.label}>{t('node.qrApiKey')}</Text>
          <TextInput style={S.input} value={apiKey} onChangeText={setApiKey} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="off" textContentType="none" importantForAutofill="no" />
          <Text style={S.label}>{t('node.qrCrn')}</Text>
          <TextInput style={S.input} value={crn} onChangeText={setCrn} autoCapitalize="none" autoCorrect={false} autoComplete="off" placeholder="crn:v1:bluemix:public:quantum-computing:…" placeholderTextColor={theme.muted} />
          <TouchableOpacity style={[S.btn, (laeuft || !apiKey || !crn) && { opacity: 0.6 }]} disabled={laeuft || !apiKey || !crn} onPress={speichern} activeOpacity={0.85} accessibilityRole="button">
            <Text style={S.btnText}>{t('node.qrSpeichern')}</Text>
          </TouchableOpacity>
        </>
      ) : null}
      {da ? (
        <>
          <Text style={[S.ok, { marginTop: 8 }]}>{t('node.qrZugangDa')}</Text>
          <TouchableOpacity style={[S.btn, laeuft && { opacity: 0.6 }]} disabled={laeuft} onPress={rundeStarten} activeOpacity={0.85} accessibilityRole="button">
            {laeuft ? <ActivityIndicator color="#fff" /> : <Text style={S.btnText}>{t('node.qrRunde')}</Text>}
          </TouchableOpacity>
          {laeuft ? <Text style={[S.muted, { marginTop: 8 }]}>{t('node.qrLaeuft')}</Text> : null}
          <TouchableOpacity onPress={loeschen} disabled={laeuft} accessibilityRole="button" style={{ marginTop: 10 }}>
            <Text style={S.muted}>{t('node.qrLoeschen')}</Text>
          </TouchableOpacity>
        </>
      ) : null}
      {meldung ? <Text style={[meldung.ok ? S.ok : S.fehler, { marginTop: 8 }]}>{meldung.text}</Text> : null}
      {bericht ? (
        <View style={{ marginTop: 8 }}>
          <Zeile k={t('node.qrBriefe')} v={String(bericht.briefe)} />
          <Zeile k={t('node.qrBeantwortet')} v={String(bericht.beantwortet.length)} />
          <Zeile k={t('node.qrBestaetigt')} v={String(bericht.bestaetigt.length)} />
          <Zeile k={t('node.qrGeoeffnet')} v={String(bericht.geoeffnet.length)} />
          <Zeile k={t('node.qrAbgelehnt')} v={String(bericht.abgelehnt.length + bericht.abgewiesen.length)} />
          <Zeile k={t('node.qrOffen')} v={String(bericht.offen)} last />
          {bericht.abgelehnt.slice(0, 5).map((a, i) => (
            <Text key={i} style={[S.muted, { marginTop: 4 }]}>{`${a.k.slice(0, 12)}…: ${a.grund.slice(0, 120)}`}</Text>
          ))}
        </View>
      ) : null}
    </View>
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
        <Text style={s.urteil === 'eingeloest' ? S.ok : S.body}>
          {s.urteil === 'eingeloest' ? t('node.qwTotEingeloest') : s.urteil === 'tot' ? t('node.qwTotErloschen') : t('node.qwTot')}
        </Text>
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
          {s.stichprobeNachBindung ? <Text style={S.muted}>{t('node.qwStichprobeV2')}</Text> : null}
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
