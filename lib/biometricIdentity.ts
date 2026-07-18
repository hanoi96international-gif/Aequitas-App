// Phase 0 biometric proof-of-personhood client (palm+face matching, see
// aequitas-biometric-beta). Talks to the COORDINATOR, never a validator
// directly -- going straight to one validator would bypass the quorum
// protection that architecture exists for (see quorum.py's docstring).
//
// This is entirely separate from identity.ts's existing device-secret bio
// derivation. It only becomes reachable when BIOMETRIC_ENABLED is set (see
// config.ts) -- unset in every build today, so this module has no effect
// on current behavior until deliberately turned on, and not before Phase 0
// accuracy validation + Phase 2 legal review are actually done.
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { getAttestationPayload } from './attestation';
import { COORDINATOR_BASE } from './config';

// Matches aequitas-biometric-beta/docs/einwilligung-entwurf.md -- bump if
// that text changes, so consent records stay tied to the exact version
// someone agreed to.
export const CONSENT_VERSION = 'einwilligung-entwurf-v1-2026-07-13';

const DEVICE_ID_KEY = 'aequitas_biometric_device_id_v1';

export async function getOrCreateDeviceId(): Promise<string> {
  let id = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (!id) {
    id = Crypto.randomUUID();
    await SecureStore.setItemAsync(DEVICE_ID_KEY, id);
  }
  return id;
}

/** Matches matching-service/app/imu_motion.py's own expected shape --
 * `t` is milliseconds elapsed since the face_burst recording started;
 * rotationRate is whatever unit the native sensor reports (expo-sensors'
 * Gyroscope gives rad/s, capture-web's DeviceMotionEvent gives deg/s) --
 * the server only ever correlates this against itself within one request,
 * never against an absolute threshold, so the unit doesn't need to match
 * across platforms. */
export interface ImuSample {
  t: number;
  rotationRate?: { alpha: number; beta: number; gamma: number } | null;
  acceleration?: { x: number; y: number; z: number } | null;
}

export interface BiometricCapture {
  palmUri: string;
  faceUri: string;
  faceBurstUris: string[];
  /** Milliseconds between face_burst frames -- the coordinator/validator
   * needs this to convert its pulse (rPPG) FFT bins back to real BPM, see
   * matching-service/app/pulse.py's estimate_pulse(). Also used for the
   * fingertip channel below and IMU windowing (see imu_motion.py) -- all
   * three assume the SAME interval, see biometric-capture.tsx's own
   * comment on why a mismatched interval would silently corrupt the BPM
   * math. */
  burstIntervalMs: number;
  /** Optional: absent on a device/OS build without a gyroscope, or if
   * expo-sensors itself failed to start -- see imu_motion.py's own
   * graceful "not checked" degradation for why this is fine to omit
   * rather than block registration on. */
  imuSamples?: ImuSample[];
  /** Optional: the user can skip the fingertip-pulse step entirely (see
   * fingertip_pulse.py's own docstring) -- absent here just means that
   * channel wasn't checked, not a failure. */
  fingertipBurstUris?: string[];
  /** One-time nonce from requestChallenge() below, echoed back so every
   * validator can independently verify the face_burst actually performed
   * the randomly-issued challenge (see matching-service/app/challenge.py's
   * docstring for the injection-attack threat model this defends against).
   * Absent if requestChallenge() itself failed (network hiccup) -- same
   * "informational only, degrade gracefully" posture as every other beta
   * liveness check here, not a hard requirement to register. */
  challengeNonce?: string;
}

export type ChallengeType = 'look_left' | 'look_right' | 'look_up' | 'look_down' | 'smile';

export interface IssuedChallenge {
  nonce: string;
  challengeType: ChallengeType;
}

/** Call this BEFORE starting face capture, per coordinator/app/main.py's
 * own /challenge docstring -- the whole point is that the challenge is
 * picked AFTER the user has committed to a real registration attempt, not
 * knowable in advance to whoever prepared a capture (or a pre-recorded/
 * injected video) ahead of time. Returns null on any failure (network
 * hiccup, coordinator unreachable) rather than throwing -- the challenge
 * step is informational-only, so a failed request here should just skip
 * straight to capture without it, not block the whole flow. */
export async function requestChallenge(): Promise<IssuedChallenge | null> {
  if (!COORDINATOR_BASE) return null;
  try {
    const resp = await fetch(`${COORDINATOR_BASE}/challenge`, { method: 'POST' });
    if (!resp.ok) return null;
    const body = await resp.json();
    if (!body?.nonce || !body?.challenge_type) return null;
    return { nonce: body.nonce, challengeType: body.challenge_type };
  } catch {
    return null;
  }
}

export interface ConsentDecision {
  biometricConsent: boolean;
  bonusConsent: boolean;
  consentedAt: number; // seconds since epoch, set at the moment of explicit confirmation
}

