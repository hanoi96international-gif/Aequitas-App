import React, { useState } from 'react';
import { Alert, Linking, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { useLanguage } from '@/contexts/LanguageContext';
import { pdfLocaleFor } from '@/lib/i18n';
import { WEBAPP } from '@/lib/config';
import { theme, purpleTint, purpleTintBorder, goldTint, goldTintBorder, neonTint, neonTintBorder } from '@/constants/aequitas-theme';

const GITHUB_URL = 'https://github.com/hanoi96international-gif/Aequitas';

const DOCKER_CMD = `# 1. Install Docker (if not already installed)
curl -fsSL https://get.docker.com | sh

# 2. Clone and build the node (~3 min Go compile)
git clone https://github.com/hanoi96international-gif/Aequitas && cd Aequitas
docker build -t aequitas-node .

# 3. First start (NODE_KEY will be printed in logs)
docker run -d --name aequitas-node --restart unless-stopped \\
  -e DATABASE_URL="postgres://aequitas:YOUR_DB_PASSWORD@172.17.0.1:5432/aequitas" \\
  -e RELAYER_PRIVATE_KEY="0xYOUR_PRIVATE_KEY" \\
  -e RELAYER_ADDRESS="0xYOUR_NODE_SIGNING_ADDRESS" \\
  -e NODE_OPERATOR_WALLET="0xYOUR_REGISTERED_HUMAN_WALLET" \\
  -e SELF_URL="http://YOUR-SERVER-IP:8080" \\
  -e PRIMARY_NODE_URL="https://aequitas.digital" \\
  -e BOOTSTRAP_SNAPSHOT_URL="https://aequitas.digital/api/snapshot" \\
  -e BOOTSTRAP_SIGNER="0x92cbedec9d348b4762cb9af99500ee6139c5b671" \\
  -e AUTO_HEAL_ON_DIVERGENCE="true" \\
  -p 8080:8080 -p 4001:4001 aequitas-node

# 4. Copy NODE_KEY from logs (only needed once)
docker logs aequitas-node 2>&1 | grep "SAVE THIS AS NODE_KEY"

# 5. Stop, add NODE_KEY, restart permanently
docker stop aequitas-node && docker rm aequitas-node
docker run -d --name aequitas-node --restart unless-stopped \\
  -e DATABASE_URL="postgres://aequitas:YOUR_DB_PASSWORD@172.17.0.1:5432/aequitas" \\
  -e RELAYER_PRIVATE_KEY="0xYOUR_PRIVATE_KEY" \\
  -e RELAYER_ADDRESS="0xYOUR_NODE_SIGNING_ADDRESS" \\
  -e NODE_OPERATOR_WALLET="0xYOUR_REGISTERED_HUMAN_WALLET" \\
  -e NODE_KEY="base64-from-step-4" \\
  -e SELF_URL="http://YOUR-SERVER-IP:8080" \\
  -e PRIMARY_NODE_URL="https://aequitas.digital" \\
  -e BOOTSTRAP_SNAPSHOT_URL="https://aequitas.digital/api/snapshot" \\
  -e BOOTSTRAP_SIGNER="0x92cbedec9d348b4762cb9af99500ee6139c5b671" \\
  -e AUTO_HEAL_ON_DIVERGENCE="true" \\
  -p 8080:8080 -p 4001:4001 aequitas-node`;

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
  const { t, lang } = useLanguage();
  const [showFullCmd, setShowFullCmd] = useState(false);

  const pdfUrl = `${WEBAPP}/download/node-guide-${pdfLocaleFor(lang)}.pdf`;

  const ENV_VARS: { key: string; required: string; desc: string }[] = [
    { key: 'DATABASE_URL', required: t('node.reqYes'), desc: t('node.envDatabaseUrl') },
    { key: 'RELAYER_PRIVATE_KEY', required: t('node.reqYes'), desc: t('node.envRelayerKey') },
    { key: 'RELAYER_ADDRESS', required: t('node.reqRecommended'), desc: t('node.envRelayerAddr') },
    { key: 'NODE_OPERATOR_WALLET', required: t('node.reqForRewards'), desc: t('node.envNodeOperator') },
    { key: 'SELF_URL', required: t('node.reqYes'), desc: t('node.envSelfUrl') },
    { key: 'PRIMARY_NODE_URL', required: t('node.reqForMultiNode'), desc: t('node.envPrimaryUrl') },
    { key: 'NODE_KEY', required: t('node.reqNo'), desc: t('node.envNodeKey') },
    { key: 'BOOTSTRAP_SNAPSHOT_URL', required: t('node.reqForMultiNode'), desc: t('node.envBootstrapSnapshot') },
    { key: 'BOOTSTRAP_SIGNER', required: t('node.reqForMultiNode'), desc: t('node.envBootstrapSigner') },
    { key: 'AUTO_HEAL_ON_DIVERGENCE', required: t('node.reqRecommended'), desc: t('node.envAutoHeal') },
  ];

  const verifyUrl = 'https://YOUR-NODE-URL/api/status';

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

        <TouchableOpacity style={S.pdfBtn} onPress={() => Linking.openURL(pdfUrl)} activeOpacity={0.85}>
          <Text style={S.pdfBtnText}>{t('node.pdfGuideBtn')}</Text>
        </TouchableOpacity>

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
          <Text style={S.cardTitle}>{t('node.envVarsTitle')}</Text>
          {ENV_VARS.map((v) => (
            <View key={v.key} style={S.envRow}>
              <View style={S.envHead}>
                <Text style={S.envKey}>{v.key}</Text>
                <Text style={[S.envReq, v.required === t('node.reqYes') && { color: theme.red }]}>{v.required}</Text>
              </View>
              <Text style={S.envDesc}>{v.desc}</Text>
            </View>
          ))}
        </View>

        <View style={S.card}>
          <Text style={S.cardTitle}>{t('node.dockerDeployTitle')}</Text>
          <Text style={S.faucetDesc}>{t('node.dockerDeployDesc')}</Text>
          {showFullCmd ? (
            <CodeBlock code={DOCKER_CMD} copyBtnLabel={t('node.copyBtn')} copiedTitle={t('common.copied')} copiedMsg={t('node.cmdCopiedMsg')} />
          ) : (
            <TouchableOpacity style={S.showCmdBtn} onPress={() => setShowFullCmd(true)} activeOpacity={0.85}>
              <Text style={S.showCmdBtnText}>{t('node.showCmdBtn')}</Text>
            </TouchableOpacity>
          )}
          <Text style={S.portNote}>{t('node.portNote')}</Text>
        </View>

        <View style={S.card}>
          <Text style={S.cardTitle}>{t('node.verifyTitle')}</Text>
          <Text style={S.faucetDesc}>{t('node.verifyDesc').replace('{url}', verifyUrl)}</Text>
        </View>

        <View style={S.card}>
          <Text style={S.cardTitle}>{t('node.rpcTitle')}</Text>
          <DetailRow label={t('node.networkName')} value="Aequitas Chain" />
          <DetailRow label={t('node.rpcUrl')} value="https://YOUR-NODE-URL/rpc" />
          <DetailRow label={t('node.chainId')} value="1926" />
          <DetailRow label={t('node.currencySymbol')} value="AEQ" />
          <DetailRow label={t('node.decimals')} value="18" last />
        </View>

        <TouchableOpacity style={S.githubBtn} onPress={() => Linking.openURL(GITHUB_URL)} activeOpacity={0.8}>
          <Text style={S.githubBtnText}>{t('node.githubBtn')}</Text>
        </TouchableOpacity>
      </ScrollView>
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

  pdfBtn: { marginHorizontal: 20, marginTop: 14, backgroundColor: theme.gold, borderRadius: theme.radiusSm, padding: 15, alignItems: 'center' },
  pdfBtnText: { color: '#06091A', fontWeight: '700', fontSize: 13, letterSpacing: 0.5 },

  card: { marginHorizontal: 20, backgroundColor: theme.card, borderRadius: theme.radius, padding: 20, marginTop: 16, borderWidth: 1, borderColor: theme.border },
  cardTitle: { fontSize: 11, color: theme.muted, letterSpacing: 3, marginBottom: 14, fontWeight: '600' },
  faucetDesc: { color: theme.muted, fontSize: 12, marginBottom: 4, lineHeight: 17 },

  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 },
  checkMark: { color: theme.neon, fontSize: 13, fontWeight: '700' },
  checkText: { color: theme.text, fontSize: 12, flex: 1, lineHeight: 17 },

  envRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.border },
  envHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  envKey: { color: theme.teal, fontSize: 12, fontFamily: theme.fontMono, fontWeight: '700' },
  envReq: { color: theme.muted, fontSize: 10, fontWeight: '600', letterSpacing: 0.5 },
  envDesc: { color: theme.muted, fontSize: 11, lineHeight: 16 },

  showCmdBtn: { borderWidth: 1, borderColor: theme.border, borderRadius: theme.radiusSm, padding: 15, alignItems: 'center', marginTop: 10, backgroundColor: theme.card2 },
  showCmdBtnText: { color: theme.text, fontWeight: '700', fontSize: 12, letterSpacing: 1 },
  codeBlock: { backgroundColor: '#0A0C16', borderWidth: 1, borderColor: theme.border, borderRadius: theme.radiusSm, padding: 12, marginTop: 10 },
  copyBtn: { alignSelf: 'flex-end', borderWidth: 1, borderColor: theme.border, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, marginBottom: 8 },
  copyBtnText: { color: theme.muted, fontSize: 10 },
  codeText: { color: theme.neon, fontSize: 10, fontFamily: theme.fontMono, lineHeight: 15 },
  portNote: { color: theme.muted, fontSize: 10, marginTop: 10, lineHeight: 15 },

  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: theme.border },
  detailKey: { color: theme.muted, fontSize: 12 },
  detailVal: { color: theme.text, fontSize: 12, fontWeight: '600', fontFamily: theme.fontMono },

  githubBtn: { marginHorizontal: 20, marginTop: 20, borderWidth: 1, borderColor: neonTintBorder, backgroundColor: neonTint, borderRadius: theme.radiusSm, padding: 15, alignItems: 'center' },
  githubBtnText: { color: theme.neon, fontWeight: '700', fontSize: 12, letterSpacing: 0.5 },
});
