import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
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
  neuWegB,
  standardUmgebung,
  stelleLesen,
  validatorenLesen,
  vergessen,
  zustandAnzeigen,
  type Vorlage,
} from '@/lib/quantenSInhaberin';
import type { Bestellung } from '@/lib/quantenS';
import { paketAbholen } from '@/lib/quantenSInhaberinPaket';
import { annahmeWegBStand, annehmenWegB, istWegBVorlage, oeffnungenAnfordern, oeffnungenSammeln } from '@/lib/quantenSStelleWegB';
import { annehmenAlsStelle, stelleKennung, stelleSchluesselHolen, validatorKennung, type AnnahmeErgebnis, type AnnahmeSchritt } from '@/lib/quantenSStelle';
import { adresseVon } from '@/lib/quantenS';
import { nachweisAbwarten } from '@/lib/quantenSNachweis';
import { hasStoredWallet, unlockWallet } from '@/lib/wallet';
import { QrScanner } from '@/components/QrScanner';
import { theme, goldTint, goldTintBorder } from '@/constants/aequitas-theme';

// Quantengeld S: die App als Inhaberin eines Tokens (lib/quantenSInhaberin.ts).
// Drei Schritte: bestellen (Bestellung an den Ausgeber), abholen (nur mit K,
// direkt bei den Validatoren), einloesen (Vorlage als QR fuer die Stelle).
// Dazu die App als Annahmestelle (lib/quantenSStelle.ts): eigene Kennung
// zeigen, Vorlage per QR annehmen und einloesen, der Wert geht an dieses Konto.
// Jede Pruefung steht in lib/quantenS*.ts; die Seite zeigt nur und reicht durch.
type Anzeige = Awaited<ReturnType<typeof zustandAnzeigen>>;
const QR_MAX = 2900;

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
  // R8: Basen an die Validatoren verschluesseln (dieselbe Validatorenliste wie beim Abholen).
  const [verschluesseln, setVerschluesseln] = useState(false);
  const [vorlage, setVorlage] = useState<Vorlage | null>(null);
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const [meldung, setMeldung] = useState<{ ok: boolean; text: string } | null>(null);
  const [kennung, setKennung] = useState<string | null>(null);
  const [stelleValidatoren, setStelleValidatoren] = useState('');
  const [scannen, setScannen] = useState(false);
  const [annahme, setAnnahme] = useState<AnnahmeErgebnis | null>(null);
  // Weg B (4c-3c/d): Bestellung zu K des Ausgebers; Annahme über den Briefkasten.
  const [wegB, setWegB] = useState(false);
  const [kWegB, setKWegB] = useState('');
  const [annahmeB, setAnnahmeB] = useState<{ k: string; b: 0 | 1; v: number } | null>(null);
  const [fehlenB, setFehlenB] = useState<number[] | null>(null);
  const [scanB, setScanB] = useState(false);

  const laden = useCallback(async () => {
    try {
      const z = await zustandAnzeigen(u);
      setZustand(z);
      // Eine offene Bestellung (noch kein Token) wieder zeigen, etwa nach einem Neustart.
      if (z && !z.k) setBestellung(await bestellungAnzeigen(u));
    } catch {
      setZustand(null);
    }
    try {
      setAnnahmeB(await annahmeWegBStand(u));
    } catch {
      setAnnahmeB(null);
    }
  }, [u]);
  useFocusEffect(useCallback(() => void laden(), [laden]));

  const schritt = async (name: string, f: () => Promise<void>) => {
    setLaeuft(name);
    setMeldung(null);
    try {
      await f();
    } catch (e: any) {
      const text = `${t('node.qtFehler')} ${e?.message ?? ''}`.trim();
      setMeldung({ ok: false, text });
      // Auch als Fenster: die Meldung unten auf der Seite sieht man nicht, wenn
      // man weiter oben auf einen Knopf getippt hat.
      Alert.alert(t('node.qtFehler'), e?.message ?? '');
    } finally {
      setLaeuft(null);
      void laden();
    }
  };

  const anlegen = () =>
    schritt('neu', async () => {
      const stellen: [ReturnType<typeof stelleLesen>, ReturnType<typeof stelleLesen>] = [stelleLesen(stelle0), stelleLesen(stelle1)];
      const best = wegB ? await neuWegB(u, Number(n), kWegB, stellen) : await neu(u, Number(n), Number(v), stellen, verschluesseln ? validatorenLesen(validatoren) : undefined);
      setBestellung(best);
      setVorlage(null);
      setMeldung({ ok: true, text: t('node.qtAngelegt') });
    });
  const holen = () =>
    schritt('abholen', async () => {
      await abholen(u, k, validatorenLesen(validatoren));
      setMeldung({ ok: true, text: t('node.qtAbgeholt') });
    });
  const paketHolen = () =>
    schritt('paket', async () => {
      const r = await paketAbholen(u);
      setMeldung(r.stand === 'angenommen' ? { ok: true, text: t('node.qtAbgeholt') } : { ok: false, text: t('node.qbPaketWarten').replace('{grund}', r.grund.slice(0, 200)) });
    });
  const vorlegen = (b: 0 | 1) =>
    schritt('einloesen', async () => {
      const vl = await einloesen(u, b, (s) =>
        setMeldung({ ok: true, text: t(s === 'binden' ? 'node.qtBinden' : s === 'waehlen' ? 'node.qtWaehlen' : 'node.qtVorlageFertig') }),
      );
      setVorlage(vl);
    });
  // Eingabehilfen: der Validator-Dienst des eigenen Knotens (C1) und das eigene Konto.
  const c1 = (ziel: 'stelle0' | 'validatoren' | 'stelleValidatoren') =>
    schritt('c1', async () => {
      const k = await validatorKennung(u);
      if (ziel === 'stelle0') setStelle0(k.stelle);
      else if (ziel === 'validatoren') setValidatoren(k.validator);
      else setStelleValidatoren(k.validator);
    });
  // Schluessel der Annahmestelle: die Wallet der App, sonst ein eigener des Geraets.
  const stelleSchluessel = async () => {
    const s = await stelleSchluesselHolen(u, { vorhanden: hasStoredWallet, entsperren: unlockWallet });
    if (s.quelle === 'geraet') setMeldung({ ok: true, text: t('node.qtGeraeteStelle').replace('{adresse}', adresseVon(s.schluessel)) });
    return s.schluessel;
  };
  const meinKonto = () =>
    schritt('konto', async () => {
      setStelle1(stelleKennung(await stelleSchluessel()));
    });
  const kennungZeigen = () =>
    schritt('kennung', async () => {
      setKennung(stelleKennung(await stelleSchluessel()));
    });
  const SCHRITT_TEXT: Record<AnnahmeSchritt, string> = {
    pruefen: 'node.qtAPruefen', blaetter: 'node.qtABlaetter', oeffnung: 'node.qtAOeffnung', anmelden: 'node.qtAAnmelden', urteil: 'node.qtAUrteil',
  };
  const annehmen = (text: string) => {
    setScannen(false);
    void schritt('annahme', async () => {
      setAnnahme(null);
      const schl = await stelleSchluessel();
      // Weg B: die Gelosten sind Handys -- erst die Öffnungen über den Briefkasten anfordern.
      if (scanB) {
        if (!istWegBVorlage(text)) throw new Error(t('node.qbKeineWegB'));
        const r = await oeffnungenAnfordern(u, schl, text);
        setFehlenB(null);
        setMeldung({ ok: true, text: t('node.qbAngefordert').replace('{n}', String(r.gesendet.length)) });
        return;
      }
      const erg = await annehmenAlsStelle(u, schl, text, validatorenLesen(stelleValidatoren), (s) =>
        setMeldung({ ok: true, text: t(SCHRITT_TEXT[s] as any) }),
      );
      setAnnahme(erg);
      setMeldung({
        ok: erg.urteil === 'eingeloest',
        text: t('node.qtAErgebnis').replace('{urteil}', erg.urteil ?? '?').replace('{vorab}', erg.vorab).replace('{fehler}', String(erg.fehler)).replace('{treffer}', String(erg.treffer)),
      });
    });
  };

  const sammelnB = () =>
    schritt('sammeln', async () => {
      const r = await oeffnungenSammeln(u, await stelleSchluessel());
      setFehlenB(r.fehlen);
      setMeldung({ ok: true, text: r.fehlen.length ? t('node.qbFehlen').replace('{liste}', r.fehlen.join(', ')) : t('node.qbAlleDa') });
    });
  const annehmenB = () =>
    schritt('annahme', async () => {
      setAnnahme(null);
      const erg = await annehmenWegB(u, await stelleSchluessel(), (s) => setMeldung({ ok: true, text: t(SCHRITT_TEXT[s] as any) }));
      setAnnahme(erg);
      setMeldung({
        ok: erg.urteil === 'eingeloest',
        text: t('node.qtAErgebnis').replace('{urteil}', erg.urteil ?? '?').replace('{vorab}', erg.vorab).replace('{fehler}', String(erg.fehler)).replace('{treffer}', String(erg.treffer)),
      });
    });

  const nachweisPruefen = () =>
    schritt('nachweis', async () => {
      if (!annahme) return;
      setMeldung({ ok: true, text: t('node.qtNachweisWarten') });
      const ber = await nachweisAbwarten(u, annahme.k, validatorenLesen(stelleValidatoren), annahme.wurzel, annahme.proben, 20 * 60_000);
      setMeldung({
        ok: true,
        text: t('node.qtNachweisOk').replace('{n}', String(ber.n)).replace('{fehler}', String(ber.fehler)).replace('{treffer}', String(ber.treffer))
          .replace('{fs}', String(ber.fehler_stelle)).replace('{ts}', String(ber.treffer_stelle)),
      });
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
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
              <Text style={[S.label, { flex: 1, marginTop: 0 }]}>{t('node.qbWegB')}</Text>
              <Switch value={wegB} onValueChange={(an) => { setWegB(an); setN(an ? '2822' : '1104'); }} disabled={beschaeftigt} accessibilityLabel={t('node.qbWegB')} />
            </View>
            {wegB ? (
              <>
                <Text style={S.muted}>{t('node.qbWegBText')}</Text>
                <Text style={S.label}>{t('node.qbK')}</Text>
                <TextInput style={S.input} value={kWegB} onChangeText={(x) => setKWegB(x.replace(/[^0-9a-fA-F]/g, '').slice(0, 64).toLowerCase())} autoCapitalize="none" autoCorrect={false} maxLength={64} placeholder="K" placeholderTextColor={theme.muted} />
              </>
            ) : null}
            <Text style={S.label}>n</Text>
            <TextInput style={S.input} value={n} onChangeText={(x) => setN(x.replace(/[^0-9]/g, ''))} keyboardType="number-pad" maxLength={5} />
            {!wegB ? (
              <>
                <Text style={S.label}>v</Text>
                <TextInput style={S.input} value={v} onChangeText={(x) => setV(x.replace(/[^0-9]/g, ''))} keyboardType="number-pad" maxLength={2} />
              </>
            ) : null}
            <Text style={S.label}>{t('node.qtStelle').replace('{b}', '0')}</Text>
            <TextInput style={S.input} value={stelle0} onChangeText={setStelle0} autoCapitalize="none" autoCorrect={false} multiline placeholder="0x…=04…" placeholderTextColor={theme.muted} />
            <TouchableOpacity style={S.btnZweit} onPress={() => c1('stelle0')} disabled={beschaeftigt} accessibilityRole="button">
              <Text style={S.btnZweitText}>{t('node.qtC1')}</Text>
            </TouchableOpacity>
            <Text style={S.label}>{t('node.qtStelle').replace('{b}', '1')}</Text>
            <TextInput style={S.input} value={stelle1} onChangeText={setStelle1} autoCapitalize="none" autoCorrect={false} multiline placeholder="0x…=04…" placeholderTextColor={theme.muted} />
            <TouchableOpacity style={S.btnZweit} onPress={meinKonto} disabled={beschaeftigt} accessibilityRole="button">
              <Text style={S.btnZweitText}>{t('node.qtMeinKonto')}</Text>
            </TouchableOpacity>
            <View style={[{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 }, wegB && { display: 'none' }]}>
              <Text style={[S.label, { flex: 1, marginTop: 0 }]}>{t('node.qtVerschluesseln')}</Text>
              <Switch value={verschluesseln} onValueChange={setVerschluesseln} disabled={beschaeftigt} accessibilityLabel={t('node.qtVerschluesseln')} />
            </View>
            {verschluesseln && !wegB ? (
              <>
                <Text style={S.muted}>{t('node.qtVerschluesselnText')}</Text>
                <TextInput style={[S.input, { minHeight: 60 }]} value={validatoren} onChangeText={setValidatoren} autoCapitalize="none" autoCorrect={false} multiline placeholder="0x…=https://…/api" placeholderTextColor={theme.muted} />
                <TouchableOpacity style={S.btnZweit} onPress={() => c1('validatoren')} disabled={beschaeftigt} accessibilityRole="button">
                  <Text style={S.btnZweitText}>{t('node.qtC1')}</Text>
                </TouchableOpacity>
              </>
            ) : null}
            <TouchableOpacity style={[S.btn, (beschaeftigt || (wegB && kWegB.length !== 64)) && { opacity: 0.5 }]} disabled={beschaeftigt || (wegB && kWegB.length !== 64)} onPress={anlegen} activeOpacity={0.85}>
              {laeuft === 'neu' ? <ActivityIndicator color="#fff" /> : <Text style={S.btnText}>{t('node.qtAnlegen')}</Text>}
            </TouchableOpacity>
          </View>
        ) : null}

        {zustand && !zustand.k && bestellung ? (
          <View style={S.card}>
            <Text style={S.title}>{t('node.qtSchritt1')}</Text>
            <Text style={S.muted}>{t('node.qtBestellungHinweis')}</Text>
            {/* Ein QR-Code faesst bei Stufe L hoechstens 2.953 Byte; verschluesselte
                Bestellungen sind groesser -- dann nur kopieren. */}
            {bestellungText.length <= QR_MAX ? (
              <View style={[S.qr, { alignSelf: 'center', marginTop: 12 }]}>
                <QRCode value={bestellungText} size={260} backgroundColor="#ffffff" color="#000000" ecl="L" />
              </View>
            ) : (
              <Text style={[S.muted, { marginTop: 12 }]}>{t('node.qtZuGrossFuerQr')}</Text>
            )}
            <TouchableOpacity style={S.btnZweit} onPress={() => Clipboard.setStringAsync(bestellungText)} accessibilityRole="button">
              <Text style={S.btnZweitText}>{t('node.qtKopieren')}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {zustand && !zustand.k && zustand.wegB ? (
          <View style={S.card}>
            <Text style={S.title}>{t('node.qtSchritt2')}</Text>
            <Text style={S.body}>{t('node.qbPaketText')}</Text>
            <TouchableOpacity style={[S.btn, beschaeftigt && { opacity: 0.5 }]} disabled={beschaeftigt} onPress={paketHolen} activeOpacity={0.85} accessibilityRole="button">
              {laeuft === 'paket' ? <ActivityIndicator color="#fff" /> : <Text style={S.btnText}>{t('node.qbPaketAbholen')}</Text>}
            </TouchableOpacity>
          </View>
        ) : null}

        {zustand && !zustand.k && !zustand.wegB ? (
          <View style={S.card}>
            <Text style={S.title}>{t('node.qtSchritt2')}</Text>
            <Text style={S.body}>{t('node.qtAbholenText')}</Text>
            <Text style={S.label}>K</Text>
            <TextInput style={S.input} value={k} onChangeText={(x) => setK(x.replace(/[^0-9a-fA-F]/g, '').slice(0, 64))} autoCapitalize="none" autoCorrect={false} maxLength={64} placeholder="K" placeholderTextColor={theme.muted} />
            <Text style={S.label}>{t('node.qtValidatoren')}</Text>
            <TextInput style={[S.input, { minHeight: 60 }]} value={validatoren} onChangeText={setValidatoren} autoCapitalize="none" autoCorrect={false} multiline placeholder="0x…=https://…/api" placeholderTextColor={theme.muted} />
            <TouchableOpacity style={S.btnZweit} onPress={() => c1('validatoren')} disabled={beschaeftigt} accessibilityRole="button">
              <Text style={S.btnZweitText}>{t('node.qtC1')}</Text>
            </TouchableOpacity>
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

        <View style={S.card}>
          <Text style={S.title}>{t('node.qtAnnahmeTitel')}</Text>
          <Text style={S.body}>{t('node.qtAnnahmeText')}</Text>
          {kennung ? (
            <View style={{ alignItems: 'center' }}>
              <View style={S.qr}>
                <QRCode value={kennung} size={220} backgroundColor="#ffffff" color="#000000" ecl="M" />
              </View>
              <Text style={[S.muted, { marginTop: 10 }]}>{t('node.qtKennungHinweis')}</Text>
              <TouchableOpacity style={S.btnZweit} onPress={() => Clipboard.setStringAsync(kennung)} accessibilityRole="button">
                <Text style={S.btnZweitText}>{t('node.qtKopieren')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={S.btnZweit} onPress={kennungZeigen} disabled={beschaeftigt} accessibilityRole="button">
              <Text style={S.btnZweitText}>{t('node.qtKennung')}</Text>
            </TouchableOpacity>
          )}
          <Text style={S.label}>{t('node.qtValidatoren')}</Text>
          <TextInput style={[S.input, { minHeight: 60 }]} value={stelleValidatoren} onChangeText={setStelleValidatoren} autoCapitalize="none" autoCorrect={false} multiline placeholder="0x…=https://…/api" placeholderTextColor={theme.muted} />
          <TouchableOpacity style={S.btnZweit} onPress={() => c1('stelleValidatoren')} disabled={beschaeftigt} accessibilityRole="button">
            <Text style={S.btnZweitText}>{t('node.qtC1')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[S.btn, (beschaeftigt || !stelleValidatoren.trim()) && { opacity: 0.5 }]}
            disabled={beschaeftigt || !stelleValidatoren.trim()}
            onPress={() => { setScanB(false); setScannen(true); }}
            activeOpacity={0.85}
          >
            {laeuft === 'annahme' ? <ActivityIndicator color="#fff" /> : <Text style={S.btnText}>{t('node.qtScannen')}</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={S.btnZweit} onPress={() => { setScanB(true); setScannen(true); }} disabled={beschaeftigt} accessibilityRole="button">
            <Text style={S.btnZweitText}>{t('node.qbScannen')}</Text>
          </TouchableOpacity>
          {annahme ? <Text style={[S.muted, { marginTop: 10 }]}>K {annahme.k.slice(0, 12)}… · {annahme.stichprobe}</Text> : null}
          {annahme?.urteil === 'eingeloest' ? (
            <TouchableOpacity style={S.btnZweit} onPress={nachweisPruefen} disabled={beschaeftigt} accessibilityRole="button">
              {laeuft === 'nachweis' ? <ActivityIndicator color={theme.text} /> : <Text style={S.btnZweitText}>{t('node.qtNachweis')}</Text>}
            </TouchableOpacity>
          ) : null}
          {annahmeB ? (
            <View style={{ marginTop: 16 }}>
              <Text style={S.label}>{t('node.qbAnnahmeTitel').replace('{k}', annahmeB.k.slice(0, 12) + '…').replace('{b}', String(annahmeB.b))}</Text>
              <Text style={S.muted}>{t('node.qbAnnahmeText')}</Text>
              {fehlenB && fehlenB.length ? <Text style={[S.muted, { marginTop: 6 }]}>{t('node.qbFehlen').replace('{liste}', fehlenB.join(', '))}</Text> : null}
              <TouchableOpacity style={S.btnZweit} onPress={sammelnB} disabled={beschaeftigt} accessibilityRole="button">
                {laeuft === 'sammeln' ? <ActivityIndicator color={theme.text} /> : <Text style={S.btnZweitText}>{t('node.qbSammeln')}</Text>}
              </TouchableOpacity>
              <TouchableOpacity
                style={[S.btn, (beschaeftigt || fehlenB === null) && { opacity: 0.5 }]}
                disabled={beschaeftigt || fehlenB === null}
                onPress={annehmenB}
                activeOpacity={0.85}
                accessibilityRole="button"
              >
                {laeuft === 'annahme' ? <ActivityIndicator color="#fff" /> : <Text style={S.btnText}>{t('node.qbAnnehmen')}</Text>}
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
        <QrScanner visible={scannen} onScanned={annehmen} onClose={() => setScannen(false)} />

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
