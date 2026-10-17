jest.mock('expo-secure-store', () => ({
  canUseBiometricAuthentication: jest.fn(() => false),
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
}));

// wallet.ts gained ensureDeviceAuthentication() as a supplementary gate for
// the case where SecureStore's own biometric prompt is unavailable -- which
// is exactly the case the mock above sets up (canUseBiometricAuthentication
// returns false), so every test here runs through it. Unmocked, the real
// module has no native backing under Jest: getEnrolledLevelAsync() resolves
// to undefined, which does not equal SecurityLevel.NONE, so the gate keeps
// going and authenticateAsync() -- also undefined -- is dereferenced for
// .success. That is what failed five tests, in wallet.ts rather than in
// anything they assert.
//
// Enrolled + successful is the right default: it is the path where the gate
// lets the caller through, leaving each test to exercise the key handling it
// was written for. A test that wants the refusal can override authenticateAsync.
jest.mock('expo-local-authentication', () => ({
  getEnrolledLevelAsync: jest.fn(async () => 2),
  authenticateAsync: jest.fn(async () => ({ success: true })),
  SecurityLevel: { NONE: 0, SECRET: 1, BIOMETRIC_WEAK: 2, BIOMETRIC_STRONG: 3 },
}));

import * as SecureStore from 'expo-secure-store';
import { generateMnemonic, importWallet, signMessage, unlockWallet, lockWallet } from '../wallet';

describe('generateMnemonic', () => {
  it('produces a 12-word BIP39 mnemonic', () => {
    const mnemonic = generateMnemonic();
    expect(mnemonic.trim().split(/\s+/)).toHaveLength(12);
  });

  it('produces a different mnemonic on each call', () => {
    expect(generateMnemonic()).not.toBe(generateMnemonic());
  });
});

describe('importWallet', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('recognizes a 12-word phrase as a mnemonic and derives the matching address', async () => {
    const mnemonic = generateMnemonic();
    const { address } = await importWallet(mnemonic);
    expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(SecureStore.setItemAsync).toHaveBeenCalled();
  });

  it('recognizes a 0x-prefixed hex string as a raw private key, not a mnemonic', async () => {
    // A syntactically valid 32-byte private key that is NOT 12+ words.
    const privateKey = '0x' + '11'.repeat(32);
    const { address } = await importWallet(privateKey);
    expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it('recognizes a bare (no 0x prefix) hex private key the same way', async () => {
    const withPrefix = await importWallet('0x' + '22'.repeat(32));
    const withoutPrefix = await importWallet('22'.repeat(32));
    expect(withoutPrefix.address).toBe(withPrefix.address);
  });

  it('rejects fewer than 12 space-separated words as neither a valid mnemonic nor a valid key', async () => {
    await expect(importWallet('only three words')).rejects.toThrow();
  });
});

describe('signMessage', () => {
  const PRIVATE_KEY = '0x' + '33'.repeat(32);

  beforeEach(async () => {
    jest.clearAllMocks();
    lockWallet();
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(PRIVATE_KEY);
    await unlockWallet();
  });

  it('signs a plain-text message as UTF-8 (personal_sign semantics)', async () => {
    const sig1 = await signMessage('hello');
    // Re-signing the identical plain-text message must reproduce the exact
    // same signature (deterministic ECDSA) -- a cheap way to confirm the
    // UTF-8 encoding path is stable rather than e.g. accidentally hex
    // -interpreting an ASCII string that happens to contain only hex chars.
    const sig2 = await signMessage('hello');
    expect(sig1).toBe(sig2);
    expect(sig1).toMatch(/^0x[0-9a-fA-F]+$/);
  });

  it('signs an already-hex message as raw bytes, not as its UTF-8 text', async () => {
    const hexMessage = '0x' + 'ab'.repeat(32);
    const hexSig = await signMessage(hexMessage);
    // If the hex/utf8 disambiguation broke and this string were signed as
    // literal UTF-8 text instead of decoded to 32 raw bytes, the resulting
    // signature would differ from signing the actual byte value directly.
    const plainTextSig = await signMessage('some unrelated plain text');
    expect(hexSig).not.toBe(plainTextSig);
    expect(hexSig).toMatch(/^0x[0-9a-fA-F]+$/);
  });
});

describe('walletLink', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { walletLink } = require('../walletconnect');
  it('takes the wallet app scheme from the session', () => {
    expect(walletLink({ peer: { metadata: { redirect: { native: 'metamask://' } } } })).toBe('metamask://');
  });
  it('refuses web links and other schemes that are not an app jump', () => {
    for (const n of ['https://evil.example', 'http://x', 'javascript:alert(1)', 'intent://x', 'data:text/html,x', '', 'kein-link', 'a'.repeat(300) + '://']) {
      expect(walletLink({ peer: { metadata: { redirect: { native: n } } } })).toBeNull();
    }
    expect(walletLink(undefined)).toBeNull();
    expect(walletLink({ peer: {} })).toBeNull();
  });
});

