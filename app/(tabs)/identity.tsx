import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useWallet } from '@/contexts/WalletContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { formatBalance, shortWallet } from '@/lib/format';
import { BIOMETRIC_ENABLED, ALLOW_DEVICE_SECRET_REGISTER } from '@/lib/config';
import { getDeviceIdentity, checkAlreadyRegistered, proveAndRegister } from '@/lib/identity';
import { storedBioHash, deleteEnrollment } from '@/lib/biometricIdentity';
import { Alert } from 'react-native';
import { theme, purpleTint, purpleTintBorder, neonTint, neonTintBorder } from '@/constants/aequitas-theme';

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

export default function Identity() {
  const { address, signer, balance, refreshBalance } = useWallet();
  const { t } = useLanguage();
  const [status, setStatus] = useState<Status>('checking');
  const [log, setLog] = useState<LogEntry[]>([]);
  const [activeStep, setActiveStep] = useState(0);
  const [checkSlow, setCheckSlow] = useState(false);
  const [provingSlow, setProvingSlow] = useState(false);
  // Withdrawal of consent. bioHash is null when this device never registered
  // (or the enrolment was already erased) -- the whole section stays hidden
  // then, rather than offering an action that cannot work.
  const [bioHash, setBioHash] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteMsg, setDeleteMsg] = useState<{ text: string; ok: boolean } | null>(null);

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

  useEffect(() => {
    storedBioHash().then(setBioHash).catch(() => setBioHash(null));
  }, []);

  // Two-step on purpose: erasure is irreversible, and it does more than drop
  // this person's row -- it makes them a stranger to the duplicate check, so
  // the next registration attempt succeeds as a new human. A single stray tap
  // must not be able to do that.
  function confirmDelete() {
    Alert.alert(
      t('identity.deleteConfirmTitle'),
      t('identity.deleteConfirmBody'),
      [
        { text: t('identity.deleteCancel'), style: 'cancel' },
        { text: t('identity.deleteConfirmBtn'), style: 'destructive', onPress: runDelete },
      ],
    );
  }

  async function runDelete() {
    if (!bioHash) return;
    setDeleting(true);
    setDeleteMsg(null);
    try {
      const res = await deleteEnrollment(bioHash);
      if (res.status === 'deleted' || res.status === 'not_found') {
        setBioHash(null);
        setDeleteMsg({ text: t('identity.deleteDone'), ok: true });
        addLog(t('identity.deleteDone'), 'success');
      } else if (res.status === 'partial') {
        // NOT a success. A validator that was unreachable still holds the
        // template and can still recognize someone who withdrew consent, so
        // this says so and keeps the button available for a retry.
        setDeleteMsg({ text: t('identity.deletePartial'), ok: false });
        addLog(t('identity.deletePartial'), 'error');
      } else {
        setDeleteMsg({ text: t('identity.deleteFailed'), ok: false });
        addLog(`${t('identity.deleteFailed')} (${res.status})`, 'error');
      }
    } catch (e: any) {
      setDeleteMsg({ text: e?.message ?? t('identity.deleteFailed'), ok: false });
      addLog(t('identity.deleteFailed'), 'error');
    } finally {
      setDeleting(false);
    }
  }

  function retryChecking() {
    setCheckSlow(false);
    refreshBalance();
  }

  async function proveHumanity() {
    // Phase 0 launch: face/coordinator is optional and off by default.
    // - BIOMETRIC_ENABLED=true → /biometric-capture (requires COORDINATOR_BASE).
    // - else ALLOW_DEVICE_SECRET_REGISTER=true → explicit device-secret path
    //   (getDeviceIdentity → checkAlreadyRegistered → proveAndRegister).
    // - else fail-closed. NOT a silent fallback when Bio is flipped off.
    if (BIOMETRIC_ENABLED) {
      router.push('/biometric-capture');
      return;
    }
    if (!ALLOW_DEVICE_SECRET_REGISTER) {
      addLog(t('identity.biometricDisabled'), 'error');
      setStatus('error');
      return;
    }
    if (!signer) return;
    setStatus('proving');
    setLog([]);
    setActiveStep(0);
    setProvingSlow(false);
    const slowTimer = setTimeout(() => setProvingSlow(true), PROVING_SLOW_MS);
    try {
      addLog(t('identity.logCheckingBiometric'), 'info');
      const identity = await getDeviceIdentity();
      addLog(t('identity.logDeviceReady'), 'success');
      setActiveStep(1);

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
      const result = await proveAndRegister(signer, identity, t('trade.signTimeout'));
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
  }

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
          <Text style={S.heroSub}>{BIOMETRIC_ENABLED ? t('identity.biometricPrivacyNote') : t('identity.heroSub')}</Text>
        </View>

        {/* FIX: heroSub/privBadge's "your biometric data never leaves this
            device" claim is true for the device-secret flow below, but
            would be FALSE for the real palm+face capture flow (photos are
            sent to a matching coordinator) -- see biometric-capture.tsx.
            Swapping the copy here when BIOMETRIC_ENABLED prevents
            reintroducing the exact kind of identity-copy overclaim this
            app's own history has already had to audit and fix once. */}
        {!BIOMETRIC_ENABLED && (
          <View style={S.privBadge}>
            <Text style={S.privBadgeText}>{t('identity.privBadge')}</Text>
          </View>
        )}

        <View style={S.card}>
          {/* step1Desc etc. describe the device-secret flow specifically
              ("never leaves the device") -- inaccurate for the real
              palm+face flow, so that stepper is replaced with one accurate
              line here; the actual consent/explanation lives in
              biometric-capture.tsx's own screen. */}
          {BIOMETRIC_ENABLED ? (
            <Text style={S.stepDesc}>{t('identity.biometricStepsIntro')}</Text>
          ) : (
            STEPS.map((s, i) => <StepItem key={i} n={i + 1} title={s.title} desc={s.desc} state={stepState(i)} />)
          )}

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

          {status === 'idle' && ALLOW_DEVICE_SECRET_REGISTER && !BIOMETRIC_ENABLED && (
            <View style={S.phase0Banner}>
              <Text style={S.phase0BannerText}>{t('identity.phase0DeviceSecretDisclaimer')}</Text>
            </View>
          )}

          {status === 'idle' && (
            <TouchableOpacity onPress={proveHumanity} activeOpacity={0.85}>
              <LinearGradient colors={theme.gradient} start={theme.gradientAngle.start} end={theme.gradientAngle.end} style={S.btnPrimary}>
                <Text style={S.btnPrimaryText}>{t('identity.proveHumanityBtn')}</Text>
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

        {/* Withdrawal of consent (GDPR Art. 17). Only shown when this device
            actually holds a bio_hash -- offering an action that cannot work
            is worse than not offering it.

            The copy deliberately does NOT promise total erasure. An encrypted
            uniqueness token stays behind, because erasing a biometric and
            still recognizing its owner are mutually exclusive, and without
            that token the same person could delete, register again, and
            collect the 1000 AEQ starting grant a second time -- without limit.
            See matching-service/app/storage.py:delete_enrollment. */}
        {bioHash && (
          <View style={S.deleteCard}>
            <Text style={S.deleteTitle}>{t('identity.deleteTitle')}</Text>
            <Text style={S.deleteBody}>{t('identity.deleteBody')}</Text>
            <Text style={S.deleteNote}>{t('identity.deleteRetainNote')}</Text>
            {deleteMsg && (
              <Text style={[S.deleteMsg, deleteMsg.ok ? S.deleteMsgOk : S.deleteMsgErr]}>{deleteMsg.text}</Text>
            )}
            {deleting ? (
              <View style={S.loadingBox}>
                <ActivityIndicator color={theme.purple} size="small" />
                <Text style={S.loadingText}>{t('identity.deleteRunning')}</Text>
              </View>
            ) : (
              <TouchableOpacity onPress={confirmDelete} activeOpacity={0.85} style={S.deleteBtn}>
                <Text style={S.deleteBtnText}>{t('identity.deleteBtn')}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

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

  privBadge: { marginHorizontal: 20, backgroundColor: neonTint, borderWidth: 1, borderColor: neonTintBorder, borderRadius: theme.radiusSm, padding: 11, marginBottom: 16 },
  privBadgeText: { color: theme.neon, fontSize: 11, lineHeight: 16, textAlign: 'center' },

  phase0Banner: { backgroundColor: 'rgba(240,180,41,0.12)', borderWidth: 1, borderColor: 'rgba(240,180,41,0.35)', borderRadius: theme.radiusSm, padding: 12, marginTop: 8 },
  phase0BannerText: { color: theme.gold, fontSize: 11, lineHeight: 16, textAlign: 'center' },

  card: { marginHorizontal: 20, backgroundColor: theme.card, borderRadius: theme.radius, padding: 22, borderWidth: 1, borderColor: theme.border },

  deleteCard: { marginHorizontal: 20, marginTop: 16, backgroundColor: theme.card, borderRadius: theme.radius, padding: 20, borderWidth: 1, borderColor: '#e5484d55' },
  deleteTitle: { fontSize: 14, fontWeight: '800', color: '#e5484d', marginBottom: 8 },
  deleteBody: { fontSize: 12, color: theme.muted, lineHeight: 18, marginBottom: 10 },
  deleteNote: { fontSize: 11, color: theme.muted, lineHeight: 16, fontStyle: 'italic', marginBottom: 14 },
  deleteBtn: { borderWidth: 1, borderColor: '#e5484d', borderRadius: theme.radiusSm, paddingVertical: 13, alignItems: 'center' },
  deleteBtnText: { color: '#e5484d', fontSize: 13, fontWeight: '700' },
  deleteMsg: { fontSize: 12, lineHeight: 18, marginBottom: 12 },
  deleteMsgOk: { color: theme.neon },
  deleteMsgErr: { color: '#e5484d' },

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
