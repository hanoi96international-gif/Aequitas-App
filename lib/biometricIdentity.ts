// Phase 0 biometric proof-of-personhood client (face matching only since
// 2026-08-23 -- palm, fingertip, ear and the acoustic test were removed, see
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
// Legacy (function-based) API -- deleteAsync/idempotent isn't exposed by the
// new File/Directory class API this SDK version defaults `expo-file-system`
// to, see the cleanupCaptureFiles() comment below.
import * as FileSystem from 'expo-file-system/legacy';
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

/** The face, and nothing else.
 *
 *  palm, fingertip and ear are gone from this type, not merely unused. Each was
 *  a WEAK modality, and match_policy requires TWO weak modalities to agree
 *  before they count for anything — while every weak modality ships disabled
 *  (PALM/FINGERTIP_VEIN/EAR/SCLERA/PERIOCULAR_PARTICIPATES_IN_MATCH all default
 *  to false). None of them could reach that bar alone or together, so none could
 *  affect a duplicate decision at all. They were nevertheless demanded from
 *  every person and stored as GDPR Art. 9 biometric data for a purpose they
 *  cannot serve.
 *
 *  The acoustic chirp went with them: its own liveness check is off by default
 *  (REQUIRE_ACOUSTIC_LIVENESS=false) and informational when on, so it too asked
 *  a person for a recording that changed nothing.
 *
 *  Removing the FIELDS rather than just the capture steps is deliberate. An
 *  optional field that nothing fills is an invitation to fill it again later,
 *  and the reason it must not be filled lives here, not in the screen. */
