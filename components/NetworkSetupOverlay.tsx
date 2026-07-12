import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useWallet } from '@/contexts/WalletContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { theme } from '@/constants/aequitas-theme';

// FIX (2026-07-12, "feels frozen" pass): ensureNetwork can legitimately take
// close to its full 60s timeout (WalletConnect round-trip to an external
// wallet app, which itself may be slow to respond) — this modal used to show
// nothing but a spinner and one static line the entire time, indistinguishable
// from a genuine hang. A reassuring second line after a few seconds says the
// wait itself is expected, not broken.
const SETUP_SLOW_MS = 8_000;

/**
 * Shown whenever a WalletConnect session is live but the connected wallet
 * hasn't confirmed the Aequitas chain yet. See ensureAequitasChain's own
 * comment (lib/walletconnect.ts) for why: AppKit's built-in "switch network"
 * screen only ever sends wallet_switchEthereumChain, which a wallet that has
 * never added this chain rejects instantly with no prompt at all — from the
 * user's side that looks exactly like "got redirected to the wallet, then
 * nothing happened," looping forever. This overlay drives the real
 * switch/add-chain flow itself and always shows one clear state (working, or
 * failed with a retry) instead of AppKit's confusing repeated screen.
 */
export default function NetworkSetupOverlay() {
  const { mode, networkStatus, networkError, retryNetworkSetup, disconnectWallet } = useWallet();
  const { t } = useLanguage();
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (networkStatus !== 'pending') {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), SETUP_SLOW_MS);
    return () => clearTimeout(timer);
  }, [networkStatus]);

  const visible = mode === 'walletconnect' && (networkStatus === 'pending' || networkStatus === 'error');
  if (!visible) return null;

  const isError = networkStatus === 'error';

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={disconnectWallet}>
      <View style={S.backdrop}>
        <View style={S.card}>
          {isError ? (
            <>
              <Text style={S.title}>{t('network.errorTitle')}</Text>
              {networkError ? <Text style={S.desc}>{networkError}</Text> : null}
              <TouchableOpacity onPress={retryNetworkSetup} activeOpacity={0.85} style={S.fullWidth}>
                <LinearGradient
                  colors={theme.gradient}
                  start={theme.gradientAngle.start}
                  end={theme.gradientAngle.end}
                  style={S.btnPrimary}>
                  <Text style={S.btnPrimaryText}>{t('identity.retryBtn')}</Text>
                </LinearGradient>
              </TouchableOpacity>
              <TouchableOpacity style={S.btnDanger} onPress={disconnectWallet} activeOpacity={0.8}>
                <Text style={S.btnDangerText}>{t('wallet.disconnect')}</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <ActivityIndicator color={theme.purple} size="large" />
              <Text style={S.title}>{t('network.settingUpTitle')}</Text>
              <Text style={S.desc}>{t('network.settingUpDesc')}</Text>
              {slow && <Text style={S.slowDesc}>{t('network.settingUpSlow')}</Text>}
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const S = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(12,14,22,0.88)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: theme.card,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 28,
    alignItems: 'center',
  },
  fullWidth: { width: '100%' },
  title: { color: theme.text, fontSize: 15, fontWeight: '700', letterSpacing: 1, textAlign: 'center', marginTop: 14 },
  desc: { color: theme.muted, fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 8, marginBottom: 18 },
  slowDesc: { color: theme.muted, fontSize: 11.5, lineHeight: 17, textAlign: 'center', marginTop: -10, marginBottom: 18, opacity: 0.8 },
  btnPrimary: { borderRadius: theme.radiusSm, paddingVertical: 15, alignItems: 'center', width: '100%' },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 13, letterSpacing: 1.5 },
  btnDanger: { marginTop: 12, padding: 10, alignItems: 'center' },
  btnDangerText: { color: theme.red, fontSize: 11, letterSpacing: 1.5 },
});
