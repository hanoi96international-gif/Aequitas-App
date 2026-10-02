import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Share, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import QRCode from 'react-native-qrcode-svg';
import { router } from 'expo-router';
import { ethers } from 'ethers';
import { useLanguage } from '@/contexts/LanguageContext';
import { useWallet } from '@/contexts/WalletContext';
import { theme } from '@/constants/aequitas-theme';
import { getVerlauf, getWirtschaftKonto, postUnternehmen } from '@/lib/api';
import { withTimeout } from '@/lib/signer';
import {
  ausPhrase,
  auszahlen,
  csv,
  eroeffnenNachricht,
  KATEGORIEN,
  liste,
  neuerSchluessel,
  normName,
  normText,
  normWebseite,
  speichern,
  tagesliste,
  verzeichnisNachricht,
  zahlungEingegangen,
  zahlungslink,
  type GespeichertesUnternehmen,
  type KassenEintrag,
} from '@/lib/unternehmen';

// Mein Unternehmen: anmelden, kassieren, auszahlen, ins Verzeichnis eintragen
// (aequitas-chain docs/UNTERNEHMEN_KONZEPT.md 10.2). Der Unternehmens-
// schluessel entsteht hier auf dem Geraet; der Mensch unterschreibt mit seiner
// Wallet, dass er verantwortlich ist.

const SIGN_TIMEOUT_MS = 60_000;
const WARTEN_MS = 5 * 60_000;

function jetzt(): number {
  return Math.floor(Date.now() / 1000);
}

function alsKasse(e: { zeit: number; betrag: number; gegenpartei?: string; tx_hash?: string; richtung: string }): KassenEintrag {
  return {
    zeit: e.zeit,
    betrag: e.betrag,
    gegenkonto: e.gegenpartei ?? '',
    tx: e.tx_hash ?? '',
    richtung: e.richtung === 'ein' || e.richtung === 'aus' ? e.richtung : 'neutral',
  };
}

