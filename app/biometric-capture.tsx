// Phase 0 biometric proof-of-personhood capture screen (palm+face+consent,
// see aequitas-biometric-beta). Pushed from the Identity tab ONLY when
// BIOMETRIC_ENABLED is set (see lib/config.ts) -- unreachable otherwise.
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Camera, useCameraDevice, useCameraPermission, usePhotoOutput } from 'react-native-vision-camera';
import { useFaceDetectorOutput, type Face } from 'react-native-vision-camera-face-detector';
import { detectHand, type HandBounds } from 'mediapipe-hand-detector';
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
import { withTimeout } from '@/lib/signer';

type Step = 'consent' | 'palm' | 'face_intro' | 'face_burst' | 'submitting' | 'result';

// Real-device follow-up ("search for something better for palmprint/eye
// verification"): extended from 15 frames (1.5s, enough for blink
// detection alone) to 50 frames (5s) so the server's new pulse (rPPG)
// check (matching-service/app/pulse.py) has enough of the burst to find a
// plausible heartbeat frequency at all -- a real cardiac cycle needs
// several seconds to show up clearly in an FFT, not under 2 seconds. This
// is a real, deliberate UX cost (a longer "hold still" moment) traded for
// a liveness signal a simple video-replay-of-a-blink can't fake.
const BURST_FRAME_COUNT = 50;
const BURST_INTERVAL_MS = 100;
// Real-device report: the burst loop got stuck forever on "please blink
// now" -- a rapid-fire capture that stalls blocks the whole for-loop with
// no error and no way out, same class of "external call can hang forever"
// problem withTimeout already exists for on the WalletConnect side (see
// lib/signer.ts). A stuck single-shot palm capture would hang the same way.
const FRAME_TIMEOUT_MS = 3_000;
const PALM_TIMEOUT_MS = 8_000;

// Real-device feedback: "there should be a template/guide showing whether the
// palm/face is actually in the right position" -- these thresholds are what
// FaceGuide below uses to turn the live react-native-vision-camera-face-detector
// output (bounds centered, a plausible size for a close-up capture, facing
// roughly straight at the camera) into one specific status, so the user
// isn't just told "wrong" but WHAT to fix. Deliberately not a hard gate on
// the capture button below: a face detector that's slightly off in some
// lighting condition shouldn't be able to strand someone who can otherwise
// clearly see themselves centered in the oval -- the manual button always
// still works regardless of this status.
const CENTER_TOLERANCE = 0.18;
const MIN_SIZE_RATIO = 0.28;
const MAX_SIZE_RATIO = 0.75;
const MAX_ANGLE_DEG = 20;

type FaceGuideStatus = 'none' | 'too_far' | 'too_close' | 'off_center' | 'angled' | 'ok';

function getFaceGuideStatus(face: Face): FaceGuideStatus {
  const sizeRatio = face.bounds.width / face.frameWidth;
  if (sizeRatio <= MIN_SIZE_RATIO) return 'too_far';
  if (sizeRatio >= MAX_SIZE_RATIO) return 'too_close';
  const cx = face.bounds.x + face.bounds.width / 2;
  const cy = face.bounds.y + face.bounds.height / 2;
  const centeredX = Math.abs(cx / face.frameWidth - 0.5) < CENTER_TOLERANCE;
  const centeredY = Math.abs(cy / face.frameHeight - 0.5) < CENTER_TOLERANCE;
  if (!centeredX || !centeredY) return 'off_center';
  const angledOk = Math.abs(face.yawAngle) < MAX_ANGLE_DEG && Math.abs(face.pitchAngle) < MAX_ANGLE_DEG;
  if (!angledOk) return 'angled';
  return 'ok';
}

// Real-device follow-up: "there must be something better for palmprint than
// what we have now" -- true real-time hand tracking has no ready-made React
// Native library (checked: react-native-mediapipe only implements face/pose/
// object detection, no hand landmark module despite the name), so this
// polls MediaPipe's own official HandLandmarker (mediapipe-hand-detector, a
// small local native module wrapping the same model the server already uses
// in Python) on periodically-captured preview frames instead of a live
// frame-processor stream -- less fluid than the face guide, but real
// detection against the actual model, not a static decoration.
const PALM_POLL_INTERVAL_MS = 600;

type PalmGuideStatus = 'none' | 'too_far' | 'too_close' | 'off_center' | 'ok';

