// Audit B2: PQ-Schluessel eines Pruefer-Dienstes eintragen (lib/dienstPQ.ts).
// Saetze byte-gleich mit der Kette (pruefer_dienst_pq_test.go); Missbrauch:
// Besitznachweis fuer einen anderen Menschen, fremde Wallet, kein PQ,
// uebergrosse Antwort, fremde Zusage, keine Zusage, kein Tresor, Ablehnung.
jest.mock('expo-secure-store', () => ({
  canUseBiometricAuthentication: () => false,
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  setItemAsync: jest.fn(async () => undefined),
  getItemAsync: jest.fn(async () => null),
  deleteItemAsync: jest.fn(async () => undefined),
}));
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { ethers } from 'ethers';
import { API_BASE } from '../config';
import { dienstBesitzNachricht, dienstFreigabeNachricht, dienstPQEintragen } from '../dienstPQ';

const W = '0xabcdef0123456789abcdef0123456789abcdef01';
const ED = 'cd'.repeat(32);
const URL = 'https://proof1.aequitas.digital/coordinator';
const MENSCH_SEED = new Uint8Array(32).fill(0x11);
const mensch = ml_dsa65.keygen(MENSCH_SEED);
const ZUSAGE = ethers.sha256(mensch.publicKey).slice(2);
const dienst = ml_dsa65.keygen(new Uint8Array(32).fill(0x42));
const hex = (b: Uint8Array) => ethers.hexlify(b).slice(2);
const besitz = (fuer = W) => hex(ml_dsa65.sign(ethers.toUtf8Bytes(dienstBesitzNachricht(fuer, ED)), dienst.secretKey));

function antwort(status: number, body: unknown) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text) } as unknown as Response;
}

function netz(nachweis: any, knoten = antwort(200, { ok: true, ed: ED, wirkt_ab: 1800003600 })) {
  return jest.fn(async (ziel: string) => {
    if (ziel.startsWith(`${URL}/besitznachweis`)) return typeof nachweis === 'function' ? nachweis() : antwort(200, nachweis);
    if (ziel === `${API_BASE}/verifier/dienst-pq`) return knoten;
    throw new Error('unerwartet: ' + ziel);
  });
}

const gut = () => ({ public_key: ED, key_signature: 'ab'.repeat(64), human_wallet: W, pq_public_key: hex(dienst.publicKey), pq_besitz_sig: besitz() });
const opts = { seed: MENSCH_SEED, zusageHash: ZUSAGE, jetztS: () => 1800000000 };

describe('Saetze wie die Kette', () => {
  it('Besitz und Freigabe', () => {
    expect(dienstBesitzNachricht(' 0xAbCdEf0123456789aBcDeF0123456789AbCdEf01 ', ED.toUpperCase())).toBe(
      `aequitas-pruefer-dienst-besitz-v1|chain:1926|${W}|${ED}`,
    );
    expect(dienstFreigabeNachricht(W, ED, 'e'.repeat(64), 1800000000)).toBe(
      `aequitas-pruefer-dienst-pq-v1|chain:1926|${W}|${ED}|${'e'.repeat(64)}|1800000000`,
    );
  });
});

describe('dienstPQEintragen', () => {
  it('prueft den Besitz, gibt mit dem Tresor-Schluessel frei und reicht ein', async () => {
    const f = netz(gut());
    const r = await dienstPQEintragen(W, URL, f as any, opts);
    expect(r).toEqual({ ok: true, ed: ED, wirktAb: 1800003600 });
    const body = JSON.parse((f.mock.calls.find((c) => c[0] === `${API_BASE}/verifier/dienst-pq`) as any)[1].body);
    expect(body).toMatchObject({ mensch: W, zeit: 1800000000, ed: ED, pub: hex(dienst.publicKey), mensch_pub: hex(mensch.publicKey) });
    const pubHash = ethers.sha256(dienst.publicKey).slice(2);
    expect(
      ml_dsa65.verify(ethers.getBytes('0x' + body.mensch_sig), ethers.toUtf8Bytes(dienstFreigabeNachricht(W, ED, pubHash, 1800000000)), mensch.publicKey),
    ).toBe(true);
  });

  it.each([
    ['Besitznachweis fuer einen anderen Menschen', { ...gut(), pq_besitz_sig: besitz('0x' + '1'.repeat(40)) }, 'besitz_ungueltig'],
    ['Antwort fuer eine andere Wallet', { ...gut(), human_wallet: '0x' + '2'.repeat(40) }, 'andere_wallet'],
    ['Dienst ohne ML-DSA-Schluessel', { public_key: ED, key_signature: 'ab'.repeat(64), human_wallet: W }, 'kein_pq'],
    ['Schluessel in falscher Form', { ...gut(), pq_public_key: 'ab'.repeat(10) }, 'antwort_ungueltig'],
    ['uebergrosse Antwort', 'x'.repeat(20000), 'antwort_ungueltig'],
  ])('%s: nichts eingereicht', async (_, nachweis, fehler) => {
    const f = netz(nachweis);
    const r = await dienstPQEintragen(W, URL, f as any, opts);
    expect(r.ok).toBe(false);
    expect(r.fehler).toBe(fehler);
    expect(f.mock.calls.some((c) => c[0] === `${API_BASE}/verifier/dienst-pq`)).toBe(false);
  });

  it('fremde Zusage, keine Zusage, kein Tresor: nichts eingereicht', async () => {
    for (const [o, fehler] of [
      [{ ...opts, zusageHash: 'ab'.repeat(32) }, 'andere_zusage'],
      [{ ...opts, zusageHash: '' }, 'keine_zusage'],
      [{ ...opts, seed: undefined }, 'kein_tresor'],
    ] as const) {
      const f = netz(gut());
      const r = await dienstPQEintragen(W, URL, f as any, o as any);
      expect(r.fehler).toBe(fehler);
      expect(f.mock.calls.some((c) => c[0] === `${API_BASE}/verifier/dienst-pq`)).toBe(false);
    }
  });

  it('Ablehnung der Kette kommt durch', async () => {
    const f = netz(gut(), antwort(409, { error: 'rejected: pruefer_pq_kein_pruefer: kein Pruefer' }));
    const r = await dienstPQEintragen(W, URL, f as any, opts);
    expect(r).toMatchObject({ ok: false, fehler: 'abgelehnt' });
    expect(r.meldung).toContain('pruefer_pq_kein_pruefer');
  });

  it('unsichere Adresse wird gar nicht gefragt', async () => {
    const f = netz(gut());
    expect((await dienstPQEintragen(W, 'http://example.com', f as any, opts)).fehler).toBe('adresse');
    expect(f).not.toHaveBeenCalled();
  });
});