export default function Unternehmen() {
  const { t } = useLanguage();
  const { address, signer } = useWallet();
  const [firmen, setFirmen] = useState<GespeichertesUnternehmen[] | null>(null);
  const [fehler, setFehler] = useState('');
  const [laeuft, setLaeuft] = useState(false);

  const neuLaden = useCallback(async () => setFirmen(await liste()), []);
  useEffect(() => {
    neuLaden();
  }, [neuLaden]);

  const firma = firmen?.[0] ?? null;

  return (
    <SafeAreaView style={S.safe}>
      <ScrollView contentContainerStyle={S.content} keyboardShouldPersistTaps="handled">
        <Text style={S.h1}>{t('firma.title')}</Text>
        {firmen === null ? (
          <ActivityIndicator color={theme.accent} />
        ) : !firma ? (
          <Anmelden
            mensch={address}
            signer={signer}
            laeuft={laeuft}
            setLaeuft={setLaeuft}
            setFehler={setFehler}
            fertig={neuLaden}
          />
        ) : (
          <>
            <Kopf firma={firma} />
            <Kasse firma={firma} setFehler={setFehler} />
            <Auszahlen firma={firma} setFehler={setFehler} />
            <VerzeichnisEintragen firma={firma} mensch={address} signer={signer} setFehler={setFehler} />
          </>
        )}
        {fehler ? <Text style={S.fehler}>{fehler}</Text> : null}
        <TouchableOpacity style={S.btnGhost} onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/wallet'))}>
          <Text style={S.btnGhostText}>{t('common.cancel')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );

}

// ------------------------------------------------------------ Teile

function Kopf({ firma }: { firma: GespeichertesUnternehmen }) {
  const { t } = useLanguage();
  const [konto, setKonto] = useState<any>(null);
  useEffect(() => {
    getWirtschaftKonto(firma.adresse).then(setKonto).catch(() => setKonto(null));
  }, [firma.adresse]);
  return (
    <View style={S.card}>
      <Text style={S.title}>{firma.name}</Text>
      <Text style={S.mono}>{firma.adresse}</Text>
      {konto ? (
        <>
          <Text style={S.body}>
            {t('firma.guthaben')}: {Number(konto.guthaben ?? 0).toFixed(2)} AEQ
          </Text>
          {konto.art !== 'unternehmen' ? <Text style={S.warnung}>{t('firma.nichtAktiv')}</Text> : null}
          {typeof konto.abgabe_pro_monat_bei_diesem_stand === 'number' ? (
            <Text style={S.klein}>
              {t('firma.liegegeld').replace('{betrag}', konto.abgabe_pro_monat_bei_diesem_stand.toFixed(2))}
            </Text>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

function Kasse({ firma, setFehler }: { firma: GespeichertesUnternehmen; setFehler: (s: string) => void }) {
  const { t } = useLanguage();
  const [betrag, setBetrag] = useState('');
  const [link, setLink] = useState<string | null>(null);
  const [bezahlt, setBezahlt] = useState<{ betrag: number; art: string } | null>(null);
  const [heute, setHeute] = useState<KassenEintrag[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const tag = new Date().toISOString().slice(0, 10);
  const ladeHeute = useCallback(async () => {
    try {
      const v = await getVerlauf(firma.adresse, 0, 200);
      const l = (v?.eintraege ?? []).map(alsKasse);
      setHeute(tagesliste(l, tag));
      return l;
    } catch {
      return [];
    }
  }, [firma.adresse, tag]);

  useEffect(() => {
    ladeHeute();
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [ladeHeute]);

  function anzeigen() {
    setFehler('');
    setBezahlt(null);
    let l: string;
    try {
      l = zahlungslink(firma.adresse, betrag.replace(',', '.'));
    } catch {
      setFehler(t('firma.betragUngueltig'));
      return;
    }
    setLink(l);
    const soll = Number(betrag.replace(',', '.'));
    const seit = jetzt() - 5;
    const start = Date.now();
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(async () => {
      if (Date.now() - start > WARTEN_MS) {
        if (timer.current) clearInterval(timer.current);
        return;
      }
      const e = zahlungEingegangen(await ladeHeute(), soll, seit);
      if (e) {
        if (timer.current) clearInterval(timer.current);
        let art = 'frei';
        try {
          art = (await getWirtschaftKonto(e.gegenkonto)).art ?? 'frei';
        } catch {
          /* unbekannt bleibt frei */
        }
        setBezahlt({ betrag: e.betrag, art });
        setLink(null);
      }
    }, 3000);
  }

  return (
    <View style={S.card}>
      <Text style={S.title}>{t('firma.kasse')}</Text>
      <TextInput
        style={S.input}
        value={betrag}
        onChangeText={(v) => setBetrag(v.replace(/[^0-9.,]/g, ''))}
        placeholder={t('firma.betrag')}
        placeholderTextColor={theme.muted}
        keyboardType="decimal-pad"
      />
      <TouchableOpacity style={S.btn} onPress={anzeigen} activeOpacity={0.85}>
        <Text style={S.btnText}>{t('firma.zahlungAnzeigen')}</Text>
      </TouchableOpacity>
      {link ? (
        <View style={S.qr}>
          <QRCode value={link} size={200} backgroundColor={theme.card} color={theme.text} />
          <Text style={S.klein}>{t('firma.wartet')}</Text>
        </View>
      ) : null}
      {bezahlt ? (
        <Text style={S.ok}>
          {t('firma.bezahlt')
            .replace('{betrag}', bezahlt.betrag.toFixed(2))
            .replace('{art}', t(bezahlt.art === 'mensch' ? 'firma.artMensch' : bezahlt.art === 'unternehmen' ? 'firma.artUnternehmen' : 'firma.artFrei'))}
        </Text>
      ) : null}
      <Text style={S.sub}>{t('firma.heute')}</Text>
      {heute.filter((e) => e.richtung !== 'neutral').length === 0 ? (
        <Text style={S.klein}>{t('firma.keineEingaenge')}</Text>
      ) : (
        heute
          .filter((e) => e.richtung !== 'neutral')
          .slice(0, 50)
          .map((e) => (
            <View key={e.tx + e.richtung} style={S.zeile}>
              <Text style={S.klein}>{new Date(e.zeit * 1000).toLocaleTimeString()}</Text>
              <Text style={e.richtung === 'ein' ? S.ein : S.aus}>
                {e.richtung === 'ein' ? '+' : '−'}
                {e.betrag.toFixed(2)}
              </Text>
            </View>
          ))
      )}
      <TouchableOpacity style={S.btnGhost} onPress={() => Share.share({ message: csv(heute), title: 'aequitas-' + tag + '.csv' })}>
        <Text style={S.btnGhostText}>{t('firma.csvTeilen')}</Text>
      </TouchableOpacity>
    </View>
  );
}

function Auszahlen({ firma, setFehler }: { firma: GespeichertesUnternehmen; setFehler: (s: string) => void }) {
  const { t } = useLanguage();
  const [an, setAn] = useState('');
  const [betrag, setBetrag] = useState('');
  const [ok, setOk] = useState('');
  const [sendet, setSendet] = useState(false);
  async function senden() {
    setFehler('');
    setOk('');
    setSendet(true);
    try {
      await auszahlen(firma.adresse, an.trim(), betrag.replace(',', '.'));
      setOk(t('firma.auszahlenOk'));
      setBetrag('');
    } catch (e: any) {
      setFehler(t('firma.fehler').replace('{meldung}', String(e?.shortMessage ?? e?.message ?? e).slice(0, 200)));
    } finally {
      setSendet(false);
    }
  }
  return (
    <View style={S.card}>
      <Text style={S.title}>{t('firma.auszahlen')}</Text>
      <TextInput style={S.input} value={an} onChangeText={setAn} placeholder={t('firma.empfaenger')} placeholderTextColor={theme.muted} autoCapitalize="none" autoCorrect={false} />
      <TextInput style={S.input} value={betrag} onChangeText={(v) => setBetrag(v.replace(/[^0-9.,]/g, ''))} placeholder={t('firma.betrag')} placeholderTextColor={theme.muted} keyboardType="decimal-pad" />
      <TouchableOpacity style={[S.btn, sendet && { opacity: 0.6 }]} onPress={senden} disabled={sendet || !ethers.isAddress(an.trim()) || !betrag}>
        {sendet ? <ActivityIndicator color="#fff" /> : <Text style={S.btnText}>{t('firma.auszahlenBtn')}</Text>}
      </TouchableOpacity>
      {ok ? <Text style={S.ok}>{ok}</Text> : null}
    </View>
  );
}

function VerzeichnisEintragen({ firma, mensch, signer, setFehler }: {
  firma: GespeichertesUnternehmen;
  mensch: string | null;
  signer: any;
  setFehler: (s: string) => void;
}) {
  const { t } = useLanguage();
  const [ort, setOrt] = useState('');
  const [annahme, setAnnahme] = useState('');
  const [webseite, setWebseite] = useState('');
  const [ok, setOk] = useState('');
  const [sendet, setSendet] = useState(false);
  async function speichernEintrag() {
    setFehler('');
    setOk('');
    if (!mensch || !signer) return;
    const web = normWebseite(webseite);
    if (web === null) {
      setFehler(t('firma.webseiteHinweis'));
      return;
    }
    setSendet(true);
    try {
      const zeit = jetzt();
      const o = normText(ort, 60);
      const a = normText(annahme, 80);
      const m = mensch.toLowerCase();
      const sig = await withTimeout(
        signer.signMessage(verzeichnisNachricht(firma.adresse, m, o, a, web, zeit)),
        SIGN_TIMEOUT_MS,
        t('trade.signTimeout'),
      );
      const r = await postUnternehmen('verzeichnis', {
        unternehmen: firma.adresse, verantwortlich: m, ort: o, annahme: a, webseite: web, zeit, sig,
      });
      if (r.ok) setOk(t('firma.gespeichert'));
      else setFehler(t('firma.fehler').replace('{meldung}', r.fehler ?? ''));
    } catch (e: any) {
      setFehler(t('firma.fehler').replace('{meldung}', String(e?.message ?? e).slice(0, 200)));
    } finally {
      setSendet(false);
    }
  }
  return (
    <View style={S.card}>
      <Text style={S.title}>{t('firma.verzeichnisTitel')}</Text>
      <Text style={S.body}>{t('firma.verzeichnisIntro')}</Text>
      <TextInput style={S.input} value={ort} onChangeText={setOrt} placeholder={t('firma.ort')} placeholderTextColor={theme.muted} maxLength={60} />
      <TextInput style={S.input} value={annahme} onChangeText={setAnnahme} placeholder={t('firma.annahmeBeispiel')} placeholderTextColor={theme.muted} maxLength={80} />
      <TextInput style={S.input} value={webseite} onChangeText={setWebseite} placeholder="https://…" placeholderTextColor={theme.muted} autoCapitalize="none" autoCorrect={false} />
      <Text style={S.klein}>{t('firma.webseiteNachweis').replace('{adresse}', firma.adresse)}</Text>
      <TouchableOpacity style={[S.btn, sendet && { opacity: 0.6 }]} onPress={speichernEintrag} disabled={sendet || !signer}>
        {sendet ? <ActivityIndicator color="#fff" /> : <Text style={S.btnText}>{t('firma.speichern')}</Text>}
      </TouchableOpacity>
      {ok ? <Text style={S.ok}>{ok}</Text> : null}
    </View>
  );
}

// ------------------------------------------------------------ Anmelden

function Anmelden(props: {
  mensch: string | null;
  signer: any;
  laeuft: boolean;
  setLaeuft: (b: boolean) => void;
  setFehler: (s: string) => void;
  fertig: () => void;
}) {
  const { t } = useLanguage();
  const { mensch, signer, laeuft, setLaeuft, setFehler, fertig } = props;
  const [name, setName] = useState('');
  const [kategorie, setKategorie] = useState<string>('handel');
  const [neu, setNeu] = useState<ReturnType<typeof neuerSchluessel> | null>(null);
  const [aufgeschrieben, setAufgeschrieben] = useState(false);
  const [phrase, setPhrase] = useState('');

  async function eroeffnen() {
    if (!neu || !mensch || !signer) return;
    setFehler('');
    setLaeuft(true);
    try {
      const zeit = jetzt();
      const n = normName(name);
      const m = mensch.toLowerCase();
      const msg = eroeffnenNachricht(neu.adresse, m, n, kategorie, zeit);
      const sigU = await neu.wallet.signMessage(msg);
      const sigM = await withTimeout(signer.signMessage(msg), SIGN_TIMEOUT_MS, t('trade.signTimeout'));
      const r = await postUnternehmen('eroeffnen', {
        unternehmen: neu.adresse, mensch: m, name: n, kategorie, zeit, sig_unternehmen: sigU, sig_mensch: sigM,
      });
      if (!r.ok) {
        setFehler(t('firma.fehler').replace('{meldung}', r.fehler ?? ''));
        return;
      }
      await speichern(neu.wallet, n);
      fertig();
    } catch (e: any) {
      setFehler(t('firma.fehler').replace('{meldung}', String(e?.message ?? e).slice(0, 200)));
    } finally {
      setLaeuft(false);
    }
  }

  async function wiederherstellen() {
    setFehler('');
    try {
      const w = ausPhrase(phrase);
      const konto = await getWirtschaftKonto(w.address.toLowerCase());
      if (konto?.art !== 'unternehmen') {
        setFehler(t('firma.keinUnternehmen'));
        return;
      }
      await speichern(w, String((konto as any).name ?? ''));
      fertig();
    } catch {
      setFehler(t('firma.phraseFalsch'));
    }
  }

  return (
    <>
      <View style={S.card}>
        <Text style={S.title}>{t('firma.anmeldenTitel')}</Text>
        <Text style={S.body}>{t('firma.intro')}</Text>
        {!neu ? (
          <>
            <TextInput style={S.input} value={name} onChangeText={setName} placeholder={t('firma.name')} placeholderTextColor={theme.muted} maxLength={60} />
            <Text style={S.sub}>{t('firma.kategorie')}</Text>
            <View style={S.chips}>
              {KATEGORIEN.map((k) => (
                <TouchableOpacity key={k} style={[S.chip, k === kategorie && S.chipAn]} onPress={() => setKategorie(k)}>
                  <Text style={S.chipText}>{k}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={S.btn} onPress={() => setNeu(neuerSchluessel())} disabled={!normName(name)}>
              <Text style={S.btnText}>{t('firma.weiter')}</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={S.sub}>{t('firma.phraseTitel')}</Text>
            <Text style={S.phrase} selectable>
              {neu.phrase}
            </Text>
            <Text style={S.warnung}>{t('firma.phraseHinweis')}</Text>
            <TouchableOpacity style={S.checkRow} onPress={() => setAufgeschrieben((v) => !v)}>
              <View style={[S.checkbox, aufgeschrieben && S.checkboxAn]}>{aufgeschrieben ? <Text style={S.btnText}>✓</Text> : null}</View>
              <Text style={S.body}>{t('firma.phraseBestaetigt')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[S.btn, (!aufgeschrieben || laeuft) && { opacity: 0.5 }]} onPress={eroeffnen} disabled={!aufgeschrieben || laeuft || !signer}>
              {laeuft ? <ActivityIndicator color="#fff" /> : <Text style={S.btnText}>{t('firma.eroeffnenBtn')}</Text>}
            </TouchableOpacity>
          </>
        )}
      </View>
      <View style={S.card}>
        <Text style={S.title}>{t('firma.wiederherstellen')}</Text>
        <TextInput style={[S.input, { minHeight: 70 }]} value={phrase} onChangeText={setPhrase} placeholder={t('firma.phraseEingeben')} placeholderTextColor={theme.muted} autoCapitalize="none" autoCorrect={false} multiline />
        <TouchableOpacity style={S.btnGhost} onPress={wiederherstellen} disabled={!phrase.trim()}>
          <Text style={S.btnGhostText}>{t('firma.wiederherstellenBtn')}</Text>
        </TouchableOpacity>
      </View>
    </>
  );
}

const S = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 20, gap: 14 },
  h1: { color: theme.text, fontSize: 22, fontWeight: '800' },
  card: { backgroundColor: theme.card, borderRadius: theme.radius, padding: 18, borderWidth: 1, borderColor: theme.border },
  title: { color: theme.text, fontSize: 17, fontWeight: '800', marginBottom: 8 },
  sub: { color: theme.text, fontSize: 13, fontWeight: '700', marginTop: 12, marginBottom: 6 },
  body: { color: theme.muted, fontSize: 13, lineHeight: 19, marginBottom: 8, flexShrink: 1 },
  klein: { color: theme.muted, fontSize: 11.5, lineHeight: 16, marginTop: 6 },
  mono: { color: theme.muted, fontSize: 11, fontFamily: theme.fontMono, marginBottom: 8 },
  phrase: { color: theme.text, fontSize: 15, fontFamily: theme.fontMono, lineHeight: 24, backgroundColor: theme.bg, borderRadius: 8, padding: 12 },
  warnung: { color: theme.gold, fontSize: 12, lineHeight: 18, marginTop: 10 },
  ok: { color: theme.neon, fontSize: 13, lineHeight: 19, marginTop: 10 },
  fehler: { color: '#ff6b6b', fontSize: 13, lineHeight: 19 },
  input: {
    color: theme.text, backgroundColor: theme.bg, borderRadius: 8, borderWidth: 1, borderColor: theme.border,
    paddingHorizontal: 12, paddingVertical: 10, marginTop: 8, fontSize: 14,
  },
  btn: { marginTop: 12, backgroundColor: theme.accent, borderRadius: theme.radiusPill, padding: 14, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  btnGhost: { marginTop: 12, borderWidth: 1, borderColor: theme.border, borderRadius: theme.radiusPill, padding: 12, alignItems: 'center' },
  btnGhostText: { color: theme.text, fontSize: 14, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1, borderColor: theme.border, borderRadius: theme.radiusPill, paddingHorizontal: 10, paddingVertical: 5 },
  chipAn: { backgroundColor: theme.accent, borderColor: theme.accent },
  chipText: { color: theme.text, fontSize: 12 },
  qr: { alignItems: 'center', marginTop: 14 },
  zeile: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: theme.border },
  ein: { color: theme.neon, fontSize: 13, fontWeight: '700' },
  aus: { color: theme.text, fontSize: 13 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' },
  checkboxAn: { backgroundColor: theme.accent, borderColor: theme.accent },
});