function getPalmGuideStatus(bounds: HandBounds): PalmGuideStatus {
  const width = bounds.maxX - bounds.minX;
  if (width <= MIN_SIZE_RATIO) return 'too_far';
  if (width >= MAX_SIZE_RATIO) return 'too_close';
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const centered = Math.abs(cx - 0.5) < CENTER_TOLERANCE && Math.abs(cy - 0.5) < CENTER_TOLERANCE;
  if (!centered) return 'off_center';
  return 'ok';
}

// Matches the app's one established primary-button look (see e.g.
// identity.tsx's proveHumanityBtn/retryBtn) instead of a flat fill, so this
// screen doesn't read as a visually separate, less-finished part of the app.
function GradientButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85}>
      <LinearGradient colors={theme.gradient} start={theme.gradientAngle.start} end={theme.gradientAngle.end} style={S.btnPrimary}>
        <Text style={S.btnPrimaryText}>{label}</Text>
      </LinearGradient>
    </TouchableOpacity>
  );
}

// Palm (1) -> Face (2) progress, echoing identity.tsx's StepItem circles
// (done = gradient check, active = spinner ring, pending = plain number) so
// the capture flow reads as one more step of the same registration process
// rather than a bolted-on separate feature.
function StepDots({ current }: { current: 1 | 2 | 3 }) {
  return (
    <View style={S.stepDots}>
      {([1, 2] as const).map((n) => (
        <React.Fragment key={n}>
          {n < current ? (
            <LinearGradient colors={theme.gradient} start={theme.gradientAngle.start} end={theme.gradientAngle.end} style={S.stepDot}>
              <Text style={S.stepDotCheck}>✓</Text>
            </LinearGradient>
          ) : n === current ? (
            <View style={[S.stepDot, S.stepDotActive]}>
              <ActivityIndicator size="small" color={theme.purple} />
            </View>
          ) : (
            <View style={[S.stepDot, S.stepDotPending]}>
              <Text style={S.stepDotNum}>{n}</Text>
            </View>
          )}
          {n === 1 && <View style={S.stepLine} />}
        </React.Fragment>
      ))}
    </View>
  );
}

function PalmGuide({ status, debug }: { status: PalmGuideStatus; debug: string }) {
  const { t } = useLanguage();
  const hint = (() => {
    switch (status) {
      case 'none': return t('identity.biometricPalmGuideNone');
      case 'too_far': return t('identity.biometricPalmGuideTooFar');
      case 'too_close': return t('identity.biometricPalmGuideTooClose');
      case 'off_center': return t('identity.biometricPalmGuideOffCenter');
      case 'ok': return t('identity.biometricPalmGuideOk');
    }
  })();
  const ok = status === 'ok';
  return (
    <View style={S.guideWrap} pointerEvents="none">
      <View style={[S.palmFrame, ok && S.palmFrameOk]} />
      <Text style={[S.guideHint, ok && S.guideHintOk]}>{hint}</Text>
      {/* TEMPORARY diagnostic, see palmDebug's own comment */}
      <Text style={S.debugText}>{debug}</Text>
    </View>
  );
}

function FaceGuide({ status }: { status: FaceGuideStatus }) {
  const { t } = useLanguage();
  const hint = (() => {
    switch (status) {
      case 'none': return t('identity.biometricGuideNone');
      case 'too_far': return t('identity.biometricGuideTooFar');
      case 'too_close': return t('identity.biometricGuideTooClose');
      case 'off_center': return t('identity.biometricGuideOffCenter');
      case 'angled': return t('identity.biometricGuideAngled');
      case 'ok': return t('identity.biometricGuideOk');
    }
  })();
  const ok = status === 'ok';
  return (
    <View style={S.guideWrap} pointerEvents="none">
      <View style={[S.faceOval, ok && S.faceOvalOk]} />
      <Text style={[S.guideHint, ok && S.guideHintOk]}>{hint}</Text>
    </View>
  );
}

