// Umzug (lib/umzug.ts) in der App:
//   - UmzugHinweis (Home, ganz oben): die ALTE Wallet sieht sofort und
//     unuebersehbar, wenn jemand ihr Menschsein umziehen will, und kann es
//     stoppen. Die NEUE Wallet sieht, wann es ankommt.
//   - UmzugIdentitaet (Identitaets-Tab): Wiederherstellungscode einrichten
//     (fuer Menschen) oder "Alte Wallet verloren?" (fuer neue Wallets).
// Vor dem Stichtag (aktiv_ab der Kette) zeigen beide nichts.
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useLanguage } from '@/contexts/LanguageContext';
import { useWallet } from '@/contexts/WalletContext';
import { theme } from '@/constants/aequitas-theme';
import { withTimeout } from '@/lib/signer';
import { umzugStand, widerrufen, type UmzugStand } from '@/lib/umzug';

function datum(s: number): string {
  return new Date(s * 1000).toLocaleDateString();
}

function kurz(a: string): string {
  return `${a.slice(0, 8)}…${a.slice(-4)}`;
}

function useUmzugStand(): [UmzugStand | null, () => void] {
  const { signer } = useWallet();
  const [stand, setStand] = useState<UmzugStand | null>(null);
  const laden = useCallback(() => {
    if (!signer) return;
    umzugStand(signer.address).then(setStand).catch(() => setStand(null));
  }, [signer]);
  useFocusEffect(
    useCallback(() => {
      laden();
      const timer = setInterval(laden, 60_000);
      return () => clearInterval(timer);
    }, [laden]),
  );
  return [stand, laden];
}

const aktiv = (s: UmzugStand | null) => !!s && s.aktivAb > 0 && s.aktivAb <= Math.floor(Date.now() / 1000);

export function UmzugHinweis() {
  const { t } = useLanguage();
  const { signer } = useWallet();
  const [stand, laden] = useUmzugStand();
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState('');
  const ich = signer?.address.toLowerCase() ?? '';
  const o = stand?.offen;
  if (!aktiv(stand) || !o) return null;

  if (o.alt === ich) {
    const stoppen = () => {
      Alert.alert(t('umzug.warnWiderrufen'), t('umzug.warnText').replace('{neu}', kurz(o.neu)).replace('{datum}', datum(o.freiAb)), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('umzug.warnWiderrufen'),
          style: 'destructive',
          onPress: async () => {
            if (!signer) return;
            setLaeuft(true);
            try {
              const r = await withTimeout(widerrufen(signer, o), 120_000, t('trade.signTimeout'));
              setMeldung(r.ok ? t('umzug.warnWiderrufenOk') : t('umzug.fehler').replace('{grund}', r.meldung ?? ''));
              laden();
            } catch (e: any) {
              setMeldung(t('umzug.fehler').replace('{grund}', e?.message ?? ''));
            } finally {
              setLaeuft(false);
            }
          },
        },
      ]);
    };
    if (o.fest) {
      return (
        <View style={[S.karte, S.warnKarte]}>
          <Text style={S.warnTitel}>{t('umzug.warnTitel')}</Text>
          <Text style={S.text}>{t('umzug.warnFestText').replace('{neu}', kurz(o.neu)).replace('{datum}', datum(o.freiAb))}</Text>
        </View>
      );
    }
    return (
      <View style={[S.karte, S.warnKarte]}>
        <Text style={S.warnTitel}>{t('umzug.warnTitel')}</Text>
        <Text style={S.text}>{t('umzug.warnText').replace('{neu}', kurz(o.neu)).replace('{datum}', datum(o.freiAb))}</Text>
        <TouchableOpacity style={[S.warnKnopf, laeuft && S.aus]} disabled={laeuft} onPress={stoppen} accessibilityRole="button">
          <Text style={S.knopfText}>{t('umzug.warnWiderrufen')}</Text>
        </TouchableOpacity>
        {laeuft ? <ActivityIndicator color={theme.red} style={S.abstand} /> : null}
        {meldung ? <Text style={S.meldung}>{meldung}</Text> : null}
      </View>
    );
  }
  if (o.neu === ich) {
    return (
      <View style={S.karte}>
        <Text style={S.titel}>{t('umzug.laeuftTitel')}</Text>
        <Text style={S.text}>{t('umzug.laeuftText').replace('{datum}', datum(o.freiAb))}</Text>
      </View>
    );
  }
  return null;
}

export function UmzugIdentitaet({ istMensch }: { istMensch: boolean }) {
  const { t } = useLanguage();
  const [stand] = useUmzugStand();
  if (!aktiv(stand) || stand?.offen) return null;
  if (istMensch) {
    const seit = stand?.codeSeit ?? 0;
    return (
      <View style={S.karte}>
        <Text style={S.titel}>{t('umzug.karteTitel')}</Text>
        <Text style={S.text}>{seit > 0 ? t('umzug.karteMit').replace('{datum}', datum(seit)) : t('umzug.karteOhne')}</Text>
        <TouchableOpacity style={seit > 0 ? S.leiseKnopf : S.knopf} onPress={() => router.push('/wiederherstellungscode')} accessibilityRole="button">
          <Text style={seit > 0 ? S.leiseText : S.knopfText}>{seit > 0 ? t('umzug.codeNeu') : t('umzug.karteLink')}</Text>
        </TouchableOpacity>
      </View>
    );
  }
  return (
    <View style={S.karte}>
      <Text style={S.titel}>{t('umzug.zurueckTitel')}</Text>
      <Text style={S.text}>{t('umzug.zurueckText')}</Text>
      <TouchableOpacity style={S.leiseKnopf} onPress={() => router.push('/umzug')} accessibilityRole="button">
        <Text style={S.leiseText}>{t('umzug.zurueckLink')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const S = StyleSheet.create({
  karte: { marginHorizontal: 16, marginTop: 12, padding: 14, borderRadius: 14, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border },
  warnKarte: { borderColor: theme.red, borderWidth: 2 },
  titel: { color: theme.text, fontSize: 15, fontWeight: '700', marginBottom: 4 },
  warnTitel: { color: theme.red, fontSize: 16, fontWeight: '800', marginBottom: 6 },
  text: { color: theme.text, fontSize: 14, lineHeight: 20 },
  knopf: { marginTop: 10, backgroundColor: theme.accent, borderRadius: theme.radiusPill, paddingVertical: 11, alignItems: 'center' },
  warnKnopf: { marginTop: 10, backgroundColor: theme.red, borderRadius: theme.radiusPill, paddingVertical: 11, alignItems: 'center' },
  knopfText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  leiseKnopf: { marginTop: 10, borderWidth: 1, borderColor: theme.border, borderRadius: theme.radiusPill, paddingVertical: 10, alignItems: 'center' },
  leiseText: { color: theme.text, fontSize: 14, fontWeight: '600' },
  aus: { opacity: 0.45 },
  abstand: { marginTop: 10 },
  meldung: { color: theme.muted, fontSize: 13, marginTop: 8 },
});
