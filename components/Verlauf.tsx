import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { getVerlauf, type VerlaufEintrag } from '@/lib/api';
import { istTagesrunde, tagesrundenZusammenfassen } from '@/lib/verlaufZusammenfassen';
import { betragText } from '@/lib/ueberweisung';
import { shortWallet } from '@/lib/format';
import { theme } from '@/constants/aequitas-theme';
import { useLanguage, type TranslationKey } from '@/contexts/LanguageContext';

// Zahlungsverlauf des Kontos: Ueberweisungen, Grundeinkommen, Abgaben ...
// Die Kette fuehrt ihn seit dem 27.09.2026 (kontoverlauf.go); aeltere
// Buchungen stehen im Explorer.

const ARTEN = new Set([
  'ubi_distribution', 'register_human', 'grant_release', 'umlauf', 'kappung',
  'validator_distribution', 'lp_distribution', 'swap', 'swap_aeq_tusd',
  'add_liquidity', 'remove_liquidity', 'faucet', 'escrow_release', 'escrow_recover',
]);

export function artSchluessel(e: Pick<VerlaufEintrag, 'art' | 'richtung'>): TranslationKey {
  if (e.art === 'transfer') return e.richtung === 'ein' ? 'history.art_transfer_ein' : 'history.art_transfer_aus';
  if (e.art === 'swap_aeq_tusd') return 'history.art_swap';
  if (e.art === 'escrow_recover') return 'history.art_escrow_release';
  return (ARTEN.has(e.art) ? 'history.art_' + e.art : 'history.art_other') as TranslationKey;
}