// Chain-ID-Wechsel 1926 -> 19260930: gesendet wird nur mit der live
// gemeldeten ID (lib/ketteLive.ts), nie ueber einen Provider mit fester ID.
describe('sendeUeberweisung (Chain-ID live)', () => {
  // Ohne RPC-Ersatzadressen: mit ihnen ist der Provider ein FallbackProvider,
  // dessen getNetwork() die echten Knoten nach ihrer Chain-ID fragt -- der
  // Test hinge dann am Netz (im APK-Build sind EXPO_PUBLIC_RPC_FALLBACKS
  // gesetzt: Zeitueberschreitung bzw. "no runners"). Geprueft wird hier nur,
  // mit welcher ID signiert wird.
  let sendeUeberweisung: typeof import('../wallet').sendeUeberweisung;
  jest.isolateModules(() => {
    jest.doMock('../config', () => ({ ...jest.requireActual('../config'), RPC_FALLBACKS: [] }));
    ({ sendeUeberweisung } = require('../wallet'));
  });
  const ZIEL = '0x' + '22'.repeat(20);
  function schluessel() {
    const gesendet: any[] = [];
    const verbunden: any[] = [];
    const s: any = {
      connect: jest.fn((p: any) => {
        verbunden.push(p);
        return { sendTransaction: jest.fn(async (tx: any) => { gesendet.push(tx); return { hash: '0xabc' }; }) };
      }),
    };
    return { s, gesendet, verbunden };
  }

  it('signiert mit der ID, die der Knoten meldet -- vor und nach dem Stichtag', async () => {
    for (const cid of [1926, 19260930]) {
      const { s, gesendet, verbunden } = schluessel();
      await expect(sendeUeberweisung(s, ZIEL, 5n, async () => cid)).resolves.toBe('0xabc');
      expect(gesendet[0]).toEqual({ to: ZIEL, value: 5n, chainId: BigInt(cid) });
      expect((await verbunden[0].getNetwork()).chainId).toBe(BigInt(cid));
    }
  });

  it('Knoten unerreichbar oder fremde ID: nichts wird signiert', async () => {
    for (const lesen of [async () => { throw new Error('Aequitas-Netz nicht bestätigt'); }, async () => 1, async () => 1927, async () => NaN]) {
      const { s, gesendet } = schluessel();
      await expect(sendeUeberweisung(s, ZIEL, 5n, lesen)).rejects.toThrow();
      expect(s.connect).not.toHaveBeenCalled();
      expect(gesendet).toHaveLength(0);
    }
  });

  it('ein entsperrter Schluessel haengt an keinem Provider (kein Senden an der Live-Pruefung vorbei)', async () => {
    const pk = '0x' + '33'.repeat(32);
    await importWallet(pk);
    const w = await unlockWallet();
    expect(w.provider).toBeNull();
    await expect(w.sendTransaction({ to: ZIEL, value: 1n })).rejects.toThrow();
    lockWallet();
  });
});
