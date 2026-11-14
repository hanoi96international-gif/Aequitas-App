// Quantensicherer Tresor (lib/tresor.ts, Kette: pq_ueberweisung.go).
//
// Hinein geht es mit einer gewoehnlichen Ueberweisung von der Wallet; heraus
// nur mit der ML-DSA-65-Unterschrift des Tresors. Eingerichtet wird er einmal
// mit der Seed-Phrase: sie wird nur geprueft (gehoert sie zu dieser Wallet?),
// daraus der Tresor-Schluessel abgeleitet und sicher abgelegt, die Eingabe
// sofort geleert.
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { router, useFocusEffect } from 'expo-router';
import { useLanguage } from '@/contexts/LanguageContext';
import { useWallet } from '@/contexts/WalletContext';
import { theme } from '@/constants/aequitas-theme';
import { isValidAddress, parseAEQToWei } from '@/lib/format';
import { withTimeout } from '@/lib/signer';
import { ausTresorSenden, tresorAdresse, tresorEinrichten, tresorStand, type TresorStand } from '@/lib/tresor';

const TIMEOUT_MS = 120_000;

export default function Tresor() {
  const { t } = useLanguage();
  const { signer } = useWallet();
  const [adresse, setAdresse] = useState<string | null>(null);
  const [stand, setStand] = useState<TresorStand | null>(null);
  const [phrase, setPhrase] = useState('');
  const [einzahlen, setEinzahlen] = useState('');
  const [an, setAn] = useState('');
  const [betrag, setBetrag] = useState('');
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState<{ ok: boolean; text: string } | null>(null);

  const laden = useCallback(() => {
    if (!signer) return;
    tresorAdresse(signer.address).then((a) => {
      setAdresse(a);
      if (a) tresorStand(a).then(setStand);
    });
  }, [signer]);
  useFocusEffect(laden);

  const jetzt = Math.floor(Date.now() / 1000);
  const ab = stand?.ab ?? 0;
  const aktiv = ab > 0 && ab <= jetzt;

  function fehler(text: string) {
    setMeldung({ ok: false, text: t('tresor.fehler').replace('{grund}', text) });
  }

  async function einrichten() {
    if (!signer) return;
    const p = phrase;
    setPhrase('');
    setLaeuft(true);
    setMeldung(null);
    try {
      const a = await tresorEinrichten(p, signer.address);
      if (!a) setMeldung({ ok: false, text: t('tresor.phraseFalsch') });
      else laden();
    } catch (e: any) {
      fehler(e?.message ?? '');
    } finally {
      setLaeuft(false);
    }
  }

  function hineinLegen() {
    if (!signer || !adresse) return;
    const wei = parseAEQToWei(einzahlen.replace(',', '.'));
    if (wei === null || wei <= 0n) {
      setMeldung({ ok: false, text: t('wallet.enterAmount') });
      return;
    }
    Alert.alert(t('tresor.einzahlen'), t('tresor.bestaetigen').replace('{betrag}', einzahlen).replace('{an}', adresse), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('tresor.einzahlenKnopf'),
        onPress: async () => {
          setLaeuft(true);
          setMeldung(null);
          try {
            await withTimeout(signer.sendTransaction({ to: adresse, value: wei }), TIMEOUT_MS, t('trade.signTimeout'));
            setEinzahlen('');
            setMeldung({ ok: true, text: t('tresor.fertig') });
            setTimeout(laden, 3000);
          } catch (e: any) {
            fehler(e?.message ?? '');
          } finally {
            setLaeuft(false);
          }
        },
      },
    ]);
  }

  function heraus() {
    const ziel = an.trim();
    const wei = parseAEQToWei(betrag.replace(',', '.'));
    if (!isValidAddress(ziel)) {
      setMeldung({ ok: false, text: t('wallet.invalidRecipient') });
      return;
    }
    if (wei === null || wei <= 0n) {
      setMeldung({ ok: false, text: t('wallet.enterAmount') });
      return;
    }
    Alert.alert(t('tresor.senden'), t('tresor.bestaetigen').replace('{betrag}', betrag).replace('{an}', ziel), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('tresor.sendenKnopf'),
        onPress: async () => {
          setLaeuft(true);
          setMeldung(null);
          try {
            const r = await withTimeout(ausTresorSenden(ziel, wei), TIMEOUT_MS, t('trade.signTimeout'));
            if (r.ok) {
              setAn('');
              setBetrag('');
              setMeldung({ ok: true, text: t('tresor.fertig') });
              setTimeout(laden, 3000);
            } else {
              fehler(r.meldung ?? '');
            }
          } catch (e: any) {
            fehler(e?.message ?? '');
          } finally {
            setLaeuft(false);
          }
        },
      },
    ]);
  }

  const bereitZumSenden = !laeuft && (stand?.guthaben ?? 0) > 0;

  return (
    <SafeAreaView style={S.flex} edges={['top']}>
      <ScrollView contentContainerStyle={S.inhalt} keyboardShouldPersistTaps="handled">
        <TouchableOpacity onPress={() => router.back()} accessibilityRole="button">
          <Text style={S.zurueck}>‹ {t('common.cancel')}</Text>
        </TouchableOpacity>
        <Text style={S.titel}>{t('tresor.titel')}</Text>
        <Text style={S.text}>{t('tresor.warum')}</Text>

        {!adresse ? (
          <View>
            <Text style={S.hinweis}>{t('tresor.einrichtenHinweis')}</Text>
            <TextInput
              style={S.eingabe}
              value={phrase}
              onChangeText={setPhrase}
              placeholder={t('pq.phrasePlatzhalter')}
              placeholderTextColor={theme.muted}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              spellCheck={false}
              importantForAutofill="no"
              multiline
              testID="tresor-phrase"
            />
            <TouchableOpacity
              style={[S.knopf, (laeuft || !signer || phrase.trim().split(/\s+/).length < 12) && S.aus]}
              disabled={laeuft || !signer || phrase.trim().split(/\s+/).length < 12}
              onPress={einrichten}
              accessibilityRole="button"
            >
              <Text style={S.knopfText}>{t('tresor.einrichtenKnopf')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View>
            <Text style={S.label}>{t('tresor.adresse')}</Text>
            <TouchableOpacity onPress={() => Clipboard.setStringAsync(adresse)} accessibilityRole="button">
              <Text style={S.adresse} selectable>
                {adresse}
              </Text>
            </TouchableOpacity>
            <Text style={S.label}>{t('tresor.guthaben')}</Text>
            <Text style={S.guthaben}>{(stand?.guthaben ?? 0).toFixed(4)} AEQ</Text>

            {!aktiv ? (
              <Text style={S.hinweis}>
                {ab ? t('tresor.inaktiv').replace('{datum}', new Date(ab * 1000).toLocaleString()) : t('tresor.inaktiv').replace('{datum}', '—')}
              </Text>
            ) : null}

            <Text style={S.abschnitt}>{t('tresor.einzahlen')}</Text>
            <TextInput
              style={S.feld}
              value={einzahlen}
              onChangeText={setEinzahlen}
              placeholder={t('tresor.betrag')}
              placeholderTextColor={theme.muted}
              keyboardType="decimal-pad"
            />
            <TouchableOpacity style={[S.knopf, (laeuft || !signer) && S.aus]} disabled={laeuft || !signer} onPress={hineinLegen} accessibilityRole="button">
              <Text style={S.knopfText}>{t('tresor.einzahlenKnopf')}</Text>
            </TouchableOpacity>

            {aktiv ? (
              <View>
                <Text style={S.abschnitt}>{t('tresor.senden')}</Text>
                <TextInput
                  style={S.feld}
                  value={an}
                  onChangeText={setAn}
                  placeholder={t('tresor.an')}
                  placeholderTextColor={theme.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TextInput
                  style={S.feld}
                  value={betrag}
                  onChangeText={setBetrag}
                  placeholder={t('tresor.betrag')}
                  placeholderTextColor={theme.muted}
                  keyboardType="decimal-pad"
                />
                <TouchableOpacity style={[S.knopf, !bereitZumSenden && S.aus]} disabled={!bereitZumSenden} onPress={heraus} accessibilityRole="button">
                  <Text style={S.knopfText}>{t('tresor.sendenKnopf')}</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        )}

        {laeuft ? <ActivityIndicator color={theme.accent} style={S.abstand} /> : null}
        {meldung ? <Text style={meldung.ok ? S.gut : S.fehler}>{meldung.text}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const S = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.bg },
  inhalt: { padding: 20, paddingBottom: 60 },
  zurueck: { color: theme.muted, fontSize: 15, marginBottom: 12 },
  titel: { color: theme.text, fontSize: 22, fontWeight: '800', marginBottom: 10 },
  text: { color: theme.text, fontSize: 15, lineHeight: 22, marginBottom: 10 },
  hinweis: { color: theme.muted, fontSize: 14, lineHeight: 20, marginVertical: 10 },
  label: { color: theme.muted, fontSize: 13, marginTop: 12 },
  adresse: { color: theme.text, fontFamily: theme.fontMono, fontSize: 13, marginTop: 4 },
  guthaben: { color: theme.text, fontSize: 22, fontWeight: '700', marginTop: 4 },
  abschnitt: { color: theme.text, fontSize: 16, fontWeight: '700', marginTop: 22 },
  eingabe: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    padding: 12,
    minHeight: 90,
    color: theme.text,
    fontSize: 15,
    backgroundColor: theme.card,
    textAlignVertical: 'top',
  },
  feld: { borderWidth: 1, borderColor: theme.border, borderRadius: 12, padding: 12, color: theme.text, fontSize: 15, backgroundColor: theme.card, marginTop: 8 },
  knopf: { marginTop: 12, backgroundColor: theme.accent, borderRadius: theme.radiusPill, paddingVertical: 13, alignItems: 'center' },
  knopfText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  aus: { opacity: 0.45 },
  abstand: { marginTop: 14 },
  gut: { color: theme.neon, fontSize: 15, marginTop: 12, fontWeight: '600' },
  fehler: { color: theme.red, fontSize: 14, marginTop: 12 },
});
