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

jest.mock('expo-crypto', () => ({ randomUUID: () => 'x' }), { virtual: true });
jest.mock('expo-file-system/legacy', () => ({ deleteAsync: jest.fn() }), { virtual: true });
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}), { virtual: true });
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
