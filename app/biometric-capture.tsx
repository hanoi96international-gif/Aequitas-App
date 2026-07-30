// Phase 0 biometric proof-of-personhood capture screen (palm+face+consent,
// see aequitas-biometric-beta). Pushed from the Identity tab ONLY when
// BIOMETRIC_ENABLED is set (see lib/config.ts) -- unreachable otherwise.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Camera, CommonResolutions, useCameraDevice, useCameraPermission, usePhotoOutput, useVideoOutput, type CameraRef } from 'react-native-vision-camera';
import { useImageFaceDetector, type Face } from 'react-native-vision-camera-face-detector';
import { detectHand, type HandBounds } from 'mediapipe-hand-detector';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { Gyroscope } from 'expo-sensors';
import * as Speech from 'expo-speech';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioPlayer, useAudioRecorder } from 'expo-audio';
import Svg, { Path } from 'react-native-svg';
import { useLanguage } from '@/contexts/LanguageContext';
import { useWallet } from '@/contexts/WalletContext';
import { theme } from '@/constants/aequitas-theme';
import {
  registerBiometric,
  requestChallenge,
  getOrCreateDeviceId,
  voucherFor,
  type BiometricRegisterResult,
  type ChallengeType,
  type ConsentDecision,
  type FlashColor,
  type ImuSample,
  type IssuedChallenge,
  type VouchResult,
} from '@/lib/biometricIdentity';

type TFunc = ReturnType<typeof useLanguage>['t'];

/** Maps the coordinator-issued challenge type (see biometricIdentity.ts's
 * requestChallenge()) to its instruction copy -- kept as a lookup rather
 * than a template string so each language can phrase the 5 directions
 * naturally instead of interpolating one generic "look {direction}"
 * pattern into grammar that doesn't always fit (see the i18n locale
 * files' own biometricChallenge* keys). */
function challengeInstruction(type: ChallengeType, t: TFunc): string {
  switch (type) {
    case 'look_left': return t('identity.biometricChallengeLookLeft');
    case 'look_right': return t('identity.biometricChallengeLookRight');
    case 'look_up': return t('identity.biometricChallengeLookUp');
    case 'look_down': return t('identity.biometricChallengeLookDown');
    case 'smile': return t('identity.biometricChallengeSmile');
    default: return '';
  }
}
import { checkAlreadyRegistered, identityFromBioHash, proveAndRegister } from '@/lib/identity';
import { withTimeout } from '@/lib/signer';

type Step =
  | 'consent'
  | 'palm'
  | 'face_intro'
  | 'face_burst'
  | 'fingertip_intro'
  | 'fingertip_burst'
  | 'ear_intro'
  | 'acoustic_intro'
  | 'submitting'
  | 'result';

// Real-device follow-up ("search for something better for palmprint/eye
// verification"): the burst duration was extended from 1.5s (enough for
// blink detection alone) to ~5.5s so the server's pulse (rPPG) check
// (matching-service/app/pulse.py) has enough of the burst to find a
// plausible heartbeat frequency at all -- a real cardiac cycle needs
// several seconds to show up clearly in an FFT, not under 2 seconds. This
// is a real, deliberate UX cost (a longer "hold still" moment) traded for
// a liveness signal a simple video-replay-of-a-blink can't fake.
//
// Real-device report ("wofür müssen wir 10-15 Sekunden durchgehend Fotos
// machen?"): this used to be 50 SEPARATE capturePhotoToFile() calls, each
// one a real still-photo capture -- meaning 50 individual forced shutter
// sounds back to back (same OS-enforced sound as the palm step, see
// checkPalmPosition's own comment; confirmed there via vision-camera's
// Android source that this device cannot have it disabled), stretched out
// by real per-shot JPEG-encode overhead well past the nominal 5s. Fixed by
// recording ONE short video instead (a video recording is not a "photo
// capture" event on Android, so it doesn't trigger MediaActionSound at
// all) and extracting BURST_EXTRACT_COUNT still frames from it afterward
// via expo-video-thumbnails -- same multipart upload contract as before
// (face_burst[] JPEGs + burstIntervalMs metadata for pulse.py's FFT), just
// a silent capture mechanism underneath. Frame count dropped from 50 to 30
// since duration (for FFT frequency resolution), not raw sample count, is
// what pulse detection actually needs -- 30 samples over 5.5s is still
// comfortably above the Nyquist rate for a resting heart rate (60-100bpm
// needs >~3.4Hz sampling; this is ~5.5Hz), and fewer frames means less
// client-side thumbnail-extraction time after the recording finishes.
const BURST_DURATION_S = 5.5;
const BURST_EXTRACT_COUNT = 30;
const BURST_INTERVAL_MS = Math.round((BURST_DURATION_S * 1000) / BURST_EXTRACT_COUNT);

// Fingertip-pulse burst (see fingertip_pulse.py, MIN_FRAMES=20) -- reuses
// BURST_INTERVAL_MS exactly rather than defining its own: the coordinator
// derives BOTH channels' fps from the single burst_interval_ms field a
// request sends (see matching-service/app/main.py's _run_match), so a
// different interval here would silently make the fingertip channel's BPM
// math wrong -- same mistake capture-web's own capture.js was written to
// deliberately avoid, see its own comment on this exact point.
const FINGERTIP_EXTRACT_COUNT = 25;
const FINGERTIP_DURATION_S = (FINGERTIP_EXTRACT_COUNT * BURST_INTERVAL_MS) / 1000;
const FINGERTIP_RECORDING_TIMEOUT_MS = (FINGERTIP_DURATION_S + 5) * 1_000;

// Gyroscope sampling rate for imu_motion.py's own motion-consistency check
// (see its docstring) -- 20Hz is plenty for a correlation against optical
// flow computed from a ~5.5Hz frame rate; no need to sample faster than
// the burst frames themselves can resolve.
const GYROSCOPE_INTERVAL_MS = 50;
// Real-device report: the burst loop got stuck forever on "please blink
// now" -- a rapid-fire capture that stalls blocks the whole for-loop with
// no error and no way out, same class of "external call can hang forever"
// problem withTimeout already exists for on the WalletConnect side (see
// lib/signer.ts). A stuck video recording or thumbnail extraction could
// hang the same way, so both are wrapped in withTimeout below too.
const VIDEO_RECORDING_TIMEOUT_MS = (BURST_DURATION_S + 5) * 1_000;
const FRAME_EXTRACT_TIMEOUT_MS = 5_000;
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

// Real-device report: user's face visibly filled the oval/screen but the
// guide kept saying "come closer" (too_far). Root cause found in
// react-native-vision-camera-face-detector's own Android source
// (HybridFace.kt): with autoMode:true, `bounds` IS scaled into
// window/screen coordinates (via scaleX/scaleY), but `frameWidth`/
// `frameHeight` always return the RAW, unscaled camera sensor frame size
// regardless of autoMode -- two different unit spaces. Dividing a
// screen-space bounds.width by a sensor-space frameWidth (typically much
// larger, e.g. a 3000px+ analysis frame vs. a ~400dp screen) produces an
// artificially tiny ratio that reads as "too far" almost no matter how
// close the face actually is. Fix: divide by the SAME windowWidth/
// windowHeight passed into useFaceDetectorOutput -- the actual space
// `bounds` was scaled into -- instead of the library's unscaled accessors.
//
// Reused as-is (2026-07-15) for the on-demand snapshot check
// (checkFacePosition) -- callers now pass a Camera.takeSnapshot() image's
// own width/height, which `bounds` is naturally already in, so the
// scaling concern above doesn't even apply there; this function only
// needs both arguments to be in the same coordinate space, whatever that
// space is.
function getFaceGuideStatus(face: Face, windowWidth: number, windowHeight: number): FaceGuideStatus {
  const sizeRatio = face.bounds.width / windowWidth;
  if (sizeRatio <= MIN_SIZE_RATIO) return 'too_far';
  if (sizeRatio >= MAX_SIZE_RATIO) return 'too_close';
  const cx = face.bounds.x + face.bounds.width / 2;
  const cy = face.bounds.y + face.bounds.height / 2;
  const centeredX = Math.abs(cx / windowWidth - 0.5) < CENTER_TOLERANCE;
  const centeredY = Math.abs(cy / windowHeight - 0.5) < CENTER_TOLERANCE;
  if (!centeredX || !centeredY) return 'off_center';
  const angledOk = Math.abs(face.yawAngle) < MAX_ANGLE_DEG && Math.abs(face.pitchAngle) < MAX_ANGLE_DEG;
  if (!angledOk) return 'angled';
  return 'ok';
}

// Real-device follow-up: "there must be something better for palmprint than
// what we have now" -- true real-time hand tracking has no ready-made React
// Native library (checked: react-native-mediapipe only implements face/pose/
// object detection, no hand landmark module despite the name), so palm
// position is checked against MediaPipe's own official HandLandmarker
// (mediapipe-hand-detector, a small local native module wrapping the same
// model the server already uses in Python) on demand, via an explicit
// "check position" button (see checkPalmPosition() below) -- not a live
// frame-processor stream like the face guide has, and not automatic either.
//
// Real-device report: an earlier version of this DID poll automatically
// (every 600ms, then 900ms bounded to a fixed window) while the palm step
// was visible. Every poll tick is a real still-photo capture
// (capturePhotoToFile), which on this device's OEM/region build plays the
// shutter sound regardless of enableShutterSound:false -- confirmed by
// reading vision-camera's own Android source (HybridPhotoOutput.kt):
// `(settings.enableShutterSound ?: true) || CameraInfo.mustPlayShutterSound()`
// -- the OS-level override wins over the app's request, by design (some
// regions mandate an audible shutter and don't let apps disable it). No
// interval or bound fixes an UNPROMPTED sound firing on its own -- so this
// no longer runs automatically at all. A real fix for a live, silent guide
// would mean switching palm detection to a true frame-processor stream
// like the face guide uses (frame analysis has no shutter, unlike a photo
// capture) -- a bigger native rewrite (this module is a plain Expo Module,
// not a vision-camera-worklets frame processor plugin) that hasn't been
// attempted yet given its own real technical uncertainty (whether an Expo
// Module's functions are even reachable from a worklets runtime at all).

