import { AppState } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { ethers } from 'ethers';
import { RPC_URL } from './config';

const WALLET_SECRET_KEY = 'aequitas_wallet_secret_v1';
const WALLET_ADDRESS_KEY = 'aequitas_wallet_address_v1';

export type WalletInfo = { address: string; mnemonic?: string };

type LocalSigner = ethers.Wallet | ethers.HDNodeWallet;

let cachedSigner: LocalSigner | null = null;
let sharedProvider: ethers.JsonRpcProvider | null = null;

export function getProvider(): ethers.JsonRpcProvider {
  if (!sharedProvider) {
    sharedProvider = new ethers.JsonRpcProvider(RPC_URL, undefined, { staticNetwork: true });
  }
  return sharedProvider;
}

export async function hasStoredWallet(): Promise<boolean> {
  const addr = await SecureStore.getItemAsync(WALLET_ADDRESS_KEY);
  return !!addr;
}

export async function getStoredAddress(): Promise<string | null> {
  return SecureStore.getItemAsync(WALLET_ADDRESS_KEY);
}

// SECURITY FIX (P1): expo-secure-store's own `requireAuthentication` gate
// (used below) is biometric-ONLY, not "biometric or device passcode" --
// verified against the installed expo-secure-store@15.0.8 native source:
// iOS locks the Keychain item with the `.biometryCurrentSet` SecAccessControl
// flag (biometry, no passcode fallback -- see
// node_modules/expo-secure-store/ios/SecureStoreModule.swift), and Android's
// AuthenticationHelper.assertBiometricsSupport() throws outright if no
// biometric is enrolled (see .../android/.../AuthenticationHelper.kt), it
// never falls back to the lock-screen PIN/pattern/password. So on a
// passcode-only device (no biometric hardware/enrollment),
// canUseBiometricAuthentication() is false and `requireAuthentication` here
// was set to false too -- meaning the private key was handed back with NO
// prompt of any kind. Simply forcing `requireAuthentication: true`
// unconditionally is NOT the fix: on those same passcode-only devices it
// would make SecureStore itself throw (key generation/read requires
// biometrics to exist at all), breaking wallet creation/unlock entirely.
// Instead, close the gap with expo-local-authentication (already a project
// dependency, already configured via the `expo-local-authentication` app.json
// plugin + USE_BIOMETRIC/USE_FINGERPRINT permissions), whose
// `authenticateAsync({ disableDeviceFallback: false })` genuinely does
// "biometric OR device passcode" on both platforms -- confirmed via native
// source: iOS uses LAPolicyDeviceOwnerAuthentication (falls back to passcode
// when biometry unavailable/unenrolled) and Android's allowedAuthenticators
// includes BiometricManager.Authenticators.DEVICE_CREDENTIAL (see
// node_modules/expo-local-authentication/android/.../LocalAuthenticationModule.kt).
// Used only as a supplementary gate when SecureStore's own biometric prompt
// isn't available -- the existing biometric path is untouched.
async function ensureDeviceAuthentication(promptMessage: string): Promise<void> {
  const enrolledLevel = await LocalAuthentication.getEnrolledLevelAsync();
  if (enrolledLevel === LocalAuthentication.SecurityLevel.NONE) {
    // Device has no lock screen configured at all (no PIN/pattern/password,
    // no biometric) -- there is nothing to authenticate against, same as
    // the OS itself would allow. Not a gap we can close from the app.
    return;
  }
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage,
    disableDeviceFallback: false,
  });
  if (!result.success) {
    throw new Error('Authentifizierung erforderlich, um auf die Wallet zuzugreifen');
  }
}

