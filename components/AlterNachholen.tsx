import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { useLanguage } from '@/contexts/LanguageContext';
import { theme } from '@/constants/aequitas-theme';
import { bestaetigungPruefen, landAusGeraet } from '@/lib/altersregel';
import { hatRegionen, laenderFuer, landName, regelFuer, REGIONEN_LISTE } from '@/lib/laender';
import { Auswahl } from '@/components/Auswahl';

// Altbestand (aequitas-biometric-beta docs/dsgvo/02_DSFA.md, R10): wer vor
// der Altersprüfung eingeschrieben wurde, waehlt einmal sein Land und
// bestaetigt das Mindestalter dort (seit 1.21.1 ohne Geburtsdatum, wie bei der
// Registrierung). Gespeichert wird nur "bestaetigt" auf diesem Geraet, nichts
// auf einem Server. Wer juenger ist, bekommt den direkten Weg zur Loeschung
// seiner biometrischen Daten.

const FLAG = 'aequitas_alter_nachgeholt_v1';

export function AlterNachholen({ onLoeschen }: { onLoeschen: () => void }) {
  const { t, lang } = useLanguage();
  const [offen, setOffen] = useState(false);
  const [land, setLand] = useState(() => {
    const g = landAusGeraet();
    return /^[A-Z]{2}$/.test(g) ? g : '';
  });
  const [region, setRegion] = useState('');
  const [bestaetigt, setBestaetigt] = useState(false);
  const [meldung, setMeldung] = useState('');
  const [zuJung, setZuJung] = useState(false);
  const liste = useMemo(() => laenderFuer(lang), [lang]);
  const regel = regelFuer(land, region || undefined);
  const name = landName(land, lang);

  useEffect(() => {
    SecureStore.getItemAsync(FLAG)
      .then((v) => setOffen(v !== 'ja'))
      .catch(() => setOffen(true));
  }, []);

  if (!offen) return null;

  async function bestaetigen() {
    const p = bestaetigungPruefen(land, region, bestaetigt);
    if (p.ok) {
      await SecureStore.setItemAsync(FLAG, 'ja');
      setOffen(false);
      return;
    }
    setMeldung(p.grund === 'fehlt' ? t('identity.alterFehlt') : t('identity.alterUngueltig'));
  }

  function juenger() {
    if (regel.art !== 'fest') {
      setMeldung(t('identity.alterUngueltig'));
      return;
    }
    setZuJung(true);
    setMeldung(t('identity.alterNachholenZuJung').replace('{n}', String(regel.n)));
  }

  return (
    <View style={S.karte}>
      <Text style={S.titel}>{t('identity.alterNachholenTitel')}</Text>
      <Text style={S.text}>{t('identity.alterNachholenText')}</Text>
      <View style={S.abstand}>
        <Auswahl
          wert={land}
          eintraege={liste}
          onWahl={(c) => { setLand(c); setRegion(''); setBestaetigt(false); setZuJung(false); setMeldung(''); }}
          platzhalter={t('identity.alterLand')}
          titel={t('identity.alterLand')}
          suchePlatzhalter={t('identity.alterSuche')}
          mitFlagge
        />
        {hatRegionen(land) ? (
          <Auswahl
            wert={region}
            eintraege={[...(REGIONEN_LISTE[land.toUpperCase()] ?? [])]}
            onWahl={(c) => { setRegion(c); setBestaetigt(false); }}
            platzhalter={t('identity.alterRegion')}
            titel={t('identity.alterRegion')}
            feldStil={S.abstandKlein}
          />
        ) : null}
      </View>
      {regel.art === 'fest' ? (
        <>
          <Text style={S.regel}>{t('identity.alterGilt').replace('{land}', name).replace('{n}', String(regel.n))}</Text>
          <TouchableOpacity style={S.checkRow} onPress={() => setBestaetigt((v) => !v)} activeOpacity={0.8}>
            <View style={[S.checkbox, bestaetigt && S.checkboxChecked]}>
              {bestaetigt && <Text style={S.checkboxMark}>✓</Text>}
            </View>
            <Text style={S.checkLabel}>{t('identity.alterBestaetigen').replace('{n}', String(regel.n))}</Text>
          </TouchableOpacity>
        </>
      ) : regel.art === 'region' ? (
        <Text style={S.regel}>
          {t('identity.alterGiltRegion').replace('{land}', name).replace('{min}', String(regel.min)).replace('{max}', String(regel.max))}
        </Text>
      ) : null}
      {meldung ? <Text style={zuJung ? S.warnung : S.text}>{meldung}</Text> : null}
      {zuJung ? (
        <TouchableOpacity style={S.loeschen} onPress={onLoeschen} activeOpacity={0.85}>
          <Text style={S.loeschenText}>{t('identity.alterNachholenLoeschen')}</Text>
        </TouchableOpacity>
      ) : (
        <>
          <TouchableOpacity style={S.btn} onPress={bestaetigen} activeOpacity={0.85}>
            <Text style={S.btnText}>{t('identity.alterNachholenBtn')}</Text>
          </TouchableOpacity>
          {regel.art === 'fest' ? (
            <TouchableOpacity style={S.juenger} onPress={juenger} activeOpacity={0.85}>
              <Text style={S.juengerText}>{t('identity.alterNachholenJuenger').replace('{n}', String(regel.n))}</Text>
            </TouchableOpacity>
          ) : null}
        </>
      )}
    </View>
  );
}

const S = StyleSheet.create({
  karte: { backgroundColor: theme.card, borderRadius: theme.radius, padding: 18, borderWidth: 1, borderColor: theme.gold, marginBottom: 14 },
  titel: { color: theme.text, fontSize: 15, fontWeight: '800', marginBottom: 6 },
  text: { color: theme.muted, fontSize: 12.5, lineHeight: 18, marginTop: 4 },
  regel: { color: theme.text, fontSize: 13.5, lineHeight: 19, marginTop: 10 },
  warnung: { color: theme.gold, fontSize: 12.5, lineHeight: 18, marginTop: 8 },
  abstand: { marginTop: 10 },
  abstandKlein: { marginTop: 8 },
  checkRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 10 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: theme.borderStrong, alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: theme.accent, borderColor: theme.accent },
  checkboxMark: { color: '#fff', fontSize: 13, fontWeight: '800' },
  checkLabel: { color: theme.text, fontSize: 13, lineHeight: 18, flex: 1 },
  btn: { marginTop: 12, backgroundColor: theme.accent, borderRadius: theme.radiusPill, padding: 12, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  juenger: { marginTop: 8, padding: 8, alignItems: 'center' },
  juengerText: { color: theme.muted, fontSize: 12.5, textDecorationLine: 'underline' },
  loeschen: { marginTop: 12, borderWidth: 1, borderColor: theme.red, borderRadius: theme.radiusPill, padding: 12, alignItems: 'center' },
  loeschenText: { color: theme.red, fontWeight: '700', fontSize: 13 },
});
