/**
 * #73 HOCH-2, zweiter Teil: auf dem Zwillingsweg bindet die
 * Geraete-Attestierung an genau die hochgeladene Aufnahme. Derselbe
 * Testvektor steht im Coordinator (coordinator/tests/test_attestierung_aufnahme.py).
 */
import { ethers } from 'ethers';
import { Platform } from 'react-native';

const plattform = { OS: 'android' as 'android' | 'ios' };
Object.defineProperty(Platform, 'OS', { get: () => plattform.OS, configurable: true });

jest.mock('@pagopa/io-react-native-integrity', () => ({
  isPlayServicesAvailable: jest.fn(async () => true),
  prepareIntegrityToken: jest.fn(async () => undefined),
  requestIntegrityToken: jest.fn(async (hash: string) => `token:${hash}`),
  generateHardwareKey: jest.fn(async () => 'key'),
  getAttestation: jest.fn(async (challenge: string) => `ios:${challenge}`),
}));

const at = require('../attestation');
const sha = (s: string) => ethers.sha256(ethers.toUtf8Bytes(s)).slice(2);

const VEKTOR_AUFNAHME = 'fa4fa7047678b9872a3ebbc105fe2d2f2fea6a0e3e78d4548a88b31868a7d9ad';
const VEKTOR_REQUEST_HASH = 'eb1a4ac55038b876c6ab07cdd21aad212862d01ab5b2cb479136787c6856660f';

describe('Bindung an die Aufnahme', () => {
  beforeEach(() => {
    plattform.OS = 'android';
    process.env.EXPO_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER = '123';
  });
  afterEach(() => { delete process.env.EXPO_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER; });

  it('rechnet denselben Testvektor wie der Coordinator', () => {
    const teile = [['face_image', sha('a')], ['face_burst', sha('b')], ['zwilling_bild', sha('c')], ['zwilling_video', sha('d')]] as const;
    expect(at.aufnahmeHashAus(teile)).toBe(VEKTOR_AUFNAHME);
    const gebunden = at.zwillingBindung('n0nce', VEKTOR_AUFNAHME);
    expect(gebunden).toBe(`aequitas-zwilling-aufnahme-v1|n0nce|${VEKTOR_AUFNAHME}`);
    expect(at.gebundenerHash(gebunden)).toBe(VEKTOR_REQUEST_HASH);
  });

  it('Android: requestHash ist der gebundene Hash, nicht der blosse Nonce-Hash', async () => {
    const gebunden = at.zwillingBindung('n0nce', VEKTOR_AUFNAHME);
    const mit = await at.getAttestationPayload('n0nce', 1000, gebunden);
    expect(mit).toEqual({ platform: 'android', token: `token:${VEKTOR_REQUEST_HASH}` });
    // Ohne Bindung (alle anderen Wege): wie bisher an den Nonce.
    const ohne = await at.getAttestationPayload('n0nce', 1000);
    expect(ohne).toEqual({ platform: 'android', token: `token:${at.attestierungsHash('n0nce')}` });
  });

  it('haengt mit Bindung genau das gebundene Token an', async () => {
    const felder: Array<[string, string]> = [];
    const form = { append: (k: string, v: string) => felder.push([k, v]) } as unknown as FormData;
    await at.attestierungAnhaengen(form, 'n0nce', at.zwillingBindung('n0nce', VEKTOR_AUFNAHME));
    expect(felder).toEqual([['attestation_platform', 'android'], ['attestation_token', `token:${VEKTOR_REQUEST_HASH}`]]);
  });

  it('iOS: die gebundene Zeichenkette ist die App-Attest-Challenge', async () => {
    plattform.OS = 'ios';
    const gebunden = at.zwillingBindung('n0nce', VEKTOR_AUFNAHME);
    expect(await at.getAttestationPayload('n0nce', 1000, gebunden)).toEqual({ platform: 'ios', token: `ios:${gebunden}`, keyId: 'key' });
    expect(await at.getAttestationPayload('n0nce', 1000)).toEqual({ platform: 'ios', token: 'ios:n0nce', keyId: 'key' });
  });
});
