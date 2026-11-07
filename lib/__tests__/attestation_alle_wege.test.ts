/**
 * Geraetepruefung an die Aufnahme gebunden, auf allen Wegen (07.11.2026):
 * Registrierung, Nachziehen, Erneuern, Lebensnachweis. Derselbe Testvektor
 * steht im Coordinator (coordinator/tests/test_attestierung_aufnahme_alle_wege.py).
 *
 * Missbrauch, gegen den das hilft: ein echtes Telefon holt das Token zum
 * Nonce, ein eigener Client legt eingespeiste Bilder daneben. Mit Bindung gilt
 * das Token nur fuer genau die Bytes, die dieses Formular hochlaedt.
 */
import { ethers } from 'ethers';

jest.mock('expo-crypto', () => ({ randomUUID: () => 'x' }));
const inhalt: Record<string, Buffer> = {};
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
// Wie lib/attestation.ts: das Token traegt, woran es gebunden ist.
jest.mock('../attestation', () => ({
  ...jest.requireActual('../attestation'),
  attestierungAnhaengen: async (form: any, nonce?: string, bindung?: string) => {
    if ((global as any).__keineAttestierung) return false;
    form.append('attestation_platform', 'android');
    form.append('attestation_token', `token-fuer-${bindung ?? nonce}`);
    return true;
  },
}));
jest.mock('../api', () => ({ submitLivenessRenewal: jest.fn(), submitProofOfLife: jest.fn() }));

const at = jest.requireActual('../attestation');
const bio = require('../biometricIdentity');
// Dateien ueber die Testschnittstelle, nicht per jest.mock von
// expo-file-system/legacy: der griff bei kaltem Jest-Cache nicht immer.
bio._setDateiLeserFuerTest({
  info: async (uri: string) => (inhalt[uri] ? { exists: true, size: inhalt[uri].length } : { exists: false }),
  lesen: async (uri: string, von: number, laenge: number) => inhalt[uri].subarray(von, von + laenge).toString('base64'),
});
afterAll(() => bio._setDateiLeserFuerTest(null));

const VEKTOR_AUFNAHME = '3d5eb6fe56a52c3c85c5b2fb3dd66f07dc588704883ac0c0b77d8790dc990bc6';
const VEKTOR_REQUEST_HASH = '536c54a194afcf9bfa8f15a8767dff49cc93e3dff7920ffe39e8f19af40970c3';

class Formular {
  felder: Array<[string, unknown]> = [];
  append(k: string, v: unknown) { this.felder.push([k, v]); }
  get(k: string) { return this.felder.find(([n]) => n === k)?.[1]; }
}

function aufnahme() {
  inhalt['file:///face.jpg'] = Buffer.from('a');
  inhalt['file:///b0.jpg'] = Buffer.from('b');
  inhalt['file:///b1.jpg'] = Buffer.from('c');
  inhalt['file:///burst.mp4'] = Buffer.from('d');
  return {
    faceUri: 'file:///face.jpg', faceBurstUris: ['file:///b0.jpg', 'file:///b1.jpg'],
    faceBurstVideoUri: 'file:///burst.mp4', challengeNonce: 'n0nce',
  };
}

describe('Geraetepruefung an die Aufnahme gebunden', () => {
  afterEach(() => {
    delete (global as any).__keineAttestierung;
    for (const k of Object.keys(inhalt)) delete inhalt[k];
  });

  it('rechnet denselben Testvektor wie der Coordinator', () => {
    const dh = (s: string) => at.datenHash(ethers.toUtf8Bytes(s));
    const teile = [['face_image', dh('a')], ['face_burst', dh('b')], ['face_burst', dh('c')], ['face_burst_video', dh('d')]] as const;
    expect(at.aufnahmeHashAus(teile)).toBe(VEKTOR_AUFNAHME);
    const gebunden = at.aufnahmeBindung('n0nce', VEKTOR_AUFNAHME);
    expect(gebunden).toBe(`aequitas-aufnahme-v1|n0nce|${VEKTOR_AUFNAHME}`);
    expect(at.gebundenerHash(gebunden)).toBe(VEKTOR_REQUEST_HASH);
    // Eigener Praefix: ein Token des Zwillingswegs gilt hier nie.
    expect(gebunden).not.toBe(at.zwillingBindung('n0nce', VEKTOR_AUFNAHME));
  });

  it('bindet an genau die Dateien, die das Formular hochlaedt, und meldet es', async () => {
    const f = new Formular();
    await bio.geraetepruefungAnhaengen(f, aufnahme());
    expect(f.get('attestation_token')).toBe(`token-fuer-aequitas-aufnahme-v1|n0nce|${VEKTOR_AUFNAHME}`);
    expect(f.get('attestierung_bindung')).toBe('aufnahme-v1');
  });

  it('ein anderes Bild ergibt eine andere Bindung', async () => {
    const c = aufnahme();
    inhalt['file:///face.jpg'] = Buffer.from('deepfake');
    const f = new Formular();
    await bio.geraetepruefungAnhaengen(f, c);
    expect(f.get('attestation_token')).not.toBe(`token-fuer-aequitas-aufnahme-v1|n0nce|${VEKTOR_AUFNAHME}`);
  });

  it('Datei nicht lesbar: Pruefung wie bisher am Nonce, ohne die Bindung zu behaupten', async () => {
    const c = aufnahme();
    delete inhalt['file:///b1.jpg'];
    const f = new Formular();
    await bio.geraetepruefungAnhaengen(f, c);
    expect(f.get('attestation_token')).toBe('token-fuer-n0nce');
    expect(f.get('attestierung_bindung')).toBeUndefined();
  });

  it('ohne Pruefung keine Behauptung der Bindung', async () => {
    (global as any).__keineAttestierung = true;
    const f = new Formular();
    await bio.geraetepruefungAnhaengen(f, aufnahme());
    expect(f.felder).toEqual([]);
  });

  it('ohne Nonce nichts', async () => {
    const f = new Formular();
    await bio.geraetepruefungAnhaengen(f, { ...aufnahme(), challengeNonce: null });
    expect(f.felder).toEqual([]);
  });

  it('alle fuenf Wege nutzen die gebundene Pruefung (mit dem Umzug)', () => {
    const fs = require('fs');
    const quelle: string = fs.readFileSync(require.resolve('../biometricIdentity.ts'), 'utf8');
    expect(quelle.match(/await geraetepruefungAnhaengen\(form, capture\);/g)).toHaveLength(5);
    // Der blosse Nonce-Weg bleibt nur im Zwillingsweg (dort mit eigener Bindung).
    expect(quelle.match(/await attestierungAnhaengen\(/g)).toHaveLength(2);
  });
});