export default function BiometricCapture() {
  const { t } = useLanguage();
  const { address, signer } = useWallet();
  const [step, setStep] = useState<Step>('consent');
  const [biometricChecked, setBiometricChecked] = useState(false);
  const [bonusChecked, setBonusChecked] = useState(false);
  const [consentError, setConsentError] = useState('');
  const [consent, setConsent] = useState<ConsentDecision | null>(null);

  const { hasPermission, requestPermission } = useCameraPermission();
  const backDevice = useCameraDevice('back');
  const frontDevice = useCameraDevice('front');
  const photoOutput = usePhotoOutput();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  const [faceGuideStatus, setFaceGuideStatus] = useState<FaceGuideStatus>('none');
  // Real-device report: the guide claimed "face detected/centered" even
  // when the face was visibly outside the oval. Root cause: autoMode
  // defaults to false in this library, meaning bounds/frameWidth/
  // frameHeight are relative to the raw camera SENSOR frame, not to the
  // screen/preview -- getFaceGuideStatus's ratio math was correct, just
  // measuring the wrong coordinate space entirely (sensor orientation and
  // front-camera mirroring both differ from what's shown on screen).
  // autoMode:true makes the library do that scaling/rotation itself, but
  // requires the actual window size to scale against -- the <Camera> here
  // fills the whole screen (cameraWrap/camera are both flex:1, overlayBox
  // is position:absolute on top of it), so window dimensions match its
  // rendered size.
  const faceDetectorOutput = useFaceDetectorOutput({
    performanceMode: 'fast',
    cameraFacing: 'front',
    autoMode: true,
    windowWidth,
    windowHeight,
    onFacesDetected: (faces) => {
      setFaceGuideStatus(faces.length > 0 ? getFaceGuideStatus(faces[0]) : 'none');
    },
    onError: () => setFaceGuideStatus('none'),
  });

  const [palmGuideStatus, setPalmGuideStatus] = useState<PalmGuideStatus>('none');
  // TEMPORARY diagnostic (remove once the "keine Hand gefunden" root cause
  // is confirmed) -- real-device logcat access has been unreliable for
  // seeing whether this poll ever actually runs at all, so this puts the
  // same information directly on screen instead.
  const [palmDebug, setPalmDebug] = useState('poll not started yet');
  // Real-device report: the actual palm capture button started failing
  // with "Testaufnahme konnte nicht abgeschlossen werden" every time
  // (capturePalm's withTimeout hitting PALM_TIMEOUT_MS) -- this same ref
  // is now a lock SHARED between the guide's background polling below and
  // capturePalm() itself, since both call photoOutput.capturePhotoToFile
  // on the same output and vision-camera doesn't handle two concurrent
  // capture requests cleanly. Before this, a poll landing at the same
  // moment as the user's tap could stall the real capture for the full
  // 8s timeout.
  const cameraBusyRef = useRef(false);

  // Periodic polling (not a real-time frame-processor stream -- see
  // getPalmGuideStatus's own comment on why) against the actual
  // MediaPipe HandLandmarker model while the palm step is visible. Skips a
  // tick instead of queueing if the previous detection call hasn't returned
  // yet (or a real capture is in flight, see cameraBusyRef above), so a
  // slow device can't pile up capture calls.
  useEffect(() => {
    if (step !== 'palm' || !hasPermission || !backDevice) {
      setPalmDebug(`effect gated off: step=${step} hasPermission=${hasPermission} backDevice=${!!backDevice}`);
      return;
    }
    setPalmDebug('effect started, waiting for first tick...');
    let tick = 0;
    const interval = setInterval(async () => {
      tick++;
      if (cameraBusyRef.current) {
        setPalmDebug(`tick ${tick}: skipped, camera busy`);
        return;
      }
      cameraBusyRef.current = true;
      setPalmDebug(`tick ${tick}: capturing photo...`);
      try {
        // Real-device report: this invisible background poll (the user
        // never pressed anything for it) was firing the audible camera
        // shutter sound every 600ms -- silenced, unlike the actual
        // capture button presses below which keep it as expected
        // "yes, that was captured" feedback.
        const file = await photoOutput.capturePhotoToFile({ enableShutterSound: false }, {});
        setPalmDebug(`tick ${tick}: captured, running detectHand...`);
        const bounds = await detectHand('file://' + file.filePath);
        setPalmDebug(`tick ${tick}: bounds=${bounds ? JSON.stringify(bounds) : 'null (no hand)'}`);
        setPalmGuideStatus(bounds ? getPalmGuideStatus(bounds) : 'none');
      } catch (e: any) {
        setPalmDebug(`tick ${tick}: ERROR ${e?.message ?? String(e)}`);
        console.error('[biometric-capture] palm guide poll failed', e);
        setPalmGuideStatus('none');
      } finally {
        cameraBusyRef.current = false;
      }
    }, PALM_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [step, hasPermission, backDevice, photoOutput]);

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
    if (hasPermission) return true;
    return requestPermission();
  }

  async function capturePalm() {
    if (!(await ensurePermission())) return;
    // Wait out a poll-triggered capture if one's in flight (always brief),
    // then hold the same lock so the guide's own poll skips itself for
    // the duration of this real capture -- see cameraBusyRef's comment.
    const waitDeadline = Date.now() + 2_000;
    while (cameraBusyRef.current && Date.now() < waitDeadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    cameraBusyRef.current = true;
    try {
      const file = await withTimeout(photoOutput.capturePhotoToFile({}, {}), PALM_TIMEOUT_MS, 'timeout');
      setPalmUri('file://' + file.filePath);
      setStep('face_intro');
    } catch (e) {
      console.error('[biometric-capture] palm capture failed', e);
      setSubmitError(t('identity.biometricResultFailed'));
      setStep('result');
    } finally {
      cameraBusyRef.current = false;
    }
  }

  async function startFaceCapture() {
    if (!(await ensurePermission())) return;
    setStep('face_burst');
    const frames: string[] = [];
    for (let i = 0; i < BURST_FRAME_COUNT; i++) {
      try {
        // Real-device report: 50 individual shutter-sound clicks in 5
        // seconds ("macht ununterbrochen das Kamera Geräusch") -- this is
        // one continuous burst the user already started, not 50 separate
        // capture actions, so per-frame audible feedback doesn't mean
        // anything here (unlike the actual capture buttons elsewhere).
        const file = await withTimeout(
          photoOutput.capturePhotoToFile({ enableShutterSound: false }, {}),
          FRAME_TIMEOUT_MS,
          'timeout'
        );
        frames.push('file://' + file.filePath);
      } catch (e) {
        // A single stuck frame shouldn't cost the whole burst -- skip it
        // and keep going, same "degrade instead of hang" idea as above.
        console.error('[biometric-capture] face burst frame failed', e);
      }
      await new Promise((r) => setTimeout(r, BURST_INTERVAL_MS));
    }
    if (frames.length === 0) {
      setSubmitError(t('identity.biometricResultFailed'));
      setStep('result');
      return;
    }
    setBurstUris(frames);
    setFaceUri(frames[0]);
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
        { palmUri, faceUri: finalFaceUri, faceBurstUris: finalBurst, burstIntervalMs: BURST_INTERVAL_MS },
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
      console.error('[biometric-capture] submit failed', e);
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
          <View style={S.card}>
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

            <GradientButton label={t('identity.biometricConsentConfirmBtn')} onPress={confirmConsent} />
            <TouchableOpacity style={S.btnGhost} onPress={close} activeOpacity={0.8}>
              <Text style={S.btnGhostText}>{t('identity.biometricCancelBtn')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {step === 'palm' && (
        <View style={S.cameraWrap}>
          {hasPermission && backDevice ? (
            <>
              <Camera style={S.camera} device={backDevice} isActive outputs={[photoOutput]} />
              <PalmGuide status={palmGuideStatus} debug={palmDebug} />
            </>
          ) : (
            <View style={S.content}>
              <Text style={S.body}>{t('identity.biometricCameraPermissionDenied')}</Text>
            </View>
          )}
          <View style={S.overlayBox}>
            <StepDots current={1} />
            <Text style={S.overlayTitle}>{t('identity.biometricPalmTitle')}</Text>
            <Text style={S.overlayHint}>{t('identity.biometricPalmHint')}</Text>
            <GradientButton label={t('identity.biometricCaptureBtn')} onPress={capturePalm} />
          </View>
        </View>
      )}

      {(step === 'face_intro' || step === 'face_burst') && (
        // Real-device report: every single burst frame failed with
        // "Camera is closed" / "Capture request is cancelled on closed
        // CameraGraph" -- face_intro and face_burst used to be two
        // SEPARATE JSX branches, each with its own <Camera> element.
        // React treats those as different elements and unmounts/remounts
        // the underlying native camera session on every face_intro ->
        // face_burst transition, right as startFaceCapture()'s loop
        // starts calling capturePhotoToFile on it -- a real hardware
        // session teardown/init race, not a timing fluke. One <Camera>
        // now stays mounted across both steps; only the overlay content
        // below it (button vs. spinner) switches.
        <View style={S.cameraWrap}>
          {hasPermission && frontDevice ? (
            <>
              <Camera style={S.camera} device={frontDevice} isActive outputs={[photoOutput, faceDetectorOutput]} />
              <FaceGuide status={faceGuideStatus} />
            </>
          ) : (
            <View style={S.content}>
              <Text style={S.body}>{t('identity.biometricCameraPermissionDenied')}</Text>
            </View>
          )}
          <View style={S.overlayBox}>
            <StepDots current={2} />
            {step === 'face_intro' ? (
              <>
                <Text style={S.overlayTitle}>{t('identity.biometricFaceTitle')}</Text>
                <Text style={S.overlayHint}>{t('identity.biometricFaceHint')}</Text>
                <GradientButton label={t('identity.biometricCaptureBtn')} onPress={startFaceCapture} />
              </>
            ) : (
              <>
                <ActivityIndicator color={theme.purple} size="large" style={S.spinnerGap} />
                <Text style={S.overlayHint}>{t('identity.biometricLivenessCapturing')}</Text>
              </>
            )}
          </View>
        </View>
      )}

      {step === 'submitting' && (
        <View style={S.content}>
          <View style={S.card}>
            <ActivityIndicator color={theme.purple} size="large" />
            <Text style={[S.body, S.spinnerGap]}>{t('identity.biometricProcessing')}</Text>
          </View>
        </View>
      )}

      {step === 'result' && (
        <View style={S.content}>
          <View style={S.card}>
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
            <GradientButton label={t('identity.biometricBackBtn')} onPress={close} />
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const S = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.bg },
  content: { flex: 1, padding: 24, justifyContent: 'center' },
  card: {
    backgroundColor: theme.card,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 24,
  },
  title: { fontSize: 18, fontWeight: '800', color: theme.text, marginBottom: 12 },
  body: { fontSize: 13, color: theme.muted, lineHeight: 20, marginBottom: 16, textAlign: 'center' },
  spinnerGap: { marginTop: 14 },

  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  checkbox: { width: 22, height: 22, borderRadius: 5, borderWidth: 1.5, borderColor: theme.borderStrong, alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: theme.purple, borderColor: theme.purple },
  checkboxMark: { color: '#fff', fontWeight: 'bold', fontSize: 13 },
  checkLabel: { color: theme.text, fontSize: 12.5, flex: 1, lineHeight: 18 },

  errorText: { color: theme.red, fontSize: 12, marginBottom: 12, textAlign: 'center' },

  btnPrimary: { borderRadius: theme.radiusSm, padding: 16, alignItems: 'center', marginTop: 12 },
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

  guideWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  palmFrame: { width: 230, height: 230, borderRadius: 24, borderWidth: 3, borderStyle: 'dashed', borderColor: theme.borderStrong },
  palmFrameOk: { borderColor: theme.neon, borderStyle: 'solid' },
  faceOval: { width: 210, height: 280, borderRadius: 140, borderWidth: 3, borderStyle: 'dashed', borderColor: theme.borderStrong },
  faceOvalOk: { borderColor: theme.neon, borderStyle: 'solid' },
  guideHint: {
    marginTop: 14, color: theme.text, fontSize: 12.5, fontWeight: '700', letterSpacing: 0.5,
    backgroundColor: 'rgba(12,14,22,0.7)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: theme.radiusSm,
  },
  guideHintOk: { color: theme.neon },
  // TEMPORARY diagnostic style, see palmDebug's own comment
  debugText: {
    marginTop: 8, color: '#ffcc00', fontSize: 10, fontFamily: 'monospace',
    backgroundColor: 'rgba(0,0,0,0.8)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6,
    maxWidth: '90%', textAlign: 'center',
  },

  stepDots: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  stepDot: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  stepDotActive: { backgroundColor: theme.card2, borderWidth: 1.5, borderColor: theme.purple },
  stepDotPending: { backgroundColor: theme.card2, borderWidth: 1, borderColor: theme.borderStrong },
  stepDotNum: { color: theme.muted, fontSize: 12, fontWeight: '700' },
  stepDotCheck: { color: '#fff', fontSize: 12, fontWeight: '700' },
  stepLine: { width: 28, height: 2, backgroundColor: theme.borderStrong, marginHorizontal: 4 },
});
