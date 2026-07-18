// Phase 0 biometric proof-of-personhood capture screen (palm+face+consent,
// see aequitas-biometric-beta). Pushed from the Identity tab ONLY when
// BIOMETRIC_ENABLED is set (see lib/config.ts) -- unreachable otherwise.
import React, { useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Camera, CommonResolutions, useCameraDevice, useCameraPermission, usePhotoOutput, useVideoOutput, type CameraRef } from 'react-native-vision-camera';
import { useImageFaceDetector, type Face } from 'react-native-vision-camera-face-detector';
import { detectHand, type HandBounds } from 'mediapipe-hand-detector';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { Gyroscope } from 'expo-sensors';
import Svg, { Path } from 'react-native-svg';
import { useLanguage } from '@/contexts/LanguageContext';
import { useWallet } from '@/contexts/WalletContext';
import { theme } from '@/constants/aequitas-theme';
import {
  registerBiometric,
  requestChallenge,
  getOrCreateDeviceId,
  type BiometricRegisterResult,
  type ChallengeType,
  type ConsentDecision,
  type ImuSample,
  type IssuedChallenge,
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
      <View pointerEvents="none">
        <PalmSilhouette ok={ok && checked} />
      </View>
      <Text style={[S.guideHint, ok && checked && S.guideHintOk]} pointerEvents="none">{hint}</Text>
      <TouchableOpacity style={S.retryPill} onPress={onCheck} activeOpacity={0.8} disabled={checking}>
        <Text style={S.retryPillText}>{checking ? t('identity.biometricPalmChecking') : t('identity.biometricPalmCheckBtn')}</Text>
      </TouchableOpacity>
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
      <View
        style={[
          S.faceOval,
          ok && checked && S.faceOvalOk,
          { width: ovalWidth, height: ovalHeight, borderRadius: ovalHeight / 2 },
        ]}
        pointerEvents="none"
      />
      <Text style={[S.guideHint, ok && checked && S.guideHintOk]} pointerEvents="none">{hint}</Text>
      <TouchableOpacity style={S.retryPill} onPress={onCheck} activeOpacity={0.8} disabled={checking}>
        <Text style={S.retryPillText}>{checking ? t('identity.biometricPalmChecking') : t('identity.biometricPalmCheckBtn')}</Text>
      </TouchableOpacity>
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
  // Fetched the moment the user commits to a real attempt (confirmConsent
  // below) rather than lazily at submit time -- gives requestChallenge()'s
  // network round-trip the whole palm+face_intro duration to complete in
  // the background, so it's already available by the time face_burst
  // actually starts. null the whole way through just means no challenge
  // was issued (network hiccup, or an older/unreachable coordinator) --
  // see requestChallenge()'s own "informational only, degrade gracefully"
  // comment.
  const [challenge, setChallenge] = useState<IssuedChallenge | null>(null);

  const { hasPermission, requestPermission } = useCameraPermission();
  const backDevice = useCameraDevice('back');
  const frontDevice = useCameraDevice('front');
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
  const [overlayHeight, setOverlayHeight] = useState(200);

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

  const [result, setResult] = useState<BiometricRegisterResult | null>(null);
  const [submitError, setSubmitError] = useState('');

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
        setSubmitError(t('identity.biometricResultFailed'));
        setStep('result');
        return;
      }
      setBurstUris(frames);
      setFaceUri(frames[0]);
      // Fingertip pulse is a genuinely separate, optional capture step (see
      // fingertip_pulse.py) -- not submitted automatically here, the user
      // can also skip it (see skipFingertip below).
      setStep('fingertip_intro');
    } catch (e) {
      console.error('[biometric-capture] face video capture failed', e);
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
      // reasoning). Submit with whatever was captured, even nothing.
      await submit(undefined, undefined, frames);
    } catch (e) {
      console.error('[biometric-capture] fingertip video capture failed', e);
      await submit(undefined, undefined, []);
    }
  }

  async function skipFingertip() {
    await submit(undefined, undefined, []);
  }

  async function submit(firstFrame?: string, frames?: string[], fingertipFrames?: string[]) {
    const finalFaceUri = firstFrame ?? faceUri;
    const finalBurst = frames ?? burstUris;
    const finalFingertip = fingertipFrames ?? fingertipUris;
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
              <PalmGuide
                status={palmGuideStatus}
                checked={palmChecked}
                checking={palmChecking}
                onCheck={checkPalmPosition}
                overlayHeight={overlayHeight}
              />
            </>
          ) : (
            <View style={S.content}>
              <Text style={S.body}>{t('identity.biometricCameraPermissionDenied')}</Text>
            </View>
          )}
          <View style={S.overlayBox} onLayout={(e) => setOverlayHeight(e.nativeEvent.layout.height)}>
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
              <FaceGuide
                status={faceGuideStatus}
                checked={faceChecked}
                checking={faceChecking}
                onCheck={checkFacePosition}
                overlayHeight={overlayHeight}
              />
            </>
          ) : (
            <View style={S.content}>
              <Text style={S.body}>{t('identity.biometricCameraPermissionDenied')}</Text>
            </View>
          )}
          <View style={S.overlayBox} onLayout={(e) => setOverlayHeight(e.nativeEvent.layout.height)}>
            <StepDots current={2} />
            {step === 'face_intro' ? (
              <>
                <Text style={S.overlayTitle}>{t('identity.biometricFaceTitle')}</Text>
                <Text style={S.overlayHint}>{t('identity.biometricFaceHint')}</Text>
                <Text style={S.overlayHintSecondary}>👓 {t('identity.biometricFaceGlassesHint')}</Text>
                {challenge && (
                  <Text style={S.overlayHintSecondary}>🎯 {challengeInstruction(challenge.challengeType, t)}</Text>
                )}
                <GradientButton label={t('identity.biometricCaptureBtn')} onPress={startFaceCapture} />
              </>
            ) : (
              <>
                <ActivityIndicator color={theme.purple} size="large" style={S.spinnerGap} />
                <Text style={S.overlayHint}>{t('identity.biometricLivenessCapturing')}</Text>
                {challenge && (
                  <Text style={S.overlayHintSecondary}>🎯 {challengeInstruction(challenge.challengeType, t)}</Text>
                )}
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
          <View style={S.overlayBox} onLayout={(e) => setOverlayHeight(e.nativeEvent.layout.height)}>
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
              </>
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
  resultDebugText: {
    color: '#ffcc00', fontSize: 10, fontFamily: 'monospace', textAlign: 'center',
    marginTop: -8, marginBottom: 12,
  },

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
  overlayHintSecondary: { color: theme.muted, fontSize: 11, textAlign: 'center', lineHeight: 16, marginTop: 8, opacity: 0.8 },

  // `bottom` is set per-instance (dynamic, measured overlay panel height --
  // see overlayHeight/onLayout above) instead of baked in here, so the
  // guide centers itself in the actually-visible area above the bottom
  // instruction panel rather than the full (partly-occluded) camera view.
  guideWrap: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' },
  // width/height/borderRadius are computed per-instance in FaceGuide (see
  // its own comment) so the oval scales with screen width instead of this
  // fixed base size.
  faceOval: { borderWidth: 3, borderStyle: 'dashed', borderColor: theme.borderStrong },
  faceOvalOk: { borderColor: theme.neon, borderStyle: 'solid' },
  guideHint: {
    marginTop: 14, color: theme.text, fontSize: 12.5, fontWeight: '700', letterSpacing: 0.5,
    backgroundColor: 'rgba(12,14,22,0.7)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: theme.radiusSm,
    maxWidth: '85%', textAlign: 'center',
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