// Real-device report: "too_far/too_close" for the palm looked outright
// wrong -- e.g. reporting green/'ok' while the guide box was tiny relative
// to the actual hand. Root cause: unlike the face guide (which runs on the
// SAME live preview frames shown on screen, properly scaled via the
// library's autoMode), the palm poll runs MediaPipe on an independently
// captured STILL PHOTO (see photoOutput's own aspect ratio, FHD_4_3 =
// 1440x1920) whose field of view/aspect ratio does not necessarily match
// what the live preview shows. A size ratio computed from that photo's
// normalized landmark coordinates has no reliable correspondence to how
// large the hand LOOKS on screen -- any "too far/too close" feedback built
// on top of that is measuring the wrong thing and will mislead. Presence
// and rough centering ARE reliable (a hand roughly in the photo's center
// is also roughly in the preview's center regardless of FOV differences),
// so the status is deliberately narrowed to just that instead of pretending
// to have precision the underlying architecture can't support. A real fix
// needs the palm detector to run on live preview frames like the face
// guide does (see the comment above checkPalmPosition() for why that's a
// bigger, not-yet-attempted native rewrite).
type PalmGuideStatus = 'none' | 'off_center' | 'ok';

function getPalmGuideStatus(bounds: HandBounds): PalmGuideStatus {
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const centered = Math.abs(cx - 0.5) < CENTER_TOLERANCE && Math.abs(cy - 0.5) < CENTER_TOLERANCE;
  if (!centered) return 'off_center';
  return 'ok';
}

// Real-device feedback: a plain dashed square gave no clue WHAT to place
// inside it (unlike the face oval, which reads as "put your face here" on
// its own) -- an actual open-palm outline (stylized, not anatomically
// literal) makes the "spread your fingers, palm flat" instruction visible
// instead of only written.
const PALM_SILHOUETTE_PATH =
  'M100,250 C78,250 62,238 60,214 L58,150 C46,148 34,140 26,126 L14,102 ' +
  'C10,94 12,84 20,80 C27,77 34,80 38,87 L52,110 L46,58 C45,48 51,40 60,39 ' +
  'C69,38 76,45 77,55 L82,98 L80,26 C79,15 86,7 96,7 C106,7 113,15 113,26 ' +
  'L114,98 L120,42 C121,32 129,25 139,26 C148,27 155,35 154,45 L148,104 ' +
  'L162,86 C168,79 178,79 184,86 C189,92 189,101 183,108 L158,138 ' +
  'C150,148 140,152 130,152 L128,214 C126,238 122,250 100,250 Z';

