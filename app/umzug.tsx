// Konto zurueckholen: das Menschsein auf DIESE (neue) Wallet holen
// (lib/umzug.ts). Erst das Gesicht (biometric-capture, zweck=umzug), dann mit
// oder ohne Wiederherstellungscode bei der Kette beantragen.
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { useLanguage } from '@/contexts/LanguageContext';
import { useWallet } from '@/contexts/WalletContext';
import { theme } from '@/constants/aequitas-theme';
import { withTimeout } from '@/lib/signer';
import {
  antragEinreichen,
  codeNormal,
  codeUnreifAb,
  umzugErgebnisNehmen,
  umzugStand,
  type UmzugBescheinigung,
} from '@/lib/umzug';

const TIMEOUT_MS = 120_000;

function datum(s: number): string {
  return new Date(s * 1000).toLocaleDateString();
}

export default function Umzug() {
  const { t } = useLanguage();
  const { signer } = useWallet();
  const [aktivAb, setAktivAb] = useState(0);
  const [bescheinigung, setBescheinigung] = useState<UmzugBescheinigung | null>(null);
  const [meldung, setMeldung] = useState<{ ok: boolean; text: string } | null>(null);
  const [code, setCode] = useState('');
  const [laeuft, setLaeuft] = useState(false);
  const [fertig, setFertig] = useState(false);

  useFocusEffect(
    useCallback(() => {
      const e = umzugErgebnisNehmen();
      if (e) {
        if (e.status === 'bescheinigt' && e.bescheinigung) {
          setBescheinigung(e.bescheinigung);
          setMeldung(null);
        } else {
          setBescheinigung(null);
          setMeldung({ ok: false, text: statusText(e.status) });
        }
      }
      if (signer) {
        umzugStand(signer.address).then((s) => setAktivAb(s?.aktivAb ?? 0));
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [signer]),
  );

  function statusText(status: string): string {
    switch (status) {
      case 'schon_mensch': return t('umzug.schonMensch');
      case 'unbekanntes_gesicht': return t('umzug.unbekannt');
      case 'zwilling': return t('umzug.zwilling');
      case 'gleiche_wallet': return t('umzug.gleicheWallet');
      case 'nicht_registriert': return t('umzug.nichtRegistriert');
      case 'zu_wenige_zeugen': return t('umzug.zuWenigeZeugen');
      default: return t('umzug.nichtErkannt').replace('{status}', status);
    }
  }

  const inaktiv = aktivAb > Math.floor(Date.now() / 1000);
  const codeGueltig = !!codeNormal(code);

  async function einreichen(mitCode: boolean) {
    if (!signer || !bescheinigung) return;
    setLaeuft(true);
    setMeldung(null);
    try {
      const r = await withTimeout(antragEinreichen(signer, bescheinigung, mitCode ? code : null), TIMEOUT_MS, t('trade.signTimeout'));
      if (r.ok && r.sofort) {
        setMeldung({ ok: true, text: t('umzug.erfolgSofort') });
        setFertig(true);
      } else if (r.ok) {
        setMeldung({ ok: true, text: t('umzug.erfolgFrist').replace('{datum}', datum(r.freiAb ?? 0)) });
        setFertig(true);
      } else if (codeUnreifAb(r.meldung) > 0) {
        setMeldung({ ok: false, text: t('umzug.codeUnreif').replace('{datum}', datum(codeUnreifAb(r.meldung))) });
      } else {
        setMeldung({ ok: false, text: t('umzug.fehler').replace('{grund}', r.meldung ?? '') });
      }
    } catch (e: any) {
      setMeldung({ ok: false, text: t('umzug.fehler').replace('{grund}', e?.message ?? '') });
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <SafeAreaView style={S.flex} edges={['top']}>
      <ScrollView contentContainerStyle={S.inhalt}>
        <TouchableOpacity onPress={() => router.back()} accessibilityRole="button">
          <Text style={S.zurueck}>‹ {t('common.cancel')}</Text>
        </TouchableOpacity>
        <Text style={S.titel}>{t('umzug.titel')}</Text>

        {!bescheinigung && !fertig ? (
          <>
            <Text style={S.text}>{t('umzug.text')}</Text>
            {inaktiv ? (
              <Text style={S.hinweis}>{t('umzug.inaktiv').replace('{datum}', datum(aktivAb))}</Text>
            ) : (
              <TouchableOpacity
                style={[S.knopf, !signer && S.aus]}
                disabled={!signer}
                onPress={() => router.push('/biometric-capture?zweck=umzug')}
                accessibilityRole="button"
              >
                <Text style={S.knopfText}>{t('umzug.start')}</Text>
              </TouchableOpacity>
            )}
          </>
        ) : null}

        {bescheinigung && !fertig ? (
          <>
            <Text style={S.text}>{t('umzug.erkannt')}</Text>
            <Text style={S.label}>{t('umzug.codeFeld')}</Text>
            <TextInput
              style={S.eingabe}
              value={code}
              onChangeText={setCode}
              placeholder={t('umzug.codeEingabe')}
              placeholderTextColor={theme.muted}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={40}
            />
            <TouchableOpacity
              style={[S.knopf, (!codeGueltig || laeuft) && S.aus]}
              disabled={!codeGueltig || laeuft}
              onPress={() => einreichen(true)}
              accessibilityRole="button"
            >
              <Text style={S.knopfText}>{t('umzug.mitCode')}</Text>
            </TouchableOpacity>
            {bescheinigung.pruefung === 'streng' ? (
              <TouchableOpacity
                style={[S.knopfLeise, laeuft && S.aus]}
                disabled={laeuft}
                onPress={() => einreichen(false)}
                accessibilityRole="button"
              >
                <Text style={S.knopfLeiseText}>{t('umzug.ohneCode')}</Text>
              </TouchableOpacity>
            ) : (
              <Text style={S.hinweis}>{t('umzug.nurMitCode')}</Text>
            )}
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
  text: { color: theme.text, fontSize: 15, lineHeight: 22, marginBottom: 16 },
  hinweis: { color: theme.muted, fontSize: 14, marginBottom: 16 },
  label: { color: theme.muted, fontSize: 13, marginBottom: 6 },
  eingabe: {
    borderWidth: 1, borderColor: theme.border, borderRadius: 12, padding: 12, color: theme.text,
    fontSize: 16, letterSpacing: 1, marginBottom: 14, fontFamily: 'monospace',
  },
  knopf: { backgroundColor: theme.accent, borderRadius: theme.radiusPill, paddingVertical: 13, alignItems: 'center', marginBottom: 10 },
  knopfText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  knopfLeise: { borderWidth: 1, borderColor: theme.border, borderRadius: theme.radiusPill, paddingVertical: 12, alignItems: 'center' },
  knopfLeiseText: { color: theme.text, fontSize: 14, fontWeight: '600' },
  aus: { opacity: 0.45 },
  abstand: { marginTop: 14 },
  meldung: { marginTop: 16, fontSize: 15, lineHeight: 21 },
});
