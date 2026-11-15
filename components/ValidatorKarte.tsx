import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useLanguage } from '@/contexts/LanguageContext';
import { adresseKurz, holeValidatorStand, type ValidatorStand } from '@/lib/validatorStand';
import { theme, neonTint, neonTintBorder, goldTint, goldTintBorder } from '@/constants/aequitas-theme';

// Validator-Bereich im Knoten-Tab: eingetragen? Bloecke heute und insgesamt.
// Solange der Tab offen ist, alle 15 s nachladen (der Knoten haelt den Stand
// 20 s vor, oefter zu fragen braechte nichts).
const NACHLADEN_MS = 15_000;

function zahl(n: number): string {
  return n.toLocaleString();
}

export function ValidatorKarte({ wallet }: { wallet: string }) {
  const { t, lang } = useLanguage();
  const [stand, setStand] = useState<ValidatorStand | null>(null);
  const [fehler, setFehler] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let aus = false;
      const laden = async () => {
        const r = await holeValidatorStand(wallet);
        if (aus) return;
        if (r.ok) {
          setStand(r.stand);
          setFehler(false);
        } else {
          // Den letzten guten Stand stehen lassen, aber sagen, dass er alt ist.
          setFehler(true);
        }
      };
      laden();
      const timer = setInterval(laden, NACHLADEN_MS);
      return () => {
        aus = true;
        clearInterval(timer);
      };
    }, [wallet]),
  );

  const letzter = stand && stand.letzterBlock > 0
    ? new Date(stand.letzterBlock * 1000).toLocaleString(lang, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : t('node.valNie');

  return (
    <View style={S.card}>
      <Text style={S.title}>{t('node.valTitle')}</Text>
      {!stand ? (
        <Text style={S.muted}>{fehler ? t('node.valNichtLesbar') : t('node.valLaedt')}</Text>
      ) : (
        <>
          <View style={[S.status, stand.erzeuger ? S.statusJa : stand.eingetragen ? S.statusHalb : S.statusNein]}>
            <Text style={[S.statusText, { color: stand.erzeuger ? theme.neon : stand.eingetragen ? theme.gold : theme.muted }]}>
              {stand.erzeuger ? t('node.valStatusErzeuger') : stand.eingetragen ? t('node.valStatusEingetragen') : t('node.valStatusNein')}
            </Text>
          </View>
          {stand.eingetragen ? (
            <>
              <View style={S.zahlen}>
                <View style={S.zahlBox}>
                  <Text style={S.zahl}>{zahl(stand.bloeckeHeute)}</Text>
                  <Text style={S.zahlLabel}>{t('node.valHeute')}</Text>
                </View>
                <View style={S.zahlBox}>
                  <Text style={S.zahl}>{zahl(stand.bloeckeGesamt)}</Text>
                  <Text style={S.zahlLabel}>{t('node.valGesamt')}</Text>
                </View>
              </View>
              <View style={S.zeile}>
                <Text style={S.key}>{t('node.valLetzter')}</Text>
                <Text style={S.val}>{letzter}</Text>
              </View>
              {stand.schluessel
                .filter((s) => (s.kette && !s.ueberholt) || s.knoten)
                .map((s) => (
                  <View key={s.adresse}>
                    <View style={S.zeile}>
                      <Text style={S.key}>{t('node.valSchluessel')}</Text>
                      <Text style={S.val}>{adresseKurz(s.adresse)}</Text>
                    </View>
                    {!s.kette ? <Text style={S.hinweis}>{t('node.valNurKnoten')}</Text> : null}
                  </View>
                ))}
              <Text style={S.hinweis}>{t('node.valHinweisHeute')}</Text>
            </>
          ) : null}
          {fehler ? <Text style={S.hinweis}>{t('node.valNichtLesbar')}</Text> : null}
        </>
      )}
    </View>
  );
}

const S = StyleSheet.create({
  card: { marginHorizontal: 20, backgroundColor: theme.card, borderRadius: theme.radius, padding: 20, marginTop: 16, borderWidth: 1, borderColor: theme.border },
  title: { fontSize: 11, color: theme.muted, letterSpacing: 3, marginBottom: 14, fontWeight: '600' },
  muted: { color: theme.muted, fontSize: 12 },
  status: { borderWidth: 1, borderRadius: theme.radiusSm, padding: 12, marginBottom: 14 },
  statusJa: { backgroundColor: neonTint, borderColor: neonTintBorder },
  statusHalb: { backgroundColor: goldTint, borderColor: goldTintBorder },
  statusNein: { borderColor: theme.border },
  statusText: { fontSize: 13, fontWeight: '700', textAlign: 'center' },
  zahlen: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  zahlBox: { flex: 1, backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border, borderRadius: theme.radiusSm, paddingVertical: 14, alignItems: 'center' },
  zahl: { color: theme.neon, fontSize: 26, fontWeight: '800', fontFamily: theme.fontMono },
  zahlLabel: { color: theme.muted, fontSize: 11, marginTop: 4 },
  zeile: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: theme.border },
  key: { color: theme.muted, fontSize: 12 },
  val: { color: theme.text, fontSize: 12, fontWeight: '600', fontFamily: theme.fontMono },
  hinweis: { color: theme.muted, fontSize: 10, marginTop: 8, lineHeight: 15 },
});
