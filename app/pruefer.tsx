import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { useLanguage } from '@/contexts/LanguageContext';
import { useWallet } from '@/contexts/WalletContext';
import { COORDINATOR_BASE } from '@/lib/config';
import { coordinatorAdresse } from '@/lib/coordinatorBindung';
import { abstimmen, bewerben, holeRegisterStand, type PrueferArt, type RegisterStand, type StimmErgebnis } from '@/lib/prueferRegister';
import { withTimeout } from '@/lib/signer';
import { theme } from '@/constants/aequitas-theme';

// Pruefer-Register (lib/prueferRegister.ts): bewerben, zustimmen, Entzug
// vorschlagen, austreten. Jede Stimme braucht die Wallet (Auftrag) und den
// eigenen Coordinator (Unterschrift); gezaehlt wird in der Kette.
const TIMEOUT_MS = 90_000;

function kurz(a: string): string {
  return a.slice(0, 8) + '…' + a.slice(-6);
}

export default function Pruefer() {
  const { t } = useLanguage();
  const { signer } = useWallet();
  const ich = signer?.address.toLowerCase() ?? '';
  const [stand, setStand] = useState<RegisterStand | null>(null);
  const [laedt, setLaedt] = useState(true);
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const [meldung, setMeldung] = useState<{ ok: boolean; text: string } | null>(null);
  const [url, setUrl] = useState(coordinatorAdresse(COORDINATOR_BASE) ?? '');

  const laden = useCallback(async () => {
    const s = await holeRegisterStand();
    setStand(s);
    setLaedt(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      laden();
      const timer = setInterval(laden, 15_000);
      return () => clearInterval(timer);
    }, [laden]),
  );

  const binPruefer = !!stand && stand.pruefer.includes(ich);
  const urlOk = !!coordinatorAdresse(url);

  // Antraege und Abstimmungen zusammen: je Betroffenem und Art eine Zeile.
  const zeilen = useMemo(() => {
    if (!stand) return [];
    const z = new Map<string, { art: PrueferArt; wallet: string; stimmen: string[]; noetig: number; antrag: boolean }>();
    for (const a of stand.abstimmungen) {
      z.set(a.art + a.wallet, { art: a.art, wallet: a.wallet, stimmen: a.stimmen.map((s) => s.mensch), noetig: a.noetig, antrag: false });
    }
    for (const a of stand.antraege) {
      const k = 'aufnahme' + a.wallet;
      const v = z.get(k);
      if (v) v.antrag = true;
      else z.set(k, { art: 'aufnahme', wallet: a.wallet, stimmen: [], noetig: 0, antrag: true });
    }
    return [...z.values()];
  }, [stand]);

  function ergebnisText(r: StimmErgebnis): { ok: boolean; text: string } {
    if (r.ok && r.eingereicht) return { ok: true, text: t('node.regEingereicht') };
    if (r.ok && r.stimmen !== undefined && r.noetig !== undefined) {
      return { ok: true, text: t('node.regGezaehlt').replace('{n}', String(r.stimmen)).replace('{noetig}', String(r.noetig)) };
    }
    if (r.ok) return { ok: true, text: t('node.regGesendet') };
    if (r.fehler === 'coordinator') return { ok: false, text: t('node.regFehlerCoordinator').replace('{meldung}', r.meldung ?? '') };
    if (r.fehler === 'unterschrift_ungueltig') return { ok: false, text: t('node.bindProofInvalid') };
    if (r.fehler === 'stimme_ungueltig') return { ok: false, text: t('node.regFehlerStimme') };
    if (r.fehler === 'eingabe') return { ok: false, text: t('node.pruefFehlerAdresse') };
    return { ok: false, text: t('node.pruefFehlerAbgelehnt').replace('{meldung}', r.meldung ?? '') };
  }

  async function stimmen(art: PrueferArt, wallet: string) {
    if (!signer) return;
    setLaeuft(art + wallet);
    setMeldung(null);
    try {
      const r = await withTimeout(abstimmen(signer, url, art, wallet), TIMEOUT_MS, t('trade.signTimeout'));
      setMeldung(ergebnisText(r));
      await laden();
    } catch (e: any) {
      setMeldung({ ok: false, text: e?.message ?? '' });
    } finally {
      setLaeuft(null);
    }
  }

  function austreten() {
    Alert.alert(t('node.regAustreten'), t('node.regAustretenFrage'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('node.regAustreten'), style: 'destructive', onPress: () => stimmen('austritt', ich) },
    ]);
  }

  function entziehen(wallet: string) {
    Alert.alert(t('node.regEntzug'), t('node.regEntzugFrage').replace('{wallet}', kurz(wallet)), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('node.regEntzug'), style: 'destructive', onPress: () => stimmen('entzug', wallet) },
    ]);
  }

  async function bewerbenDruecken() {
    if (!signer) return;
    setLaeuft('antrag');
    setMeldung(null);
    try {
      const r = await withTimeout(bewerben(signer), TIMEOUT_MS, t('trade.signTimeout'));
      setMeldung(r.ok ? { ok: true, text: t('node.regBeworben') } : ergebnisText(r));
      await laden();
    } catch (e: any) {
      setMeldung({ ok: false, text: e?.message ?? '' });
    } finally {
      setLaeuft(null);
    }
  }

  const artText = (art: PrueferArt) =>
    art === 'aufnahme' ? t('node.regArtAufnahme') : art === 'entzug' ? t('node.regArtEntzug') : t('node.regArtAustritt');

  return (
    <SafeAreaView style={S.safe}>
      <ScrollView contentContainerStyle={S.content} keyboardShouldPersistTaps="handled">
        <View style={S.card}>
          <Text style={S.title}>{t('node.regTitle')}</Text>
          <Text style={S.body}>{t('node.regDesc')}</Text>
          {laedt ? (
            <ActivityIndicator color={theme.accent} />
          ) : !stand ? (
            <Text style={S.fehler}>{t('node.regNichtErreichbar')}</Text>
          ) : !stand.aktiv ? (
            <Text style={S.warnung}>{t('node.regNichtAktiv')}</Text>
          ) : (
            <Text style={S.body}>
              {t('node.regAnzahl').replace('{n}', String(stand.pruefer.length))}
              {binPruefer ? ' · ' + t('node.regDuBist') : ''}
            </Text>
          )}
          {meldung ? <Text style={meldung.ok ? S.ok : S.fehler}>{meldung.text}</Text> : null}
        </View>

        {stand?.aktiv && binPruefer ? (
          <View style={S.card}>
            <Text style={S.label}>{t('node.pruefUrlLabel')}</Text>
            <TextInput
              style={S.input}
              value={url}
              onChangeText={setUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder="https://…/coordinator"
              placeholderTextColor={theme.muted}
              maxLength={200}
            />
            <Text style={S.hinweis}>{t('node.regUrlHinweis')}</Text>
          </View>
        ) : null}

        {stand?.aktiv && zeilen.length > 0 ? (
          <View style={S.card}>
            <Text style={S.cardTitle}>{t('node.regOffen')}</Text>
            {zeilen.map((z) => {
              const schon = z.stimmen.includes(ich);
              const darf = binPruefer && !schon && urlOk && z.wallet !== ich && z.art !== 'austritt';
              return (
                <View key={z.art + z.wallet} style={S.zeile}>
                  <Text style={S.wert}>{artText(z.art)} · {kurz(z.wallet)}</Text>
                  <Text style={S.hinweis}>
                    {z.noetig > 0 ? t('node.regStimmenStand').replace('{n}', String(z.stimmen.length)).replace('{noetig}', String(z.noetig)) : t('node.regBeworbenStand')}
                    {schon ? ' · ' + t('node.regSchonGestimmt') : ''}
                  </Text>
                  {darf ? (
                    <TouchableOpacity style={S.btnKlein} onPress={() => stimmen(z.art, z.wallet)} disabled={!!laeuft} activeOpacity={0.85}>
                      {laeuft === z.art + z.wallet ? <ActivityIndicator color="#fff" /> : <Text style={S.btnText}>{t('node.regZustimmen')}</Text>}
                    </TouchableOpacity>
                  ) : null}
                </View>
              );
            })}
          </View>
        ) : null}

        {stand?.aktiv ? (
          <View style={S.card}>
            <Text style={S.cardTitle}>{t('node.regListe')}</Text>
            {stand.pruefer.map((p) => (
              <View key={p} style={S.zeile}>
                <Text style={S.wert}>{kurz(p)}{p === ich ? ' · ' + t('node.regDu') : ''}</Text>
                {binPruefer && urlOk ? (
                  p === ich ? (
                    <TouchableOpacity onPress={austreten} disabled={!!laeuft} activeOpacity={0.7}>
                      <Text style={S.link}>{t('node.regAustreten')}</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity onPress={() => entziehen(p)} disabled={!!laeuft} activeOpacity={0.7}>
                      <Text style={S.link}>{t('node.regEntzug')}</Text>
                    </TouchableOpacity>
                  )
                ) : null}
              </View>
            ))}
          </View>
        ) : null}

        {stand?.aktiv && !binPruefer && signer ? (
          <View style={S.card}>
            <Text style={S.cardTitle}>{t('node.regBewerbenTitel')}</Text>
            <Text style={S.body}>{t('node.regBewerbenDesc')}</Text>
            <TouchableOpacity style={S.btn} onPress={bewerbenDruecken} disabled={!!laeuft} activeOpacity={0.85}>
              {laeuft === 'antrag' ? <ActivityIndicator color="#fff" /> : <Text style={S.btnText}>{t('node.regBewerben')}</Text>}
            </TouchableOpacity>
          </View>
        ) : null}

        <TouchableOpacity style={S.btnGhost} onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/run-node'))} activeOpacity={0.8}>
          <Text style={S.btnGhostText}>{t('node.bindDone')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const S = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 20, paddingBottom: 40 },
  card: { backgroundColor: theme.card, borderRadius: theme.radius, padding: 20, borderWidth: 1, borderColor: theme.border, marginBottom: 14 },
  title: { color: theme.text, fontSize: 18, fontWeight: '800', marginBottom: 12 },
  cardTitle: { color: theme.text, fontSize: 15, fontWeight: '700', marginBottom: 8 },
  body: { color: theme.muted, fontSize: 13, lineHeight: 19, marginBottom: 10 },
  label: { color: theme.muted, fontSize: 12, marginBottom: 6 },
  hinweis: { color: theme.muted, fontSize: 11, lineHeight: 16, marginTop: 4 },
  input: { color: theme.text, borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 12, fontSize: 13, fontFamily: theme.fontMono },
  zeile: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.border },
  wert: { color: theme.text, fontSize: 13, fontWeight: '600', fontFamily: theme.fontMono },
  link: { color: theme.gold, fontSize: 12, marginTop: 6, fontWeight: '600' },
  warnung: { color: theme.gold, fontSize: 12, lineHeight: 18 },
  ok: { color: theme.neon, fontSize: 13, lineHeight: 19, marginTop: 8 },
  fehler: { color: '#ff6b6b', fontSize: 13, lineHeight: 19, marginTop: 8 },
  btn: { marginTop: 8, backgroundColor: theme.accent, borderRadius: theme.radiusPill, padding: 15, alignItems: 'center' },
  btnKlein: { marginTop: 8, backgroundColor: theme.accent, borderRadius: theme.radiusPill, paddingVertical: 10, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  btnGhost: { marginTop: 4, borderWidth: 1, borderColor: theme.border, borderRadius: theme.radiusPill, padding: 13, alignItems: 'center' },
  btnGhostText: { color: theme.text, fontSize: 14, fontWeight: '600' },
});
