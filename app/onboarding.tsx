import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Clipboard from 'expo-clipboard';
import { useWallet } from '@/contexts/WalletContext';
import { useLanguage } from '@/contexts/LanguageContext';
import * as wallet from '@/lib/wallet';
import { theme } from '@/constants/aequitas-theme';
import LanguagePicker from '@/components/LanguagePicker';

type Step = 'choice' | 'reveal' | 'import';

export default function Onboarding() {
  const { createLocalWallet, importLocalWallet, walletConnectAvailable, openWalletConnect } = useWallet();
  const { t } = useLanguage();
  const [step, setStep] = useState<Step>('choice');
  const [mnemonic, setMnemonic] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [importValue, setImportValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function startCreate() {
    setMnemonic(wallet.generateMnemonic());
    setConfirmed(false);
    setStep('reveal');
  }

  async function confirmCreate() {
    setBusy(true);
    try {
      await createLocalWallet(mnemonic);
    } catch (e: any) {
      setError(e?.message ?? t('onboarding.walletCreateError'));
    } finally {
      setBusy(false);
    }
  }

  async function doImport() {
    if (!importValue.trim()) return;
    setBusy(true);
    setError('');
    try {
      await importLocalWallet(importValue);
    } catch {
      setError(t('onboarding.invalidSeed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={S.safe}>
      <StatusBar barStyle="light-content" backgroundColor={theme.bg} />
      <ScrollView contentContainerStyle={S.content} showsVerticalScrollIndicator={false}>
        <View style={S.langRow}>
          <LanguagePicker />
        </View>
        <View style={S.header}>
          <LinearGradient colors={theme.gradient} start={theme.gradientAngle.start} end={theme.gradientAngle.end} style={S.logoIcon}>
            <Text style={S.logoIconText}>◈</Text>
          </LinearGradient>
          <Text style={S.logo}>AEQUITAS</Text>
          <Text style={S.subtitle}>{t('onboarding.subtitle')}</Text>
        </View>

        {step === 'choice' && (
          <View style={S.card}>
            <Text style={S.cardTitle}>{t('onboarding.welcome')}</Text>
            <Text style={S.cardDesc}>{t('onboarding.welcomeDesc')}</Text>

            <TouchableOpacity onPress={startCreate} activeOpacity={0.85}>
              <LinearGradient colors={theme.gradient} start={theme.gradientAngle.start} end={theme.gradientAngle.end} style={S.btnPrimary}>
                <Text style={S.btnPrimaryText}>{t('onboarding.createWallet')}</Text>
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity style={S.btnSecondary} onPress={() => setStep('import')} activeOpacity={0.8}>
              <Text style={S.btnSecondaryText}>{t('onboarding.importWalletBtn')}</Text>
            </TouchableOpacity>

            {walletConnectAvailable && (
              <TouchableOpacity style={S.btnWC} onPress={openWalletConnect} activeOpacity={0.85}>
                <Text style={S.btnWCText}>{t('onboarding.connectWalletConnect')}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {step === 'reveal' && (
          <View style={S.card}>
            <Text style={S.cardTitle}>{t('onboarding.yourSeedPhrase')}</Text>
            <View style={S.warnBadge}>
              <Text style={S.warnText}>{t('onboarding.seedWarning')}</Text>
            </View>

            <View style={S.mnemonicBox}>
              {mnemonic.split(' ').map((word, i) => (
                <View key={i} style={S.wordChip}>
                  <Text style={S.wordIndex}>{i + 1}</Text>
                  <Text style={S.wordText}>{word}</Text>
                </View>
              ))}
            </View>

            <TouchableOpacity
              style={S.btnSecondary}
              onPress={async () => {
                await Clipboard.setStringAsync(mnemonic);
                Alert.alert(t('common.copied'), t('onboarding.seedCopiedMsg'));
              }}
              activeOpacity={0.8}>
              <Text style={S.btnSecondaryText}>{t('onboarding.copyToClipboard')}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={S.confirmRow}
              onPress={() => setConfirmed((c) => !c)}
              activeOpacity={0.8}>
              <View style={[S.checkbox, confirmed && S.checkboxChecked]}>
                {confirmed && <Text style={S.checkboxMark}>✓</Text>}
              </View>
              <Text style={S.confirmText}>{t('onboarding.seedConfirmCheckbox')}</Text>
            </TouchableOpacity>

            {error ? <Text style={S.errorText}>{error}</Text> : null}

            <TouchableOpacity disabled={!confirmed || busy} onPress={confirmCreate} activeOpacity={0.85}>
              <LinearGradient
                colors={theme.gradient}
                start={theme.gradientAngle.start}
                end={theme.gradientAngle.end}
                style={[S.btnPrimary, !confirmed && S.btnDisabled]}>
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={S.btnPrimaryText}>{t('onboarding.continueBtn')}</Text>}
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity style={S.btnGhost} onPress={() => setStep('choice')} activeOpacity={0.8}>
              <Text style={S.btnGhostText}>{t('onboarding.back')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {step === 'import' && (
          <View style={S.card}>
            <Text style={S.cardTitle}>{t('onboarding.importTitle')}</Text>
            <Text style={S.cardDesc}>{t('onboarding.importDesc')}</Text>

            <TextInput
              style={S.input}
              placeholder={t('onboarding.importPlaceholder')}
              placeholderTextColor={theme.muted}
              value={importValue}
              onChangeText={setImportValue}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry={false}
            />

            {error ? <Text style={S.errorText}>{error}</Text> : null}

            <TouchableOpacity disabled={!importValue.trim() || busy} onPress={doImport} activeOpacity={0.85}>
              <LinearGradient
                colors={theme.gradient}
                start={theme.gradientAngle.start}
                end={theme.gradientAngle.end}
                style={[S.btnPrimary, !importValue.trim() && S.btnDisabled]}>
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={S.btnPrimaryText}>{t('onboarding.importBtn')}</Text>}
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity style={S.btnGhost} onPress={() => setStep('choice')} activeOpacity={0.8}>
              <Text style={S.btnGhostText}>{t('onboarding.back')}</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={S.footer}>
          <Text style={S.footerQuote}>{t('home.footerQuote')}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const S = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.bg },
  content: { paddingBottom: 40, flexGrow: 1 },
  langRow: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 20, paddingTop: 12 },
  header: { alignItems: 'center', paddingTop: 24, paddingBottom: 28, paddingHorizontal: 20 },
  logoIcon: { width: 44, height: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  logoIconText: { color: '#fff', fontSize: 21 },
  logo: { fontSize: 30, fontWeight: '900', color: theme.text, letterSpacing: 7 },
  subtitle: { color: theme.muted, fontSize: 10, letterSpacing: 2.5, marginTop: 6 },

  card: { marginHorizontal: 20, backgroundColor: theme.card, borderRadius: theme.radius, padding: 24, borderWidth: 1, borderColor: theme.border },
  cardTitle: { fontSize: 11, color: theme.muted, letterSpacing: 3, marginBottom: 10, fontWeight: '600' },
  cardDesc: { color: theme.text, fontSize: 14, lineHeight: 21, marginBottom: 20 },

  btnPrimary: { borderRadius: theme.radiusSm, padding: 17, alignItems: 'center', marginTop: 6 },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 13, letterSpacing: 1.5 },
  btnDisabled: { opacity: 0.4 },
  btnSecondary: { borderWidth: 1, borderColor: theme.border, borderRadius: theme.radiusSm, padding: 15, alignItems: 'center', marginTop: 12 },
  btnSecondaryText: { color: theme.text, fontSize: 12, letterSpacing: 1.5 },
  btnWC: { backgroundColor: theme.card2, borderWidth: 1, borderColor: theme.borderStrong, borderRadius: theme.radiusSm, padding: 15, alignItems: 'center', marginTop: 12 },
  btnWCText: { color: theme.teal, fontWeight: '700', fontSize: 12, letterSpacing: 1 },
  btnGhost: { padding: 12, alignItems: 'center', marginTop: 4 },
  btnGhostText: { color: theme.muted, fontSize: 11, letterSpacing: 1.5 },

  warnBadge: { backgroundColor: 'rgba(240,180,41,0.06)', borderWidth: 1, borderColor: 'rgba(240,180,41,0.2)', borderRadius: theme.radiusSm, padding: 12, marginBottom: 16 },
  warnText: { color: theme.gold, fontSize: 12, lineHeight: 18 },

  mnemonicBox: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  wordChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.card2, borderWidth: 1, borderColor: theme.border, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 8, gap: 6, width: '31%' },
  wordIndex: { color: theme.muted, fontSize: 10 },
  wordText: { color: theme.text, fontSize: 13, fontWeight: '600' },

  confirmRow: { flexDirection: 'row', alignItems: 'center', marginTop: 18, gap: 10 },
  checkbox: { width: 22, height: 22, borderRadius: 5, borderWidth: 1.5, borderColor: theme.borderStrong, alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: theme.purple, borderColor: theme.purple },
  checkboxMark: { color: '#fff', fontWeight: 'bold', fontSize: 13 },
  confirmText: { color: theme.text, fontSize: 12, flex: 1 },

  input: { backgroundColor: theme.card2, borderWidth: 1, borderColor: theme.border, borderRadius: theme.radiusSm, padding: 14, color: theme.text, fontSize: 13, minHeight: 90, textAlignVertical: 'top' },
  errorText: { color: theme.red, fontSize: 12, marginTop: 10 },

  footer: { alignItems: 'center', padding: 24, paddingTop: 32 },
  footerQuote: { color: theme.muted, fontSize: 11, textAlign: 'center', fontStyle: 'italic', lineHeight: 18 },
});