// Real-device report: the silhouette was hardcoded to a fixed 200x260px --
// on a real phone screen (hundreds of dp wide) that renders as a small,
// oddly-placed shape unrelated to the actual screen size ("sehr klein und
// skaliert nicht"). Sized relative to window width instead, same idea as
// the face oval's fixed-but-screen-appropriate 210x280 (that one happens
// to already look right at typical phone widths, this one didn't because
// its original size was chosen without checking against a real device).
function PalmSilhouette({ ok }: { ok: boolean }) {
  const { width: windowWidth } = useWindowDimensions();
  const width = Math.min(windowWidth * 0.55, 230);
  const height = width * 1.3; // matches the path's own 200:260 aspect ratio
  return (
    <Svg width={width} height={height} viewBox="0 0 200 260">
      <Path
        d={PALM_SILHOUETTE_PATH}
        fill={ok ? 'rgba(52,211,153,0.12)' : 'rgba(155,114,246,0.06)'}
        stroke={ok ? theme.neon : theme.borderStrong}
        strokeWidth={3}
        strokeDasharray={ok ? undefined : '7,6'}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// Matches the app's one established primary-button look (see e.g.
// identity.tsx's proveHumanityBtn/retryBtn) instead of a flat fill, so this
// screen doesn't read as a visually separate, less-finished part of the app.
function GradientButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} disabled={disabled}>
      <LinearGradient
        colors={theme.gradient}
        start={theme.gradientAngle.start}
        end={theme.gradientAngle.end}
        style={[S.btnPrimary, disabled && S.btnPrimaryDisabled]}
      >
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

// checked=false means "no manual check has run yet this step" -- shows the
// idle "tap to check" hint instead of implying a hand was searched for and
// not found (biometricPalmGuideNone, which now only applies to an actual
// checked-and-empty result).
function PalmGuide({
  status,
  checked,
  checking,
  onCheck,
  overlayHeight,
}: {
  status: PalmGuideStatus;
  checked: boolean;
  checking: boolean;
  onCheck: () => void;
  overlayHeight: number;
}) {
  const { t } = useLanguage();
  const hint = (() => {
    if (!checked) return t('identity.biometricPalmGuideIdle');
    switch (status) {
      case 'none': return t('identity.biometricPalmGuideNone');
      case 'off_center': return t('identity.biometricPalmGuideOffCenter');
      case 'ok': return t('identity.biometricPalmGuideOk');
    }
  })();
  const ok = status === 'ok';
  return (
    <View style={[S.guideWrap, { bottom: overlayHeight }]} pointerEvents="box-none">
      <View style={S.guideOvalCenterer} pointerEvents="none">
        <PalmSilhouette ok={ok && checked} />
      </View>
      <View style={S.guideBottomGroup} pointerEvents="box-none">
        <Text style={[S.guideHint, ok && checked && S.guideHintOk]} pointerEvents="none">{hint}</Text>
        <TouchableOpacity style={S.retryPill} onPress={onCheck} activeOpacity={0.8} disabled={checking}>
          <Text style={S.retryPillText}>{checking ? t('identity.biometricPalmChecking') : t('identity.biometricPalmCheckBtn')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// Real-device report: the face oval "template" looked too small. Root cause:
// unlike PalmSilhouette (sized relative to window width, see its own
// comment), faceOval was left at its original hardcoded 210x280px -- the
// exact same class of bug the palm silhouette was already fixed for. Sized
// relative to window width the same way, keeping the original 210:280
// aspect ratio and border-radius-vs-height relationship (which is what
// makes it render as an oval, not a circle).
const FACE_OVAL_BASE_WIDTH = 210;
const FACE_OVAL_BASE_HEIGHT = 280;

// Real-device finding, 2026-07-15: the live face-detector stream (running
// concurrently with the video-burst recording) turned out to make this
// device's front camera fall back to CameraX's "StreamSharing" path, which
// itself failed to hand VideoCapture a Surface -- the recording produced a
// 0-byte file (see faceVideoOutput's own comment on the <Camera> below).
// Fixed by never attaching the live analyzer output at all; the guide is now
// checked manually, on demand, the same pattern (and for the same reason --
// avoiding a second concurrent stream) already used for the palm guide
// (see checkPalmPosition's own comment). checked=false shows the idle
// "tap to check" hint instead of implying a face was searched for and not
// found (biometricGuideNone, which now only applies to an actual
// checked-and-empty result).
function FaceGuide({
  status,
  checked,
  checking,
  onCheck,
  overlayHeight,
}: {
  status: FaceGuideStatus;
  checked: boolean;
  checking: boolean;
  onCheck: () => void;
  overlayHeight: number;
}) {
  const { t } = useLanguage();
  const { width: windowWidth } = useWindowDimensions();
  const hint = (() => {
    if (!checked) return t('identity.biometricFaceGuideIdle');
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
  const ovalWidth = Math.min(windowWidth * 0.62, 260);
  const ovalHeight = ovalWidth * (FACE_OVAL_BASE_HEIGHT / FACE_OVAL_BASE_WIDTH);
  return (
    <View style={[S.guideWrap, { bottom: overlayHeight }]} pointerEvents="box-none">
      <View style={S.guideOvalCenterer} pointerEvents="none">
        <View
          style={[
            S.faceOval,
            ok && checked && S.faceOvalOk,
            { width: ovalWidth, height: ovalHeight, borderRadius: ovalHeight / 2 },
          ]}
        />
      </View>
      <View style={S.guideBottomGroup} pointerEvents="box-none">
        <Text style={[S.guideHint, ok && checked && S.guideHintOk]} pointerEvents="none">{hint}</Text>
        <TouchableOpacity style={S.retryPill} onPress={onCheck} activeOpacity={0.8} disabled={checking}>
          <Text style={S.retryPillText}>{checking ? t('identity.biometricPalmChecking') : t('identity.biometricPalmCheckBtn')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// Real-user feedback ("groSSe Anleitungen auf dem Bildschirm, nicht klein
// als Text unten... praktikabel fuer Menschen die es ohne Brille machen"):
// the on-screen instruction that tells someone what to physically do RIGHT
// NOW (blink, look left, hold your fingertip still) used to be the
// SMALLEST text on the whole screen (overlayHintSecondary, 11px) -- exactly
// backwards from how critical it actually is. Fixed in two ways together:
// the instruction text itself is now the single largest, boldest element
// on screen (see S.actionInstruction below), and it's also spoken aloud via
// expo-speech the moment it becomes the active instruction, so someone who
// can't read it clearly at all still knows what to do. Speech language
// follows the app's own selected locale, not the device's OS language --
// same locale useLanguage()'s t() already reads from, so voice and text
// never disagree about which language they're in.
const SPEECH_LOCALE: Record<string, string> = {
  en: 'en-US', de: 'de-DE', es: 'es-ES', fr: 'fr-FR', pt: 'pt-PT', ru: 'ru-RU',
  zh: 'zh-CN', ar: 'ar-SA', hi: 'hi-IN', id: 'id-ID', it: 'it-IT', tr: 'tr-TR',
};

// Active-flash liveness (see flash_liveness.py) -- near-saturated colours,
// not pastel, so the reflected light actually differs enough between slots
// for the server's channel-deviation check to pick up cleanly; 0.7 alpha
// still lets the guide oval/text (rendered on top) read through it.
const FLASH_COLOR_RGBA: Record<FlashColor, string> = {
  red: 'rgba(255,40,40,0.7)',
  green: 'rgba(40,220,90,0.7)',
  blue: 'rgba(50,110,255,0.7)',
};

// Real-device finding (2026-07-18): a generic "does the identifier/name
// contain the word 'female'" heuristic (tried first) never matches on this
// device -- its installed German voices use bare 3-letter codenames
// ("de-de-x-deg-local" etc.) with no gender marker at all, confirmed via a
// live device log. There's no public mapping from these codenames to
// gender, so this was resolved by actually listening: the app spoke
// "Stimme 1..9" through every installed German voice live on-device, and
// the user picked #4. Hardcoded per-language rather than guessed, since
// only German has been confirmed by a real listener so far -- other
// languages fall back to the device's plain default voice (same as before
// this fix) until someone does the same on-device pass for them.
const CONFIRMED_FEMALE_VOICE: Partial<Record<string, string>> = {
  de: 'de-de-x-deg-local',
};

export default function BiometricCapture() {
  const { t, lang } = useLanguage();

  // Real-device report ("die Stimme ist grauenhaft, eine sympathische
  // weibliche Stimme bitte"): an earlier attempt picked a specific
  // installed voice by identifier and went completely silent on real
  // hardware -- a known Android TTS quirk, a `voice` identifier the engine
  // can't cleanly resolve fails SILENTLY (no error callback, no sound)
  // rather than throwing. See CONFIRMED_FEMALE_VOICE's own comment for how
  // the actual identifier below was found (by listening, not guessed).
  // Still verified against THIS device's own getAvailableVoicesAsync()
  // result before use (an OS/TTS update could remove/rename it), and still
  // guarded by an onStart-vs-timeout probe (see speak() below) that
  // detects a silent failure on the first utterance and permanently falls
  // back to plain pitch/rate for the rest of the session -- so even a
  // repeat of the old failure mode costs at most one lost instruction
  // instead of silencing the whole screen.
  const [femaleVoiceId, setFemaleVoiceId] = useState<string | null>(null);
  const voiceStatusRef = useRef<'untested' | 'ok' | 'broken'>('untested');
  const voiceProbeScheduledRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setFemaleVoiceId(null);
    voiceStatusRef.current = 'untested';
    voiceProbeScheduledRef.current = false;
    const confirmed = CONFIRMED_FEMALE_VOICE[lang];
    if (!confirmed) return;
    Speech.getAvailableVoicesAsync()
      .then((voices) => {
        if (!cancelled) setFemaleVoiceId(voices.some((v) => v.identifier === confirmed) ? confirmed : null);
      })
      .catch(() => setFemaleVoiceId(null));
    return () => {
      cancelled = true;
    };
  }, [lang]);

  // Real-device report ("der Text beim Palm Print wird doppelt
  // vorgelesen"): the step-instruction effect below can fire twice for the
  // same step value (React re-render double-invoke) -- without this guard
  // the second call's Speech.stop() cuts the first call's audio a few ms
  // in and restarts it from the top, audible as "read twice"/stuttering,
  // not a real duplicate-instruction bug in the app's own step logic.
  const lastSpokenRef = useRef<{ text: string; at: number }>({ text: '', at: 0 });

  // User feedback ("klingt jetzt gerade so abgehackt, das soll flüssiger
  // sein"): the face_burst sequence (hold -> blink -> direction) used to
  // hard-cut speech at fixed timer boundaries via speak()'s own
  // Speech.stop() -- see the fixed HOLD/BLINK windows this replaced, below.
  // Cutting mid-utterance (or right at its last syllable) between three
  // back-to-back sentences is exactly what reads as choppy. speakRaw is
  // the un-interrupting half: no stop() first, and it reports back via
  // onDone/onStopped so a CALLER can chain the next sentence only once
  // this one has actually finished speaking, instead of on an arbitrary
  // clock. speak() (below) is unchanged in spirit -- still the "cut
  // whatever's playing and say something new right now" entry point used
  // for step-level instructions -- just rebuilt on top of speakRaw so the
  // voice-selection/probe logic lives in one place.
  const speakRaw = useCallback(
    (text: string, onDone?: () => void) => {
      if (!text) {
        onDone?.();
        return;
      }
      const baseOpts = { language: SPEECH_LOCALE[lang] ?? 'en-US', rate: 0.92, pitch: 0.9 };
      const doneOnce = onDone ? { called: false } : null;
      const fireDone = () => {
        if (doneOnce && !doneOnce.called) {
          doneOnce.called = true;
          onDone?.();
        }
      };
      if (femaleVoiceId && voiceStatusRef.current !== 'broken') {
        Speech.speak(text, {
          ...baseOpts,
          voice: femaleVoiceId,
          onStart: () => {
            voiceStatusRef.current = 'ok';
          },
          onDone: fireDone,
          onStopped: fireDone,
        });
        // Only the very first attempt needs to probe -- once any attempt
        // has actually started (or been declared broken), every later
        // speak() call already knows which path to take.
        if (!voiceProbeScheduledRef.current) {
          voiceProbeScheduledRef.current = true;
          setTimeout(() => {
            if (voiceStatusRef.current === 'untested') {
              voiceStatusRef.current = 'broken';
              Speech.stop();
            }
          }, 1200);
        }
      } else {
        Speech.speak(text, { ...baseOpts, onDone: fireDone, onStopped: fireDone });
      }
    },
    [lang, femaleVoiceId]
  );

  const speak = useCallback(
    (text: string) => {
      if (!text) return;
      const now = Date.now();
      if (lastSpokenRef.current.text === text && now - lastSpokenRef.current.at < 800) return;
      lastSpokenRef.current = { text, at: now };

      // interrupt: a new instruction replacing an old one should be heard
      // immediately, not queued behind speech for a step the user already
      // moved past.
      Speech.stop();
      speakRaw(text);
    },
    [speakRaw]
  );

  const { address, signer } = useWallet();
  const [step, setStep] = useState<Step>('consent');
  const [biometricChecked, setBiometricChecked] = useState(false);
  const [bonusChecked, setBonusChecked] = useState(false);
  const [consentError, setConsentError] = useState('');
  const [consent, setConsent] = useState<ConsentDecision | null>(null);
  // Fetched the moment the user commits to a real attempt (confirmConsent
  // below) rather than lazily at submit time -- gives requestChallenge()'s
  // network round-trip the whole palm+face_intro duration to complete in
  // the background, so it's already available by the time face_burst
  // actually starts. null the whole way through just means no challenge
  // was issued (network hiccup, or an older/unreachable coordinator) --
  // see requestChallenge()'s own "informational only, degrade gracefully"
  // comment.
  const [challenge, setChallenge] = useState<IssuedChallenge | null>(null);

  // User feedback ("genaue Angaben beim face proof, gestückelt... nicht
  // alles auf einmal"): the face_burst recording used to show ONE static
  // instruction for the whole ~5.5s (either the generic "capturing" line,
  // or that plus a single coordinator-issued direction) -- too much to act
  // on at once, and too little guidance when no challenge was issued at
  // all (network hiccup, see requestChallenge()'s own "informational only"
  // comment). Broken into a sequence instead: always hold-in-oval then
  // blink first (the two things the server's face-match and pulse checks
  // actually need regardless of any challenge), followed by whatever
  // direction the coordinator specifically asked for -- or, if none was
  // issued, a left-then-right fallback so there's still staged, concrete
  // guidance rather than nothing. challenge_passed is informational-only
  // server-side (see biometricIdentity.ts's RegisterVote comment), so this
  // fallback can't conflict with a real requested direction that was never
  // issued.
  //
  // User feedback ("wie lange muss man schauen? das muss präziser sein"):
  // the direction stage's text states its own exact hold duration instead
  // of leaving "look left" open-ended.
  //
  // User feedback ("klingt jetzt gerade so abgehackt, das soll flüssiger
  // sein"): a first version divided BURST_DURATION_S into fixed
  // (hold=1.5s, blink=1s, direction=rest) windows and hard-cut speech at
  // each boundary via setTimeout -- choppy because a short fixed window
  // often didn't leave enough time for e.g. "Jetzt blinzeln" to finish
  // speaking before being cut off for the next stage. Rebuilt as an
  // onDone-chained sequence instead (see speakRaw above): each stage's
  // speech is allowed to actually finish before the next one starts, so
  // the pacing follows real speech duration, not a guessed budget. Only
  // the FINAL (direction) stage's stated duration still needs to be
  // trustworthy -- computed live from actual elapsed time at the moment it
  // starts (see startFaceCapture), not a fixed constant, so it stays
  // accurate regardless of how long the first two stages actually took to
  // say in whatever language/voice is active. burstChainCancelledRef stops
  // a stage from firing after the user has already left face_burst (e.g.
  // the recording failed) -- onDone/onStopped both resolve the chain, so
  // an interrupting Speech.stop() elsewhere would otherwise still let it
  // continue to the next stage.
  const [burstStageText, setBurstStageText] = useState('');
  const burstChainCancelledRef = useRef(true);
  useEffect(() => () => {
    burstChainCancelledRef.current = true;
  }, []);

  // Active-flash liveness (see matching-service/app/flash_liveness.py) --
  // 2026-07-18 research finding: passive liveness (blink/pulse/parallax,
  // everything else on this screen) is losing the arms race against
  // real-time deepfake injection, which re-renders those in real time. This
  // is the countermeasure -- the screen flashes a server-picked, unknowable-
  // in-advance colour sequence during the recording, and the server checks
  // whether the face's reflected colour actually tracked it. flashColor
  // drives a full-screen tint OVER the camera preview (still under the
  // guide/instruction text, see the face_burst render below) so the light
  // actually reaches the face; null means no tint (outside face_burst, or
  // no sequence was issued -- see requestChallenge()'s own graceful-
  // degrade posture, same here). Timers tracked separately from
  // burstChainCancelledRef's speech chain since this is paced by the
  // RECORDING's own timeline (see startFaceCapture), not by how long
  // speech happens to take.
  const [flashColor, setFlashColor] = useState<FlashColor | null>(null);
  const flashTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const clearFlashTimers = useCallback(() => {
    flashTimersRef.current.forEach(clearTimeout);
    flashTimersRef.current = [];
    setFlashColor(null);
  }, []);
  useEffect(() => clearFlashTimers, [clearFlashTimers]);

  // Speaks the current step's primary instruction once, whenever the step
  // actually changes -- deliberately NOT called inline from JSX, which
  // re-runs on every render and would restart/overlap the same sentence
  // repeatedly.
  //
  // Real-device report ("wenn man den letzten Test überspringt, wird
  // trotzdem weiter vorgelesen"): steps with no instruction of their own
  // (consent/submitting/result) fall through the switch below with no
  // matching case -- previously that meant whatever was already playing
  // (e.g. the long fingertip hint) just kept going uninterrupted, since
  // only speak() itself called Speech.stop(), and speak() was never
  // reached on those steps. The default case below stops it explicitly.
  useEffect(() => {
    switch (step) {
      case 'palm':
        speak(t('identity.biometricPalmHint'));
        break;
      case 'face_intro':
        speak(t('identity.biometricFaceHint'));
        break;
      case 'face_burst':
        // Owned entirely by startFaceCapture()'s own onDone-chained
        // sequence (see burstStageText's own comment) -- calling
        // Speech.stop() here would race with, and could cut off, that
        // chain's own first utterance.
        break;
      case 'fingertip_intro':
        speak(t('identity.biometricFingertipHint'));
        break;
      case 'fingertip_burst':
        speak(t('identity.biometricFingertipCapturing'));
        break;
      case 'ear_intro':
        speak(t('identity.biometricEarHint'));
        break;
      default:
        Speech.stop();
        break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Leaving this screen mid-sentence (back button, app backgrounded)
  // shouldn't leave the voice talking over whatever comes next.
  useEffect(() => {
    return () => {
      Speech.stop();
    };
  }, []);

  const { hasPermission, requestPermission } = useCameraPermission();
  const backDevice = useCameraDevice('back');
  const frontDevice = useCameraDevice('front');

  // Acoustic sonar liveness (see matching-service/app/acoustic_liveness.py)
  // -- 2026-07-18 research finding: a camera-independent liveness channel,
  // immune to video injection by construction (a substituted virtual-camera
  // feed never touches the microphone/speaker path at all). The chirp
  // (assets/audio/liveness_chirp.wav, 15-19kHz sweep -- see that Python
  // module's own frequency-choice comment) plays through the phone's main
  // speaker while the mic records the echo; the server measures how spread
  // the reflection is (a flat surface reflects at one distance, a real 3D
  // face's features at several). Deliberately adapted from the literal
  // EchoFace research setup (phone pressed to the ear like a call) to this
  // screen's existing "hold the phone up in front of your face" posture,
  // matching every other capture step here -- not independently validated
  // that this holding distance/angle works as well as the ear-pressed
  // original, an honest open question same as everything else new this
  // session. useAudioPlayer/useAudioRecorder are hooks (can't be called
  // inside an async function), so -- same pattern as usePhotoOutput/
  // useVideoOutput above -- declared here at the top level and used
  // imperatively inside captureAcoustic() below.
  const chirpPlayer = useAudioPlayer(require('@/assets/audio/liveness_chirp.wav'));
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  // Real-device report: whole app felt sluggish on this screen. Root cause:
  // usePhotoOutput() with no targetResolution defaults to
  // CommonResolutions.UHD_4_3 (3024x4032, ~12MP) -- every single capture
  // used that, including the invisible palm-guide poll firing every 600ms
  // (full JPEG encode + a full decodeFile()+rotate on the JS/native side
  // just to run detection) and all 50 face_burst frames captured over
  // ~5-10s (then all uploaded as multipart form data). FHD_4_3 is still
  // plenty of detail for palm/face matching and MediaPipe's own model
  // input is far smaller than either, but cuts capture/encode/decode/
  // upload cost roughly 4x versus the 12MP default.
  const photoOutput = usePhotoOutput({ targetResolution: CommonResolutions.FHD_4_3 });
  // Real-device report: see BURST_DURATION_S's own comment -- video
  // recording (unlike capturePhotoToFile) is not a "photo capture" event on
  // Android, so it never triggers the forced shutter sound. enableAudio is
  // left at its false default: nothing here needs audio, and requesting it
  // would need a microphone-permission prompt for no reason.
  //
  // Real-device finding (live logcat diagnosis, 2026-07-15): 100% of the 30
  // face_burst thumbnail extractions fail with expo-video-thumbnails'
  // "Could not generate thumbnail" (native E_VIDEO_THUMBNAILS: "Unable to
  // retrieve source file"), for every single frame time including t=0 --
  // while CameraX's own Finalize event reports a clean recording (no error,
  // file fully muxed). Leading theory: useVideoOutput's own doc comment says
  // codec selection with no override picks "the most efficient codec...
  // likely h265", and the same logcat capture showed continuous MediaTek
  // Codec2 encoder warnings ("Failed to open:
  // /vendor/etc/mtk_platform_codecs_whitelist.xml") throughout both
  // recording AND thumbnail extraction -- consistent with HEVC decode being
  // unreliable via MediaMetadataRetriever.getFrameAtTime (what
  // expo-video-thumbnails uses) on this device's vendor image.
  // NOT FIXED HERE: VideoOutputSettings.codec (the only override this
  // library exposes) is iOS-only -- HybridVideoOutput.kt's
  // setOutputSettings() is a documented Android no-op ("CameraX does not
  // support setting custom settings"), so there is no supported way to force
  // h264 from this app on Android. See this file's own follow-up investigation
  // before assuming a fix exists here.
  const faceVideoOutput = useVideoOutput({ targetResolution: CommonResolutions.FHD_4_3 });
  // Separate output on the BACK device (see fingertip_pulse.py) -- reuses
  // the same "record video, extract frames afterward" pattern already
  // proven for face_burst above, rather than a photo-burst loop (which hit
  // the forced-shutter-sound problem palm/face capture both had to work
  // around, see BURST_DURATION_S's own comment).
  const fingertipVideoOutput = useVideoOutput({ targetResolution: CommonResolutions.FHD_4_3 });
  // FIX (2026-07-18): a single overlayHeight shared across palm/face/
  // fingertip meant whichever of the three ever measured tallest (even a
  // totally different step, visited earlier in the same session) became
  // the permanent floor for ALL of them -- "die Schablone ist zu hoch"
  // real-device report, the guide sitting noticeably higher than its own
  // step's panel actually needs. Split per step instead: monotonic-max
  // still holds within face_intro<->face_burst (that's the pairing that
  // actually needs it, see their shared overlayBox's own comment), but
  // palm's guide no longer inherits face's taller panel height or vice
  // versa. Fingertip has no live guide reading a height at all, so it
  // doesn't need a tracked value of its own.
  const [palmOverlayHeight, setPalmOverlayHeight] = useState(200);
  const [faceOverlayHeight, setFaceOverlayHeight] = useState(200);

  const [faceGuideStatus, setFaceGuideStatus] = useState<FaceGuideStatus>('none');
  // Real-device finding, 2026-07-15: this used to be a LIVE
  // useFaceDetectorOutput() attached to the <Camera>'s `outputs` alongside
  // faceVideoOutput -- see faceVideoOutput's own comment on the <Camera>
  // below for why running it concurrently with the video recording broke
  // the recording entirely on this device (CameraX StreamSharing fallback
  // failing to hand VideoCapture a Surface). useImageFaceDetector() instead
  // runs detection on demand against a single still image (a Camera
  // preview snapshot, see checkFacePosition below) -- never attached to the
  // camera session as a stream, so it can't create this contention.
  const imageFaceDetector = useImageFaceDetector({ performanceMode: 'fast' });
  const [faceChecking, setFaceChecking] = useState(false);
  const [faceChecked, setFaceChecked] = useState(false);
  const cameraRef = useRef<CameraRef>(null);

  async function checkFacePosition() {
    if (!(await ensurePermission()) || cameraBusyRef.current || !cameraRef.current) return;
    cameraBusyRef.current = true;
    setFaceChecking(true);
    try {
      // takeSnapshot() reads directly from the already-bound Preview
      // surface -- unlike the palm step's separate photoOutput capture, so
      // its image is in the SAME coordinate space/aspect the user actually
      // sees on screen, and the full too_far/too_close/off_center/angled
      // logic (getFaceGuideStatus) applies correctly, not just presence +
      // rough centering like the palm guide had to fall back to.
      const snapshot = await withTimeout(cameraRef.current.takeSnapshot(), PALM_TIMEOUT_MS, 'timeout');
      const path = await snapshot.saveToTemporaryFileAsync('jpg', 80);
      const faces = imageFaceDetector.detectFaces('file://' + path);
      setFaceGuideStatus(faces.length > 0 ? getFaceGuideStatus(faces[0], snapshot.width, snapshot.height) : 'none');
      setFaceChecked(true);
    } catch (e) {
      console.error('[biometric-capture] face position check failed', e);
      setFaceGuideStatus('none');
      setFaceChecked(true);
    } finally {
      cameraBusyRef.current = false;
      setFaceChecking(false);
    }
  }

  const [palmGuideStatus, setPalmGuideStatus] = useState<PalmGuideStatus>('none');
  // Real-device report: an automatic background poll -- even slowed down
  // and bounded -- still means the camera fires an UNPROMPTED shutter
  // sound every ~900ms with no way to turn it off (see PALM_SILHOUETTE's
  // sibling comment on getPalmGuideStatus: confirmed via vision-camera's
  // own Android source that this device's OS forces the shutter sound
  // regardless of enableShutterSound:false). No amount of interval tuning
  // fixes an unexpected, relentless sound -- so this is no longer
  // automatic. checkPalmPosition() below runs on an explicit button tap
  // instead, exactly like the real capture button already does: a shutter
  // sound the user just caused themselves reads as normal camera feedback,
  // not as the app malfunctioning.
  const [palmChecking, setPalmChecking] = useState(false);
  const [palmChecked, setPalmChecked] = useState(false);
  // Real-device report: the actual palm capture button started failing
  // with "Testaufnahme konnte nicht abgeschlossen werden" every time
  // (capturePalm's withTimeout hitting PALM_TIMEOUT_MS) -- this same lock
  // is shared between checkPalmPosition() and capturePalm() below, since
  // both call photoOutput.capturePhotoToFile on the same output and
  // vision-camera doesn't handle two concurrent capture requests cleanly.
  const cameraBusyRef = useRef(false);

  async function checkPalmPosition() {
    if (!(await ensurePermission()) || cameraBusyRef.current) return;
    cameraBusyRef.current = true;
    setPalmChecking(true);
    try {
      const file = await withTimeout(photoOutput.capturePhotoToFile({}, {}), PALM_TIMEOUT_MS, 'timeout');
      const bounds = await detectHand('file://' + file.filePath);
      setPalmGuideStatus(bounds ? getPalmGuideStatus(bounds) : 'none');
      setPalmChecked(true);
    } catch (e) {
      console.error('[biometric-capture] palm position check failed', e);
      setPalmGuideStatus('none');
      setPalmChecked(true);
    } finally {
      cameraBusyRef.current = false;
      setPalmChecking(false);
    }
  }

  const [palmUri, setPalmUri] = useState<string | null>(null);
  const [faceUri, setFaceUri] = useState<string | null>(null);
  const [burstUris, setBurstUris] = useState<string[]>([]);
  const [imuSamples, setImuSamples] = useState<ImuSample[]>([]);
  const [fingertipUris, setFingertipUris] = useState<string[]>([]);
  const [earUri, setEarUri] = useState<string | null>(null);
  const [acousticUri, setAcousticUri] = useState<string | null>(null);

  const [result, setResult] = useState<BiometricRegisterResult | null>(null);
  const [submitError, setSubmitError] = useState('');

  // Web-of-trust vouching (see aequitas-biometric-beta/matching-service/
  // app/trust.py) -- lets this device's now-enrolled identity vouch for
  // someone else's, by pasting their bio_hash. copiedOwnId is just local
  // button-label feedback ("Copy" -> t('common.copied') briefly), not a
  // real toast component -- consistent with this screen's existing
  // minimal-dependency style.
  const [vouchInput, setVouchInput] = useState('');
  const [vouchResult, setVouchResult] = useState<VouchResult | null>(null);
  const [vouchError, setVouchError] = useState('');
  const [vouching, setVouching] = useState(false);
  const [copiedOwnId, setCopiedOwnId] = useState(false);

  async function handleCopyOwnId() {
    if (!result?.bio_hash) return;
    await Clipboard.setStringAsync(result.bio_hash);
    setCopiedOwnId(true);
    setTimeout(() => setCopiedOwnId(false), 2000);
  }

  async function handleVouch() {
    if (!result?.bio_hash || !vouchInput.trim()) return;
    setVouching(true);
    setVouchError('');
    setVouchResult(null);
    try {
      const res = await voucherFor('test', result.bio_hash, vouchInput.trim());
      setVouchResult(res);
    } catch (e: any) {
      console.error('[biometric-capture] vouch failed', e);
      setVouchError(e?.message ?? t('identity.biometricVouchResultFailed'));
    } finally {
      setVouching(false);
    }
  }

  // See imu_motion.py's own docstring -- optional signal, absent on a
  // device/OS build without a gyroscope. Never throws: a failed/missing
  // sensor just means fewer or zero samples get collected, which
  // imu_motion.py's own "insufficient_imu_samples" already degrades to
  // gracefully rather than a false pass/fail.
  function collectImuSamples(durationMs: number): Promise<ImuSample[]> {
    return new Promise((resolve) => {
      const samples: ImuSample[] = [];
      const startTime = Date.now();
      let subscription: { remove: () => void } | null = null;
      try {
        Gyroscope.setUpdateInterval(GYROSCOPE_INTERVAL_MS);
        subscription = Gyroscope.addListener((data) => {
          samples.push({ t: Date.now() - startTime, rotationRate: { alpha: data.x, beta: data.y, gamma: data.z } });
        });
      } catch (e) {
        console.error('[biometric-capture] gyroscope unavailable', e);
      }
      setTimeout(() => {
        subscription?.remove();
        resolve(samples);
      }, durationMs);
    });
  }

  function confirmConsent() {
    if (!biometricChecked) {
      setConsentError(t('identity.biometricConsentRequired'));
      return;
    }
    setConsent({ biometricConsent: true, bonusConsent: bonusChecked, consentedAt: Date.now() / 1000 });
    setConsentError('');
    setStep('palm');
    // Not awaited -- see the `challenge` state's own comment on why this
    // fires now instead of at submit time. A slow/failed request just
    // means `challenge` stays null and the face_burst step below shows no
    // extra instruction, same as an older client.
    requestChallenge().then(setChallenge);
  }

  // Real-device report: the very first capture/check attempt right after
  // granting camera permission always failed (e.g. "Photo Output is not yet
  // attached to the CameraSession!"), but tapping the same button again
  // immediately afterward always worked. Root cause: `hasPermission` was
  // still `false` at the moment this function's caller started (that's WHY
  // it had to request), and every <Camera> element in this file is only
  // rendered behind a `{hasPermission && device ? <Camera/> : ...}` guard
  // (see the palm/face step JSX below) -- so even though
  // requestPermission() resolves `true` synchronously once the user taps
  // "Allow", the actual <Camera> hasn't mounted yet (that needs a React
  // re-render first), leaving cameraRef/photoOutput/faceVideoOutput
  // unattached to any live session for this same call. Returning `false`
  // here specifically for the fresh-request path (instead of forwarding
  // requestPermission()'s own `true`) makes the caller no-op this one time;
  // by the user's next tap, hasPermission is already true from render
  // start, <Camera> is already mounted, and the real capture succeeds --
  // matching exactly what "going back and trying again" already worked
  // around manually.
  async function ensurePermission(): Promise<boolean> {
    if (hasPermission) return true;
    await requestPermission();
    return false;
  }

  async function capturePalm() {
    if (!(await ensurePermission())) return;
    // Wait out a manual position-check capture if one's in flight (always
    // brief), then hold the same lock so checkPalmPosition() can't collide
    // with this real capture -- see cameraBusyRef's comment.
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

    // See burstStageText's own comment for why this is an onDone-chained
    // sequence rather than fixed setTimeout windows. burstChainCancelledRef
    // is checked before every stage transition so a chain started by an
    // earlier call (or one still catching up after Speech.stop() resolved
    // its onStopped) can't keep talking once the user has left face_burst.
    burstChainCancelledRef.current = false;
    const burstStartedAt = Date.now();
    const withSeconds = (direction: string, ms: number) =>
      `${direction} · ${t('identity.biometricBurstHoldSeconds', { seconds: String(Math.round(ms / 1000)) })}`;
    const sayStage = (text: string, onDone?: () => void) => {
      if (burstChainCancelledRef.current) return;
      setBurstStageText(text);
      speakRaw(text, () => {
        if (!burstChainCancelledRef.current) onDone?.();
      });
    };
    const startDirectionStage = () => {
      // Computed live from actual elapsed time, not a guessed budget --
      // however long hold+blink genuinely took to say in this language/
      // voice, whatever's left of BURST_DURATION_S is what's stated here,
      // so the number is always true. Floored so a slow first two stages
      // still leave a meaningful window to actually perform the direction.
      const remainingMs = Math.max(2000, BURST_DURATION_S * 1000 - (Date.now() - burstStartedAt));
      if (challenge) {
        sayStage(withSeconds(challengeInstruction(challenge.challengeType, t), remainingMs));
      } else {
        const halfMs = remainingMs / 2;
        sayStage(withSeconds(t('identity.biometricChallengeLookLeft'), halfMs), () => {
          sayStage(withSeconds(t('identity.biometricChallengeLookRight'), halfMs));
        });
      }
    };
    // Cuts off face_intro's leftover speech once, right here -- the
    // step-instruction effect deliberately skips Speech.stop() for the
    // 'face_burst' case to avoid racing with this chain's own first
    // utterance (see that effect's own comment).
    Speech.stop();
    sayStage(t('identity.biometricBurstHoldOval'), () => {
      sayStage(t('identity.biometricBurstBlinkNow'), startDirectionStage);
    });

    try {
      // Started alongside the recording, not awaited until after -- see
      // imu_motion.py's own docstring: this needs to cover the SAME window
      // the burst frames come from, not a window measured separately
      // afterward.
      const imuPromise = collectImuSamples(BURST_DURATION_S * 1000);

      // Real-device report: this used to be a loop of 50 individual
      // capturePhotoToFile() calls ("macht ununterbrochen das Kamera
      // Geräusch") -- see BURST_DURATION_S's own comment for why a single
      // video recording replaces that: recording isn't a "photo capture"
      // event, so it doesn't trigger the OS-forced shutter sound at all.
      const recorder = await faceVideoOutput.createRecorder({ maxDuration: BURST_DURATION_S });
      const videoPath = await withTimeout(
        new Promise<string>((resolve, reject) => {
          recorder.startRecording(
            (filePath) => resolve(filePath),
            (error) => reject(error)
          );
          // Started the instant recording actually begins, not alongside
          // the speech chain above (which paces separately and can finish
          // its "hold/blink" stages faster or slower depending on
          // language/voice) -- flash_liveness.py's server-side check
          // assumes equal-length contiguous slots across the WHOLE
          // recording, so this has to be synced to the recording's own
          // clock, not the guidance text's.
          const sequence = challenge?.flashSequence ?? [];
          if (sequence.length > 0) {
            clearFlashTimers();
            const slotMs = (BURST_DURATION_S * 1000) / sequence.length;
            setFlashColor(sequence[0]);
            flashTimersRef.current = sequence.slice(1).map((color, i) =>
              setTimeout(() => setFlashColor(color), Math.round(slotMs * (i + 1)))
            );
            flashTimersRef.current.push(
              setTimeout(() => setFlashColor(null), Math.round(BURST_DURATION_S * 1000))
            );
          }
        }),
        VIDEO_RECORDING_TIMEOUT_MS,
        'timeout'
      );
      const videoUri = 'file://' + videoPath;

      const frames: string[] = [];
      for (let i = 0; i < BURST_EXTRACT_COUNT; i++) {
        try {
          const thumb = await withTimeout(
            VideoThumbnails.getThumbnailAsync(videoUri, { time: i * BURST_INTERVAL_MS, quality: 0.8 }),
            FRAME_EXTRACT_TIMEOUT_MS,
            'timeout'
          );
          frames.push(thumb.uri);
        } catch (e) {
          // A single stuck/failed frame shouldn't cost the whole burst --
          // skip it and keep going, same "degrade instead of hang" idea
          // used throughout this screen (see capturePalm's withTimeout).
          console.error('[biometric-capture] face frame extraction failed', e);
        }
      }
      setImuSamples(await imuPromise);
      if (frames.length === 0) {
        burstChainCancelledRef.current = true;
        clearFlashTimers();
        setSubmitError(t('identity.biometricResultFailed'));
        setStep('result');
        return;
      }
      setBurstUris(frames);
      setFaceUri(frames[0]);
      // Fingertip pulse is a genuinely separate, optional capture step (see
      // fingertip_pulse.py) -- not submitted automatically here, the user
      // can also skip it (see skipFingertip below).
      // Stop the burst chain before leaving -- otherwise a still-pending
      // stage (its onDone hasn't fired yet) would speak over whatever
      // fingertip_intro/burst says next (see burstChainCancelledRef's own
      // comment). Flash timers stopped the same way -- the recording has
      // finished by now regardless, but a late setFlashColor would still
      // needlessly tint the next step's screen for a moment.
      burstChainCancelledRef.current = true;
      clearFlashTimers();
      setStep('fingertip_intro');
    } catch (e) {
      console.error('[biometric-capture] face video capture failed', e);
      burstChainCancelledRef.current = true;
      clearFlashTimers();
      setSubmitError(t('identity.biometricResultFailed'));
      setStep('result');
    }
  }

  async function startFingertipCapture() {
    if (!(await ensurePermission())) return;
    setStep('fingertip_burst');
    try {
      const recorder = await fingertipVideoOutput.createRecorder({ maxDuration: FINGERTIP_DURATION_S });
      const videoPath = await withTimeout(
        new Promise<string>((resolve, reject) => {
          recorder.startRecording(
            (filePath) => resolve(filePath),
            (error) => reject(error)
          );
        }),
        FINGERTIP_RECORDING_TIMEOUT_MS,
        'timeout'
      );
      const videoUri = 'file://' + videoPath;

      const frames: string[] = [];
      for (let i = 0; i < FINGERTIP_EXTRACT_COUNT; i++) {
        try {
          const thumb = await withTimeout(
            VideoThumbnails.getThumbnailAsync(videoUri, { time: i * BURST_INTERVAL_MS, quality: 0.8 }),
            FRAME_EXTRACT_TIMEOUT_MS,
            'timeout'
          );
          frames.push(thumb.uri);
        } catch (e) {
          console.error('[biometric-capture] fingertip frame extraction failed', e);
        }
      }
      // Unlike the face burst, an empty/failed fingertip capture is NOT a
      // reason to fail the whole registration -- this channel is entirely
      // optional (see fingertip_pulse.py's own "informational only"
      // reasoning). Move on to the (also optional) ear step with whatever
      // was captured, even nothing.
      setFingertipUris(frames);
      setStep('ear_intro');
    } catch (e) {
      console.error('[biometric-capture] fingertip video capture failed', e);
      setFingertipUris([]);
      setStep('ear_intro');
    }
  }

  async function skipFingertip() {
    // Cut immediately on tap rather than waiting for the step-change
    // effect's own Speech.stop() to run on the next render -- see that
    // effect's own comment on the "still reads after skipping" report.
    Speech.stop();
    setFingertipUris([]);
    setStep('ear_intro');
  }

  // Ear shape (see ear.py) is a single still photo, not a burst -- no
  // liveness/pulse signal to extract, just static geometry, same capture
  // shape as the palm step. Uses the BACK device + the same photoOutput
  // the palm step already has (no reason for a second still-photo output).
  // Genuinely awkward to self-capture (you can't easily see your own ear
  // without a mirror or help) -- see this screen's biometricEarHint copy --
  // so, like fingertip, it's optional and skippable, never blocking
  // registration.
  async function captureEar() {
    if (!(await ensurePermission())) return;
    const waitDeadline = Date.now() + 2_000;
    while (cameraBusyRef.current && Date.now() < waitDeadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    cameraBusyRef.current = true;
    try {
      const file = await withTimeout(photoOutput.capturePhotoToFile({}, {}), PALM_TIMEOUT_MS, 'timeout');
      const uri = 'file://' + file.filePath;
      setEarUri(uri);
      setStep('acoustic_intro');
    } catch (e) {
      console.error('[biometric-capture] ear capture failed', e);
      setEarUri(null);
      setStep('acoustic_intro');
    } finally {
      cameraBusyRef.current = false;
    }
  }

  async function skipEar() {
    Speech.stop();
    setStep('acoustic_intro');
  }

  // Acoustic sonar liveness (see chirpPlayer/audioRecorder's own comment
  // above, and matching-service/app/acoustic_liveness.py) -- the last
  // optional step before submit. setAudioModeAsync's allowsRecording is
  // what actually lets playback and recording run at once on this device;
  // without it the recorder and player would fight over the audio session
  // (see expo-audio's own docs on this).
  async function captureAcoustic() {
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        await submit(undefined, undefined, undefined, undefined, null);
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
      chirpPlayer.seekTo(0);
      chirpPlayer.play();
      // Recording window generously covers the ~400ms chirp plus room for
      // the echo's own travel time and playback-start latency -- not tied
      // to the chirp's exact duration since a bit of extra silence on
      // either side doesn't hurt the server's own correlation search
      // (see acoustic_liveness.py's own MAX_LAG_MS -- it searches for the
      // chirp within the recording, not assumes it starts at sample 0).
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await audioRecorder.stop();
      const uri = audioRecorder.uri;
      setAcousticUri(uri ?? null);
      await submit(undefined, undefined, undefined, undefined, uri ?? null);
    } catch (e) {
      console.error('[biometric-capture] acoustic capture failed', e);
      setAcousticUri(null);
      await submit(undefined, undefined, undefined, undefined, null);
    }
  }

  async function skipAcoustic() {
    Speech.stop();
    await submit(undefined, undefined, undefined, undefined, null);
  }

  async function submit(
    firstFrame?: string,
    frames?: string[],
    fingertipFrames?: string[],
    earUriParam?: string | null,
    acousticUriParam?: string | null
  ) {
    const finalFaceUri = firstFrame ?? faceUri;
    const finalBurst = frames ?? burstUris;
    const finalFingertip = fingertipFrames ?? fingertipUris;
    // undefined means "not passed, read state" (mirrors firstFrame/frames/
    // fingertipFrames above); null/a string is treated as authoritative --
    // relying on the earUri state alone here would race the setEarUri()
    // call in captureEar() (same stale-closure risk as the other capture
    // fields, see submit()'s existing params for the established pattern).
    const finalEarUri = earUriParam === undefined ? earUri : earUriParam;
    const finalAcousticUri = acousticUriParam === undefined ? acousticUri : acousticUriParam;
    if (!palmUri || !finalFaceUri || !consent || !address || !signer) return;
    setFingertipUris(finalFingertip);
    setStep('submitting');
    setSubmitError('');
    try {
      const deviceId = await getOrCreateDeviceId();
      const res = await registerBiometric(
        {
          palmUri,
          faceUri: finalFaceUri,
          faceBurstUris: finalBurst,
          burstIntervalMs: BURST_INTERVAL_MS,
          imuSamples,
          fingertipBurstUris: finalFingertip,
          challengeNonce: challenge?.nonce,
          earUri: finalEarUri ?? undefined,
          acousticRecordingUri: finalAcousticUri ?? undefined,
        },
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
        // The coordinator signed `domain|bio_hash|wallet|issued_at`. What
        // reaches /prove as `bio` is identityFromBioHash's output, which is
        // byte-identical to res.bio_hash only because new_scalar() already
        // returns a canonical decimal below FIELD_SIZE, so the reduction is a
        // no-op. lib/__tests__/attestation.test.ts pins that -- if the
        // coordinator ever emits hex or a padded value instead, every
        // signature stops verifying, and the symptom would look like a
        // crypto bug rather than a formatting change.
        const proveResult = await proveAndRegister(signer, identity, t('trade.signTimeout'), {
          signature: res.bio_attestation ?? null,
          issuedAt: res.bio_attestation_issued_at ?? null,
        });
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
              <PalmGuide
                status={palmGuideStatus}
                checked={palmChecked}
                checking={palmChecking}
                onCheck={checkPalmPosition}
                overlayHeight={palmOverlayHeight}
              />
            </>
          ) : (
            <View style={S.content}>
              <Text style={S.body}>{t('identity.biometricCameraPermissionDenied')}</Text>
            </View>
          )}
          <View
            style={S.overlayBox}
            onLayout={(e) => {
              // Read the plain number out synchronously here rather than
              // inside the functional updater below -- see faceOverlayHeight
              // site's own comment on why (React's synthetic-event pooling).
              const height = e.nativeEvent.layout.height;
              setPalmOverlayHeight((prev) => Math.max(prev, height));
            }}
          >
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
              <Camera
                ref={cameraRef}
                style={S.camera}
                device={frontDevice}
                isActive
                // Real-device finding, confirmed via CameraX's own debug log
                // (live logcat diagnosis, 2026-07-15) -- NOT a React/JS-side
                // bug, several were ruled out first (outputs-array identity,
                // faceDetectorOutput memoization, even a system Face Unlock
                // conflict): this device's front camera cannot natively
                // sustain Preview + ImageAnalysis (a live face detector) +
                // VideoCapture as 3 concurrent streams. CameraX's own log
                // shows it falling back to "StreamSharing" (a virtual/GPU
                // stream-splitting path) to try anyway, and that fallback
                // itself fails: "SurfaceProcessorNode: Downstream
                // VideoCapture failed to provide Surface" -- the video
                // encoder never gets a real Surface, so the recording
                // produces a 0-byte file and CameraX reports
                // ERROR_SOURCE_INACTIVE about a second later. Never
                // attaching a live ImageAnalysis output at all (not even
                // conditionally -- a previous attempt dropped it only
                // during face_burst, which still requested all 3 streams
                // at some point in this screen's session and didn't help)
                // means only 2 streams (Preview + VideoCapture) are ever
                // requested, so CameraX never needs StreamSharing here.
                // The face-position guide is checked on demand instead via
                // checkFacePosition() (useImageFaceDetector against a
                // Camera.takeSnapshot(), not a camera-session output) --
                // same reasoning as the palm guide's own manual check.
                outputs={[faceVideoOutput]}
              />
              {/* Active-flash liveness (see flash_liveness.py / flashColor's
                  own comment) -- a colour tint over the whole preview so the
                  screen's light actually reaches the face, sitting BELOW the
                  guide oval/instruction text (rendered after this) so those
                  stay legible through it. pointerEvents="none" so it never
                  blocks the position-check button underneath. */}
              {flashColor && (
                <View style={[S.flashOverlay, { backgroundColor: FLASH_COLOR_RGBA[flashColor] }]} pointerEvents="none" />
              )}
              <FaceGuide
                status={faceGuideStatus}
                checked={faceChecked}
                checking={faceChecking}
                onCheck={checkFacePosition}
                overlayHeight={faceOverlayHeight}
              />
            </>
          ) : (
            <View style={S.content}>
              <Text style={S.body}>{t('identity.biometricCameraPermissionDenied')}</Text>
            </View>
          )}
          <View
            style={S.overlayBox}
            // Real-user report: the face oval visibly jumped down the
            // instant recording started. Root cause: this panel's content
            // is shorter during face_burst (spinner+hint) than face_intro
            // (title+hint+glasses reminder+button), so onLayout re-fires
            // with a smaller height on that exact transition, and the
            // guide above it (positioned at `bottom: faceOverlayHeight`,
            // see guideWrap) follows the panel down to match -- right as
            // the user's face was already correctly framed. Math.max makes
            // this monotonic: once face_intro's taller content has been
            // measured, face_burst's shorter content can't shrink the
            // reserved space back down, so the guide holds still across
            // that specific transition. Scoped to face's own state only
            // (not shared with palm/fingertip, see its declaration) so it
            // can't inherit a taller floor from an unrelated step.
            onLayout={(e) => {
              // FIX (2026-07-18): reading e.nativeEvent inside the
              // setFaceOverlayHeight functional-updater callback (rather
              // than synchronously here) trips React's synthetic-event
              // pooling warning -- the event object can already be
              // released/nulled out by the time that updater actually
              // runs, since it's not guaranteed to execute synchronously
              // within this handler. Read the plain number out NOW, while
              // the event is still valid, and only close over that -- not
              // the event itself.
              const height = e.nativeEvent.layout.height;
              setFaceOverlayHeight((prev) => Math.max(prev, height));
            }}
          >
            <StepDots current={2} />
            {step === 'face_intro' ? (
              <>
                <Text style={S.overlayTitle}>{t('identity.biometricFaceTitle')}</Text>
                <Text style={S.overlayHint}>{t('identity.biometricFaceHint')}</Text>
                <Text style={S.overlayHintSecondary}>👓 {t('identity.biometricFaceGlassesHint')}</Text>
                <GradientButton label={t('identity.biometricCaptureBtn')} onPress={startFaceCapture} />
              </>
            ) : (
              <>
                <ActivityIndicator color={theme.purple} size="large" style={S.spinnerGap} />
                <Text style={S.overlayHint}>{t('identity.biometricLivenessCapturing')}</Text>
                {/* Staged sequence (hold oval -> blink -> direction), one
                    instruction at a time, advancing as each one finishes
                    speaking -- see burstStageText's own comment. */}
                <Text style={S.actionInstruction}>🎯 {burstStageText}</Text>
              </>
            )}
          </View>
        </View>
      )}

      {(step === 'fingertip_intro' || step === 'fingertip_burst') && (
        // Optional step, deliberately not part of StepDots' numbered 1-2
        // sequence above -- see fingertip_pulse.py's own "informational
        // only" reasoning and skipFingertip() below. Uses the BACK device
        // (same one palm's step already used) with torchMode, rather than
        // any web-style getCapabilities()/applyConstraints() dance --
        // react-native-vision-camera exposes torch as a plain declarative
        // prop.
        <View style={S.cameraWrap}>
          {hasPermission && backDevice ? (
            <Camera
              style={S.camera}
              device={backDevice}
              isActive
              torchMode={step === 'fingertip_burst' ? 'on' : 'off'}
              outputs={[fingertipVideoOutput]}
            />
          ) : (
            <View style={S.content}>
              <Text style={S.body}>{t('identity.biometricCameraPermissionDenied')}</Text>
            </View>
          )}
          <View style={S.overlayBox}>
            {step === 'fingertip_intro' ? (
              <>
                <Text style={S.overlayTitle}>{t('identity.biometricFingertipTitle')}</Text>
                <Text style={S.overlayHint}>{t('identity.biometricFingertipHint')}</Text>
                <GradientButton label={t('identity.biometricFingertipStartBtn')} onPress={startFingertipCapture} />
                <TouchableOpacity style={S.btnGhost} onPress={skipFingertip} activeOpacity={0.8}>
                  <Text style={S.btnGhostText}>{t('identity.biometricFingertipSkipBtn')}</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <ActivityIndicator color={theme.purple} size="large" style={S.spinnerGap} />
                <Text style={S.overlayHint}>{t('identity.biometricFingertipCapturing')}</Text>
              </>
            )}
          </View>
        </View>
      )}

      {step === 'ear_intro' && (
        // Optional step, deliberately not part of StepDots' numbered
        // sequence -- same "informational only, never blocks" posture as
        // the fingertip step above. A single still photo (see ear.py),
        // reusing the palm step's own BACK-camera photoOutput rather than
        // standing up a second still-photo output -- no burst, no live
        // guide (no ear landmark model exists to drive one, see ear.py's
        // own docstring), just a plain framing hint and a capture button.
        <View style={S.cameraWrap}>
          {hasPermission && backDevice ? (
            <Camera style={S.camera} device={backDevice} isActive outputs={[photoOutput]} />
          ) : (
            <View style={S.content}>
              <Text style={S.body}>{t('identity.biometricCameraPermissionDenied')}</Text>
            </View>
          )}
          <View style={S.overlayBox}>
            <Text style={S.overlayTitle}>{t('identity.biometricEarTitle')}</Text>
            <Text style={S.overlayHint}>{t('identity.biometricEarHint')}</Text>
            <GradientButton label={t('identity.biometricCaptureBtn')} onPress={captureEar} />
            <TouchableOpacity style={S.btnGhost} onPress={skipEar} activeOpacity={0.8}>
              <Text style={S.btnGhostText}>{t('identity.biometricEarSkipBtn')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {step === 'acoustic_intro' && (
        // Optional, last step before submit -- same "informational only,
        // never blocks" posture as fingertip/ear above. No camera needed
        // (audio-only, see captureAcoustic's own comment), so this is a
        // plain card like the consent step rather than a camera view.
        <View style={S.content}>
          <View style={S.card}>
            <Text style={S.title}>{t('identity.biometricAcousticTitle')}</Text>
            <Text style={S.body}>{t('identity.biometricAcousticHint')}</Text>
            <GradientButton label={t('identity.biometricAcousticStartBtn')} onPress={captureAcoustic} />
            <TouchableOpacity style={S.btnGhost} onPress={skipAcoustic} activeOpacity={0.8}>
              <Text style={S.btnGhostText}>{t('identity.biometricAcousticSkipBtn')}</Text>
            </TouchableOpacity>
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
              <>
                <Text style={S.body}>
                  {(() => {
                    switch (result?.decision) {
                      case 'duplicate_detected': return t('identity.biometricResultDuplicate');
                      case 'new_enrollment': return t('identity.biometricResultNew');
                      // Real-device report: EVERY non-success decision used to
                      // collapse into one generic "Testaufnahme konnte nicht
                      // abgeschlossen werden" message -- capture_failed (e.g.
                      // the palm ORB matcher's own documented
                      // insufficient_features failure mode, see
                      // aequitas-biometric-beta/README.md's "what's real vs
                      // stubbed" table), liveness_failed, and quorum_failed
                      // are three completely different problems needing
                      // different user actions, but were indistinguishable on
                      // screen. Now shown separately; invalid_mode/
                      // missing_consent (internal-config errors, not user-
                      // fixable by retrying differently) still fall back to
                      // the generic message.
                      case 'capture_failed': return t('identity.biometricResultCaptureFailed');
                      case 'liveness_failed': return t('identity.biometricResultLivenessFailed');
                      case 'quorum_failed': return t('identity.biometricResultQuorumFailed');
                      default: return t('identity.biometricResultFailed');
                    }
                  })()}
                </Text>
                {/* Phase 0 test-harness diagnostic: the first validator's own
                    reported error (e.g. "insufficient_features"), if any --
                    not translated, this is a raw debugging detail for a
                    screen that's unreachable outside BIOMETRIC_ENABLED test
                    builds, not user-facing copy. */}
                {result?.votes?.[0]?.error ? (
                  <Text style={S.resultDebugText}>{result.votes[0].error}</Text>
                ) : null}
                {/* User question ("funktioniert das mit dem nach rechts
                    gucken auch richtig?"): challenge_passed/measured_delta
                    are real, server-computed values (see challenge.py's
                    actual MediaPipe yaw/pitch check) but the app never
                    surfaced them anywhere -- there was no way to confirm a
                    given attempt's direction was actually detected without
                    reading validator logs directly. Same raw-debug posture
                    as the error line above: not translated, Phase 0 only. */}
                {result?.votes?.[0]?.challenge_checked ? (
                  <Text style={S.resultDebugText}>
                    challenge={result.votes[0].challenge_type} passed={String(result.votes[0].challenge_passed)}
                    {' '}delta={result.votes[0].challenge_measured_delta?.toFixed(1)}°
                  </Text>
                ) : null}
              </>
            )}
            <GradientButton label={t('identity.biometricBackBtn')} onPress={close} />
          </View>

          {/* Only reachable once this device has a bio_hash to vouch
              with -- absent on capture_failed/liveness_failed/etc, same
              gating as the rest of this result screen. */}
          {result?.bio_hash ? (
            <View style={[S.card, S.vouchCard]}>
              <Text style={S.title}>{t('identity.biometricVouchTitle')}</Text>

              <Text style={S.vouchLabel}>{t('identity.biometricYourIdLabel')}</Text>
              <View style={S.vouchIdRow}>
                <Text style={S.vouchIdText} numberOfLines={1} ellipsizeMode="middle">
                  {result.bio_hash}
                </Text>
                <TouchableOpacity style={S.copyBtn} onPress={handleCopyOwnId}>
                  <Text style={S.copyBtnText}>
                    {copiedOwnId ? t('common.copied') : t('identity.biometricCopyIdBtn')}
                  </Text>
                </TouchableOpacity>
              </View>

              <TextInput
                style={S.vouchInput}
                value={vouchInput}
                onChangeText={setVouchInput}
                placeholder={t('identity.biometricVouchInputPlaceholder')}
                placeholderTextColor={theme.muted}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <GradientButton
                label={t('identity.biometricVouchBtn')}
                onPress={handleVouch}
                disabled={vouching || !vouchInput.trim()}
              />
              {vouching ? <ActivityIndicator style={S.spinnerGap} color={theme.purple} /> : null}
              {vouchResult ? (
                <>
                  <Text style={S.body}>
                    {(() => {
                      switch (vouchResult.status) {
                        case 'recorded': return t('identity.biometricVouchResultRecorded');
                        case 'unknown_vouchee':
                        case 'unknown_voucher': return t('identity.biometricVouchResultUnknown');
                        case 'invalid_self_vouch': return t('identity.biometricVouchResultSelf');
                        default: return t('identity.biometricVouchResultFailed');
                      }
                    })()}
                  </Text>
                  {/* Raw diagnostic detail, same "not translated, Phase 0
                      test-harness debugging" posture as result.votes[0].error
                      above -- trust.py's own reasons strings are plain
                      English explanations of a heuristic, not user copy. */}
                  {vouchResult.status === 'recorded' ? (
                    <Text style={S.resultDebugText}>
                      trust_score={vouchResult.trust_score.toFixed(2)}
                      {vouchResult.trust_reasons.length ? ` | ${vouchResult.trust_reasons.join('; ')}` : ''}
                    </Text>
                  ) : null}
                </>
              ) : null}
              {vouchError ? <Text style={S.errorText}>{vouchError}</Text> : null}
            </View>
          ) : null}
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
  resultDebugText: {
    color: '#ffcc00', fontSize: 10, fontFamily: 'monospace', textAlign: 'center',
    marginTop: -8, marginBottom: 12,
  },

  vouchCard: { marginTop: 16 },
  vouchLabel: { fontSize: 11, color: theme.muted, marginBottom: 6 },
  vouchIdRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  vouchIdText: {
    flex: 1, fontFamily: theme.fontMono, fontSize: 11, color: theme.text,
    backgroundColor: theme.bg, borderRadius: 8, borderWidth: 1, borderColor: theme.border,
    paddingHorizontal: 10, paddingVertical: 8,
  },
  copyBtn: {
    borderRadius: 8, borderWidth: 1, borderColor: theme.borderStrong,
    paddingHorizontal: 12, paddingVertical: 9,
  },
  copyBtnText: { color: theme.text, fontSize: 11, fontWeight: '700' },
  vouchInput: {
    fontFamily: theme.fontMono, fontSize: 12, color: theme.text,
    backgroundColor: theme.bg, borderRadius: 8, borderWidth: 1, borderColor: theme.border,
    paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12,
  },
  btnPrimaryDisabled: { opacity: 0.45 },

  btnPrimary: { borderRadius: theme.radiusSm, padding: 16, alignItems: 'center', marginTop: 12 },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 13, letterSpacing: 1 },
  btnGhost: { padding: 12, alignItems: 'center', marginTop: 8 },
  btnGhostText: { color: theme.muted, fontSize: 12 },

  cameraWrap: { flex: 1 },
  camera: { flex: 1 },
  flashOverlay: { ...StyleSheet.absoluteFillObject },
  overlayBox: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(12,14,22,0.92)', padding: 16, alignItems: 'center',
  },
  // Real-user feedback round 1 ("groSSe Anleitungen, nicht klein als Text
  // unten"): the instruction telling someone what to do right now used to
  // be the smallest text on screen. Round 2 ("der Text ist jetzt so groSS
  // dass man Position pruefen nicht mehr sehen kann"): the fix overshot --
  // overlayHint/overlayHintSecondary at 24-26px, STACKED with the title and
  // (on face_intro) the glasses reminder AND the challenge line, made this
  // panel tall enough to push PalmGuide/FaceGuide's own position-check
  // button (positioned in the remaining space above this panel, see
  // guideWrap's `bottom: overlayHeight`) off the visible screen. Fixed by
  // splitting one broad "big text" style into two purposeful ones instead
  // of shrinking blindly: overlayHintSecondary goes back to being a modest
  // secondary reminder (the glasses hint), while the one piece of text that
  // actually needed to be huge -- the challenge direction someone must
  // follow in the next second -- gets its own dedicated actionInstruction
  // style below, sized to stay legible without becoming the whole screen.
  overlayTitle: { color: theme.text, fontSize: 18, fontWeight: '800', marginBottom: 6, textAlign: 'center' },
  overlayHint: { color: theme.text, fontSize: 18, fontWeight: '700', textAlign: 'center', lineHeight: 23 },
  overlayHintSecondary: { color: theme.muted, fontSize: 12, textAlign: 'center', lineHeight: 16, marginTop: 6, opacity: 0.85 },
  actionInstruction: {
    color: theme.neon, fontSize: 21, fontWeight: '800', textAlign: 'center', lineHeight: 26,
    marginTop: 8,
  },

  // `bottom` is set per-instance (dynamic, measured overlay panel height --
  // see overlayHeight/onLayout above) instead of baked in here, so the
  // guide centers itself in the actually-visible area above the bottom
  // instruction panel rather than the full (partly-occluded) camera view.
  guideWrap: { position: 'absolute', top: 0, left: 0, right: 0 },
  // Real-device report ("die Schablone ist zu weit oben"): guideWrap used
  // to center the oval AND the hint text AND the retry button together as
  // one flex column -- the hint+button's own height below the oval pulled
  // that group's midpoint (and so the oval itself) well above the true
  // center of the available space, confirmed via a live screenshot (the
  // oval's top edge nearly touched the status bar while empty space sat
  // below the chin). Split instead: guideOvalCenterer fills the WHOLE
  // available region and centers only the oval/silhouette within it, so
  // its center matches the region's actual center; guideBottomGroup
  // anchors the hint+button near the region's bottom edge independently,
  // same visual spot they already occupied, just no longer coupled to the
  // oval's own centering math.
  guideOvalCenterer: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  guideBottomGroup: { position: 'absolute', left: 0, right: 0, bottom: 20, alignItems: 'center' },
  // width/height/borderRadius are computed per-instance in FaceGuide (see
  // its own comment) so the oval scales with screen width instead of this
  // fixed base size.
  faceOval: { borderWidth: 3, borderStyle: 'dashed', borderColor: theme.borderStrong },
  faceOvalOk: { borderColor: theme.neon, borderStyle: 'solid' },
  guideHint: {
    color: theme.text, fontSize: 15, fontWeight: '800', letterSpacing: 0.3,
    backgroundColor: 'rgba(12,14,22,0.75)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: theme.radiusSm,
    maxWidth: '90%', textAlign: 'center', lineHeight: 19,
  },
  guideHintOk: { color: theme.neon },
  retryPill: {
    marginTop: 12, backgroundColor: theme.purple, paddingHorizontal: 20, paddingVertical: 10, borderRadius: theme.radiusSm,
  },
  retryPillText: { color: '#fff', fontWeight: '700', fontSize: 12.5, letterSpacing: 0.5 },

  stepDots: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  stepDot: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  stepDotActive: { backgroundColor: theme.card2, borderWidth: 1.5, borderColor: theme.purple },
  stepDotPending: { backgroundColor: theme.card2, borderWidth: 1, borderColor: theme.borderStrong },
  stepDotNum: { color: theme.muted, fontSize: 12, fontWeight: '700' },
  stepDotCheck: { color: '#fff', fontSize: 12, fontWeight: '700' },
  stepLine: { width: 28, height: 2, backgroundColor: theme.borderStrong, marginHorizontal: 4 },
});
