import React, { useCallback, useState } from 'react';
import { Alert, Linking, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { QrScanner } from '@/components/QrScanner';
import { bindungsanfrageAblehnen, holeBindungsanfragen, leseKnotenbindung, type Bindungsanfrage } from '@/lib/knotenBindung';
import { useWallet } from '@/contexts/WalletContext';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { useLanguage } from '@/contexts/LanguageContext';
import { CHAIN_ID_DEC, RPC_URL } from '@/lib/config';
import { theme, purpleTint, purpleTintBorder, goldTint, goldTintBorder, neonTint, neonTintBorder } from '@/constants/aequitas-theme';

const GITHUB_URL = 'https://github.com/hanoi96international-gif/Aequitas';
// Die Anleitungen liegen im Repo und sind damit immer auf dem Stand des Codes
// (docs/VALIDATOR_EINRICHTEN.md, docs/VERIFIER_EINRICHTEN.md).
const GUIDE_URL = GITHUB_URL + '/blob/main/docs/VALIDATOR_EINRICHTEN.md';

// Ein Befehl (docs/VALIDATOR_EINRICHTEN.md): die erste Zeile installiert
// Docker, die zweite holt Aequitas, die dritte richtet alles ein. Die Wallet
// steht schon drin; am Ende meldet der Server eine Anfrage, die dieser Tab von
// selbst anzeigt (keeper/bindungsanfrage.go).
function setupCmd(wallet?: string | null): string {
  const w = wallet && /^0x[0-9a-fA-F]{40}$/.test(wallet) ? ' ' + wallet.toLowerCase() : '';
  return `curl -fsSL https://get.docker.com | sh
git clone https://github.com/hanoi96international-gif/Aequitas.git
cd Aequitas/deploy/validator && bash einrichten.sh${w}`;
}

// Dasselbe fuer den Vergleichsdienst (docs/VERIFIER_EINRICHTEN.md).
const VERIFIER_CMD = `curl -fsSL https://get.docker.com | sh
git clone https://github.com/hanoi96international-gif/Aequitas.git
cd Aequitas/deploy/verifier && bash einrichten.sh`;
const VERIFIER_GUIDE_URL = GITHUB_URL + '/blob/main/docs/VERIFIER_EINRICHTEN.md';

const CHECK_CMD = `curl -s http://localhost:8080/api/status | grep -oE '"height":[0-9]+'
curl -s https://aequitas.digital/api/status | grep -oE '"height":[0-9]+'`;

function CodeBlock({ code, copyBtnLabel, copiedTitle, copiedMsg }: { code: string; copyBtnLabel: string; copiedTitle: string; copiedMsg: string }) {
  async function copy() {
    await Clipboard.setStringAsync(code);
    Alert.alert(copiedTitle, copiedMsg);
  }
  return (
    <View style={S.codeBlock}>
      <TouchableOpacity onPress={copy} style={S.copyBtn} activeOpacity={0.7}>
        <Text style={S.copyBtnText}>{copyBtnLabel}</Text>
      </TouchableOpacity>
      <Text style={S.codeText}>{code}</Text>
    </View>
  );
}

export default function RunNode() {
  const { t } = useLanguage();

  const { address, signer } = useWallet();
  const [scanOffen, setScanOffen] = useState(false);
  const [anfragen, setAnfragen] = useState<Bindungsanfrage[]>([]);

  // Offene Anfragen meiner Server: alle 5 s, solange dieser Tab offen ist.
  useFocusEffect(
    useCallback(() => {
      if (!address) return;
      let aus = false;
      const lesen = () => holeBindungsanfragen(address).then((a) => { if (!aus) setAnfragen(a); });
      lesen();
      const timer = setInterval(lesen, 5000);
      return () => { aus = true; clearInterval(timer); };
    }, [address]),
  );

  function bestaetigen(a: Bindungsanfrage) {
    router.push({ pathname: '/knoten-binden', params: { adresse: a.adresse, wallet: a.wallet, beweis: a.beweis } });
  }

  async function ablehnen(a: Bindungsanfrage) {
    if (!signer) return;
    try {
      await bindungsanfrageAblehnen(signer, a.adresse);
    } finally {
      setAnfragen((alt) => alt.filter((x) => x.adresse !== a.adresse));
    }
  }

  function gescannt(roh: string) {
    setScanOffen(false);
    const b = leseKnotenbindung(roh);
    if (!b) {
      Alert.alert(t('node.bindTitle'), t('node.bindInvalid'));
      return;
    }
    router.push({ pathname: '/knoten-binden', params: { adresse: b.adresse, wallet: b.wallet, beweis: b.beweis } });
  }

  return (
    <SafeAreaView style={S.safe} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={theme.bg} />
      <ScrollView contentContainerStyle={S.content} showsVerticalScrollIndicator={false}>
        <View style={S.hero}>
          <Text style={S.heroTitle}>{t('node.title')}</Text>
          <Text style={S.heroSub}>
            {t('node.subtitle')} <Text style={{ color: theme.gold, fontWeight: '700' }}>{t('node.subtitleHighlight')}</Text>
          </Text>
        </View>

        <View style={S.privBar}>
          <Text style={S.privBarText}>{t('node.rewardBanner')}</Text>
        </View>

        <View style={S.card}>
          <Text style={S.cardTitle}>{t('node.requirementsTitle')}</Text>
          {[t('node.req1'), t('node.req2'), t('node.req3'), t('node.req4'), t('node.req5')].map((r, i) => (
            <View key={i} style={S.checkRow}>
              <Text style={S.checkMark}>✓</Text>
              <Text style={S.checkText}>{r}</Text>
            </View>
          ))}
        </View>

        <View style={S.card}>
          <Text style={S.cardTitle}>{t('node.setupTitle')}</Text>
          <Text style={S.faucetDesc}>{t('node.setupDesc')}</Text>
          <CodeBlock code={setupCmd(address)} copyBtnLabel={t('node.copyBtn')} copiedTitle={t('common.copied')} copiedMsg={t('node.cmdCopiedMsg')} />
          <Text style={S.portNote}>{t('node.portNote')}</Text>
        </View>

        <View style={S.card}>
          <Text style={S.cardTitle}>{t('node.bindTitle')}</Text>
          <Text style={S.faucetDesc}>{t('node.bindDesc')}</Text>
          {anfragen.length === 0 ? (
            <Text style={S.portNote}>{t('node.bindAnfrageLeer')}</Text>
          ) : (
            anfragen.map((a) => (
              <View key={a.adresse} style={S.anfrage}>
                <Text style={S.anfrageText}>{t('node.bindAnfrageVon').replace('{ip}', a.ip)}</Text>
                <Text style={S.anfrageAdr}>{a.adresse}</Text>
                <TouchableOpacity style={S.scanBtn} onPress={() => bestaetigen(a)} activeOpacity={0.85}>
                  <Text style={S.pdfBtnText}>{t('node.bindConfirmBtn')}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => ablehnen(a)} activeOpacity={0.7}>
                  <Text style={S.ablehnen}>{t('node.bindAblehnen')}</Text>
                </TouchableOpacity>
              </View>
            ))
          )}
          <TouchableOpacity onPress={() => setScanOffen(true)} activeOpacity={0.7}>
            <Text style={S.qrLink}>{t('node.bindQrStattdessen')}</Text>
          </TouchableOpacity>
        </View>

        <View style={S.card}>
          <Text style={S.cardTitle}>{t('node.admissionTitle')}</Text>
          <Text style={S.faucetDesc}>{t('node.admissionDesc')}</Text>
        </View>

        <View style={S.card}>
          <Text style={S.cardTitle}>{t('node.verifyTitle')}</Text>
          <Text style={S.faucetDesc}>{t('node.verifyDesc')}</Text>
          <CodeBlock code={CHECK_CMD} copyBtnLabel={t('node.copyBtn')} copiedTitle={t('common.copied')} copiedMsg={t('node.cmdCopiedMsg')} />
        </View>

        <TouchableOpacity style={S.pdfBtn} onPress={() => Linking.openURL(GUIDE_URL)} activeOpacity={0.85}>
          <Text style={S.pdfBtnText}>{t('node.guideBtn')}</Text>
        </TouchableOpacity>

        <View style={S.card}>
          <Text style={S.cardTitle}>{t('node.verifierTitle')}</Text>
          <Text style={S.faucetDesc}>{t('node.verifierDesc')}</Text>
          <CodeBlock code={VERIFIER_CMD} copyBtnLabel={t('node.copyBtn')} copiedTitle={t('common.copied')} copiedMsg={t('node.cmdCopiedMsg')} />
          <Text style={S.portNote}>{t('node.verifierNote')}</Text>
          <TouchableOpacity style={S.githubBtn} onPress={() => Linking.openURL(VERIFIER_GUIDE_URL)} activeOpacity={0.8}>
            <Text style={S.githubBtnText}>{t('node.verifierGuideBtn')}</Text>
          </TouchableOpacity>
        </View>

        <View style={S.card}>
          <Text style={S.cardTitle}>{t('node.rpcTitle')}</Text>
          <DetailRow label={t('node.networkName')} value="Aequitas" />
          <DetailRow label={t('node.rpcUrl')} value={RPC_URL} />
          <DetailRow label={t('node.chainId')} value={String(CHAIN_ID_DEC)} />
          <DetailRow label={t('node.currencySymbol')} value="AEQ" />
          <DetailRow label={t('node.decimals')} value="18" last />
        </View>
      </ScrollView>
      <QrScanner visible={scanOffen} onScanned={gescannt} onClose={() => setScanOffen(false)} />
    </SafeAreaView>
  );
}

function DetailRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[S.detailRow, last && { borderBottomWidth: 0 }]}>
      <Text style={S.detailKey}>{label}</Text>
      <Text style={S.detailVal}>{value}</Text>
    </View>
  );
}

const S = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.bg },
  content: { paddingBottom: 40 },

  hero: { marginHorizontal: 20, marginTop: 12, backgroundColor: purpleTint, borderWidth: 1, borderColor: purpleTintBorder, borderRadius: theme.radius, padding: 22, alignItems: 'center' },
  heroTitle: { fontSize: 16, fontWeight: '700', color: theme.text, marginBottom: 8 },
  heroSub: { fontSize: 12, color: theme.muted, lineHeight: 18, textAlign: 'center' },

  privBar: { marginHorizontal: 20, marginTop: 12, backgroundColor: goldTint, borderWidth: 1, borderColor: goldTintBorder, borderRadius: theme.radiusSm, padding: 10 },
  privBarText: { fontSize: 11, color: theme.gold, textAlign: 'center', lineHeight: 16 },

  pdfBtn: { marginHorizontal: 20, marginTop: 20, backgroundColor: theme.accent, borderRadius: theme.radiusPill, padding: 15, alignItems: 'center' },
  pdfBtnText: { color: '#fff', fontWeight: '700', fontSize: 14, letterSpacing: 0.3 },
  scanBtn: { marginTop: 12, backgroundColor: theme.accent, borderRadius: theme.radiusPill, padding: 15, alignItems: 'center' },

  card: { marginHorizontal: 20, backgroundColor: theme.card, borderRadius: theme.radius, padding: 20, marginTop: 16, borderWidth: 1, borderColor: theme.border },
  cardTitle: { fontSize: 11, color: theme.muted, letterSpacing: 3, marginBottom: 14, fontWeight: '600' },
  faucetDesc: { color: theme.muted, fontSize: 12, marginBottom: 4, lineHeight: 17 },

  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 },
  checkMark: { color: theme.neon, fontSize: 13, fontWeight: '700' },
  checkText: { color: theme.text, fontSize: 12, flex: 1, lineHeight: 17 },


  codeBlock: { backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border, borderRadius: theme.radiusSm, padding: 12, marginTop: 10 },
  anfrage: { borderWidth: 1, borderColor: theme.gold, borderRadius: 12, padding: 12, marginTop: 8, marginBottom: 8 },
  anfrageText: { color: theme.text, fontSize: 15, fontWeight: '700', marginBottom: 6 },
  anfrageAdr: { color: theme.muted, fontSize: 11, fontFamily: 'monospace', marginBottom: 8 },
  ablehnen: { color: theme.muted, fontSize: 13, textAlign: 'center', marginTop: 10 },
  qrLink: { color: theme.muted, fontSize: 12, textAlign: 'center', marginTop: 12, textDecorationLine: 'underline' },
  copyBtn: { alignSelf: 'flex-end', borderWidth: 1, borderColor: theme.border, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, marginBottom: 8 },
  copyBtnText: { color: theme.muted, fontSize: 10 },
  codeText: { color: theme.neon, fontSize: 10, fontFamily: theme.fontMono, lineHeight: 15 },
  portNote: { color: theme.muted, fontSize: 10, marginTop: 10, lineHeight: 15 },

  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: theme.border },
  detailKey: { color: theme.muted, fontSize: 12 },
  detailVal: { color: theme.text, fontSize: 12, fontWeight: '600', fontFamily: theme.fontMono },

  githubBtn: { marginHorizontal: 20, marginTop: 10, borderWidth: 1, borderColor: neonTintBorder, backgroundColor: neonTint, borderRadius: theme.radiusPill, padding: 15, alignItems: 'center' },
  githubBtnText: { color: theme.neon, fontWeight: '700', fontSize: 12, letterSpacing: 0.5 },
});
