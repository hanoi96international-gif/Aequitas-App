// Tresor (lib/tresor.ts): Adresse und Satz byte-gleich mit der Kette
// (pq_ueberweisung_test.go), Senden mit genau dem, was die Kette prueft, und
// die Missbrauchsfaelle: fremde Phrase, falsche Adresse, Betrag ausser Bereich,
// an sich selbst, Fehlantwort.
jest.mock('expo-secure-store', () => {
  const m = new Map<string, string>();
  return {
    canUseBiometricAuthentication: () => false,
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
    setItemAsync: jest.fn(async (k: string, v: string) => void m.set(k, v)),
    getItemAsync: jest.fn(async (k: string) => m.get(k) ?? null),
    deleteItemAsync: jest.fn(async (k: string) => void m.delete(k)),
  };
});
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { ethers } from 'ethers';
import {
  ausTresorSenden,
  tresorAdresse,
  tresorAdresseAusSchluessel,
  tresorEinrichten,
  tresorNachricht,
  tresorSchluessel,
  tresorStand,
  tresorTxHash,
} from '../tresor';

const SEED = new Uint8Array(32).fill(0x11);
const ADRESSE = '0x6b2b299810ed00feb61d8a1cc5b91b5caa93926b';
const PHRASE = 'test test test test test test test test test test test junk';
const WALLET = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
const AN = '0x00000000000000000000000000000000000000b2';

function antwort(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as any;
}

describe('wie die Kette', () => {
  it('Adresse zu Seed 0x11*32 (Go und Python rechnen dieselbe)', () => {
    expect(tresorAdresseAusSchluessel(tresorSchluessel(SEED).publicKey)).toBe(ADRESSE);
  });
  it('Satz wie pqUeberweisungNachricht', () => {
    expect(tresorNachricht('0xA', '0xB', '5', '7')).toBe('aequitas-pq-ueberweisung-v1|chain:1926|0xa|0xb|5|7');
  });
  it('Unterschrift wie im Pruefvektor des Knotens (deterministisch)', () => {
    const text = tresorNachricht(ADRESSE, AN, '1000000000000000000', '0');
    const sig = ml_dsa65.sign(ethers.toUtf8Bytes(text), tresorSchluessel(SEED).secretKey, { extraEntropy: false });
    expect(ethers.hexlify(sig).slice(2, 66)).toBe('6df4adaca42e6f0f8eaeb1a8f5e69cafa0f3b6ec379c2a2d0ca4d015f569e78a');
  });
});

describe('Senden', () => {
  it('schickt genau, was die Kette prueft', async () => {
    const f = jest.fn(async (url: string) =>
      url.includes('/pq/stand') ? antwort(200, { ueberweisung_ab: 1794938400, nonce: '3', guthaben: 50 }) : antwort(200, { ok: true }),
    );
    const r = await ausTresorSenden(AN, 2n * 10n ** 18n, { seed: SEED, fetchFn: f as any });
    expect(r.ok).toBe(true);
    const [, init] = (f as jest.Mock).mock.calls[1];
    const b = JSON.parse(init.body);
    expect(b.von).toBe(ADRESSE);
    expect(b.an).toBe(AN);
    expect(b.wei).toBe('2000000000000000000');
    expect(b.nonce).toBe(3);
    const text = tresorNachricht(ADRESSE, AN, b.wei, '3');
    expect(ml_dsa65.verify(ethers.getBytes('0x' + b.sig), ethers.toUtf8Bytes(text), ethers.getBytes('0x' + b.pub))).toBe(true);
    expect(r.txHash).toBe(tresorTxHash(text));
  });
  it('Unsinn wird nicht gesendet', async () => {
    const f = jest.fn();
    expect((await ausTresorSenden('0x123', 1n, { seed: SEED, fetchFn: f as any })).meldung).toBe('adresse');
    expect((await ausTresorSenden(AN, 0n, { seed: SEED, fetchFn: f as any })).meldung).toBe('betrag');
    expect((await ausTresorSenden(AN, 10n ** 30n + 1n, { seed: SEED, fetchFn: f as any })).meldung).toBe('betrag');
    expect((await ausTresorSenden(ADRESSE, 1n, { seed: SEED, fetchFn: f as any })).meldung).toBe('selbst');
    expect(f).not.toHaveBeenCalled();
  });
  it('Ablehnung der Kette kommt an', async () => {
    const f = jest.fn(async (url: string) =>
      url.includes('/pq/stand') ? antwort(200, { ueberweisung_ab: 1, nonce: '0', guthaben: 1 }) : antwort(409, { error: 'transfer failed: insufficient balance' }),
    );
    const r = await ausTresorSenden(AN, 10n ** 18n, { seed: SEED, fetchFn: f as any });
    expect(r).toEqual({ ok: false, meldung: 'transfer failed: insufficient balance' });
  });
  it('Stand: Unsinn wird zu Null', async () => {
    expect(await tresorStand(ADRESSE, (async () => antwort(200, { ueberweisung_ab: -5, nonce: '01', guthaben: -1 })) as any)).toEqual({
      ab: 0,
      nonce: '0',
      guthaben: 0,
    });
    expect(await tresorStand('kaputt', jest.fn() as any)).toBeNull();
  });
});

describe('Einrichten', () => {
  it('nur mit der Phrase genau dieser Wallet', async () => {
    expect(await tresorEinrichten(PHRASE, '0x00000000000000000000000000000000000000a1')).toBeNull();
    expect(await tresorEinrichten('unsinn', WALLET)).toBeNull();
    expect(await tresorAdresse(WALLET)).toBeNull();
    const a = await tresorEinrichten(PHRASE, WALLET);
    expect(a).toMatch(/^0x[0-9a-f]{40}$/);
    expect(await tresorAdresse(WALLET)).toBe(a);
  });
});
