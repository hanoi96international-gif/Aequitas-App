// Device attestation (Android Play Integrity / iOS App Attest) -- a
// complementary, non-biometric Sybil-resistance signal: it proves a
// registration request came from a genuine, unmodified app on a genuine
// device, raising the cost of mass-registering fake identities from an
// emulator farm even if the biometric checks themselves were somehow
// defeated. See coordinator/app/attestation.py's own docstring for the
// full picture: ACTUALLY verifying the token this produces needs a Google
// Cloud project tied to this app's own Play Console listing (Android) and
// an Apple Developer Team ID (iOS) -- account/credential setup only the
// project owner can provision, not something this code can create or fake
// for itself. Until that's provisioned, the coordinator deliberately
// always reports "not_configured" regardless of what's sent here -- same
// "no false sense of security" reasoning as EXPO_PUBLIC_GOOGLE_CLOUD_
// PROJECT_NUMBER being unset below.
//
// Uses @pagopa/io-react-native-integrity -- a plain React Native native
// module, NOT an Expo Module -- instead of the earlier @expo/app-integrity
// attempt. That one crashed the whole app at native-module-registry
// construction (NoClassDefFoundError: expo.modules.kotlin.types.
// AnyTypeCache) because it goes through Expo Modules Core's own
// registration system, and no published version of it targets this
// project's Expo SDK (54) -- confirmed via npm's own dist-tags: the
// earliest SDK-aligned release is tagged "sdk-55", every version from then
// on skips 54 entirely. A plain RN native module doesn't route through
// Expo Modules Core at all, so it isn't exposed to that specific
// incompatibility -- confirmed live via a real device build (no crash).
//
// BINDUNG AN DEN SERVER-NONCE (18.10.2026). Vorher rief Android
// requestIntegrityToken() ohne requestHash, und iOS wuerfelte seine
// App-Attest-Challenge lokal mit Math.random() und schickte keinen keyId --
// ein erbeutetes Android-Token galt fuer beliebig viele Anmeldungen, und jede
// echte iOS-Attestierung war beim Coordinator "invalid". Jetzt binden beide
// Plattformen an den Nonce, den POST /challenge fuer genau diese Aufnahme
// ausgegeben hat (derselbe, der als challenge_nonce mitgeht):
//
//   Android: requestHash = SHA-256 ueber die UTF-8-Bytes von
//              aequitas-geraetepruefung-v1|<challenge_nonce>
//            als 64 Zeichen Hex in Kleinbuchstaben (ohne 0x).
//            Gegenstueck: coordinator/app/attestation.py, attestierungs_hash.
//   iOS:     der Nonce selbst ist die App-Attest-Challenge (die Bibliothek
//            bildet clientDataHash = SHA-256 seiner UTF-8-Bytes), und der
//            keyId von generateHardwareKey() geht als attestation_key_id mit.
//
// Ohne Nonce wird gar nichts geschickt: ein ungebundenes Token waere beim
// Coordinator ohnehin "invalid".
import { Platform } from 'react-native';
import { ethers } from 'ethers';
import {
  isPlayServicesAvailable,
  prepareIntegrityToken,
  requestIntegrityToken,
  generateHardwareKey,
  getAttestation,
} from '@pagopa/io-react-native-integrity';

export const ATTESTIERUNG_DOMAIN = 'aequitas-geraetepruefung-v1';

// BINDUNG AN DIE AUFNAHME (#73 HOCH-2, zweiter Teil -- nur der Zwillingsweg).
// Der Nonce allein genuegt dort nicht: ein echtes Geraet holte ein Token zum
// Nonce, und ein eigener Client legte andere Bilder daneben. Das Token bindet
// darum an genau die hochgeladenen Dateien -- und wird erst NACH der Aufnahme
// geholt. Gleich in coordinator/app/attestation.py (aufnahme_hash,
// zwilling_bindung), gemeinsamer Testvektor in beiden Testsuiten:
//
//   datei_hash    = SHA-256 ueber SHA-256(Block 1) || SHA-256(Block 2) || ...
//                   (Bloecke zu DATEI_BLOCK = 1 MiB, rohe 32-Byte-Werte; leere
//                   Datei: SHA-256 der leeren Eingabe) -- blockweise, damit nie
//                   eine ganze Datei (bis zu zwei 20-s-Videos) im Speicher liegt
//   aufnahme_hash = SHA-256 ueber "<feld>:<datei_hash, hex>\n" je Teil,
//                   Reihenfolge: face_image, face_burst (je Datei),
//                   face_burst_video, zwilling_bild, zwilling_burst (je Datei),
//                   zwilling_video -- fehlende entfallen
//   gebunden      = aequitas-zwilling-aufnahme-v1|<challenge_nonce>|<aufnahme_hash>
//   Android: requestHash = SHA-256(gebunden), Hex klein ohne 0x
//   iOS:     gebunden ist die App-Attest-Challenge
export const ZWILLING_AUFNAHME_DOMAIN = 'aequitas-zwilling-aufnahme-v1';

/** Blockgroesse fuer datei_hash -- gleich im Coordinator (BLOCK_GROESSE). */
export const DATEI_BLOCK = 1 << 20;

/** SHA-256 eines Blocks, roh (32 Byte) -- ein Glied von datei_hash. */
export function blockHash(block: Uint8Array): Uint8Array {
  return ethers.getBytes(ethers.sha256(block));
}

