// Hinweis oben auf der Startseite: es gibt eine neuere App-Version
// (lib/appUpdate.ts). "Jetzt aktualisieren" oeffnet die Download-Seite des
// Knotens; installiert wird vom Menschen selbst. "Spaeter" blendet den
// Hinweis fuer diese Sitzung aus.
import React, { useEffect, useState } from 'react';
import { AppState, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { neonTint, neonTintBorder, theme } from '@/constants/aequitas-theme';
import { useLanguage } from '@/contexts/LanguageContext';
import { DOWNLOAD_URL, eigeneVersion, updateVerfuegbar } from '@/lib/appUpdate';

const PRUEFEN_ALLE_MS = 6 * 60 * 60 * 1000;
let ausgeblendetFuer: string | null = null;

export default function UpdateHinweis() {
  const { t } = useLanguage();
  const [neu, setNeu] = useState<string | null>(null);

  useEffect(() => {
    let aktiv = true;
    let zuletzt = 0;
    const pruefen = () => {
      if (Date.now() - zuletzt < PRUEFEN_ALLE_MS) return;
      zuletzt = Date.now();
      updateVerfuegbar().then((v) => {
        if (aktiv) setNeu(v);
      });
    };
    pruefen();
    const abo = AppState.addEventListener('change', (s) => {
      if (s === 'active') pruefen();
    });
    return () => {
      aktiv = false;
      abo.remove();
    };
  }, []);

  if (!neu || ausgeblendetFuer === neu) return null;
  return (
    <View style={S.karte}>
      <Text style={S.titel}>{t('home.updateTitel').replace('{version}', neu)}</Text>
      <Text style={S.text}>{t('home.updateText').replace('{eigene}', eigeneVersion())}</Text>
      <TouchableOpacity style={S.knopf} onPress={() => Linking.openURL(DOWNLOAD_URL)} activeOpacity={0.85} accessibilityRole="button">
        <Text style={S.knopfText}>{t('home.updateJetzt')}</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => { ausgeblendetFuer = neu; setNeu(null); }} activeOpacity={0.7}>
        <Text style={S.spaeter}>{t('home.updateSpaeter')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const S = StyleSheet.create({
  karte: {
    marginHorizontal: 16, marginTop: 12, padding: 14, borderRadius: 14,
    backgroundColor: neonTint, borderWidth: 1, borderColor: neonTintBorder,
  },
  titel: { color: theme.neon, fontSize: 15, fontWeight: '700', marginBottom: 4 },
  text: { color: theme.text, fontSize: 14, lineHeight: 20 },
  knopf: { marginTop: 10, backgroundColor: theme.accent, borderRadius: theme.radiusPill, paddingVertical: 11, alignItems: 'center' },
  knopfText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  spaeter: { color: theme.muted, fontSize: 13, textAlign: 'center', marginTop: 8 },
});
