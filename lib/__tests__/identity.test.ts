jest.mock('expo-secure-store', () => ({
  canUseBiometricAuthentication: jest.fn(() => false),
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
}));

// Mocked for the same reason wallet.test.ts mocks it (see that file's own
// comment): the real module has no native backing under Jest. Included here
// even though lib/identity.ts does not currently import it at all -- see
// below, that is exactly the gap this test documents -- so that this test
// keeps working unmodified once identity.ts gains the same supplementary
// gate wallet.ts already has.
jest.mock('expo-local-authentication', () => ({
  getEnrolledLevelAsync: jest.fn(async () => 2),
  authenticateAsync: jest.fn(async () => ({ success: true })),
  SecurityLevel: { NONE: 0, SECRET: 1, BIOMETRIC_WEAK: 2, BIOMETRIC_STRONG: 3 },
}));

// expo-crypto also has no native backing under Jest -- getRandomBytesAsync
// would otherwise throw/hang the same way expo-local-authentication's calls
// did before wallet.test.ts mocked it (see that file's own comment).
jest.mock('expo-crypto', () => ({
  getRandomBytesAsync: jest.fn(async (byteCount: number) => new Uint8Array(byteCount).fill(0x42)),
}));

import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import { getDeviceIdentity } from '../identity';

// lib/wallet.ts's persistWallet/unlockWallet carry a "SECURITY FIX (P1)"
// comment (see that file) documenting that expo-secure-store's own
// `requireAuthentication` gate is biometric-ONLY: verified against the
// installed expo-secure-store native source, a device with no biometric
// hardware/enrollment has canUseBiometricAuthentication() === false, so
// requireAuthentication: canBiometric hands the stored secret back with NO
// prompt of any kind -- no passcode fallback, nothing. wallet.ts closes that
// gap with an explicit expo-local-authentication supplementary gate
// (ensureDeviceAuthentication, "biometric OR device passcode") for exactly
// this case, applied to the wallet's private key.
//
// lib/identity.ts's ensureDeviceSecret() (called by getDeviceIdentity(),
// used by the device-secret "Prove your humanity" flow -- see
// app/(tabs)/identity.tsx's proveHumanity()) reads and writes a DIFFERENT
// SecureStore-backed secret (aequitas_device_identity_v1, the value the
// bio_hash sent to /api/prove and /api/register is derived from) through the
// exact same canUseBiometricAuthentication()-gated requireAuthentication
// pattern -- but WITHOUT wallet.ts's supplementary gate. lib/identity.ts
// imports only 'expo-secure-store', 'expo-crypto', 'ethers', './api',
// './config', './signer' -- no 'expo-local-authentication' at all (confirmed
// via grep: identity.ts is the only canUseBiometricAuthentication() call
// site in lib/ besides wallet.ts's two, and it has no matching
// ensureDeviceAuthentication()-style call anywhere near it).
//
// This directly contradicts the app's own copy: identity.step1Desc in every
// locale (e.g. en.ts: "A biometrically secured key is generated in your
// device's secure hardware storage") promises a biometrically secured key.
// On a device with no biometric hardware/enrollment, it is not secured by
// anything at all -- not even the device passcode.
//
// This test currently FAILS. It is meant to: it proves the gap exists, and
// will start passing once ensureDeviceSecret() gets the same fix wallet.ts's
// persistWallet/unlockWallet already have.
describe('getDeviceIdentity on a device with no biometric hardware/enrollment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (SecureStore.canUseBiometricAuthentication as jest.Mock).mockReturnValue(false);
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null); // no secret stored yet
  });

  it('gates the stored device-identity secret behind some form of device authentication, not none', async () => {
    await getDeviceIdentity();

    expect(SecureStore.getItemAsync).toHaveBeenCalled();
    expect(SecureStore.setItemAsync).toHaveBeenCalled();

    const getOpts = (SecureStore.getItemAsync as jest.Mock).mock.calls[0][1];
    const setOpts = (SecureStore.setItemAsync as jest.Mock).mock.calls[0][2];
    const localAuthRan = (LocalAuthentication.authenticateAsync as jest.Mock).mock.calls.length > 0;

    // Matches wallet.ts's post-fix contract: EITHER SecureStore itself is
    // told to require authentication, OR an equivalent gate ran first.
    // Today, neither holds -- requireAuthentication is `canBiometric`
    // (false, per the mock above) on both calls, and nothing calls
    // expo-local-authentication at all.
    expect(getOpts?.requireAuthentication === true || localAuthRan).toBe(true);
    expect(setOpts?.requireAuthentication === true || localAuthRan).toBe(true);
  });
});
