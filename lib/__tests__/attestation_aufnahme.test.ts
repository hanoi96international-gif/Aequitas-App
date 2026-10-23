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
const sha256Hex = (b: Uint8Array) => ethers.sha256(b).slice(2);

const VEKTOR_AUFNAHME = '000bc474adb1d265fb1ccc638547123d1376979f1fe4aff351f96a893d92486b';
const VEKTOR_REQUEST_HASH = 'dd2748b84f18493eb649acbacf4a399fddadb2073dbe572504cac631dadbb112';
// Ueber mehrere Bloecke: bytes(range(256)) * 12295 = 3.147.520 Byte.
const VEKTOR_GROSS_HASH = '721656139dc2d9749502311edf357483f72cefcc783fea95c0e0f1a5e36e32ac';
const LEER_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const gross = () => { const b = new Uint8Array(256 * 12295); for (let i = 0; i < b.length; i++) b[i] = i % 256; return b; };
const dh = (s: string) => at.datenHash(ethers.toUtf8Bytes(s));

describe('Bindung an die Aufnahme', () => {
  beforeEach(() => {
    plattform.OS = 'android';
    process.env.EXPO_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER = '123';
  });
  afterEach(() => { delete process.env.EXPO_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER; });

  it('rechnet denselben Testvektor wie der Coordinator', () => {
    const teile = [['face_image', dh('a')], ['face_burst', dh('b')], ['zwilling_bild', dh('c')], ['zwilling_video', dh('d')]] as const;
    expect(at.aufnahmeHashAus(teile)).toBe(VEKTOR_AUFNAHME);
    expect(at.datenHash(gross())).toBe(VEKTOR_GROSS_HASH);
    expect(at.datenHash(new Uint8Array(0))).toBe(LEER_HASH);
    // Blockweise, nicht SHA-256 der ganzen Datei.
    expect(at.datenHash(gross())).not.toBe(sha256Hex(gross()));
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
