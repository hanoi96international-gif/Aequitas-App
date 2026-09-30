import { ethers } from 'ethers';
import {
  FRIST_S,
  MAX_FRIST_S,
  netzSalt,
  registerV8Digest,
  registerV8Frist,
  registerV8Nachricht,
  registerV8Signatur,
  registerV8TypedData,
  registerVertrag,
} from '../registerV8';

// Gemeinsamer Pruefvektor mit Go (Aequitas: TestV8_GoldenVektorMitDerApp in
// x/humanity/keeper/vertrag_v8_test.go). Aendert sich hier ein Wert, muss er
// sich dort genauso aendern -- sonst unterschreibt die App etwas, das die
// Kette ablehnt.
const KENNUNG = 'aequitas-1926-1790000000';
const ALICE = new ethers.Wallet('0x' + '11'.repeat(32));
const MALLORY = new ethers.Wallet('0x' + '22'.repeat(32));
const SIGNALE = ['1001', '2001'];
const FRIST = 1_790_000_600;
const DIGEST = '0x0cfd835d1262f048ab9e759f064e7d6ebfb747599e40a606e5cd84dc13cc1804';
const SIG =
  '0x9d5387fee26b5ec00237ff732f68821b31744e07c81b8b815f048c1c9ad8965d4032040a16fbf1ef18bd9c24bbdab9c76df4c03fa8637ce003f18a4dc4d05cd31c';

const N_HALB = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;
const N = N_HALB * 2n + 1n;

function nachricht(human = ALICE.address) {
  return registerV8Nachricht(human, SIGNALE, FRIST);
}

async function unterschreibe(w: ethers.Wallet, kennung = KENNUNG, n = nachricht()) {
  const td = registerV8TypedData(kennung, n);
  return w.signTypedData(td.domain, td.types as any, td.message as any);
}

describe('Pruefvektor mit Go', () => {
  it('Salt, Digest und Signatur stimmen byte-genau', async () => {
    expect(netzSalt(KENNUNG)).toBe('0x89654bb870598e4d718a433a7d674b5ddd48f78cb6eecd489c01d69fa8e8954f');
    expect(registerV8Digest(KENNUNG, nachricht())).toBe(DIGEST);
    const sig = await unterschreibe(ALICE);
    expect(sig).toBe(SIG);
    expect(registerV8Signatur(KENNUNG, nachricht(), sig)).toBe(SIG);
  });
});

describe('registerV8Signatur (Missbrauch)', () => {
  it('lehnt eine Unterschrift aus einem anderen Netz ab', async () => {
    const alt = await unterschreibe(ALICE, 'aequitas-1926-1700000000');
    expect(() => registerV8Signatur(KENNUNG, nachricht(), alt)).toThrow('nicht von dieser Wallet');
  });
  it('lehnt eine fremde Wallet ab', async () => {
    const fremd = await unterschreibe(MALLORY);
    expect(() => registerV8Signatur(KENNUNG, nachricht(), fremd)).toThrow('nicht von dieser Wallet');
  });
  it('lehnt vertauschte Signale und eine andere Frist ab', () => {
    const vertauscht = registerV8Nachricht(ALICE.address, ['2001', '1001'], FRIST);
    expect(() => registerV8Signatur(KENNUNG, vertauscht, SIG)).toThrow('nicht von dieser Wallet');
    const spaeter = registerV8Nachricht(ALICE.address, SIGNALE, FRIST + 1);
    expect(() => registerV8Signatur(KENNUNG, spaeter, SIG)).toThrow('nicht von dieser Wallet');
  });
  it('gleicht v 0/1 an (WalletConnect), aendert sonst nichts', () => {
    const v01 = SIG.slice(0, -2) + (parseInt(SIG.slice(-2), 16) - 27).toString(16).padStart(2, '0');
    expect(registerV8Signatur(KENNUNG, nachricht(), v01)).toBe(SIG);
  });
  it('lehnt hohes s ab (formbare Signatur)', () => {
    const b = ethers.getBytes(SIG);
    const s = BigInt(ethers.hexlify(b.slice(32, 64)));
    const hoch = ethers.toBeHex(N - s, 32).slice(2);
    const v = b[64] === 27 ? '1c' : '1b';
    const formbar = SIG.slice(0, 66) + hoch + v;
    expect(() => registerV8Signatur(KENNUNG, nachricht(), formbar)).toThrow('hohes s');
  });
  it('lehnt falsche Laenge, v und Unsinn ab', () => {
    expect(() => registerV8Signatur(KENNUNG, nachricht(), SIG.slice(0, -2))).toThrow('65 Byte');
    expect(() => registerV8Signatur(KENNUNG, nachricht(), SIG + '00')).toThrow('65 Byte');
    expect(() => registerV8Signatur(KENNUNG, nachricht(), SIG.slice(0, -2) + '1d')).toThrow('v ungueltig');
    expect(() => registerV8Signatur(KENNUNG, nachricht(), 'kaputt')).toThrow('65 Byte');
    expect(() => registerV8Signatur(KENNUNG, nachricht(), '0x' + '00'.repeat(64) + '1b')).toThrow('r/s');
  });
});

describe('registerV8Nachricht', () => {
  it('Nonce ist immer 0, Adresse normalisiert', () => {
    const n = registerV8Nachricht(ALICE.address.toLowerCase(), SIGNALE, FRIST);
    expect(n.nonce).toBe(0n);
    expect(n.human).toBe(ALICE.address);
  });
  it('lehnt Signale ausserhalb des Feldes und Unsinn ab', () => {
    const r = '21888242871839275222246405745257275088548364400416034343698204186575808495617';
    for (const bad of [['0', '1'], ['1', r], ['-1', '2'], ['0x10', '2'], ['1e3', '2'], ['1']]) {
      expect(() => registerV8Nachricht(ALICE.address, bad, FRIST)).toThrow();
    }
    expect(() => registerV8Nachricht('0x1234', SIGNALE, FRIST)).toThrow('Wallet');
    expect(() => registerV8Nachricht(ALICE.address, SIGNALE, 0)).toThrow('Frist');
    expect(() => registerV8Nachricht(ALICE.address, SIGNALE, 1.5)).toThrow('Frist');
  });
});

describe('Netz und Vertrag', () => {
  it('Salt nur fuer eine gueltige Kennung dieses Netzes', () => {
    expect(() => netzSalt('aequitas-1-1790000000')).toThrow();
    expect(() => netzSalt('')).toThrow();
  });
  it('registerVertrag: fehlend = v7, unbekannt = nicht unterschreiben', () => {
    expect(registerVertrag({})).toBe('v7');
    expect(registerVertrag({ register_vertrag: 'v7' })).toBe('v7');
    expect(registerVertrag({ register_vertrag: 'v8' })).toBe('v8');
    expect(registerVertrag({ register_vertrag: 'v9' })).toBeNull();
    expect(registerVertrag({ register_vertrag: 8 })).toBeNull();
    expect(registerVertrag(null)).toBeNull();
  });
  it('Frist liegt innerhalb dessen, was der Knoten annimmt', () => {
    const jetzt = 1_790_000_000_000;
    expect(registerV8Frist(jetzt)).toBe(1_790_000_000 + FRIST_S);
    expect(FRIST_S).toBeLessThan(MAX_FRIST_S);
    expect(FRIST_S).toBeGreaterThan(15 * 60); // laenger als der Beweis am Knoten gilt
  });
});
