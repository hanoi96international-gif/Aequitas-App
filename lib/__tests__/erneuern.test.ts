/**
 * WP 3, second liveness check: the ownership signature must be the one the
 * coordinator recovers (aequitas-biometric-beta/coordinator/app/erneuerung.py),
 * and the app must read the chain's answer to the attestation correctly.
 *
 * The fixture was produced on the Python side (eth_keys, private key 0x11..11,
 * nonce "nonce-1") and is pinned byte for byte -- deterministic RFC 6979 ECDSA
 * over the EIP-191 digest on both sides.
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
jest.mock('../api', () => ({ submitLivenessRenewal: jest.fn() }));

const PRIV = '0x' + '11'.repeat(32);
const WALLET = '0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A';
const PY_MESSAGE = 'aequitas-lebendigkeit-erneuern-v1|0x19e7e376e7c213b7e7e7e46cc70a5dd086daff2a|nonce-1';
const PY_SIGNATURE =
  '0x33600be989ad520fb1d7511ee0e646e876ffa2832d64dc9d346e4acb68ad0eb1467a0a74d849a0308ac24695595f77642fbaecf6c70eafc799178f316c268e691c';

describe('erneuern ownership signature', () => {
  it('builds exactly the message the coordinator verifies', () => {
    const { erneuernMessage } = require('../biometricIdentity');
    expect(erneuernMessage(` ${WALLET} `, 'nonce-1')).toBe(PY_MESSAGE);
  });

  it('signs byte-identically to the Python fixture', async () => {
    const { erneuernMessage } = require('../biometricIdentity');
    const sig = await new ethers.Wallet(PRIV).signMessage(erneuernMessage(WALLET, 'nonce-1'));
    expect(sig).toBe(PY_SIGNATURE);
  });

  it('is not interchangeable with the nachziehen signature', () => {
    const { erneuernMessage, nachziehenMessage } = require('../biometricIdentity');
    expect(erneuernMessage(WALLET, 'n')).not.toBe(nachziehenMessage(WALLET, 'n'));
  });
});

describe('chain answer to the renewal attestation', () => {
  const { ketteAntwortDeuten } = require('../biometricIdentity');

  it('accepted', () => {
    expect(ketteAntwortDeuten({ ok: true })).toEqual({ kette: 'angenommen' });
  });

  it('too early carries the date', () => {
    expect(ketteAntwortDeuten({ error: 'x', frueh_ab: 1_900_000_000 })).toEqual({
      kette: 'zu_frueh',
      frueh_ab: 1_900_000_000,
    });
  });

  it('anything else is a rejection with the reason', () => {
    expect(ketteAntwortDeuten({ error: 'no staged grant on this wallet' })).toEqual({
      kette: 'abgelehnt',
      kette_fehler: 'no staged grant on this wallet',
    });
    expect(ketteAntwortDeuten(null)).toEqual({ kette: 'abgelehnt', kette_fehler: null });
  });
});
