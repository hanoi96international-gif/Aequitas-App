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
import { Platform } from 'react-native';
import {
  isPlayServicesAvailable,
  prepareIntegrityToken,
  requestIntegrityToken,
  generateHardwareKey,
  getAttestation,
} from '@pagopa/io-react-native-integrity';

export interface AttestationPayload {
  platform: 'android' | 'ios';
  token: string;
}

/** Returns null (never throws) whenever attestation isn't actionable --
 * no GOOGLE_CLOUD_PROJECT_NUMBER configured, Play Services/App Attest
 * unavailable, or the underlying native call itself failed. Attestation is
 * informational only (see attestation.py), so a null here must never
 * block registration -- same posture as every other beta liveness check
 * in this project. */
export async function getAttestationPayload(): Promise<AttestationPayload | null> {
  try {
    if (Platform.OS === 'android') {
      const projectNumber = process.env.EXPO_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER;
      if (!projectNumber) return null;
      if (!(await isPlayServicesAvailable())) return null;
      await prepareIntegrityToken(projectNumber);
      const token = await requestIntegrityToken();
      return { platform: 'android', token };
    }

    if (Platform.OS === 'ios') {
      // No equivalent "is this configured" gate on iOS -- App Attest needs
      // no external project number, just a real device (it always fails
      // on the Simulator, same as any other hardware-backed check).
      const key = await generateHardwareKey();
      // App Attest's own contract requires a per-attempt challenge, not a
      // stable/reused one (a reused challenge would make the attestation
      // itself replayable) -- a real deployment would fetch this from the
      // coordinator instead of generating it locally, once real server-
      // side verification exists to issue one (see this file's own
      // top comment on why that isn't provisioned yet).
      const challenge = Math.random().toString(36).slice(2);
      const token = await getAttestation(challenge, key);
      return { platform: 'ios', token };
    }
  } catch (e) {
    console.error('[attestation] getAttestationPayload failed', e);
  }
  return null;
}
