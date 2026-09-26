import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { useWallet } from '@/contexts/WalletContext';
import { useLanguage } from '@/contexts/LanguageContext';
import type { TranslationKey } from '@/contexts/LanguageContext';
import { formatBalance, isValidAddress, parseAEQToWei, shortWallet } from '@/lib/format';
import { getWirtschaftKonto, postFaucet } from '@/lib/api';
import { betragText, fehlerArt, freierRest, gebuehrFuer, hoechstbetrag, type WirtschaftKonto } from '@/lib/ueberweisung';
import { leseZahlungsziel } from '@/lib/zahlungslink';
import { QrScanner } from '@/components/QrScanner';
import { withTimeout } from '@/lib/signer';
import { theme, redTintBorder, goldTint, goldTintBorder, purpleTint, purpleTintBorder } from '@/constants/aequitas-theme';

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
  const [scannerOffen, setScannerOffen] = useState(false);
  const [konto, setKonto] = useState<WirtschaftKonto | null>(null);

  // Wirtschaftsregeln dieses Kontos (gebuehrenfreier Monatsrest,
  // Umlaufabgabe). Faellt die Auskunft aus, rechnet die App mit der vollen
  // Gebuehr -- siehe lib/ueberweisung.ts.
  const ladeKonto = useCallback(async () => {
    if (!address) return;
    try {
      setKonto(await getWirtschaftKonto(address));
    } catch {
      setKonto(null);
    }
  }, [address]);
  useEffect(() => {
    ladeKonto();
  }, [ladeKonto, balance?.balance]);

  const guthaben = Number(balance?.balance ?? 0);
  const betragZahl = Number(String(sendAmount).replace(',', '.'));
  const betragGueltig = Number.isFinite(betragZahl) && betragZahl > 0;
  const gebuehr = betragGueltig ? gebuehrFuer(betragZahl, konto) : 0;
  const frei = freierRest(konto);
  const zuWenig = betragGueltig && betragZahl + gebuehr > guthaben + 1e-9;

  function fehlerText(e: unknown): string {
    const art = fehlerArt(e);
    if (art === 'unbekannt') {
      const m = (e as { shortMessage?: string; message?: string } | null);
      return t('wallet.errUnknown') + (m?.shortMessage || m?.message ? ' (' + String(m?.shortMessage || m?.message).slice(0, 120) + ')' : '');
    }
    return t(('wallet.err_' + art) as TranslationKey);
  }

  function onScan(data: string) {
    setScannerOffen(false);
    const ziel = leseZahlungsziel(data);
    if (!ziel) {
      setSendStatus('✗ ' + t('wallet.scanInvalid'));
      return;
    }
    if (ziel.fremdeKette) {
      setSendStatus('✗ ' + t('wallet.scanOtherChain'));
      return;
    }
    setSendTo(ziel.adresse);
    if (ziel.betrag) setSendAmount(ziel.betrag);
    setSendStatus('');
  }

  function setzeMaximum() {
    const max = hoechstbetrag(guthaben, konto);
    setSendAmount(max > 0 ? String(max) : '');
  }

  async function copyAddress() {
    if (!address) return;
    await Clipboard.setStringAsync(address);
    Alert.alert(t('common.copied'), t('wallet.addressCopiedMsg'));
  }

  function doSend() {
    if (!signer) return;
    const ziel = sendTo.trim();
    if (!isValidAddress(ziel)) {
      setSendStatus('✗ ' + t('wallet.invalidRecipient'));
      return;
    }
    if (address && ziel.toLowerCase() === address.toLowerCase()) {
      setSendStatus('✗ ' + t('wallet.sendToSelf'));
      return;
    }
    const amountWei = parseAEQToWei(String(sendAmount).replace(',', '.'));
    if (amountWei === null || amountWei <= 0n) {
      setSendStatus('✗ ' + t('wallet.enterAmount'));
      return;
    }
    if (zuWenig) {
      setSendStatus('✗ ' + t('wallet.err_guthaben'));
      return;
    }
    // Bestaetigen vor dem Senden: eine Ueberweisung laesst sich nicht
    // zurueckholen. Volle Adresse, Betrag, Gebuehr, Summe.
    Alert.alert(
      t('wallet.confirmSendTitle'),
      t('wallet.confirmSendDetail', {
        amount: betragText(betragZahl),
        fee: betragText(gebuehr),
        total: betragText(betragZahl + gebuehr),
        address: ziel,
      }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('wallet.send'), onPress: () => sende(ziel, amountWei) },
      ]
    );
  }

  async function sende(ziel: string, amountWei: bigint) {
    if (!signer) return;
    setSendBusy(true);
    setSendStatus(t('wallet.sendingTx'));
    try {
      const hash = await withTimeout(signer.sendTransaction({ to: ziel, value: amountWei }), SIGN_TIMEOUT_MS, t('trade.signTimeout'));
      setSendStatus(t('wallet.sentTx') + hash.slice(0, 12) + '…');
      setSendTo('');
      setSendAmount('');
      setTimeout(() => {
        refreshBalance();
        ladeKonto();
      }, 3000);
    } catch (e: unknown) {
      setSendStatus('✗ ' + fehlerText(e));
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
          {(konto?.abgabe_pro_monat_bei_diesem_stand ?? 0) > 0 && (
            <View style={S.demurrageWarn}>
              <Text style={S.demurrageText}>
                {t('wallet.levyNotice', { levy: betragText(konto?.abgabe_pro_monat_bei_diesem_stand ?? 0) })}
              </Text>
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

        {konto?.aktiv && konto.art === 'mensch' && (
          <View style={S.card}>
            <Text style={S.cardTitle}>{t('wallet.monthTitle')}</Text>
            <View style={S.row}>
              <Text style={S.rowLabel}>{t('wallet.monthFeeFree')}</Text>
              <Text style={S.rowValue}>{betragText(frei)} AEQ</Text>
            </View>
            <View style={S.row}>
              <Text style={S.rowLabel}>{t('wallet.monthLevy')}</Text>
              <Text style={S.rowValue}>{betragText(konto.abgabe_pro_monat_bei_diesem_stand ?? 0)} AEQ</Text>
            </View>
            <Text style={S.monthNote}>{t('wallet.monthNote')}</Text>
          </View>
        )}
        {konto?.aktiv && konto.art === 'frei' && (
          <View style={[S.card, S.hinweisKarte]}>
            <Text style={S.hinweisText}>{t('wallet.freeAddressNote', { limit: betragText(konto.grenze ?? 250) })}</Text>
          </View>
        )}

        <View style={S.card}>
          <Text style={S.cardTitle}>{t('wallet.sendAeq')}</Text>
          <View style={S.inputRow}>
            <TextInput
              style={[S.input, S.inputFlex]}
              placeholder={t('wallet.recipientPlaceholder')}
              placeholderTextColor={theme.muted}
              value={sendTo}
              onChangeText={setSendTo}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity style={S.sideBtn} onPress={() => setScannerOffen(true)} activeOpacity={0.8} accessibilityLabel={t('wallet.scanTitle')}>
              <Text style={S.sideBtnText}>{t('wallet.scanBtn')}</Text>
            </TouchableOpacity>
          </View>
          <View style={S.inputRow}>
            <TextInput
              style={[S.input, S.inputFlex]}
              placeholder={t('wallet.amountPlaceholder')}
              placeholderTextColor={theme.muted}
              value={sendAmount}
              onChangeText={setSendAmount}
              keyboardType="decimal-pad"
            />
            <TouchableOpacity style={S.sideBtn} onPress={setzeMaximum} activeOpacity={0.8}>
              <Text style={S.sideBtnText}>{t('wallet.maxBtn')}</Text>
            </TouchableOpacity>
          </View>
          {betragGueltig && (
            <View style={S.feeBox}>
              <View style={S.row}>
                <Text style={S.rowLabel}>{t('wallet.feeLabel')}</Text>
                <Text style={S.rowValue}>{gebuehr > 0 ? betragText(gebuehr) + ' AEQ' : t('wallet.feeFree')}</Text>
              </View>
              <View style={S.row}>
                <Text style={S.rowLabel}>{t('wallet.totalLabel')}</Text>
                <Text style={[S.rowValue, zuWenig && { color: theme.red }]}>{betragText(betragZahl + gebuehr)} AEQ</Text>
              </View>
              <Text style={S.monthNote}>{t('wallet.feeNote')}</Text>
            </View>
          )}
          {sendStatus ? <Text style={S.statusText}>{sendStatus}</Text> : null}
          <TouchableOpacity onPress={doSend} disabled={sendBusy || zuWenig} activeOpacity={0.85}>
            <LinearGradient colors={theme.buttonGradient} start={theme.gradientAngle.start} end={theme.gradientAngle.end} style={[S.btnPrimary, (sendBusy || zuWenig) && S.btnDisabled]}>
              {sendBusy ? <ActivityIndicator color="#fff" /> : <Text style={S.btnPrimaryText}>{t('wallet.send')}</Text>}
            </LinearGradient>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={S.btnDanger} onPress={confirmDisconnect} activeOpacity={0.8}>
          <Text style={S.btnDangerText}>{mode === 'local' ? t('wallet.removeWallet') : t('wallet.disconnect')}</Text>
        </TouchableOpacity>
      </ScrollView>
      <QrScanner visible={scannerOffen} onScanned={onScan} onClose={() => setScannerOffen(false)} />
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
  demurrageWarn: { marginTop: 14, backgroundColor: 'rgba(245,165,36,0.06)', borderWidth: 1, borderColor: 'rgba(245,165,36,0.2)', borderRadius: 8, padding: 10 },
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
  btnPrimary: { borderRadius: theme.radiusPill, padding: 16, alignItems: 'center', marginTop: 4 },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 14, letterSpacing: 0.8 },
  btnDisabled: { opacity: 0.45 },
  inputRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  inputFlex: { flex: 1 },
  sideBtn: { borderWidth: 1, borderColor: purpleTintBorder, backgroundColor: purpleTint, borderRadius: theme.radiusPill, paddingHorizontal: 14, height: 48, justifyContent: 'center' },
  sideBtnText: { color: theme.accent, fontSize: 12, fontWeight: '700' },
  feeBox: { backgroundColor: theme.card2, borderRadius: theme.radiusSm, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: theme.border },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4, gap: 12 },
  rowLabel: { color: theme.muted, fontSize: 13, flexShrink: 1 },
  rowValue: { color: theme.text, fontSize: 14, fontWeight: '700' },
  monthNote: { color: theme.muted, fontSize: 12, marginTop: 8, lineHeight: 17 },
  hinweisKarte: { backgroundColor: goldTint, borderColor: goldTintBorder },
  hinweisText: { color: theme.gold, fontSize: 13, lineHeight: 19 },

  btnDanger: { marginHorizontal: 20, marginTop: 24, borderWidth: 1, borderColor: redTintBorder, borderRadius: theme.radiusPill, padding: 14, alignItems: 'center' },
  btnDangerText: { color: theme.red, fontSize: 11, letterSpacing: 1.5 },
});
