// Phase 0 biometric proof-of-personhood capture screen (palm+face+consent,
// see aequitas-biometric-beta). Pushed from the Identity tab ONLY when
// BIOMETRIC_ENABLED is set (see lib/config.ts) -- unreachable otherwise.
import React, { useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useLanguage } from '@/contexts/LanguageContext';
import { useWallet } from '@/contexts/WalletContext';
import { theme } from '@/constants/aequitas-theme';
import {
  registerBiometric,
  getOrCreateDeviceId,
  type BiometricRegisterResult,
  type ConsentDecision,
} from '@/lib/biometricIdentity';
import { checkAlreadyRegistered, identityFromBioHash, proveAndRegister } from '@/lib/identity';

type Step = 'consent' | 'palm' | 'face_intro' | 'face_burst' | 'submitting' | 'result';

const BURST_FRAME_COUNT = 15;
const BURST_INTERVAL_MS = 100;

export default function BiometricCapture() {
  const { t } = useLanguage();
  const { address, signer } = useWallet();
  const [step, setStep] = useState<Step>('consent');
  const [biometricChecked, setBiometricChecked] = useState(false);
  const [bonusChecked, setBonusChecked] = useState(false);
  const [consentError, setConsentError] = useState('');
  const [consent, setConsent] = useState<ConsentDecision | null>(null);

  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const [palmUri, setPalmUri] = useState<string | null>(null);
  const [faceUri, setFaceUri] = useState<string | null>(null);
  const [burstUris, setBurstUris] = useState<string[]>([]);

  const [result, setResult] = useState<BiometricRegisterResult | null>(null);
  const [submitError, setSubmitError] = useState('');

  function confirmConsent() {
    if (!biometricChecked) {
      setConsentError(t('identity.biometricConsentRequired'));
      return;
    }
    setConsent({ biometricConsent: true, bonusConsent: bonusChecked, consentedAt: Date.now() / 1000 });
    setConsentError('');
    setStep('palm');
  }

  async function ensurePermission(): Promise<boolean> {
    if (permission?.granted) return true;
    const res = await requestPermission();
    return res.granted;
  }

  async function capturePalm() {
    if (!(await ensurePermission())) return;
    const photo = await cameraRef.current?.takePictureAsync({ quality: 0.85 });
    if (photo?.uri) {
      setPalmUri(photo.uri);
      setStep('face_intro');
    }
  }

  async function startFaceCapture() {
    if (!(await ensurePermission())) return;
    setStep('face_burst');
    const frames: string[] = [];
    for (let i = 0; i < BURST_FRAME_COUNT; i++) {
      const photo = await cameraRef.current?.takePictureAsync({ quality: 0.7 });
      if (photo?.uri) frames.push(photo.uri);
      await new Promise((r) => setTimeout(r, BURST_INTERVAL_MS));
    }
    setBurstUris(frames);
    setFaceUri(frames[0] ?? null);
    await submit(frames[0], frames);
  }

  async function submit(firstFrame?: string, frames?: string[]) {
    const finalFaceUri = firstFrame ?? faceUri;
    const finalBurst = frames ?? burstUris;
    if (!palmUri || !finalFaceUri || !consent || !address || !signer) return;
    setStep('submitting');
    setSubmitError('');
    try {
      const deviceId = await getOrCreateDeviceId();
      const res = await registerBiometric(
        { palmUri, faceUri: finalFaceUri, faceBurstUris: finalBurst },
        { mode: 'test', deviceId, walletAddress: address, consent }
      );
      setResult(res);

      // The coordinator's job ends at producing a trustworthy bio_hash --
      // completing registration goes through the EXACT SAME existing
      // check/prove/sign/submit pipeline identity.tsx's device-secret flow
      // uses (see lib/identity.ts), just with this bio_hash instead of a
      // device-derived one. No changes to that pipeline, the chain, or the
      // proof server were needed for this.
      if (res.bio_hash && (res.decision === 'new_enrollment' || res.decision === 'duplicate_detected')) {
        const identity = identityFromBioHash(res.bio_hash);
        const check = await checkAlreadyRegistered(identity.bio);
        if (check.registered && check.is_human) {
          setStep('result');
          return;
        }
        const proveResult = await proveAndRegister(signer, identity, t('trade.signTimeout'));
        if (!proveResult.success) {
          setSubmitError(proveResult.message || t('identity.registrationFailed'));
        }
      }
      setStep('result');
    } catch (e: any) {
      setSubmitError(e?.message ?? t('identity.biometricResultFailed'));
      setStep('result');
    }
  }

  function close() {
    router.back();
  }

  return (
    <SafeAreaView style={S.safe}>
      {step === 'consent' && (
        <View style={S.content}>
          <Text style={S.title}>{t('identity.biometricConsentTitle')}</Text>
          <Text style={S.body}>{t('identity.biometricConsentBody')}</Text>

          <TouchableOpacity style={S.checkRow} onPress={() => setBiometricChecked((v) => !v)} activeOpacity={0.8}>
            <View style={[S.checkbox, biometricChecked && S.checkboxChecked]}>
              {biometricChecked && <Text style={S.checkboxMark}>✓</Text>}
            </View>
            <Text style={S.checkLabel}>{t('identity.biometricConsentBiometricLabel')}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={S.checkRow} onPress={() => setBonusChecked((v) => !v)} activeOpacity={0.8}>
            <View style={[S.checkbox, bonusChecked && S.checkboxChecked]}>
              {bonusChecked && <Text style={S.checkboxMark}>✓</Text>}
            </View>
            <Text style={S.checkLabel}>{t('identity.biometricConsentBonusLabel')}</Text>
          </TouchableOpacity>

          {consentError ? <Text style={S.errorText}>{consentError}</Text> : null}

          <TouchableOpacity style={S.btnPrimary} onPress={confirmConsent} activeOpacity={0.85}>
            <Text style={S.btnPrimaryText}>{t('identity.biometricConsentConfirmBtn')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={S.btnGhost} onPress={close} activeOpacity={0.8}>
            <Text style={S.btnGhostText}>{t('identity.biometricCancelBtn')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {step === 'palm' && (
        <View style={S.cameraWrap}>
          {permission?.granted ? (
            <CameraView ref={cameraRef} style={S.camera} facing="back" />
          ) : (
            <View style={S.content}>
              <Text style={S.body}>{t('identity.biometricCameraPermissionDenied')}</Text>
            </View>
          )}
          <View style={S.overlayBox}>
            <Text style={S.overlayTitle}>{t('identity.biometricPalmTitle')}</Text>
            <Text style={S.overlayHint}>{t('identity.biometricPalmHint')}</Text>
            <TouchableOpacity style={S.btnPrimary} onPress={capturePalm} activeOpacity={0.85}>
              <Text style={S.btnPrimaryText}>{t('identity.biometricCaptureBtn')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {step === 'face_intro' && (
        <View style={S.cameraWrap}>
          {permission?.granted ? (
            <CameraView ref={cameraRef} style={S.camera} facing="front" />
          ) : (
            <View style={S.content}>
              <Text style={S.body}>{t('identity.biometricCameraPermissionDenied')}</Text>
            </View>
          )}
          <View style={S.overlayBox}>
            <Text style={S.overlayTitle}>{t('identity.biometricFaceTitle')}</Text>
            <Text style={S.overlayHint}>{t('identity.biometricFaceHint')}</Text>
            <TouchableOpacity style={S.btnPrimary} onPress={startFaceCapture} activeOpacity={0.85}>
              <Text style={S.btnPrimaryText}>{t('identity.biometricCaptureBtn')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {step === 'face_burst' && (
        <View style={S.cameraWrap}>
          <CameraView ref={cameraRef} style={S.camera} facing="front" />
          <View style={S.overlayBox}>
            <ActivityIndicator color={theme.purple} size="large" />
            <Text style={S.overlayHint}>{t('identity.biometricLivenessCapturing')}</Text>
          </View>
        </View>
      )}

      {step === 'submitting' && (
        <View style={S.content}>
          <ActivityIndicator color={theme.purple} size="large" />
          <Text style={S.body}>{t('identity.biometricProcessing')}</Text>
        </View>
      )}

      {step === 'result' && (
        <View style={S.content}>
          {submitError ? (
            <Text style={S.errorText}>{submitError}</Text>
          ) : (
            <Text style={S.body}>
              {result?.decision === 'duplicate_detected'
                ? t('identity.biometricResultDuplicate')
                : result?.decision === 'new_enrollment'
                  ? t('identity.biometricResultNew')
                  : t('identity.biometricResultFailed')}
            </Text>
          )}
          <TouchableOpacity style={S.btnPrimary} onPress={close} activeOpacity={0.85}>
            <Text style={S.btnPrimaryText}>{t('identity.biometricBackBtn')}</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

const S = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.bg },
  content: { flex: 1, padding: 24, justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '800', color: theme.text, marginBottom: 12 },
  body: { fontSize: 13, color: theme.muted, lineHeight: 20, marginBottom: 16, textAlign: 'center' },

  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  checkbox: { width: 22, height: 22, borderRadius: 5, borderWidth: 1.5, borderColor: theme.borderStrong, alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: theme.purple, borderColor: theme.purple },
  checkboxMark: { color: '#fff', fontWeight: 'bold', fontSize: 13 },
  checkLabel: { color: theme.text, fontSize: 12.5, flex: 1, lineHeight: 18 },

  errorText: { color: theme.red, fontSize: 12, marginBottom: 12, textAlign: 'center' },

  btnPrimary: { backgroundColor: theme.purple, borderRadius: theme.radiusSm, padding: 16, alignItems: 'center', marginTop: 12 },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 13, letterSpacing: 1 },
  btnGhost: { padding: 12, alignItems: 'center', marginTop: 8 },
  btnGhostText: { color: theme.muted, fontSize: 12 },

  cameraWrap: { flex: 1 },
  camera: { flex: 1 },
  overlayBox: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(12,14,22,0.92)', padding: 20, alignItems: 'center',
  },
  overlayTitle: { color: theme.text, fontSize: 15, fontWeight: '700', marginBottom: 6 },
  overlayHint: { color: theme.muted, fontSize: 12, textAlign: 'center', lineHeight: 18 },
});
