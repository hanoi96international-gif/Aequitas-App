/**
 * GERAETEPRUEFUNG: an den Server-Nonce gebunden, mit Frist.
 *
 * Bis 1.11.0 rief Android requestIntegrityToken() ohne requestHash (ein
 * erbeutetes Token galt fuer beliebig viele Anmeldungen), iOS wuerfelte die
 * App-Attest-Challenge lokal und schickte keinen keyId (jede echte
 * iOS-Attestierung war beim Coordinator "invalid"), und ein haengender
 * Play-Services-Aufruf hielt die Anmeldung unbegrenzt auf.
 *
 * Format (gleich im Coordinator, coordinator/app/attestation.py):
 *   requestHash = sha256_hex("aequitas-geraetepruefung-v1|" + challenge_nonce)
 */
import { ethers } from 'ethers';
import { Platform } from 'react-native';

const plattform = { OS: 'android' as 'android' | 'ios' };
Object.defineProperty(Platform, 'OS', { get: () => plattform.OS, configurable: true });

jest.mock('@pagopa/io-react-native-integrity', () => ({
  isPlayServicesAvailable: jest.fn(async () => true),
  prepareIntegrityToken: jest.fn(async (_p: string) => undefined),
  requestIntegrityToken: jest.fn(async (_h?: string) => 'android-token'),
  generateHardwareKey: jest.fn(async () => 'S0VZSUQ='),
  getAttestation: jest.fn(async (_c: string, _k: string) => 'ios-attestierung'),
}));
const integritaet = jest.requireMock('@pagopa/io-react-native-integrity') as Record<string, jest.Mock>;

import {
  attestierungsHash,
  attestierungAnhaengen,
  getAttestationPayload,
  ATTESTIERUNG_FRIST_MS,
} from '../attestation';

const NONCE = 'nonce-vom-coordinator-123';

class Formular {
  felder: [string, string][] = [];
  append(k: string, v: string) { this.felder.push([k, v]); }
}

beforeEach(() => {
  jest.clearAllMocks();
  plattform.OS = 'android';
  process.env.EXPO_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER = '123456789012';
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  jest.useRealTimers();
  delete process.env.EXPO_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER;
});

