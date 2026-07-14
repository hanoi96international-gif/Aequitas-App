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

export interface BiometricCapture {
  palmUri: string;
  faceUri: string;
  faceBurstUris: string[];
  /** Milliseconds between face_burst frames -- the coordinator/validator
   * needs this to convert its pulse (rPPG) FFT bins back to real BPM, see
   * matching-service/app/pulse.py's estimate_pulse(). */
  burstIntervalMs: number;
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

  const resp = await fetch(`${COORDINATOR_BASE}/register`, { method: 'POST', body: form });
  if (!resp.ok) {
    throw new Error(`Coordinator request failed (HTTP ${resp.status})`);
  }
  return resp.json();
}