export interface RegisterVote {
  validator_url: string;
  decision: string;
  matched_bio_hash?: string | null;
  best_palm_score?: number;
  best_face_score?: number;
  best_periocular_score?: number;
  pulse_detected?: boolean | null;
  pulse_bpm?: number | null;
  pulse_confidence?: number;
  // See antispoof.py/moire.py/parallax.py/imu_motion.py/fingertip_pulse.py --
  // all informational only (never affect `decision` itself yet), same
  // reasoning as pulse_detected above already had before these existed.
  antispoof_checked?: boolean;
  antispoof_passed?: boolean | null;
  antispoof_confidence?: number;
  moire_checked?: boolean;
  moire_likely_screen_replay?: boolean;
  moire_score?: number;
  parallax_checked?: boolean;
  parallax_passed?: boolean | null;
  parallax_correlation?: number;
  imu_checked?: boolean;
  imu_passed?: boolean | null;
  imu_correlation?: number;
  challenge_type?: string | null;
  challenge_checked?: boolean;
  challenge_passed?: boolean | null;
  challenge_measured_delta?: number;
  fingertip_checked?: boolean;
  fingertip_detected?: boolean;
  fingertip_bpm?: number | null;
  fingertip_confidence?: number;
  pulse_consistent?: boolean | null;
  pulse_bpm_difference?: number | null;
  error?: string | null;
}

export interface BiometricRegisterResult {
  decision: string; // duplicate_detected | new_enrollment | capture_failed | liveness_failed | quorum_failed | invalid_mode | missing_consent
  bio_hash: string | null;
  quorum_size: number;
  validator_count: number;
  votes: RegisterVote[];
  commit_results?: unknown[] | null;
  proof_server_check?: unknown;
  // Always "not_configured" until real Play Integrity / App Attest
  // verification is implemented server-side (see attestation.py) --
  // informational only, never affects `decision`.
  attestation_status?: string;
  attestation_reason?: string | null;
  // Echoes back what requestChallenge() actually issued, once the
  // coordinator confirms it consumed a valid, unexpired challenge_nonce --
  // null if no challenge was requested/consumed (see coordinator/app/
  // main.py's /register).
  challenge_type?: string | null;
}

function toUploadFile(uri: string, name: string) {
  // React Native's fetch/FormData accepts this shape directly for file
  // uploads -- not a real Blob, but the RN runtime knows how to read it.
  return { uri, name, type: 'image/jpeg' } as unknown as Blob;
}

export async function registerBiometric(
  capture: BiometricCapture,
  opts: {
    mode: 'test' | 'real';
    deviceId: string;
    walletAddress?: string;
    consent?: ConsentDecision;
  }
): Promise<BiometricRegisterResult> {
  if (!COORDINATOR_BASE) {
    throw new Error('Biometric coordinator not configured (EXPO_PUBLIC_COORDINATOR_BASE unset)');
  }

  const form = new FormData();
  form.append('mode', opts.mode);
  form.append('device_id', opts.deviceId);
  if (opts.walletAddress) form.append('wallet_address', opts.walletAddress);
  if (opts.consent?.biometricConsent) {
    form.append('consent_version', CONSENT_VERSION);
    form.append('consented_at', String(opts.consent.consentedAt));
  }
  form.append('palm_image', toUploadFile(capture.palmUri, 'palm.jpg'));
  form.append('face_image', toUploadFile(capture.faceUri, 'face.jpg'));
  capture.faceBurstUris.forEach((uri, i) => {
    form.append('face_burst', toUploadFile(uri, `burst_${i}.jpg`));
  });
  form.append('burst_interval_ms', String(capture.burstIntervalMs));
  if (capture.imuSamples?.length) {
    form.append('imu_samples', JSON.stringify(capture.imuSamples));
  }
  capture.fingertipBurstUris?.forEach((uri, i) => {
    form.append('fingertip_burst', toUploadFile(uri, `fingertip_${i}.jpg`));
  });
  if (capture.challengeNonce) {
    form.append('challenge_nonce', capture.challengeNonce);
  }
  // See lib/attestation.ts's own top comment for why this is
  // @pagopa/io-react-native-integrity now, not @expo/app-integrity (which
  // crashed the whole app on this project's Expo SDK). Still gracefully
  // sends nothing when unconfigured/unavailable -- the coordinator's
  // attestation_status/attestation_reason fields keep reading
  // "not_configured" either way until real server-side verification is
  // provisioned (see attestation.py).
  const attestation = await getAttestationPayload();
  if (attestation) {
    form.append('attestation_platform', attestation.platform);
    form.append('attestation_token', attestation.token);
  }

  const resp = await fetch(`${COORDINATOR_BASE}/register`, { method: 'POST', body: form });
  if (!resp.ok) {
    throw new Error(`Coordinator request failed (HTTP ${resp.status})`);
  }
  return resp.json();
}