/** datei_hash (hex) aus den Blockhashes in Reihenfolge. */
export function dateiHashAus(blockHashes: Uint8Array[]): string {
  return ethers.sha256(ethers.concat(blockHashes)).slice(2);
}

/** datei_hash einer Datei im Speicher (Tests, kleine Daten). */
export function datenHash(daten: Uint8Array): string {
  const glieder: Uint8Array[] = [];
  for (let pos = 0; pos < daten.length; pos += DATEI_BLOCK) glieder.push(blockHash(daten.subarray(pos, pos + DATEI_BLOCK)));
  return dateiHashAus(glieder);
}

/** aufnahme_hash aus [feld, datei_hash (hex)] in fester Reihenfolge. */
export function aufnahmeHashAus(teile: ReadonlyArray<readonly [string, string]>): string {
  const zeilen = teile.map(([feld, hash]) => `${feld}:${hash}\n`).join('');
  return ethers.sha256(ethers.toUtf8Bytes(zeilen)).slice(2);
}

/** Die gebundene Zeichenkette (Format oben). */
export function zwillingBindung(nonce: string, aufnahme: string): string {
  return `${ZWILLING_AUFNAHME_DOMAIN}|${nonce}|${aufnahme}`;
}

/** Der requestHash fuer Play Integrity zu einer gebundenen Zeichenkette. */
export function gebundenerHash(bindung: string): string {
  return ethers.sha256(ethers.toUtf8Bytes(bindung)).slice(2);
}

/** Obergrenze fuer die ganze Geraetepruefung. Ein haengender Play-Services-
 * oder App-Attest-Aufruf darf die Anmeldung nicht aufhalten: danach geht
 * die Anfrage ohne Attestierung raus (beim Coordinator "not_provided"). */
export const ATTESTIERUNG_FRIST_MS = 15_000;

export interface AttestationPayload {
  platform: 'android' | 'ios';
  token: string;
  /** Nur iOS: der App-Attest-keyId (Base64, SHA-256 des Geraeteschluessels). */
  keyId?: string;
}

/** Der requestHash fuer Play Integrity zu diesem Nonce (Format oben). */
export function attestierungsHash(nonce: string): string {
  return ethers.sha256(ethers.toUtf8Bytes(`${ATTESTIERUNG_DOMAIN}|${nonce}`)).slice(2);
}

async function erzeugen(nonce: string, bindung?: string): Promise<AttestationPayload | null> {
  try {
    if (Platform.OS === 'android') {
      const projectNumber = process.env.EXPO_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER;
      if (!projectNumber) return null;
      if (!(await isPlayServicesAvailable())) return null;
      await prepareIntegrityToken(projectNumber);
      const token = await requestIntegrityToken(bindung ? gebundenerHash(bindung) : attestierungsHash(nonce));
      return { platform: 'android', token };
    }

    if (Platform.OS === 'ios') {
      // No equivalent "is this configured" gate on iOS -- App Attest needs
      // no external project number, just a real device (it always fails
      // on the Simulator, same as any other hardware-backed check).
      // generateHardwareKey() liefert den keyId, den der Coordinator gegen
      // das Zertifikat prueft (app_attest.py: key_id_mismatch).
      const keyId = await generateHardwareKey();
      const token = await getAttestation(bindung ?? nonce, keyId);
      return { platform: 'ios', token, keyId };
    }
  } catch (e) {
    console.error('[attestation] getAttestationPayload failed', e);
  }
  return null;
}

/** Returns null (never throws) whenever attestation isn't actionable --
 * no challenge nonce, no GOOGLE_CLOUD_PROJECT_NUMBER configured, Play
 * Services/App Attest unavailable, the native call failed, or it took
 * longer than fristMs. Attestation is informational only (see
 * attestation.py), so a null here must never block registration -- same
 * posture as every other beta liveness check in this project. */
export async function getAttestationPayload(
  nonce: string | null | undefined,
  fristMs: number = ATTESTIERUNG_FRIST_MS,
  bindung?: string
): Promise<AttestationPayload | null> {
  if (!nonce) return null;
  let uhr: ReturnType<typeof setTimeout> | undefined;
  const frist = new Promise<null>((resolve) => {
    uhr = setTimeout(() => {
      console.warn('[attestation] Frist abgelaufen -- Anmeldung ohne Geraetepruefung');
      resolve(null);
    }, fristMs);
  });
  try {
    // erzeugen() wirft nie (eigenes catch) -- ein spaeter Fehler des
    // haengenden nativen Aufrufs bleibt also auch nach der Frist still.
    return await Promise.race([erzeugen(nonce, bindung), frist]);
  } finally {
    if (uhr !== undefined) clearTimeout(uhr);
  }
}

/** Haengt die Geraetepruefung an ein Anmeldeformular an -- oder nichts.
 *  bindung: zwillingBindung(...) -- dann gilt das Token nur fuer genau diese
 *  Aufnahme (Zwillingsweg). Ergebnis: ob etwas angehaengt wurde. */
export async function attestierungAnhaengen(
  form: FormData,
  nonce: string | null | undefined,
  bindung?: string
): Promise<boolean> {
  const attestation = await getAttestationPayload(nonce, ATTESTIERUNG_FRIST_MS, bindung);
  if (!attestation) return false;
  form.append('attestation_platform', attestation.platform);
  form.append('attestation_token', attestation.token);
  if (attestation.keyId) form.append('attestation_key_id', attestation.keyId);
  return true;
}
