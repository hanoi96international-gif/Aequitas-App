// Quantenschutz der Wallet (lib/pq.ts, Kette: pq_zusage.go).
//
// Die Zusage ist der SHA-256 eines ML-DSA-65-Schluessels aus der Seed-Phrase.
// Hat die App den Hash beim Anlegen/Import gemerkt, genuegt ein Knopf. Sonst
// gibt der Mensch die Seed-Phrase EINMAL ein: sie wird nur geprueft (gehoert
// sie zu dieser Wallet?), der Hash daraus gerechnet und die Eingabe sofort
// geleert -- nie gespeichert, nie gesendet.
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { useLanguage } from '@/contexts/LanguageContext';
import { useWallet } from '@/contexts/WalletContext';
import { theme } from '@/constants/aequitas-theme';
import { withTimeout } from '@/lib/signer';
import { pqHashFuerWallet, pqHashGemerkt, pqHashVergessen, pqStand, zusageHinterlegen, zusageSchonDa, type PQStand } from '@/lib/pq';

const TIMEOUT_MS = 120_000;

export default function Quantenschutz() {
  const { t } = useLanguage();
  const { signer, balance } = useWallet();
  const [stand, setStand] = useState<PQStand | null>(null);
  const [gemerkt, setGemerkt] = useState<string | null>(null);
  const [phrase, setPhrase] = useState('');
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState<{ ok: boolean; text: string } | null>(null);

  const laden = useCallback(() => {
    if (!signer) return;
    pqStand(signer.address).then(setStand);
    pqHashGemerkt(signer.address).then(setGemerkt);
  }, [signer]);
  useFocusEffect(laden);

  const jetzt = Math.floor(Date.now() / 1000);
  const aktivAb = stand?.ab ?? 0;
  const inaktiv = !aktivAb || aktivAb > jetzt;
  const seit = stand?.seit ?? 0;
  const mensch = balance?.is_human === true;

  async function hinterlegen(hash: string) {
    if (!signer) return;
    setLaeuft(true);
    setMeldung(null);
    try {
      const r = await withTimeout(zusageHinterlegen(signer, hash), TIMEOUT_MS, t('trade.signTimeout'));
      // Ging die Antwort verloren, steht die Zusage trotzdem auf der Kette.
      const danach = r.ok ? null : await pqStand(signer.address);
      if (r.ok || danach?.hash === hash) {
        await pqHashVergessen(signer.address);
        setMeldung({ ok: true, text: t('pq.fertig') });
      } else if (zusageSchonDa(r.meldung)) {
        setMeldung({ ok: false, text: t('pq.schonDa') });
      } else {
        setMeldung({ ok: false, text: t('pq.fehler').replace('{grund}', r.meldung ?? '') });
      }
    } catch (e: any) {
      setMeldung({ ok: false, text: t('pq.fehler').replace('{grund}', e?.message ?? '') });
    } finally {
      setLaeuft(false);
      laden();
    }
  }

  function mitPhrase() {
    if (!signer) return;
    const hash = pqHashFuerWallet(phrase, signer.address);
    setPhrase('');
    if (!hash) {
      setMeldung({ ok: false, text: t('pq.phraseFalsch') });
      return;
    }
    void hinterlegen(hash);
  }

  return (
    <SafeAreaView style={S.flex} edges={['top']}>
      <ScrollView contentContainerStyle={S.inhalt} keyboardShouldPersistTaps="handled">
        <TouchableOpacity onPress={() => router.back()} accessibilityRole="button">
          <Text style={S.zurueck}>‹ {t('common.cancel')}</Text>
        </TouchableOpacity>
        <Text style={S.titel}>{t('pq.titel')}</Text>
        <Text style={S.text}>{t('pq.warum')}</Text>
        <Text style={S.hinweis}>{t('pq.nichtsNeues')}</Text>

        {seit > 0 ? (
          <Text style={S.gut}>{t('pq.seit').replace('{datum}', new Date(seit * 1000).toLocaleDateString())}</Text>
        ) : !mensch ? (
          <Text style={S.hinweis}>{t('pq.nurMensch')}</Text>
        ) : inaktiv ? (
          aktivAb ? <Text style={S.hinweis}>{t('pq.inaktiv').replace('{datum}', new Date(aktivAb * 1000).toLocaleDateString())}</Text> : null
        ) : gemerkt ? (
          <TouchableOpacity style={[S.knopf, (laeuft || !signer) && S.aus]} disabled={laeuft || !signer} onPress={() => hinterlegen(gemerkt)} accessibilityRole="button">
            <Text style={S.knopfText}>{t('pq.knopf')}</Text>
          </TouchableOpacity>
        ) : (
          <View>
            <Text style={S.text}>{t('pq.phraseHinweis')}</Text>
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
              secureTextEntry={false}
              multiline
              testID="pq-phrase"
            />
            <TouchableOpacity
              style={[S.knopf, (laeuft || !signer || phrase.trim().split(/\s+/).length < 12) && S.aus]}
              disabled={laeuft || !signer || phrase.trim().split(/\s+/).length < 12}
              onPress={mitPhrase}
              accessibilityRole="button"
            >
              <Text style={S.knopfText}>{t('pq.phraseKnopf')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Stufe 3: der Tresor -- Guthaben, das nur ML-DSA ausgeben kann. */}
        <TouchableOpacity style={S.knopf} onPress={() => router.push('/tresor')} accessibilityRole="button" testID="zum-tresor">
          <Text style={S.knopfText}>{t('tresor.link')}</Text>
        </TouchableOpacity>

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
  hinweis: { color: theme.muted, fontSize: 14, lineHeight: 20, marginBottom: 12 },
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
  knopf: { marginTop: 14, backgroundColor: theme.accent, borderRadius: theme.radiusPill, paddingVertical: 13, alignItems: 'center' },
  knopfText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  aus: { opacity: 0.45 },
  abstand: { marginTop: 14 },
  gut: { color: theme.neon, fontSize: 15, marginTop: 12, fontWeight: '600' },
  fehler: { color: theme.red, fontSize: 14, marginTop: 12 },
});
