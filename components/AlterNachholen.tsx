import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { useLanguage } from '@/contexts/LanguageContext';
import { theme } from '@/constants/aequitas-theme';
import { landAusGeraet, pruefen } from '@/lib/altersregel';

// Altbestand (aequitas-biometric-beta docs/dsgvo/02_DSFA.md, R10): wer vor
// der Altersprüfung eingeschrieben wurde, gibt einmal Geburtsmonat, -jahr und
// Land an. Gespeichert wird nur "bestaetigt" auf diesem Geraet, nichts auf
// einem Server. Wer danach zu jung ist, bekommt den direkten Weg zur Loeschung
// seiner biometrischen Daten.

const FLAG = 'aequitas_alter_nachgeholt_v1';

export function AlterNachholen({ onLoeschen }: { onLoeschen: () => void }) {
  const { t } = useLanguage();
  const [offen, setOffen] = useState(false);
  const [jahr, setJahr] = useState('');
  const [monat, setMonat] = useState('');
  const [land, setLand] = useState(() => landAusGeraet());
  const [meldung, setMeldung] = useState('');
  const [zuJung, setZuJung] = useState(false);

  useEffect(() => {
    SecureStore.getItemAsync(FLAG)
      .then((v) => setOffen(v !== 'ja'))
      .catch(() => setOffen(true));
  }, []);

  if (!offen) return null;

  async function bestaetigen() {
    const p = pruefen({ jahr, monat, land });
    if (p.ok) {
      await SecureStore.setItemAsync(FLAG, 'ja');
      setOffen(false);
      return;
    }
    if (p.grund === 'zu_jung') {
      setZuJung(true);
      setMeldung(t('identity.alterNachholenZuJung').replace('{n}', String(p.mindestalter)));
      return;
    }
    setMeldung(p.grund === 'fehlt' ? t('identity.alterFehlt') : t('identity.alterUngueltig'));
  }

  return (
    <View style={S.karte}>
      <Text style={S.titel}>{t('identity.alterNachholenTitel')}</Text>
      <Text style={S.text}>{t('identity.alterNachholenText')}</Text>
      <View style={S.reihe}>
        <TextInput style={S.feld} value={monat} onChangeText={(v) => setMonat(v.replace(/[^0-9]/g, '').slice(0, 2))}
          placeholder={t('identity.alterMonat')} placeholderTextColor={theme.muted} keyboardType="number-pad" />
        <TextInput style={S.feld} value={jahr} onChangeText={(v) => setJahr(v.replace(/[^0-9]/g, '').slice(0, 4))}
          placeholder={t('identity.alterJahr')} placeholderTextColor={theme.muted} keyboardType="number-pad" />
        <TextInput style={S.feld} value={land} onChangeText={(v) => setLand(v.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase())}
          placeholder={t('identity.alterLand')} placeholderTextColor={theme.muted} autoCapitalize="characters" />
      </View>
      {meldung ? <Text style={zuJung ? S.warnung : S.text}>{meldung}</Text> : null}
      {zuJung ? (
        <TouchableOpacity style={S.loeschen} onPress={onLoeschen} activeOpacity={0.85}>
          <Text style={S.loeschenText}>{t('identity.alterNachholenLoeschen')}</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity style={S.btn} onPress={bestaetigen} activeOpacity={0.85}>
          <Text style={S.btnText}>{t('identity.alterNachholenBtn')}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const S = StyleSheet.create({
  karte: { backgroundColor: theme.card, borderRadius: theme.radius, padding: 18, borderWidth: 1, borderColor: theme.gold, marginBottom: 14 },
  titel: { color: theme.text, fontSize: 15, fontWeight: '800', marginBottom: 6 },
  text: { color: theme.muted, fontSize: 12.5, lineHeight: 18, marginTop: 4 },
  warnung: { color: theme.gold, fontSize: 12.5, lineHeight: 18, marginTop: 8 },
  reihe: { flexDirection: 'row', gap: 8, marginTop: 10 },
  feld: { flex: 1, textAlign: 'center', color: theme.text, backgroundColor: theme.bg, borderRadius: 8, borderWidth: 1, borderColor: theme.border, paddingVertical: 9 },
  btn: { marginTop: 12, backgroundColor: theme.accent, borderRadius: theme.radiusPill, padding: 12, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  loeschen: { marginTop: 12, borderWidth: 1, borderColor: theme.red, borderRadius: theme.radiusPill, padding: 12, alignItems: 'center' },
  loeschenText: { color: theme.red, fontWeight: '700', fontSize: 13 },
});
