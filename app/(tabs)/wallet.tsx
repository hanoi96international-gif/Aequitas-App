import React, { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { useWallet } from '@/contexts/WalletContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { formatBalance, isValidAddress, parseAEQToWei, shortWallet } from '@/lib/format';
import { postFaucet } from '@/lib/api';
import { withTimeout } from '@/lib/signer';
import { theme, redTintBorder } from '@/constants/aequitas-theme';

// FIX (Monster Audit follow-up, 2026-07-12, P1): matches trade.tsx's own
// SIGN_TIMEOUT_MS/withTimeout usage — see lib/signer.ts's comment for why a
// WalletConnect signing call needs a timeout at all. This screen's Send and
// Faucet buttons were the two signing call sites in the app that hadn't
// gotten the fix trade.tsx already has on all 4 of its own.
const SIGN_TIMEOUT_MS = 60_000;

export default function Wallet() {
  const { address, mode, balance, signer, refreshBalance, disconnectWallet } = useWallet();
  const { t } = useLanguage();
  const [showReceive, setShowReceive] = useState(false);
  const [sendTo, setSendTo] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [sendBusy, setSendBusy] = useState(false);
  const [sendStatus, setSendStatus] = useState('');
  const [faucetBusy, setFaucetBusy] = useState(false);
  const [faucetStatus, setFaucetStatus] = useState('');

  async function copyAddress() {
    if (!address) return;
    await Clipboard.setStringAsync(address);
    Alert.alert(t('common.copied'), t('wallet.addressCopiedMsg'));
  }

  async function doSend() {
    if (!signer) return;
    if (!isValidAddress(sendTo)) {
      setSendStatus(t('wallet.invalidRecipient'));
      return;
    }
    const amountWei = parseAEQToWei(sendAmount);
    if (amountWei === null || amountWei <= 0n) {
      setSendStatus(t('wallet.enterAmount'));
      return;
    }
    setSendBusy(true);
    setSendStatus(t('wallet.sendingTx'));
    try {
      const hash = await withTimeout(signer.sendTransaction({ to: sendTo, value: amountWei }), SIGN_TIMEOUT_MS, t('trade.signTimeout'));
      setSendStatus(t('wallet.sentTx') + hash.slice(0, 12) + '…');
      setSendTo('');
      setSendAmount('');
      setTimeout(refreshBalance, 3000);
    } catch (e: any) {
      setSendStatus('✗ ' + (e?.message ?? t('wallet.sendError')));
    } finally {
      setSendBusy(false);
    }
  }

  async function doFaucet() {
    if (!signer || !address) return;
    setFaucetBusy(true);
    setFaucetStatus(t('wallet.faucetRequesting'));
    try {
      const ts = Math.floor(Date.now() / 1000);
      const msg = 'Aequitas tUSD Faucet Claim: ' + address.toLowerCase() + ' ts:' + ts;
      const sig = await withTimeout(signer.signMessage(msg), SIGN_TIMEOUT_MS, t('trade.signTimeout'));
      const d = await postFaucet({ wallet: address, timestamp: ts, signature: sig });
      if (!d.success) throw new Error(d.message || t('wallet.faucetFailed'));
      setFaucetStatus(t('wallet.faucetSent'));
      setTimeout(refreshBalance, 2000);
    } catch (e: any) {
      setFaucetStatus('✗ ' + (e?.message ?? t('wallet.faucetError')));
    } finally {
      setFaucetBusy(false);
    }
  }

  function confirmDisconnect() {
    Alert.alert(
      mode === 'local' ? t('wallet.removeWalletTitle') : t('wallet.disconnectTitle'),
      mode === 'local' ? t('wallet.removeWalletDesc') : t('wallet.disconnectDesc'),
      [
        { text: t('wallet.cancel'), style: 'cancel' },
        {
          text: mode === 'local' ? t('wallet.remove') : t('wallet.disconnect'),
          style: 'destructive',
          onPress: async () => {
            const wasWalletConnect = mode === 'walletconnect';
            await disconnectWallet();
            // A wedged WalletConnect session can leave stale listeners alive
            // in the current JS process even after storage is cleared (see
            // resetWalletConnectStorage's comment) — only a fresh process
            // guarantees a clean SignClient instance for the next connection.
            if (wasWalletConnect) {
              Alert.alert(t('wallet.resetTitle'), t('wallet.resetDesc'));
            }
          },
        },
      ]
    );
  }

  return (
    <SafeAreaView style={S.safe} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={theme.bg} />
      <ScrollView contentContainerStyle={S.content} showsVerticalScrollIndicator={false}>
        <View style={S.header}>
          <Text style={S.title}>{t('wallet.title')}</Text>
          <TouchableOpacity onPress={copyAddress} style={S.addressRow} activeOpacity={0.7}>
            <Text style={S.address}>{shortWallet(address)}</Text>
            <Text style={S.copyHint}>{t('wallet.copyHint')}</Text>
          </TouchableOpacity>
        </View>

        <View style={S.balanceCard}>
          <Text style={S.balanceLabel}>AEQ</Text>
          <Text style={S.balanceValue}>{formatBalance(balance?.balance)}</Text>
          <View style={S.divider} />
          <Text style={S.balanceLabel}>tUSD</Text>
          <Text style={S.balanceValueSmall}>{formatBalance(balance?.tusd_balance)}</Text>
          {balance?.demurrage_active && (
            <View style={S.demurrageWarn}>
              <Text style={S.demurrageText}>{t('wallet.demurrageActive')}</Text>
            </View>
          )}
        </View>

        <View style={S.actionsRow}>
          <TouchableOpacity style={S.actionBtn} onPress={() => setShowReceive((v) => !v)} activeOpacity={0.8}>
            <Text style={S.actionBtnText}>{t('wallet.receive')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={S.actionBtn} onPress={doFaucet} disabled={faucetBusy} activeOpacity={0.8}>
            {faucetBusy ? <ActivityIndicator color={theme.purple} /> : <Text style={S.actionBtnText}>{t('wallet.faucet')}</Text>}
          </TouchableOpacity>
        </View>
        {faucetStatus ? <Text style={S.statusText}>{faucetStatus}</Text> : null}

        {showReceive && address && (
          <View style={S.card}>
            <Text style={S.cardTitle}>{t('wallet.yourAddress')}</Text>
            <View style={S.qrWrap}>
              <QRCode value={address} size={180} backgroundColor={theme.card} color={theme.text} />
            </View>
            <Text style={S.fullAddress}>{address}</Text>
          </View>
        )}

        <View style={S.card}>
          <Text style={S.cardTitle}>{t('wallet.sendAeq')}</Text>
          <TextInput
            style={S.input}
            placeholder={t('wallet.recipientPlaceholder')}
            placeholderTextColor={theme.muted}
            value={sendTo}
            onChangeText={setSendTo}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextInput
            style={S.input}
            placeholder={t('wallet.amountPlaceholder')}
            placeholderTextColor={theme.muted}
            value={sendAmount}
            onChangeText={setSendAmount}
            keyboardType="decimal-pad"
          />
          {sendStatus ? <Text style={S.statusText}>{sendStatus}</Text> : null}
          <TouchableOpacity onPress={doSend} disabled={sendBusy} activeOpacity={0.85}>
            <LinearGradient colors={theme.gradient} start={theme.gradientAngle.start} end={theme.gradientAngle.end} style={S.btnPrimary}>
              {sendBusy ? <ActivityIndicator color="#fff" /> : <Text style={S.btnPrimaryText}>{t('wallet.send')}</Text>}
            </LinearGradient>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={S.btnDanger} onPress={confirmDisconnect} activeOpacity={0.8}>
          <Text style={S.btnDangerText}>{mode === 'local' ? t('wallet.removeWallet') : t('wallet.disconnect')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const S = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.bg },
  content: { paddingBottom: 40 },
  header: { paddingTop: 12, paddingBottom: 16, paddingHorizontal: 20 },
  title: { fontSize: 22, fontWeight: '900', color: theme.text, letterSpacing: 2 },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  address: { color: theme.teal, fontSize: 13, fontFamily: theme.fontMono },
  copyHint: { color: theme.muted, fontSize: 10, borderWidth: 1, borderColor: theme.border, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },

  balanceCard: { marginHorizontal: 20, backgroundColor: theme.card, borderRadius: theme.radius, padding: 24, borderWidth: 1, borderColor: theme.border, marginBottom: 16, alignItems: 'center' },
  balanceLabel: { color: theme.muted, fontSize: 11, letterSpacing: 2 },
  balanceValue: { color: theme.gold, fontSize: 38, fontWeight: '900', marginTop: 4 },
  balanceValueSmall: { color: theme.text, fontSize: 20, fontWeight: '700', marginTop: 4 },
  divider: { height: 1, backgroundColor: theme.border, width: '100%', marginVertical: 16 },
  demurrageWarn: { marginTop: 14, backgroundColor: 'rgba(240,180,41,0.06)', borderWidth: 1, borderColor: 'rgba(240,180,41,0.2)', borderRadius: 8, padding: 10 },
  demurrageText: { color: theme.gold, fontSize: 11, textAlign: 'center' },

  actionsRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, marginBottom: 8 },
  actionBtn: { flex: 1, borderWidth: 1, borderColor: theme.border, borderRadius: theme.radiusSm, paddingVertical: 14, alignItems: 'center' },
  actionBtnText: { color: theme.text, fontSize: 12, letterSpacing: 1 },
  statusText: { color: theme.muted, fontSize: 11, textAlign: 'center', marginTop: 8, marginHorizontal: 20 },

  card: { marginHorizontal: 20, backgroundColor: theme.card, borderRadius: theme.radius, padding: 20, marginTop: 16, borderWidth: 1, borderColor: theme.border },
  cardTitle: { fontSize: 11, color: theme.muted, letterSpacing: 3, marginBottom: 14, fontWeight: '600' },
  qrWrap: { alignItems: 'center', backgroundColor: theme.card, padding: 12, borderRadius: 12, alignSelf: 'center' },
  fullAddress: { color: theme.muted, fontSize: 11, textAlign: 'center', marginTop: 14, fontFamily: theme.fontMono },

  input: { backgroundColor: theme.card2, borderWidth: 1, borderColor: theme.border, borderRadius: theme.radiusSm, padding: 14, color: theme.text, fontSize: 13, marginBottom: 10 },
  btnPrimary: { borderRadius: theme.radiusSm, padding: 16, alignItems: 'center', marginTop: 4 },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 13, letterSpacing: 1.5 },

  btnDanger: { marginHorizontal: 20, marginTop: 24, borderWidth: 1, borderColor: redTintBorder, borderRadius: theme.radiusSm, padding: 14, alignItems: 'center' },
  btnDangerText: { color: theme.red, fontSize: 11, letterSpacing: 1.5 },
});
