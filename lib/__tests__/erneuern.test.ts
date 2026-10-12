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

// Nicht virtuell fuer Module, die es gibt: ein virtueller Mock von
// expo-secure-store verbog im selben Jest-Prozess die Aufloesung fuer die
// naechste Testdatei (kettenschritt.test.ts bekam dann das echte Modul).
jest.mock('expo-crypto', () => ({ randomUUID: () => 'x' }));
jest.mock('expo-file-system/legacy', () => ({ deleteAsync: jest.fn() }), { virtual: true });
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
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

describe('chain answer: already renewed', () => {
  const { ketteAntwortDeuten } = require('../biometricIdentity');

  it('is its own outcome, not a fresh acceptance', () => {
    expect(ketteAntwortDeuten({ ok: true, schon_erneuert: true })).toEqual({ kette: 'schon_erneuert' });
  });
});

describe('day 7 as the chain counts it', () => {
  const { staffelErneuerungAb } = jest.requireActual('../api');
  const st = (w: Record<string, number>) => ({ rest_aeq: 800, laeuft: false, erneuert_am: 0, bis: 0, tagesrate_aeq: 1, ...w });

  it('takes erneuerung_ab when the node names it', () => {
    expect(staffelErneuerungAb(st({ bis: 2_000_000_000, erneuerung_ab: 1_999_000_000 }))).toBe(1_999_000_000);
  });

  it('otherwise bis minus 23 days (registration + 7 days)', () => {
    expect(staffelErneuerungAb(st({ bis: 2_000_000_000 }))).toBe(2_000_000_000 - 23 * 86400);
  });

  it('is 0 when unknown', () => {
    expect(staffelErneuerungAb(st({}))).toBe(0);
  });
});

describe('erneuernBiometric: what goes to the coordinator and the chain', () => {
  const felder = (form: any): Record<string, unknown> => {
    const teile: [string, unknown][] =
      typeof form.getParts === 'function'
        ? form.getParts().map((p: any) => [p.fieldName, p.string ?? p.uri])
        : Array.from(form.entries());
    return Object.fromEntries(teile);
  };

  it('sends the consent and no age fields; hands the attestation to the chain unchanged', async () => {
    const bio = require('../biometricIdentity');
    const api = require('../api');
    bio._setCoordinatorCandidatesForTest(['http://coord.test']);
    const erneuerung = { wallet: WALLET.toLowerCase(), issued_at: 1_900_000_000, signature: 'ab'.repeat(64), public_key: 'cd'.repeat(32) };
    api.submitLivenessRenewal.mockResolvedValue({ ok: true, wallet: WALLET.toLowerCase(), renewed_at: 1 });
    let url = '';
    let gesendet: Record<string, unknown> = {};
    const altFetch = global.fetch;
    global.fetch = jest.fn(async (u: string, init: any) => {
      url = u;
      gesendet = felder(init.body);
      return { ok: true, json: async () => ({ decision: 'bescheinigt', erneuerung }) };
    }) as any;
    let r: any;
    try {
      r = await bio.erneuernBiometric(
        { faceUri: 'file:///f.jpg', faceBurstUris: [], burstIntervalMs: 100, challengeNonce: 'nonce-1' },
        {
          deviceId: 'd',
          walletAddress: WALLET,
          signer: { signMessage: async () => '0xsig' },
          consent: { biometricConsent: true, bonusConsent: false, consentedAt: 7 },
        },
      );
    } finally {
      global.fetch = altFetch;
      bio._setCoordinatorCandidatesForTest(null);
    }
    expect(url).toBe('http://coord.test/erneuern');
    expect(gesendet.consent_version).toBe(bio.CONSENT_VERSION);
    expect(gesendet.consented_at).toBe('7');
    expect(gesendet.wallet_signature).toBe('0xsig');
    expect(gesendet.geburtsjahr).toBeUndefined();
    expect(api.submitLivenessRenewal).toHaveBeenCalledWith(erneuerung);
    expect(r.kette).toBe('angenommen');
  });

  it('without a challenge nonce nothing is sent', async () => {
    const bio = require('../biometricIdentity');
    bio._setCoordinatorCandidatesForTest(['http://coord.test']);
    const altFetch = global.fetch;
    global.fetch = jest.fn() as any;
    try {
      await expect(
        bio.erneuernBiometric(
          { faceUri: 'file:///f.jpg', faceBurstUris: [], burstIntervalMs: 100 },
          { deviceId: 'd', walletAddress: WALLET, signer: { signMessage: async () => '0xsig' } },
        ),
      ).rejects.toBeInstanceOf(bio.NachziehenNeedsChallenge);
      expect(global.fetch).not.toHaveBeenCalled();
    } finally {
      global.fetch = altFetch;
      bio._setCoordinatorCandidatesForTest(null);
    }
  });
});
