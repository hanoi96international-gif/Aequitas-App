import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useWallet } from '@/contexts/WalletContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { formatBalance, shortWallet } from '@/lib/format';
import {
  getDeviceIdentity,
  checkAlreadyRegistered,
  proveAndRegister,
  identityFromBioHash,
  loadEnrollment,
  saveEnrollment,
  type DeviceIdentity,
} from '@/lib/identity';
import { HAS_COORDINATOR } from '@/lib/config';
import BiometricCapture from '@/components/BiometricCapture';
import { theme, purpleTint, purpleTintBorder, neonTint, neonTintBorder, goldTint, goldTintBorder } from '@/constants/aequitas-theme';

type Status = 'checking' | 'idle' | 'proving' | 'registered' | 'already_registered' | 'error';
type LogType = 'info' | 'success' | 'error';
type LogEntry = { msg: string; type: LogType; time: string };
type StepState = 'done' | 'active' | 'pending';

function StepItem({ n, title, desc, state }: { n: number; title: string; desc: string; state: StepState }) {
  return (
    <View style={S.step}>
      {state === 'active' ? (
        <View style={[S.stepCircle, S.stepCircleActive]}>
          <ActivityIndicator size="small" color={theme.purple} />
        </View>
      ) : state === 'done' ? (
        <LinearGradient colors={theme.gradient} start={theme.gradientAngle.start} end={theme.gradientAngle.end} style={S.stepCircle}>
          <Text style={S.stepCircleCheck}>✓</Text>
        </LinearGradient>
      ) : (
        <View style={[S.stepCircle, S.stepCirclePending]}>
          <Text style={S.stepCircleNum}>{n}</Text>
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={[S.stepTitle, state === 'done' && S.stepTitleDone, state === 'active' && S.stepTitleActive]}>{title}</Text>
        <Text style={S.stepDesc}>{desc}</Text>
      </View>
    </View>
  );
}

// FIX (2026-07-12, "feels frozen" pass): both thresholds below exist for the
// same reason — an operation that's genuinely still working looks identical
// to a silently-stuck one unless the UI says something after a while.
const CHECK_TIMEOUT_MS = 8_000;
const PROVING_SLOW_MS = 8_000;

/**
 * Wie lange eine bestandene Coordinator-Prüfung wiederverwendet werden darf,
 * ohne die Aufnahme zu wiederholen.
 *
 * Der Proof-Server verwirft Attestierungen, die älter als
 * BIO_ATTESTATION_MAX_AGE_SECONDS sind (Standard 900 s). 600 s liegen bewusst
 * deutlich darunter: zwischen dem Nachschlagen hier und dem Eintreffen beim
 * Proof-Server liegen noch der Registrierungscheck und die Wallet-Signatur,
 * auf die der Nutzer erst reagieren muss. Läge die Grenze bei 900, könnte eine
 * gerade noch akzeptierte Attestierung während des Signaturdialogs verfallen —
 * und der Nutzer bekäme nach dem Unterschreiben einen Fehler.
 */
const ENROLLMENT_REUSE_SECONDS = 600;

export default function Identity() {
  const { address, signer, balance, refreshBalance } = useWallet();
  const { t } = useLanguage();
  const [status, setStatus] = useState<Status>('checking');
  const [log, setLog] = useState<LogEntry[]>([]);
  const [activeStep, setActiveStep] = useState(0);
  const [checkSlow, setCheckSlow] = useState(false);
  const [provingSlow, setProvingSlow] = useState(false);
  const [captureVisible, setCaptureVisible] = useState(false);

  const STEPS = [
    { title: t('identity.step1Title'), desc: t('identity.step1Desc') },
    { title: t('identity.step2Title'), desc: t('identity.step2Desc') },
    { title: t('identity.step3Title'), desc: t('identity.step3Desc') },
    { title: t('identity.step4Title'), desc: t('identity.step4Desc') },
  ];

  const FACTS = [
    { color: theme.neon, title: t('identity.fact1Title'), desc: t('identity.fact1Desc') },
    { color: theme.gold, title: t('identity.fact2Title'), desc: t('identity.fact2Desc') },
    { color: theme.purple, title: t('identity.fact3Title'), desc: t('identity.fact3Desc') },
    { color: theme.teal, title: t('identity.fact4Title'), desc: t('identity.fact4Desc') },
  ];

  const addLog = useCallback((msg: string, type: LogType = 'info') => {
    setLog((prev) => [...prev, { msg, type, time: new Date().toLocaleTimeString() }]);
  }, []);

  useEffect(() => {
    if (balance == null) return;
    setStatus(balance.is_human ? 'already_registered' : 'idle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [balance?.is_human]);

  // FIX (2026-07-12, "feels frozen" pass): status started at 'checking' and
  // only ever left it once WalletContext's balance poll succeeded at least
  // once — refreshBalance() silently swallows fetch failures with no error
  // surfaced anywhere (by design, so a transient blip doesn't flash an error
  // on every screen), so a single failed first attempt (very plausible right
  // after wallet creation, before the network has settled) left this screen
  // spinning on "Checking registration status…" forever, indistinguishable
  // from a genuine hang. This mirrors Home's tab own resilience (placeholder
  // dashes + keeps polling) instead of blocking silently: after a timeout,
  // show a message and a manual retry that re-triggers the fetch directly.
  useEffect(() => {
    if (status !== 'checking') {
      setCheckSlow(false);
      return;
    }
    const timer = setTimeout(() => setCheckSlow(true), CHECK_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [status]);

  function retryChecking() {
    setCheckSlow(false);
    refreshBalance();
  }

  /**
   * Registrierung ab dem Punkt, an dem der `bio` feststeht.
   *
   * Herausgelöst, weil es jetzt zwei Wege dorthin gibt: den biometrischen
   * über den Coordinator (ein Wert pro MENSCH) und den gerätegebundenen
   * (ein Wert pro INSTALLATION). Ab hier ist der Ablauf identisch, und ihn
   * zweimal zu schreiben hieße, jede künftige Änderung zweimal zu machen.
   */
  const runRegistration = useCallback(
    async (identity: DeviceIdentity, attestation?: { signature: string; issuedAt: number }) => {
      if (!signer) return;
      setStatus('proving');
      setActiveStep(1);
      setProvingSlow(false);
      const slowTimer = setTimeout(() => setProvingSlow(true), PROVING_SLOW_MS);
      try {
        addLog(t('identity.logCheckingExisting'), 'info');
        const check = await checkAlreadyRegistered(identity.bio);
        if (check.registered && check.is_human) {
          addLog(t('identity.logAlreadyRegistered'), 'success');
          setStatus('already_registered');
          refreshBalance();
          return;
        }
        if (check.biometric_in_use) {
          addLog(t('identity.logBiometricInUse'), 'error');
          addLog(t('identity.logOnePersonOneWallet'), 'error');
          setStatus('error');
          return;
        }

        addLog(t('identity.logRequestingProof'), 'info');
        setActiveStep(2);
        const result = await proveAndRegister(signer, identity, t('trade.signTimeout'), attestation);
        if (!result.success) throw new Error(result.message || t('identity.registrationFailed'));

        setActiveStep(4);
        addLog(t('identity.logConfirmed'), 'success');
        addLog(t('identity.logCredited'), 'success');
        setStatus('registered');
        refreshBalance();
      } catch (e: any) {
        addLog(t('identity.logErrorPrefix') + (e?.message ?? t('identity.logUnknownError')), 'error');
        setStatus('error');
      } finally {
        clearTimeout(slowTimer);
        setProvingSlow(false);
      }
    },
    [signer, addLog, refreshBalance, t]
  );

  async function proveHumanity() {
    if (!signer) return;
    setLog([]);
    setActiveStep(0);

    // Ohne erreichbaren Coordinator bleibt es beim gerätegebundenen Weg.
    // Der ist ausdrücklich schwächer — er belegt nur, dass ein Gerät
    // beteiligt war, nicht, dass ein bestimmter Mensch es war — aber eine
    // Schaltfläche, die zu einer nicht existierenden Gegenstelle führt, wäre
    // kein besserer Zustand.
    if (!HAS_COORDINATOR) {
      setStatus('proving');
      try {
        addLog(t('identity.logCheckingBiometric'), 'info');
        const identity = await getDeviceIdentity();
        addLog(t('identity.logDeviceReady'), 'success');
        await runRegistration(identity);
      } catch (e: any) {
        addLog(t('identity.logErrorPrefix') + (e?.message ?? t('identity.logUnknownError')), 'error');
        setStatus('error');
      }
      return;
    }

    // Eine noch frische Prüfung nicht wiederholen lassen. Wer die
    // Wallet-Signatur abgebrochen hat, soll nicht erneut Handfläche und
    // Gesicht aufnehmen müssen.
    const cached = await loadEnrollment();
    const ageOk = cached && Math.floor(Date.now() / 1000) - cached.issuedAt < ENROLLMENT_REUSE_SECONDS;
    const walletOk = cached && signer.address.toLowerCase() === cached.wallet.toLowerCase();
    if (cached && ageOk && walletOk) {
      addLog(t('identity.logReusingEnrollment'), 'info');
      await runRegistration(identityFromBioHash(cached.bioHash), {
        signature: cached.signature,
        issuedAt: cached.issuedAt,
      });
      return;
    }

    setCaptureVisible(true);
  }

  const onCaptureSuccess = useCallback(
    async (r: { bioHash: string; signature: string; issuedAt: number }) => {
      setCaptureVisible(false);
      if (!signer) return;
      addLog(t('identity.logBiometricPassed'), 'success');
      await saveEnrollment({ ...r, wallet: signer.address });
      await runRegistration(identityFromBioHash(r.bioHash), {
        signature: r.signature,
        issuedAt: r.issuedAt,
      });
    },
    [signer, addLog, runRegistration, t]
  );

  function stepState(i: number): StepState {
    if (status === 'registered' || status === 'already_registered') return 'done';
    if (status === 'proving') {
      if (i < activeStep) return 'done';
      if (i === activeStep) return 'active';
    }
    return 'pending';
  }

  const isSuccess = status === 'registered' || status === 'already_registered';

  return (
    <SafeAreaView style={S.safe} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={theme.bg} />
      <ScrollView contentContainerStyle={S.content} showsVerticalScrollIndicator={false}>
        <View style={S.header}>
          <Text style={S.title}>{t('identity.title')}</Text>
        </View>

        <View style={S.hero}>
          <Text style={S.heroTitle}>{t('identity.heroTitle')}</Text>
          <Text style={S.heroSub}>{t('identity.heroSub')}</Text>
        </View>

        <View style={S.privBadge}>
          <Text style={S.privBadgeText}>{t('identity.privBadge')}</Text>
        </View>

        {/* Welcher der beiden Wege gerade aktiv ist, gehört sichtbar auf den
            Bildschirm. Sie sind nicht gleichwertig: der gerätegebundene Weg
            belegt nur, dass ein Gerät beteiligt war, und wer zehn Geräte hat,
            bekommt zehn Identitäten. Das stillschweigend als „Menschlichkeit
            nachgewiesen" auszugeben, wäre die eine Unehrlichkeit, die dieses
            Projekt sich nicht leisten kann. */}
        <View style={HAS_COORDINATOR ? S.modeBadge : S.modeBadgeWeak}>
          <Text style={HAS_COORDINATOR ? S.modeBadgeText : S.modeBadgeWeakText}>
            {HAS_COORDINATOR ? t('identity.modeBiometric') : t('identity.modeDeviceOnly')}
          </Text>
        </View>

        <View style={S.card}>
          {STEPS.map((s, i) => (
            <StepItem key={i} n={i + 1} title={s.title} desc={s.desc} state={stepState(i)} />
          ))}

          {status === 'checking' && !checkSlow && (
            <View style={S.loadingBox}>
              <ActivityIndicator color={theme.purple} size="small" />
              <Text style={S.loadingText}>{t('identity.checkingStatus')}</Text>
            </View>
          )}

          {status === 'checking' && checkSlow && (
            <View style={S.loadingBox}>
              <Text style={S.slowText}>{t('identity.checkingSlow')}</Text>
              <TouchableOpacity onPress={retryChecking} activeOpacity={0.85} style={{ marginTop: 12 }}>
                <LinearGradient colors={theme.gradient} start={theme.gradientAngle.start} end={theme.gradientAngle.end} style={S.btnPrimary}>
                  <Text style={S.btnPrimaryText}>{t('identity.retryBtn')}</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          )}

          {status === 'idle' && (
            <TouchableOpacity onPress={proveHumanity} activeOpacity={0.85} disabled={!signer}>
              <LinearGradient colors={theme.gradient} start={theme.gradientAngle.start} end={theme.gradientAngle.end} style={[S.btnPrimary, !signer && S.btnDisabled]}>
                <Text style={S.btnPrimaryText}>
                  {!signer
                    ? t('identity.connectWalletFirst')
                    : HAS_COORDINATOR
                      ? t('identity.startBiometricBtn')
                      : t('identity.proveHumanityBtn')}
                </Text>
              </LinearGradient>
            </TouchableOpacity>
          )}

          {status === 'proving' && (
            <View style={S.loadingBox}>
              <ActivityIndicator color={theme.purple} size="large" />
              <Text style={S.loadingText}>{t('identity.verifying')}</Text>
              {provingSlow && <Text style={S.slowText}>{t('identity.provingSlow')}</Text>}
            </View>
          )}

          {status === 'error' && (
            <TouchableOpacity onPress={proveHumanity} activeOpacity={0.85}>
              <LinearGradient colors={theme.gradient} start={theme.gradientAngle.start} end={theme.gradientAngle.end} style={S.btnPrimary}>
                <Text style={S.btnPrimaryText}>{t('identity.retryBtn')}</Text>
              </LinearGradient>
            </TouchableOpacity>
          )}

          {isSuccess && (
            <View style={status === 'registered' ? S.successBox : S.alreadyBox}>
              <Text style={status === 'registered' ? S.successTitle : S.alreadyTitle}>
                {status === 'registered' ? t('identity.registeredTitle') : t('identity.alreadyRegisteredTitle')}
              </Text>
              <Text style={status === 'registered' ? S.successSub : S.alreadySub}>
                {status === 'registered' ? t('identity.registeredSub') : t('identity.alreadyRegisteredSub')}
              </Text>
              {balance && balance.balance > 0 && <Text style={S.balanceText}>{formatBalance(balance.balance)} AEQ</Text>}
              {address ? <Text style={S.walletAddr}>{shortWallet(address)}</Text> : null}
            </View>
          )}
        </View>

        <View style={S.factsGrid}>
          {FACTS.map((f, i) => (
            <View key={i} style={[S.factCard, { borderColor: f.color + '33' }]}>
              <Text style={[S.factTitle, { color: f.color }]}>{f.title}</Text>
              <Text style={S.factDesc}>{f.desc}</Text>
            </View>
          ))}
        </View>

        {log.length > 0 && (
          <View style={S.logCard}>
            <Text style={S.logTitle}>{t('identity.activityLog')}</Text>
            {log.map((e, i) => (
              <Text key={i} style={[S.logEntry, e.type === 'success' ? S.logSuccess : e.type === 'error' ? S.logError : S.logInfo]}>
                [{e.time}]  {e.msg}
              </Text>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Nur gemountet, wenn es einen Coordinator gibt UND eine Wallet
          feststeht: die Attestierung wird auf genau diese Adresse ausgestellt,
          eine Aufnahme ohne sie wäre unbrauchbar. */}
      {HAS_COORDINATOR && signer && (
        <BiometricCapture
          visible={captureVisible}
          wallet={signer.address}
          onCancel={() => setCaptureVisible(false)}
          onSuccess={onCaptureSuccess}
        />
      )}
    </SafeAreaView>
  );
}

const S = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.bg },
  content: { paddingBottom: 40 },
  header: { paddingTop: 12, paddingBottom: 16, paddingHorizontal: 20 },
  title: { fontSize: 22, fontWeight: '900', color: theme.text, letterSpacing: 2 },

  hero: { marginHorizontal: 20, backgroundColor: purpleTint, borderWidth: 1, borderColor: purpleTintBorder, borderRadius: theme.radius, padding: 20, marginBottom: 12 },
  heroTitle: { fontSize: 15, fontWeight: '700', color: theme.text, marginBottom: 6 },
  heroSub: { fontSize: 12, color: theme.muted, lineHeight: 18 },

  privBadge: { marginHorizontal: 20, backgroundColor: neonTint, borderWidth: 1, borderColor: neonTintBorder, borderRadius: theme.radiusSm, padding: 11, marginBottom: 10 },
  privBadgeText: { color: theme.neon, fontSize: 11, lineHeight: 16, textAlign: 'center' },

  modeBadge: { marginHorizontal: 20, backgroundColor: purpleTint, borderWidth: 1, borderColor: purpleTintBorder, borderRadius: theme.radiusSm, padding: 11, marginBottom: 16 },
  modeBadgeText: { color: theme.purple, fontSize: 11, lineHeight: 16, textAlign: 'center' },
  modeBadgeWeak: { marginHorizontal: 20, backgroundColor: goldTint, borderWidth: 1, borderColor: goldTintBorder, borderRadius: theme.radiusSm, padding: 11, marginBottom: 16 },
  modeBadgeWeakText: { color: theme.gold, fontSize: 11, lineHeight: 16, textAlign: 'center' },

  btnDisabled: { opacity: 0.4 },

  card: { marginHorizontal: 20, backgroundColor: theme.card, borderRadius: theme.radius, padding: 22, borderWidth: 1, borderColor: theme.border },

  step: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.border, gap: 12 },
  stepCircle: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 },
  stepCircleActive: { borderWidth: 2, borderColor: theme.purple, backgroundColor: 'transparent' },
  stepCirclePending: { borderWidth: 1, borderColor: theme.border, backgroundColor: 'transparent' },
  stepCircleCheck: { color: '#fff', fontSize: 13, fontWeight: 'bold' },
  stepCircleNum: { color: theme.muted, fontSize: 12, fontWeight: '600' },
  stepTitle: { color: theme.text, fontSize: 13, fontWeight: '700', marginBottom: 3 },
  stepTitleDone: { color: theme.neon },
  stepTitleActive: { color: theme.purple },
  stepDesc: { color: theme.muted, fontSize: 11, lineHeight: 16 },

  loadingBox: { alignItems: 'center', paddingVertical: 24, marginTop: 8 },
  loadingText: { color: theme.purple, marginTop: 14, fontSize: 13, letterSpacing: 1 },
  slowText: { color: theme.muted, marginTop: 10, fontSize: 11.5, lineHeight: 17, textAlign: 'center', paddingHorizontal: 8 },

  btnPrimary: { borderRadius: theme.radiusSm, padding: 18, alignItems: 'center', marginTop: 16 },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 13, letterSpacing: 1.5 },

  alreadyBox: { backgroundColor: theme.card2, borderWidth: 1, borderColor: 'rgba(240,180,41,0.27)', borderRadius: theme.radiusSm, padding: 20, alignItems: 'center', marginTop: 16 },
  alreadyTitle: { color: theme.gold, fontSize: 16, fontWeight: 'bold' },
  alreadySub: { color: theme.muted, fontSize: 12, marginTop: 6, textAlign: 'center' },
  successBox: { backgroundColor: neonTint, borderWidth: 1, borderColor: neonTintBorder, borderRadius: theme.radiusSm, padding: 20, alignItems: 'center', marginTop: 16 },
  successTitle: { color: theme.neon, fontSize: 18, fontWeight: 'bold' },
  successSub: { color: theme.neon, fontSize: 12, marginTop: 4 },
  balanceText: { color: theme.gold, fontSize: 30, fontWeight: 'bold', marginTop: 10 },
  walletAddr: { color: theme.muted, fontSize: 11, marginTop: 8, fontFamily: theme.fontMono },

  factsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginHorizontal: 20, marginTop: 16 },
  factCard: { flexBasis: '47%', flexGrow: 1, backgroundColor: theme.card, borderWidth: 1, borderRadius: theme.radiusSm, padding: 13 },
  factTitle: { fontSize: 12, fontWeight: '700', marginBottom: 5 },
  factDesc: { color: theme.muted, fontSize: 10.5, lineHeight: 15 },

  logCard: { marginHorizontal: 20, backgroundColor: theme.card, borderRadius: theme.radius, padding: 16, borderWidth: 1, borderColor: theme.border, marginTop: 16 },
  logTitle: { fontSize: 10, color: theme.muted, letterSpacing: 3, marginBottom: 10 },
  logEntry: { fontSize: 10, color: theme.muted, lineHeight: 18, fontFamily: theme.fontMono },
  logSuccess: { color: theme.neon },
  logError: { color: theme.red },
  logInfo: { color: theme.purple },
});
