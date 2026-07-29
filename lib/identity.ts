import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { ethers } from 'ethers';
import { requestProof, postRegister, checkRegistrationByBioHash } from './api';
import { CHAIN_ID_DEC, V7_CONTRACT } from './config';
import { withTimeout, type AequitasSigner } from './signer';

const SIGN_TIMEOUT_MS = 60_000;

const DEVICE_SECRET_KEY = 'aequitas_device_identity_v1';

// Same finite field as the Groth16 circuit (BN254 scalar field) — must match
// the proof server's expectations for bio/salt inputs.
const FIELD_SIZE = BigInt(
  '21888242871839275222246405745257275088548364400416034343698204186575808495617'
);

/**
 * Deterministic device-bound hash, same algorithm as the existing
 * AequitasBio app's deriveBioHash: no raw biometric data is ever produced or
 * transmitted, only a stable hash of a hardware-gated device secret.
 */
function deriveBioHash(input: string): bigint {
  let h = 0n;
  const len = Math.min(input.length, 512);
  for (let i = 0; i < len; i++) {
    h = (h * 256n + BigInt(input.charCodeAt(i))) % FIELD_SIZE;
  }
  return h;
}

async function ensureDeviceSecret(): Promise<string> {
  const canBiometric = SecureStore.canUseBiometricAuthentication();
  const opts: SecureStore.SecureStoreOptions = {
    requireAuthentication: canBiometric,
    authenticationPrompt: 'Bestätige deine Identität für Aequitas',
  };
  let secret = await SecureStore.getItemAsync(DEVICE_SECRET_KEY, opts);
  if (!secret) {
    const bytes = await Crypto.getRandomBytesAsync(32);
    secret = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    await SecureStore.setItemAsync(DEVICE_SECRET_KEY, secret, {
      ...opts,
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  }
  return secret;
}

export interface DeviceIdentity {
  bio: string;
  salt: string;
}

/** Aus einem `bio` den zugehörigen Blinding-Faktor ableiten.
 *
 *  Deterministisch und nicht zufällig, weil derselbe Mensch bei einer
 *  Neuinstallation denselben `bio` vom Coordinator zurückbekommt — käme dann
 *  ein anderer `salt` heraus, ergäbe sich ein anderes Commitment, und die
 *  Kette sähe zwei verschiedene Registrierungen für eine Person. Die Formel
 *  ist unverändert die des 2-Faktor-Prototyps (AequitasAndroid2). */
function saltFor(bio: bigint): string {
  return ((bio * 7n + 12345n) % FIELD_SIZE).toString();
}

export async function getDeviceIdentity(): Promise<DeviceIdentity> {
  const secret = await ensureDeviceSecret();
  const bio = deriveBioHash(secret);
  return { bio: bio.toString(), salt: saltFor(bio) };
}

/**
 * Identität aus einem vom Coordinator vergebenen `bio_hash`.
 *
 * Der Unterschied zu getDeviceIdentity() ist der ganze Punkt der Übung: dort
 * entsteht der Wert aus einem Zufallsgeheimnis im Keystore, ist also pro
 * INSTALLATION eindeutig — wer die App zehnmal installiert, hat zehn
 * Identitäten. Hier stammt er aus einem Abgleich gegen alle bisherigen
 * Registrierungen und ist damit pro MENSCH eindeutig, was die Kette überhaupt
 * erst behaupten kann, was sie behauptet.
 */
export function identityFromBioHash(bioHash: string): DeviceIdentity {
  const bio = BigInt(bioHash) % FIELD_SIZE;
  return { bio: bio.toString(), salt: saltFor(bio) };
}

const DEVICE_ID_KEY = 'aequitas_device_id_v1';

/**
 * Stabile, zufällige Gerätekennung für die Ratenbegrenzung des Coordinators.
 *
 * Bewusst NICHT aus einer Hardware-ID (ANDROID_ID, IMEI o. ä.) abgeleitet:
 * eine solche Kennung wäre über App-Grenzen hinweg wiedererkennbar und würde
 * die biometrischen Aufnahmen mit dem Gerät verknüpfbar machen. Für den
 * Zweck — „wie viele Versuche kamen zuletzt von hier?" — genügt ein Zufalls-
 * wert, den nur diese Installation kennt.
 *
 * Ohne requireAuthentication gespeichert, anders als das Identitäts-
 * geheimnis: er wird zu Beginn der Aufnahme gebraucht, und eine zweite
 * biometrische Abfrage des Betriebssystems mitten im Ablauf würde die Kamera
 * unterbrechen.
 */
export async function getDeviceId(): Promise<string> {
  let id = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (!id) {
    const bytes = await Crypto.getRandomBytesAsync(16);
    id = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    await SecureStore.setItemAsync(DEVICE_ID_KEY, id, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  }
  return id;
}

const BIO_ENROLLMENT_KEY = 'aequitas_bio_enrollment_v1';

export interface StoredEnrollment {
  bioHash: string;
  signature: string;
  issuedAt: number;
  /**
   * Wallet, für die die Attestierung ausgestellt wurde.
   *
   * Muss mitgespeichert werden, weil sie Teil der signierten Nachricht ist
   * (`domain|bio|wallet|issued_at`). Eine für Wallet A ausgestellte
   * Attestierung mit Wallet B einzureichen ergibt eine ungültige Signatur —
   * ohne dieses Feld ließe sich das nicht bemerken, und der Nutzer bekäme
   * einen Signaturfehler statt der Aufforderung, die Aufnahme zu wiederholen.
   */
  wallet: string;
}

/**
 * Zwischenspeicher für eine bestandene Coordinator-Prüfung.
 *
 * Nicht als Sicherheitsmerkmal gedacht — der Proof-Server prüft die Signatur
 * selbst und lässt sie nach einer Frist verfallen. Der Zweck ist bloß, dass
 * ein abgebrochener Registrierungsversuch (Wallet-Signatur weggewischt, Netz
 * weg) nicht bedeutet, dass die ganze Aufnahme noch einmal gemacht werden
 * muss.
 */
export async function loadEnrollment(): Promise<StoredEnrollment | null> {
  try {
    const raw = await SecureStore.getItemAsync(BIO_ENROLLMENT_KEY);
    return raw ? (JSON.parse(raw) as StoredEnrollment) : null;
  } catch {
    return null;
  }
}

export async function saveEnrollment(e: StoredEnrollment): Promise<void> {
  try {
    await SecureStore.setItemAsync(BIO_ENROLLMENT_KEY, JSON.stringify(e), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } catch {
    // Nicht speichern zu können ist kein Grund, die laufende Registrierung
    // abzubrechen — sie funktioniert auch ohne den Zwischenspeicher.
  }
}

export async function checkAlreadyRegistered(bioHash: string) {
  return checkRegistrationByBioHash(bioHash);
}

/**
 * Generates the Groth16 proof, signs the registration message, and submits
 * it — mirrors aequitas-dapp.html's doRegister exactly (see that file's own
 * 2026-07-03 security-audit comment: registerWithSig is the only real,
 * working registration path), except the wallet used to sign is our own
 * in-app signer instead of MetaMask.
 *
 * FIX (Monster Audit follow-up, 2026-07-12, P1): trade.tsx's 4 signing call
 * sites are all wrapped in withTimeout (see lib/signer.ts's own comment on
 * why — a WalletConnect relay that doesn't recover after a background/
 * foreground cycle can hang signMessage() forever with zero feedback) but
 * this one, a brand-new user's very first action, wasn't. timeoutMessage is
 * a parameter rather than a hardcoded string because this module has no
 * useLanguage()/t() access — the caller (identity.tsx) passes the localized
 * text through.
 */
export async function proveAndRegister(
  signer: AequitasSigner,
  identity: DeviceIdentity,
  timeoutMessage: string = 'Timed out — no response from the wallet. Please try again.',
  /**
   * Attestierung des Coordinators über den `bio`-Wert, sofern die
   * Registrierung über den biometrischen Weg lief.
   *
   * Ohne sie akzeptiert der Proof-Server den `bio` nur, solange er auf
   * BIO_ATTESTATION_MODE=off oder =optional steht. Unter =required lehnt er
   * ab — und genau das ist der Sinn: ein selbst ausgedachter `bio` bekommt
   * dann keinen Nullifier mehr, und die biometrische Prüfung lässt sich nicht
   * länger dadurch umgehen, dass man sie einfach ausläßt.
   */
  attestation?: { signature: string; issuedAt: number }
) {
  const proof = await requestProof({
    bio: identity.bio,
    salt: identity.salt,
    wallet: signer.address,
    bioAttestation: attestation?.signature,
    bioAttestationIssuedAt: attestation?.issuedAt,
  });
  const { pA, pB, pC, pubSignals, zkNullifier, circuitVersion, bioHashKey } = proof;
  if (!zkNullifier) {
    throw new Error('Proof-Server hat keinen ZK-Nullifier zurückgegeben (Circuit v3 erforderlich) — bitte erneut versuchen');
  }
  // FIX (fresh Monster Audit 2026-07-13): register.go hard-requires
  // circuitVersion === 3. This used to fall back to `circuitVersion || 2`
  // when the field was missing/falsy and send that on to postRegister — 2
  // is not 3, so the backend would always reject it anyway, just later
  // (after the signMessage prompt below) and less clearly than catching it
  // here, mirroring the identical fix already made in explorer.js's
  // doRegister for the same reason.
  if (circuitVersion !== 3) {
    throw new Error(`Proof-Server hat Circuit v${circuitVersion ?? 'unbekannt'} zurückgegeben, aber v3 ist erforderlich — bitte erneut versuchen`);
  }

  const commitment = pubSignals[0];
  const nullifier = BigInt(zkNullifier).toString(16).padStart(64, '0');
  const messageHash = ethers.solidityPackedKeccak256(
    ['uint256', 'address', 'string', 'uint256', 'bytes32'],
    [CHAIN_ID_DEC, V7_CONTRACT, 'register', commitment, '0x' + nullifier]
  );
  const signature = await withTimeout(signer.signMessage(messageHash), SIGN_TIMEOUT_MS, timeoutMessage);

  return postRegister({
    wallet: signer.address,
    pA,
    pB,
    pC,
    pubSignals,
    signature,
    bioHash: identity.bio,
    bioHashKey: bioHashKey || '',
    nullifier,
    circuitVersion: circuitVersion || 2,
    zkNullifier,
  });
}