describe('requestHash', () => {
  it('ist SHA-256 ueber Domain|Nonce, 64 Zeichen Hex klein, ohne 0x', () => {
    // Pruefvektor -- derselbe steht in coordinator/tests/test_attestierung_bindung.py.
    expect(attestierungsHash('abc')).toBe(
      '4b13ee1467554cad1ac0df0cd6648cfa760a9db6552709472d83e66f6b715ec6'
    );
    expect(attestierungsHash(NONCE)).toBe(
      ethers.sha256(ethers.toUtf8Bytes(`aequitas-geraetepruefung-v1|${NONCE}`)).slice(2)
    );
    expect(attestierungsHash(NONCE)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('haengt am Nonce: ein anderer Nonce gibt einen anderen Hash', () => {
    expect(attestierungsHash('a')).not.toBe(attestierungsHash('b'));
  });
});

describe('Android', () => {
  it('fordert das Token mit dem Hash des Server-Nonce an', async () => {
    const p = await getAttestationPayload(NONCE);
    expect(p).toEqual({ platform: 'android', token: 'android-token' });
    expect(integritaet.prepareIntegrityToken).toHaveBeenCalledWith('123456789012');
    expect(integritaet.requestIntegrityToken).toHaveBeenCalledWith(attestierungsHash(NONCE));
  });

  it('ohne Projektnummer: nichts', async () => {
    delete process.env.EXPO_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER;
    expect(await getAttestationPayload(NONCE)).toBeNull();
    expect(integritaet.requestIntegrityToken).not.toHaveBeenCalled();
  });

  it('ohne Nonce: nichts -- ein ungebundenes Token wird nie angefordert', async () => {
    expect(await getAttestationPayload(undefined)).toBeNull();
    expect(await getAttestationPayload('')).toBeNull();
    expect(integritaet.prepareIntegrityToken).not.toHaveBeenCalled();
    expect(integritaet.requestIntegrityToken).not.toHaveBeenCalled();
  });

  it('ein Fehler der Play Services wird zu "nichts", nie zu einem Abbruch', async () => {
    integritaet.requestIntegrityToken.mockRejectedValueOnce(new Error('REQUEST_TOKEN_FAILED'));
    expect(await getAttestationPayload(NONCE)).toBeNull();
  });
});

describe('iOS', () => {
  beforeEach(() => { plattform.OS = 'ios'; });

  it('nutzt den Server-Nonce als App-Attest-Challenge und liefert den keyId', async () => {
    const p = await getAttestationPayload(NONCE);
    expect(p).toEqual({ platform: 'ios', token: 'ios-attestierung', keyId: 'S0VZSUQ=' });
    expect(integritaet.getAttestation).toHaveBeenCalledWith(NONCE, 'S0VZSUQ=');
  });

  it('schickt keyId und Token ins Formular', async () => {
    const f = new Formular();
    await attestierungAnhaengen(f as unknown as FormData, NONCE);
    expect(f.felder).toEqual([
      ['attestation_platform', 'ios'],
      ['attestation_token', 'ios-attestierung'],
      ['attestation_key_id', 'S0VZSUQ='],
    ]);
  });
});

describe('Frist', () => {
  it('haengt die Play-Services-Vorbereitung, geht es nach der Frist ohne Attestierung weiter', async () => {
    jest.useFakeTimers();
    integritaet.prepareIntegrityToken.mockImplementationOnce(() => new Promise(() => {}));
    const f = new Formular();
    const fertig = attestierungAnhaengen(f as unknown as FormData, NONCE);
    await jest.advanceTimersByTimeAsync(ATTESTIERUNG_FRIST_MS - 1);
    let erledigt = false;
    fertig.then(() => { erledigt = true; });
    await Promise.resolve();
    expect(erledigt).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await fertig;
    expect(f.felder).toEqual([]);
    expect(integritaet.requestIntegrityToken).not.toHaveBeenCalled();
  });

  it('haengt die Token-Anforderung, gilt dieselbe Frist', async () => {
    jest.useFakeTimers();
    integritaet.requestIntegrityToken.mockImplementationOnce(() => new Promise(() => {}));
    const p = getAttestationPayload(NONCE);
    await jest.advanceTimersByTimeAsync(ATTESTIERUNG_FRIST_MS);
    expect(await p).toBeNull();
  });

  it('haengt App Attest, gilt sie auch auf iOS', async () => {
    jest.useFakeTimers();
    plattform.OS = 'ios';
    integritaet.getAttestation.mockImplementationOnce(() => new Promise(() => {}));
    const p = getAttestationPayload(NONCE);
    await jest.advanceTimersByTimeAsync(ATTESTIERUNG_FRIST_MS);
    expect(await p).toBeNull();
  });

  it('die Frist liegt bei 15 Sekunden', () => {
    expect(ATTESTIERUNG_FRIST_MS).toBe(15_000);
  });
});

describe('registerBiometric', () => {
  afterEach(() => { jest.resetModules(); (global as any).fetch = undefined; });

  it('schickt challenge_nonce, Token und keyId in derselben Anfrage', async () => {
    plattform.OS = 'ios';
    const gesendet: Record<string, string>[] = [];
    (global as any).fetch = jest.fn(async (url: string, init?: any) => {
      if (url.endsWith('/challenge')) {
        return { ok: true, status: 200, json: async () => ({ nonce: NONCE, challenge_type: 'look_left', flash_sequence: '' }) } as any;
      }
      if (url.endsWith('/register')) {
        const felder: Record<string, string> = {};
        const body = init.body as any;
        const paare: [string, unknown][] = typeof body.entries === 'function' ? [...body.entries()] : body._parts ?? [];
        for (const [k, v] of paare) felder[k] = typeof v === 'string' ? v : '[datei]';
        gesendet.push(felder);
      }
      return { ok: true, status: 200, json: async () => ({ decision: 'ok' }) } as any;
    });
    jest.doMock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn() }));
    jest.doMock('expo-file-system', () => ({ deleteAsync: jest.fn(async () => undefined) }));
    let attestAufrufe: unknown[][] = [];
    await jest.isolateModulesAsync(async () => {
      const bio = require('../biometricIdentity');
      bio._setCoordinatorCandidatesForTest(['https://c.example']);
      expect((await bio.requestChallenge())?.nonce).toBe(NONCE);
      await bio.registerBiometric(
        { faceUri: 'file:///f.jpg', faceBurstUris: [], challengeNonce: NONCE, burstIntervalMs: 100 } as any,
        { deviceId: 'd1' },
      );
      attestAufrufe = require('@pagopa/io-react-native-integrity').getAttestation.mock.calls;
    });
    expect(gesendet).toHaveLength(1);
    expect(gesendet[0]).toMatchObject({
      challenge_nonce: NONCE,
      attestation_platform: 'ios',
      attestation_token: 'ios-attestierung',
      attestation_key_id: 'S0VZSUQ=',
    });
    expect(attestAufrufe).toEqual([[NONCE, 'S0VZSUQ=']]);
  });
});