async function persistWallet(privateKey: string, address: string) {
  const canBiometric = SecureStore.canUseBiometricAuthentication();
  if (!canBiometric) {
    await ensureDeviceAuthentication('Sichere deine Aequitas Wallet');
  }
  await SecureStore.setItemAsync(WALLET_SECRET_KEY, privateKey, {
    requireAuthentication: canBiometric,
    authenticationPrompt: 'Sichere deine Aequitas Wallet',
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  await SecureStore.setItemAsync(WALLET_ADDRESS_KEY, address);
}

/** Generates a mnemonic without touching storage, so the UI can show it for backup before committing. */
export function generateMnemonic(): string {
  const wallet = ethers.Wallet.createRandom();
  if (!wallet.mnemonic) throw new Error('Mnemonic generation failed');
  return wallet.mnemonic.phrase;
}

/** Persists a wallet derived from a (usually freshly generated + user-confirmed) mnemonic. */
export async function persistMnemonic(mnemonic: string): Promise<WalletInfo> {
  const wallet = ethers.Wallet.fromPhrase(mnemonic.trim().toLowerCase());
  await persistWallet(wallet.privateKey, wallet.address);
  cachedSigner = wallet.connect(getProvider());
  return { address: wallet.address, mnemonic };
}

export async function createWallet(): Promise<WalletInfo> {
  return persistMnemonic(generateMnemonic());
}

export async function importWallet(secret: string): Promise<WalletInfo> {
  const trimmed = secret.trim();
  const looksLikeMnemonic = trimmed.split(/\s+/).length >= 12;
  const wallet = looksLikeMnemonic
    ? ethers.Wallet.fromPhrase(trimmed.toLowerCase())
    : new ethers.Wallet(trimmed.startsWith('0x') ? trimmed : '0x' + trimmed);
  await persistWallet(wallet.privateKey, wallet.address);
  cachedSigner = wallet.connect(getProvider());
  return { address: wallet.address };
}

/** Unlocks the stored wallet, prompting for biometrics/device credential if the device supports it. */
export async function unlockWallet(): Promise<LocalSigner> {
  if (cachedSigner) return cachedSigner;
  const canBiometric = SecureStore.canUseBiometricAuthentication();
  if (!canBiometric) {
    // See ensureDeviceAuthentication()'s comment above persistWallet: this
    // is the highest-severity fix in this file -- without it, a device with
    // no biometric hardware/enrollment returned the private key with zero
    // authentication of any kind.
    await ensureDeviceAuthentication('Entsperre deine Aequitas Wallet');
  }
  const privateKey = await SecureStore.getItemAsync(WALLET_SECRET_KEY, {
    requireAuthentication: canBiometric,
    authenticationPrompt: 'Entsperre deine Aequitas Wallet',
  });
  if (!privateKey) throw new Error('Keine Wallet auf diesem Gerät gefunden');
  const wallet = new ethers.Wallet(privateKey, getProvider());
  cachedSigner = wallet;
  return wallet;
}

/** Drops the in-memory unlocked signer; the next operation will re-prompt. */
export function lockWallet() {
  cachedSigner = null;
}

// FIX (Monster Audit follow-up, 2026-07-12, P1): lockWallet existed but
// nothing ever called it — unlockWallet's cachedSigner check meant the
// biometric prompt only ever fired once per process lifetime, not once per
// use. RN doesn't tear down the JS context on backgrounding, so a signed-in
// session stayed unlocked indefinitely across background/foreground cycles:
// anyone with physical access to the phone while the app was still in
// Recents (no fresh unlock) could sign a transaction with zero further
// authentication, defeating the point of a "biometric-gated" wallet. Locking
// on every transition out of 'active' (background AND the transient
// 'inactive' state iOS uses for app-switcher/control-center) is the
// conservative choice for a wallet holding real funds — matches common
// banking-app UX of re-authenticating on every return, not after some grace
// period.
AppState.addEventListener('change', (nextState) => {
  if (nextState !== 'active') {
    lockWallet();
  }
});

export async function deleteWallet() {
  await SecureStore.deleteItemAsync(WALLET_SECRET_KEY);
  await SecureStore.deleteItemAsync(WALLET_ADDRESS_KEY);
  cachedSigner = null;
}

/**
 * Signs a message the same way MetaMask's personal_sign does: a plain-text
 * string is signed as UTF-8, but a "0x..."-hex string is signed as its raw
 * bytes. This disambiguation matters because aequitas-dapp.html's
 * registration flow passes an already-hashed "0x"+64-hex-char digest
 * (messageHash) through personal_sign expecting the latter — ethers'
 * Wallet.signMessage always treats a JS string as UTF-8 text unless told
 * otherwise, which would silently sign the wrong bytes for that case.
 */
export async function signMessage(message: string): Promise<string> {
  const wallet = await unlockWallet();
  const isHex = /^0x[0-9a-fA-F]+$/.test(message);
  return wallet.signMessage(isHex ? ethers.getBytes(message) : message);
}

export async function sendAEQ(to: string, amountWei: bigint): Promise<string> {
  const wallet = await unlockWallet();
  const tx = await wallet.sendTransaction({ to, value: amountWei });
  return tx.hash;
}

export async function getNativeBalance(address: string): Promise<bigint> {
  return getProvider().getBalance(address);
}
