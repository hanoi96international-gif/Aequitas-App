// Jaehrlicher Lebensnachweis: die Karte im Identitaets-Tab und die
// Erinnerung auf der Startseite. Beide lesen nur, was die Kette in
// /api/balance unter `lebensnachweis` meldet (lib/lebensnachweis.ts) -- fehlt
// es oder ist es kaputt, zeigen beide nichts.
//
// Ton: ruhig. Wer pausiert ist, verliert weder den Status als Mensch noch
// sein Guthaben; nur der taegliche Anteil am Grundeinkommen ruht, bis er
// bestaetigt, und laeuft danach sofort weiter. Genau das steht da, nicht mehr.
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';

import { goldTint, goldTintBorder, theme } from '@/constants/aequitas-theme';
import { useLanguage } from '@/contexts/LanguageContext';
import { useWallet } from '@/contexts/WalletContext';
import { BIOMETRIC_ENABLED } from '@/lib/config';
import {
  lebensnachweisAusKontostand,
  lebensnachweisErinnern,
  type LebensnachweisStand,
} from '@/lib/lebensnachweis';

const datum = (unix: number) => (unix > 0 ? new Date(unix * 1000).toLocaleDateString() : '—');

function useLebensnachweis() {
  const { balance } = useWallet();
  // Neu berechnet bei jedem Kontostand (alle 10 s im Vordergrund).
  return lebensnachweisAusKontostand(balance, Math.floor(Date.now() / 1000));
}

function bestaetigen() {
  router.push('/biometric-capture?zweck=lebensnachweis');
}

/** Karte im Identitaets-Tab. Nichts, solange die Kette fuer dieses Konto
 *  keinen Nachweis verlangt (oder ihn nicht meldet). */
export function LebensnachweisKarte() {
  const { t } = useLanguage();
  const ln = useLebensnachweis();
  if (!ln || ln.phase === 'inaktiv') return null;
  const { stand, phase } = ln;
  const text = (() => {
    switch (phase) {
      case 'noch_nicht': return t('identity.lnNochNicht', { date: datum(stand.faellig_ab) });
      case 'faellig': return t('identity.lnFaellig', { date: datum(stand.frist) });
      case 'nachfrist': return t('identity.lnNachfrist', { date: datum(stand.pause_ab) });
      case 'pausiert': return t('identity.lnPausiert');
    }
  })();
  const knopf = phase !== 'noch_nicht';
  return (
    <View style={S.karte}>
      <Text style={S.titel}>{t('identity.lnTitel')}</Text>
      {stand.am > 0 ? <Text style={S.klein}>{t('identity.lnZuletzt', { date: datum(stand.am) })}</Text> : null}
      <Text style={S.text}>{text}</Text>
      {knopf && BIOMETRIC_ENABLED ? (
        <TouchableOpacity onPress={bestaetigen} activeOpacity={0.85} accessibilityRole="button">
          <LinearGradient colors={theme.buttonGradient} start={theme.gradientAngle.start} end={theme.gradientAngle.end} style={S.knopf}>
            <Text style={S.knopfText}>{t('identity.lnBtn')}</Text>
          </LinearGradient>
        </TouchableOpacity>
      ) : null}
      {/* Ohne Gesichtspruefung in dieser App-Fassung gibt es keinen Weg zum
          Nachweis -- das wird gesagt, statt einen Knopf ins Leere zu zeigen. */}
      {knopf && !BIOMETRIC_ENABLED ? <Text style={S.klein}>{t('identity.lnNichtInDieserApp')}</Text> : null}
      <Text style={S.regel}>{t('identity.lnRegel')}</Text>
    </View>
  );
}

function hinweisText(t: ReturnType<typeof useLanguage>['t'], phase: string, stand: LebensnachweisStand): string {
  switch (phase) {
    case 'faellig': return t('home.lnHinweisFaellig', { date: datum(stand.frist) });
    case 'nachfrist': return t('home.lnHinweisNachfrist', { date: datum(stand.pause_ab) });
    default: return t('home.lnHinweisPausiert');
  }
}

/** Erinnerung auf der Startseite: nur, wenn jetzt etwas zu tun ist (faellig,
 *  Nachfrist, pausiert). Fuehrt in den Identitaets-Tab. */
export function LebensnachweisHinweis() {
  const { t } = useLanguage();
  const ln = useLebensnachweis();
  if (!ln || !lebensnachweisErinnern(ln.phase)) return null;
  return (
    <TouchableOpacity style={S.hinweis} onPress={() => router.push('/(tabs)/identity')} activeOpacity={0.85}
      accessibilityRole="button">
      <Text style={S.hinweisTitel}>{t('home.lnHinweisTitel')}</Text>
      <Text style={S.hinweisText}>{hinweisText(t, ln.phase, ln.stand)}</Text>
      <Text style={S.hinweisLink}>{t('home.lnHinweisLink')}</Text>
    </TouchableOpacity>
  );
}

const S = StyleSheet.create({
  karte: { marginHorizontal: 20, marginTop: 16, backgroundColor: theme.card, borderRadius: theme.radius, padding: 20, borderWidth: 1, borderColor: theme.purple + '66' },
  titel: { fontSize: 14, fontWeight: '800', color: theme.purple, marginBottom: 8 },
  text: { fontSize: 12.5, color: theme.text, lineHeight: 19 },
  klein: { fontSize: 11.5, color: theme.muted, lineHeight: 17, marginBottom: 6 },
  regel: { fontSize: 11, color: theme.muted, lineHeight: 16, marginTop: 12 },
  knopf: { borderRadius: theme.radiusPill, padding: 16, alignItems: 'center', marginTop: 14 },
  knopfText: { color: '#fff', fontWeight: '700', fontSize: 14, letterSpacing: 0.8 },

  hinweis: {
    marginHorizontal: 16, marginTop: 12, padding: 14, borderRadius: 14,
    backgroundColor: goldTint, borderWidth: 1, borderColor: goldTintBorder,
  },
  hinweisTitel: { color: theme.gold, fontSize: 15, fontWeight: '700', marginBottom: 4 },
  hinweisText: { color: theme.text, fontSize: 14, lineHeight: 20 },
  hinweisLink: { color: theme.gold, fontSize: 14, fontWeight: '700', marginTop: 8 },
});