export function Verlauf({ address, neuLaden }: { address: string; neuLaden: unknown }) {
  const { t, lang } = useLanguage();
  const [eintraege, setEintraege] = useState<VerlaufEintrag[]>([]);
  const [laedt, setLaedt] = useState(false);
  const [fehler, setFehler] = useState(false);
  const [mehr, setMehr] = useState(false);
  // Aufgeklappte Tagesrunden (Rundenzeit): zeigen die einzelnen Buchungen.
  const [offen, setOffen] = useState<Record<number, boolean>>({});

  const lade = useCallback(async (vor: number) => {
    setLaedt(true);
    setFehler(false);
    try {
      const d = await getVerlauf(address, vor, 20);
      const neu = d.eintraege ?? [];
      setEintraege((alt) => (vor > 0 ? [...alt, ...neu] : neu));
      setMehr(neu.length === 20);
    } catch {
      setFehler(true);
    } finally {
      setLaedt(false);
    }
  }, [address]);

  useEffect(() => {
    lade(0);
  }, [lade, neuLaden]);

  const datum = (z: number) => {
    try {
      return new Date(z * 1000).toLocaleString(lang, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch {
      return new Date(z * 1000).toISOString().slice(0, 16).replace('T', ' ');
    }
  };

  return (
    <View style={S.card}>
      <Text style={S.cardTitle}>{t('history.title')}</Text>
      {eintraege.length === 0 && !laedt ? (
        <Text style={S.leer}>{fehler ? t('history.error') : t('history.empty')}</Text>
      ) : null}
      {tagesrundenZusammenfassen(eintraege).map((e) => {
        const runde = istTagesrunde(e) ? e : null;
        const roh = istTagesrunde(e) ? null : e;
        const vorzeichen = e.richtung === 'ein' ? '+' : e.richtung === 'aus' ? '−' : runde ? '±' : '';
        const farbe = e.richtung === 'ein' ? theme.neon : e.richtung === 'aus' ? theme.text : theme.muted;
        const betrag = e.betrag + (roh && roh.richtung === 'aus' ? roh.gebuehr ?? 0 : 0);
        const auf = runde ? !!offen[runde.zeit] : false;
        const kopf = (
          <View style={S.zeileInnen}>
            <View style={S.links}>
              <Text style={S.art}>
                {runde ? t('history.art_tagesrunde') : t(artSchluessel(roh as VerlaufEintrag))}
                {runde ? (auf ? '  ▾' : '  ▸') : ''}
              </Text>
              <Text style={S.sub}>
                {datum(e.zeit)}
                {runde ? ' · ' + t('history.tagesrundeSub', { ein: betragText(runde.erhalten), aus: betragText(runde.abgabe) }) : ''}
                {roh?.gegenpartei ? ' · ' + shortWallet(roh.gegenpartei) : ''}
                {roh?.gebuehr ? ' · ' + t('history.feeIncl', { fee: betragText(roh.gebuehr) }) : ''}
              </Text>
            </View>
            <Text style={[S.betrag, { color: farbe }]}>
              {vorzeichen}
              {betragText(betrag)}
            </Text>
          </View>
        );
        if (!runde) {
          return (
            <View key={`${e.hoehe}-${e.tx_index}-${e.richtung}-${e.art}`} style={S.zeile}>
              {kopf}
            </View>
          );
        }
        return (
          <View key={`runde-${runde.zeit}`} style={S.zeile}>
            <TouchableOpacity
              onPress={() => setOffen((o) => ({ ...o, [runde.zeit]: !o[runde.zeit] }))}
              accessibilityRole="button"
              accessibilityState={{ expanded: auf }}
              accessibilityLabel={t(auf ? 'history.tagesrundeAusblenden' : 'history.tagesrundeZeigen')}
              activeOpacity={0.7}
            >
              {kopf}
            </TouchableOpacity>
            {auf ? (
              <View style={S.teile}>
                {runde.teile.map((x) => (
                  <View key={`${x.hoehe}-${x.tx_index}-${x.art}`} style={S.teil}>
                    <Text style={S.teilText} selectable>
                      {t(artSchluessel(x))} {x.richtung === 'ein' ? '+' : '−'}
                      {betragText(x.betrag)} · {t('history.block', { h: String(x.hoehe) })}
                      {x.tx_hash ? ' · ' + x.tx_hash : ''}
                    </Text>
                  </View>
                ))}
                <Text style={S.erklaerung}>{t('history.tagesrundeErklaerung')}</Text>
              </View>
            ) : null}
          </View>
        );
      })}
      {laedt ? <ActivityIndicator color={theme.accent} style={{ marginTop: 10 }} /> : null}
      {mehr && !laedt ? (
        <TouchableOpacity onPress={() => lade(eintraege[eintraege.length - 1].hoehe)} style={S.mehrBtn} activeOpacity={0.8}>
          <Text style={S.mehrText}>{t('history.more')}</Text>
        </TouchableOpacity>
      ) : null}
      <Text style={S.hinweis}>{t('history.note')}</Text>
    </View>
  );
}

const S = StyleSheet.create({
  card: { marginHorizontal: 20, backgroundColor: theme.card, borderRadius: theme.radius, padding: 20, marginTop: 16, borderWidth: 1, borderColor: theme.border },
  cardTitle: { fontSize: 11, color: theme.muted, letterSpacing: 3, marginBottom: 10, fontWeight: '600' },
  leer: { color: theme.muted, fontSize: 13, lineHeight: 19 },
  zeile: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.border },
  zeileInnen: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  teile: { marginTop: 8, paddingLeft: 10, borderLeftWidth: 2, borderLeftColor: theme.border },
  teil: { paddingVertical: 3 },
  teilText: { color: theme.muted, fontSize: 11, fontVariant: ['tabular-nums'] },
  erklaerung: { color: theme.muted, fontSize: 11, lineHeight: 16, marginTop: 6 },
  links: { flex: 1 },
  art: { color: theme.text, fontSize: 14, fontWeight: '600' },
  sub: { color: theme.muted, fontSize: 11, marginTop: 2 },
  betrag: { fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  mehrBtn: { alignSelf: 'center', marginTop: 12, borderWidth: 1, borderColor: theme.border, borderRadius: theme.radiusPill, paddingVertical: 9, paddingHorizontal: 20 },
  mehrText: { color: theme.text, fontSize: 13, fontWeight: '600' },
  hinweis: { color: theme.muted, fontSize: 11, marginTop: 12, lineHeight: 16 },
});
