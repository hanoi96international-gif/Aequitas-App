// Wiederherstellungscode erzeugen und (nur seinen Hash) auf der Kette
// hinterlegen (lib/umzug.ts).
//
// Der Code wird EINMAL gezeigt und nirgends gespeichert -- nicht in der App,
// nicht beim Coordinator, nicht per E-Mail. Darum steht die Warnung vor dem
// Erzeugen, und hinterlegt wird erst, wenn der Mensch den Code noch einmal
// richtig eingegeben hat (also abgeschrieben hat). Verlaesst er den
// Bildschirm vorher, ist der Code weg und nichts hinterlegt.
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { useLanguage } from '@/contexts/LanguageContext';
import { useWallet } from '@/contexts/WalletContext';
import { theme } from '@/constants/aequitas-theme';
import { withTimeout } from '@/lib/signer';
import { codeAnzeige, codeErzeugen, codeHinterlegen, codeNormal, codeSchonDa, umzugStand } from '@/lib/umzug';

const TIMEOUT_MS = 120_000;

export default function Wiederherstellungscode() {
  const { t } = useLanguage();
  const { signer } = useWallet();
  const [codeSeit, setCodeSeit] = useState(0);
  const [gueltigAb, setGueltigAb] = useState(0);
  const [aktivAb, setAktivAb] = useState(0);
  const [code, setCode] = useState<string | null>(null);
  const [eingabe, setEingabe] = useState('');
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState<{ ok: boolean; text: string } | null>(null);
  const [fertig, setFertig] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!signer) return;
      umzugStand(signer.address).then((s) => {
        setCodeSeit(s?.codeSeit ?? 0);
        setGueltigAb(s?.codeGueltigAb ?? 0);
        setAktivAb(s?.aktivAb ?? 0);
      });
    }, [signer]),
  );

  const inaktiv = aktivAb > Math.floor(Date.now() / 1000);
  const passt = !!code && codeNormal(eingabe) === code;

  async function hinterlegen() {
    if (!signer || !code || !passt) return;
    setLaeuft(true);
    setMeldung(null);
    try {
      const r = await withTimeout(codeHinterlegen(signer, code), TIMEOUT_MS, t('trade.signTimeout'));
      if (r.ok) {
        setMeldung({ ok: true, text: t('umzug.codeFertig') });
        setFertig(true);
        setCode(null);
        setEingabe('');
      } else if (codeSchonDa(r.meldung)) {
        setMeldung({ ok: false, text: t('umzug.codeEinmal') });
        setCode(null);
        setEingabe('');
      } else {
        setMeldung({ ok: false, text: t('umzug.codeFehler').replace('{grund}', r.meldung ?? '') });
      }
    } catch (e: any) {
      setMeldung({ ok: false, text: t('umzug.codeFehler').replace('{grund}', e?.message ?? '') });
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <SafeAreaView style={S.flex} edges={['top']}>
      <ScrollView contentContainerStyle={S.inhalt} keyboardShouldPersistTaps="handled">
        <TouchableOpacity onPress={() => router.back()} accessibilityRole="button">
          <Text style={S.zurueck}>‹ {t('common.cancel')}</Text>
        </TouchableOpacity>
        <Text style={S.titel}>{t('umzug.codeTitel')}</Text>
        <Text style={S.text}>{t('umzug.codeWarum')}</Text>
        <View style={S.warnung}>
          <Text style={S.warnText}>{t('umzug.codeNiemand')}</Text>
        </View>

        {/* Ein Code je Wallet, nicht aenderbar (Kette, Regeln vom 08.11.2026). */}
        <Text style={S.hinweis}>{t('umzug.codeEinmal')}</Text>

        {codeSeit > 0 && !code ? (
          <Text style={S.hinweis}>
            {t('umzug.codeSeit').replace('{datum}', new Date(codeSeit * 1000).toLocaleDateString())}
            {gueltigAb > Math.floor(Date.now() / 1000)
              ? ' ' + t('umzug.codeGueltigAb').replace('{datum}', new Date(gueltigAb * 1000).toLocaleDateString())
              : ''}
          </Text>
        ) : null}

        {codeSeit > 0 ? null : inaktiv ? (
          <Text style={S.hinweis}>{t('umzug.inaktiv').replace('{datum}', new Date(aktivAb * 1000).toLocaleDateString())}</Text>
        ) : !code && !fertig ? (
          <TouchableOpacity
            style={[S.knopf, !signer && S.aus]}
            disabled={!signer}
            onPress={() => {
              setMeldung(null);
              setEingabe('');
              setCode(codeErzeugen());
            }}
            accessibilityRole="button"
          >
            <Text style={S.knopfText}>{t('umzug.codeErzeugen')}</Text>
          </TouchableOpacity>
        ) : null}

        {code ? (
          <>
            <Text style={S.hinweis}>{t('umzug.codeAufschreiben')}</Text>
            <View style={S.codeKasten}>
              <Text style={S.code} selectable={false}>{codeAnzeige(code)}</Text>
            </View>
            <Text style={S.label}>{t('umzug.codeBestaetigen')}</Text>
            <TextInput
              style={S.eingabe}
              value={eingabe}
              onChangeText={setEingabe}
              placeholder={t('umzug.codeEingabe')}
              placeholderTextColor={theme.muted}
              autoCapitalize="characters"
              autoCorrect={false}
              contextMenuHidden
              maxLength={40}
            />
            {eingabe.length >= 24 && !passt ? <Text style={S.fehler}>{t('umzug.codeFalsch')}</Text> : null}
            <TouchableOpacity
              style={[S.knopf, (!passt || laeuft) && S.aus]}
              disabled={!passt || laeuft}
              onPress={hinterlegen}
              accessibilityRole="button"
            >
              <Text style={S.knopfText}>{t('umzug.codeHinterlegen')}</Text>
            </TouchableOpacity>
            {laeuft ? <ActivityIndicator color={theme.purple} style={S.abstand} /> : null}
          </>
        ) : null}

        {meldung ? <Text style={[S.meldung, { color: meldung.ok ? theme.neon : theme.red }]}>{meldung.text}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const S = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.bg },
  inhalt: { padding: 20, paddingBottom: 60 },
  zurueck: { color: theme.muted, fontSize: 15, marginBottom: 12 },
  titel: { color: theme.text, fontSize: 24, fontWeight: '800', marginBottom: 12 },
  text: { color: theme.text, fontSize: 15, lineHeight: 22, marginBottom: 14 },
  warnung: { borderWidth: 1, borderColor: theme.gold, borderRadius: 12, padding: 14, marginBottom: 16 },
  warnText: { color: theme.gold, fontSize: 14, lineHeight: 21, fontWeight: '600' },
  hinweis: { color: theme.muted, fontSize: 14, lineHeight: 20, marginBottom: 14 },
  label: { color: theme.muted, fontSize: 13, marginBottom: 6 },
  codeKasten: { backgroundColor: theme.card2, borderRadius: 12, padding: 16, marginBottom: 16, alignItems: 'center' },
  code: { color: theme.text, fontSize: 20, fontWeight: '700', letterSpacing: 1.5, fontFamily: 'monospace' },
  eingabe: {
    borderWidth: 1, borderColor: theme.border, borderRadius: 12, padding: 12, color: theme.text,
    fontSize: 16, letterSpacing: 1, marginBottom: 8, fontFamily: 'monospace',
  },
  fehler: { color: theme.red, fontSize: 13, marginBottom: 8 },
  knopf: { backgroundColor: theme.accent, borderRadius: theme.radiusPill, paddingVertical: 13, alignItems: 'center', marginTop: 6 },
  knopfText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  aus: { opacity: 0.45 },
  abstand: { marginTop: 14 },
  meldung: { marginTop: 16, fontSize: 15, lineHeight: 21 },
});
