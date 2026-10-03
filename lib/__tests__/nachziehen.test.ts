/**
 * Nachziehen: the ownership signature the app produces must be the one the
 * coordinator recovers (aequitas-biometric-beta/coordinator/app/nachziehen.py).
 *
 * The fixture below was produced on the Python side (eth_keys, private key
 * 0x11..11, nonce "nonce-1") and is pinned here byte for byte. Both sides use
 * deterministic (RFC 6979) ECDSA over the EIP-191 digest, so a matching
 * signature proves the message format and the digest agree -- if either side
 * ever changes the domain string, the prefix, or the address casing, this
 * test fails before a real person does.
 */
import { ethers } from 'ethers';

jest.mock('expo-crypto', () => ({ randomUUID: () => 'x' }));
jest.mock('expo-file-system/legacy', () => ({ deleteAsync: jest.fn() }), { virtual: true });
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock('../attestation', () => ({ getAttestationPayload: async () => null }));

const PRIV = '0x' + '11'.repeat(32);
const WALLET = '0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A';
const PY_MESSAGE = 'aequitas-nachziehen-v1|0x19e7e376e7c213b7e7e7e46cc70a5dd086daff2a|nonce-1';
const PY_SIGNATURE =
  '0xdb824d46b6e1a6b3edf884c922fd68d16131185a36d365ed14c7dc3269aae57050c1f84d37b40d3b100b41646625dfaae475e14a2f3b23f95f4f855c61da10941c';

describe('nachziehen ownership signature', () => {
  it('builds exactly the message the coordinator verifies (lower-case wallet)', () => {
    const { nachziehenMessage } = require('../biometricIdentity');
    expect(nachziehenMessage(WALLET, 'nonce-1')).toBe(PY_MESSAGE);
    expect(nachziehenMessage(`  ${WALLET.toUpperCase().replace('0X', '0x')} `, 'nonce-1')).toBe(PY_MESSAGE);
  });

  it('signs byte-identically to the Python fixture', async () => {
    const { nachziehenMessage } = require('../biometricIdentity');
    const wallet = new ethers.Wallet(PRIV);
    expect(wallet.address).toBe(WALLET);
    const sig = await wallet.signMessage(nachziehenMessage(WALLET, 'nonce-1'));
    expect(sig).toBe(PY_SIGNATURE);
    expect(ethers.verifyMessage(PY_MESSAGE, PY_SIGNATURE)).toBe(WALLET);
  });
});

describe('coordinator candidates', () => {
  // Pure function on purpose: EXPO_PUBLIC_* is inlined by babel-preset-expo at
  // transform time, so setting process.env inside a test changes nothing.
  it('lists the base first, then the fallbacks, without duplicates or trailing slashes', () => {
    const { coordinatorCandidatesFrom } = require('../biometricIdentity');
    expect(
      coordinatorCandidatesFrom('https://proof1.example/coordinator/', [
        ' https://proof2.example/coordinator ',
        'https://proof1.example/coordinator',
        '',
      ])
    ).toEqual(['https://proof1.example/coordinator', 'https://proof2.example/coordinator']);
  });

  it('is empty when nothing is configured', () => {
    const { coordinatorCandidatesFrom } = require('../biometricIdentity');
    expect(coordinatorCandidatesFrom('', [])).toEqual([]);
    expect(coordinatorCandidatesFrom(undefined, [' '])).toEqual([]);
  });
});

describe('nachziehenBiometric: was an den Coordinator geht', () => {
  const felder = (form: any): Record<string, unknown> => {
    // React Natives FormData kennt getParts(), das von Node entries().
    const teile: [string, unknown][] =
      typeof form.getParts === 'function'
        ? form.getParts().map((p: any) => [p.fieldName, p.string ?? p.uri])
        : Array.from(form.entries());
    return Object.fromEntries(teile);
  };

  it('schickt Einwilligung v3, Altersangabe und die Buergschafts-Anfrage', async () => {
    const bio = require('../biometricIdentity');
    bio._setCoordinatorCandidatesForTest(['http://coord.test']);
    let gesendet: Record<string, unknown> = {};
    const altFetch = global.fetch;
    global.fetch = jest.fn(async (_url: string, init: any) => {
      gesendet = felder(init.body);
      return { ok: true, json: async () => ({ decision: 'age_proof_required' }) };
    }) as any;
    try {
      await bio.nachziehenBiometric(
        { faceUri: 'file:///f.jpg', faceBurstUris: [], burstIntervalMs: 100, challengeNonce: 'nonce-1' },
        {
          deviceId: 'd',
          walletAddress: WALLET,
          signer: { signMessage: async () => '0xsig' },
          consent: {
            biometricConsent: true, bonusConsent: false, consentedAt: 1,
            alter: { geburtsjahr: 1990, geburtsmonat: 5, land: 'DE' },
            alterAnfrage: 'a'.repeat(32),
          },
        },
      );
    } finally {
      global.fetch = altFetch;
      bio._setCoordinatorCandidatesForTest(null);
    }
    expect(gesendet.consent_version).toBe('einwilligung-v3-2026-10-02');
    expect(gesendet.alter_anfrage).toBe('a'.repeat(32));
    expect(gesendet.geburtsjahr).toBe('1990');
    expect(gesendet.land).toBe('DE');
  });

  it('die Fassung ist dieselbe wie die Vorgabe von Coordinator und Vergleichsdiensten', () => {
    // aequitas-biometric-beta: CURRENT_CONSENT_VERSION in coordinator/app/einwilligung.py
    // und matching-service/app/config.py. Weicht sie ab, wird jede Aufnahme abgewiesen.
    expect(require('../biometricIdentity').CONSENT_VERSION).toBe('einwilligung-v3-2026-10-02');
  });
});