export interface BiometricCapture {
  faceUri: string;
  faceBurstUris: string[];
  /** Die Burst-Aufnahme selbst, statt der auf dem Geraet extrahierten
   *  Einzelbilder. Ist sie gesetzt, zerlegt der Coordinator sie mit ffmpeg
   *  und ignoriert faceBurstUris.
   *
   *  Grund: Androids MediaMetadataRetriever -- was expo-video-thumbnails
   *  benutzt -- liefert auf manchen Geraeten aus dem eigenen HEVC-Video
   *  keinen einzigen Frame (gemessen: 100 % Ausfall auf einem
   *  MediaTek-Xiaomi, ueber alle Zeitpunkte). Der Codec laesst sich auf dem
   *  Geraet nicht waehlen, und eine Fotoserie statt Video zerstoert die
   *  rPPG-Pulsmessung. Serverseitig zu zerlegen loest es geraeteunabhaengig
   *  und gibt der Pulsmessung ausserdem den ECHTEN Bildabstand aus dem
   *  Videostrom statt burstIntervalMs, das nur unsere Zielvorgabe ist. */
  faceBurstVideoUri?: string;
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

/** Colour names the coordinator's flash sequence draws from -- see
 * matching-service/app/flash_liveness.py's PALETTE (duplicated here for the
 * same "separate services, no cross-repo coupling" reason the Python side
 * itself duplicates constants between validators and the coordinator). */
export type FlashColor = 'red' | 'green' | 'blue';

export interface IssuedChallenge {
  nonce: string;
  challengeType: ChallengeType;
  /** Active-flash-liveness colour sequence (see
   * matching-service/app/flash_liveness.py) -- the screen shows each colour
   * in order for an equal slice of the face_burst recording, and the server
   * verifies the face's reflected colour actually tracked it. Empty if the
   * coordinator response predates this feature -- same graceful-degrade
   * posture as challengeType's own null-on-failure path. */
  flashSequence: FlashColor[];
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
    const flashSequence: FlashColor[] = typeof body.flash_sequence === 'string' && body.flash_sequence
      ? body.flash_sequence.split(',').filter(Boolean)
      : [];
    return { nonce: body.nonce, challengeType: body.challenge_type, flashSequence };
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
  best_sclera_score?: number;
  best_fingertip_vein_score?: number;
  best_ear_score?: number;
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
  // not_configured | invalid | valid | unavailable -- see attestation.py.
  // Android is real Play Integrity verification once the coordinator has a
  // service account key deployed; iOS App Attest isn't implemented yet.
  // Informational only, never affects `decision`.
  attestation_status?: string;
  attestation_reason?: string | null;
  // Echoes back what requestChallenge() actually issued, once the
  // coordinator confirms it consumed a valid, unexpired challenge_nonce --
  // null if no challenge was requested/consumed (see coordinator/app/
  // main.py's /register).
  challenge_type?: string | null;
  // Ed25519 signature over (bio_hash, wallet, issued_at), issued by the
  // coordinator alongside the bio_hash. Must be forwarded verbatim to
  // /api/prove: without it the proof server cannot distinguish a bio_hash
  // that came out of the palm/face quorum from one the caller made up, and
  // every check in aequitas-biometric-beta is bypassed rather than defeated.
  //
  // Optional on this type because a coordinator without
  // COORDINATOR_SIGNING_KEY returns neither -- it reports why in
  // bio_attestation_error instead of failing the registration, so an
  // unconfigured coordinator stays usable while the proof server is still in
  // BIO_ATTESTATION_MODE=off or optional.
  bio_attestation?: string | null;
  bio_attestation_issued_at?: number | null;
  attestation_key?: string | null;
  bio_attestation_error?: string | null;
}

function toUploadFile(uri: string, name: string, type = 'image/jpeg') {
  // React Native's fetch/FormData accepts this shape directly for file
  // uploads -- not a real Blob, but the RN runtime knows how to read it.
  return { uri, name, type } as unknown as Blob;
}

/** Deletes every raw capture temp file registerBiometric() below just read
 * into the upload FormData -- palm/face/face_burst/fingertip_burst/ear/
 * acoustic. These are exactly (and only) the temp/cache URIs used for
 * upload; nothing else in the app is touched. `idempotent: true` means a
 * URI that's already gone (e.g. cleaned up once already) doesn't throw.
 * Best-effort: a delete failure is logged, not surfaced, so cache-cleanup
 * problems never mask the real registration result/error to the caller. */
async function cleanupCaptureFiles(capture: BiometricCapture): Promise<void> {
  const uris = [
    capture.faceUri,
    ...capture.faceBurstUris,
    capture.faceBurstVideoUri,
  ].filter((uri): uri is string => !!uri);

  await Promise.all(
    uris.map(async (uri) => {
      try {
        await FileSystem.deleteAsync(uri, { idempotent: true });
      } catch (e) {
        console.warn('[biometricIdentity] failed to delete capture temp file', uri, e);
      }
    })
  );
}

export async function registerBiometric(
  capture: BiometricCapture,
  opts: {
    deviceId: string;
    walletAddress?: string;
    consent?: ConsentDecision;
  }
): Promise<BiometricRegisterResult> {
  if (!COORDINATOR_BASE) {
    throw new Error('Biometric coordinator not configured (EXPO_PUBLIC_COORDINATOR_BASE unset)');
  }

  try {
    const form = new FormData();
    // No `mode` field. It used to be sent here and it selected which
    // enrollment table the coordinator deduplicated against -- so a caller
    // could pick the empty test table, fail no check, and still walk away
    // with a usable bio_hash. The coordinator now takes its mode from its own
    // SERVICE_MODE and ignores the field entirely; keeping it on the wire
    // would imply this app still has a say in that, which it must not.
    form.append('device_id', opts.deviceId);
    if (opts.walletAddress) form.append('wallet_address', opts.walletAddress);
    if (opts.consent?.biometricConsent) {
      form.append('consent_version', CONSENT_VERSION);
      form.append('consented_at', String(opts.consent.consentedAt));
    }
    form.append('face_image', toUploadFile(capture.faceUri, 'face.jpg'));
    capture.faceBurstUris.forEach((uri, i) => {
      form.append('face_burst', toUploadFile(uri, `burst_${i}.jpg`));
    });
    if (capture.faceBurstVideoUri) {
      form.append(
        'face_burst_video',
        toUploadFile(capture.faceBurstVideoUri, 'face_burst.mp4', 'video/mp4')
      );
    }
    form.append('burst_interval_ms', String(capture.burstIntervalMs));
    if (capture.imuSamples?.length) {
      form.append('imu_samples', JSON.stringify(capture.imuSamples));
    }
    if (capture.challengeNonce) {
      form.append('challenge_nonce', capture.challengeNonce);
    }
    // See lib/attestation.ts's own top comment for why this is
    // @pagopa/io-react-native-integrity now, not @expo/app-integrity (which
    // crashed the whole app on this project's Expo SDK). Still gracefully
    // sends nothing when unconfigured/unavailable -- e.g. no
    // EXPO_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER set, which also makes the
    // coordinator's own attestation_status read "not_configured" (see
    // attestation.py).
    const attestation = await getAttestationPayload();
    if (attestation) {
      form.append('attestation_platform', attestation.platform);
      form.append('attestation_token', attestation.token);
    }

    const resp = await fetch(`${COORDINATOR_BASE}/register`, { method: 'POST', body: form });
    if (!resp.ok) {
      throw new Error(`Coordinator request failed (HTTP ${resp.status})`);
    }
    return await resp.json();
  } finally {
    // SECURITY FIX (P1): raw palm/face/fingertip/ear photos and the
    // acoustic recording sat in app cache indefinitely after upload --
    // nothing ever deleted them, contradicting the app's own "images are
    // discarded" privacy copy. Clean up on both success and failure:
    // biometric-capture.tsx's submit() has no "retry with the same files"
    // path (a failed attempt sends the user back to re-capture from
    // scratch with brand-new URIs), so it's safe to always delete here
    // rather than conditioning on the outcome.
    await cleanupCaptureFiles(capture);
  }
}

export interface VouchResult {
  status: string; // recorded | invalid_mode | invalid_self_vouch | unknown_voucher | unknown_vouchee | quorum_failed
  trust_score: number;
  trust_reasons: string[];
}

/** Records a social vouch (see aequitas-biometric-beta/matching-service/
 * app/trust.py's own docstring) -- purely informational, same posture as
 * every other beta signal here: the returned trust_score/status is shown
 * to the user, but nothing in this app or the coordinator gates a
 * registration decision on it yet (see trust.py: no equivalent of
 * risk_block_threshold exists for trust scores). Goes through the
 * COORDINATOR's /vouch (fanned out to every validator), never a single
 * validator directly -- same "never bypass the quorum" rule
 * registerBiometric() above already follows. */
export async function voucherFor(
  voucherBioHash: string,
  voucheeBioHash: string
): Promise<VouchResult> {
  if (!COORDINATOR_BASE) {
    throw new Error('Biometric coordinator not configured (EXPO_PUBLIC_COORDINATOR_BASE unset)');
  }
  const resp = await fetch(`${COORDINATOR_BASE}/vouch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // No `mode` -- same reason as registerBiometric above: which table a
    // vouch is recorded against is the coordinator's business, not ours.
    body: JSON.stringify({ voucher_bio_hash: voucherBioHash, vouchee_bio_hash: voucheeBioHash }),
  });
  if (!resp.ok) {
    throw new Error(`Coordinator vouch request failed (HTTP ${resp.status})`);
  }
  return resp.json();
}

// ---------------------------------------------------------------------------
// Withdrawal of consent (GDPR Art. 17).
//
// The coordinator has exposed DELETE /enrollment for a while, but nothing in
// this app ever called it, and worse: the bio_hash it needs was thrown away
// the moment registration finished. The self-service erasure path existed on
// the server and was unreachable from the only client that exists.
//
// WHY THE bio_hash AND NOT THE WALLET. Both identify the enrolment, but they
// are not equally secret. The wallet address is PUBLIC -- the chain lists
// every registered human at /api/humans to anyone who asks -- so the
// coordinator (rightly) demands an operator credential for that key, and an
// app must never carry one. The bio_hash is handed to the registrant and to
// nobody else, so knowing one is itself the evidence of being that person.
// That is the key a client can legitimately hold, and the only one this code
// touches.

const BIO_HASH_KEY = 'aequitas_bio_hash_v1';

/** Persists the bio_hash so the person can later erase their own enrolment.
 *
 * SecureStore, not AsyncStorage: this value IS the erasure credential for one
 * human's biometric enrolment. It is not a biometric template and cannot be
 * turned back into a face, but anyone holding it can delete that enrolment --
 * which does not merely remove data, it lets the next person through as a
 * stranger. Hardware-backed storage is the proportionate place for it.
 *
 * Never throws: a device that cannot persist it still completed a valid
 * registration, and failing the whole flow at the last step over a
 * convenience feature would be the wrong trade. The consequence is a person
 * who must ask the operator to erase them instead of doing it themselves. */
export async function rememberBioHash(bioHash: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(BIO_HASH_KEY, bioHash);
  } catch (e) {
    console.warn('[biometric] bio_hash konnte nicht gesichert werden', e);
  }
}

/** The stored bio_hash, or null if this device never registered (or the
 * enrolment was already erased). */
export async function storedBioHash(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(BIO_HASH_KEY);
  } catch {
    return null;
  }
}

export interface DeleteEnrollmentResult {
  // deleted | not_found | partial | invalid_request | unauthorized
  status: string;
  validator_results: { url?: string; status?: string; [k: string]: unknown }[];
}

/** Erases this person's enrolment at every matching validator.
 *
 * PARTIAL IS NOT SUCCESS. The coordinator reports per-validator results
 * rather than one boolean precisely because a validator that was unreachable
 * still holds the template and can still "recognize" someone who withdrew
 * consent. Callers must show `partial` as the incomplete erasure it is
 * instead of collapsing it into a checkmark.
 *
 * The local copy is only forgotten on a clean `deleted`. Dropping it on
 * `partial` would strand the person: the one key that lets them retry the
 * erasure would be gone while their data was still out there. */
export async function deleteEnrollment(bioHash: string): Promise<DeleteEnrollmentResult> {
  if (!COORDINATOR_BASE) {
    throw new Error('Biometric coordinator not configured (EXPO_PUBLIC_COORDINATOR_BASE unset)');
  }
  const resp = await fetch(`${COORDINATOR_BASE}/enrollment`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    // No wallet_address: that key is public and needs an operator token this
    // app must not carry. See the block comment above.
    body: JSON.stringify({ bio_hash: bioHash }),
  });
  if (!resp.ok) {
    throw new Error(`Coordinator delete request failed (HTTP ${resp.status})`);
  }
  const result: DeleteEnrollmentResult = await resp.json();
  if (result.status === 'deleted' || result.status === 'not_found') {
    // not_found counts: nothing of this person is held any more, which is
    // exactly the state the request asked for.
    try {
      await SecureStore.deleteItemAsync(BIO_HASH_KEY);
    } catch {
      /* the server state is what matters; a stale local copy is harmless */
    }
  }
  return result;
}
