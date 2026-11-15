// Stufe 3.6 (Kette: umzug_pq.go, Coordinator: pq_konto.py): der Tresor
// unterschreibt Umzugsantrag, Code und Widerruf mit ML-DSA-65 statt EIP-191 --
// ueber GENAU DIESELBE Nachricht, mit {pq_pub, pq_sig} statt {sig}, nie beides.
// Und die Missbrauchsfaelle: kaputte Unterschrift, fremder Widerruf, Stand
// der Kette ohne Stichtag.
jest.mock('expo-secure-store', () => ({
  canUseBiometricAuthentication: () => false,
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  setItemAsync: jest.fn(),
  getItemAsync: jest.fn(async () => null),
  deleteItemAsync: jest.fn(),
}));
jest.mock('expo-crypto', () => ({ getRandomBytes: jest.fn() }));
import * as fs from 'fs';
import * as path from 'path';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { ethers } from 'ethers';
import { istTresorUnterzeichner, tresorUnterzeichnerAusSeed, type TresorUnterzeichner } from '../tresor';
import {
  antragEinreichen,
  antragNachricht,
  codeHash,
  codeHinterlegen,
  codeSetzenNachricht,
  kontoUnterschrift,
  umzugStand,
  widerrufen,
  widerrufNachricht,
  type UmzugBescheinigung,
} from '../umzug';

const SEED = new Uint8Array(32).fill(0x11);
// Dieselbe Adresse wie in tresor.test.ts und in der Kette (Seed 0x11*32).
const TRESOR = '0x6b2b299810ed00feb61d8a1cc5b91b5caa93926b';
const ALT = '0x00000000000000000000000000000000000000a1';
const N = '2258162185744682068870376411042672036729508593423772695192684261112116008409';

function antwort(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as any;
}

function gesendet(fetchFn: jest.Mock): any {
  expect(fetchFn).toHaveBeenCalledTimes(1);
  return JSON.parse(fetchFn.mock.calls[0][1].body);
}

function pruefe(pub: string, sig: string, text: string): boolean {
  return ml_dsa65.verify(ethers.getBytes('0x' + sig), ethers.toUtf8Bytes(text), ethers.getBytes('0x' + pub));
}

const tresor = tresorUnterzeichnerAusSeed(SEED);

describe('Tresor als Unterzeichner', () => {
  it('Adresse wie die Kette, Unterschrift ueber genau den Satz', () => {
    expect(istTresorUnterzeichner(tresor)).toBe(true);
    expect(tresor.address).toBe(TRESOR);
    const s = tresor.unterschreibe('aequitas-umzug-v1|chain:1926|x');
    expect(s).not.toBeNull();
    expect(s!.pub).toHaveLength(2 * 1952);
    expect(s!.sig).toHaveLength(2 * 3309);
    expect(s!.pub).toMatch(/^[0-9a-f]+$/);
    expect(pruefe(s!.pub, s!.sig, 'aequitas-umzug-v1|chain:1926|x')).toBe(true);
    expect(pruefe(s!.pub, s!.sig, 'aequitas-umzug-v1|chain:1926|y')).toBe(false);
  });

  it('kontoUnterschrift: Tresor -> pq_pub/pq_sig, nie sig', async () => {
    const u = (await kontoUnterschrift(tresor, 'satz')) as any;
    expect(u.sig).toBeUndefined();
    expect(pruefe(u.pq_pub, u.pq_sig, 'satz')).toBe(true);
  });

  it('eine Unterschrift, die nicht aufgeht, wird nie gesendet', async () => {
    const kaputt: TresorUnterzeichner = { art: 'tresor', address: TRESOR, unterschreibe: () => null };
    const fetchFn = jest.fn();
    const r = await codeHinterlegen(kaputt, 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ01', fetchFn as any, () => 7);
    expect(r).toEqual({ ok: false, meldung: 'unterschrift' });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('Umzug mit dem Tresor', () => {
  it('Code: an die Tresor-Adresse gebunden, ML-DSA ueber den Satz der Kette', async () => {
    const fetchFn = jest.fn(async () => antwort(200, { ok: true }));
    const r = await codeHinterlegen(tresor, 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ01', fetchFn as any, () => 1700000000);
    expect(r.ok).toBe(true);
    const b = gesendet(fetchFn);
    expect((fetchFn.mock.calls[0] as unknown[])[0]).toMatch(/\/umzug\/code$/);
    expect(b.wallet).toBe(TRESOR);
    expect(b.code_hash).toBe(codeHash(TRESOR, 'ABCDEFGHJKMNPQRSTVWXYZ01'));
    expect(b.sig).toBeUndefined();
    expect(pruefe(b.pq_pub, b.pq_sig, codeSetzenNachricht(TRESOR, b.code_hash, 1700000000))).toBe(true);
  });

  it('Antrag: die neue Wallet ist der Tresor', async () => {
    const be: UmzugBescheinigung = { alt: ALT, nullifier: N, zeit: 1700000100, modus: 'test', bescheinigung: ['v3:ab', 'v3:cd'], pruefung: 'einfach' };
    const fetchFn = jest.fn(async () => antwort(200, { ok: true, sofort: true }));
    const r = await antragEinreichen(tresor, be, 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ01', fetchFn as any);
    expect(r).toMatchObject({ ok: true, sofort: true });
    const b = gesendet(fetchFn);
    expect(b.neu).toBe(TRESOR);
    expect(b.sig).toBeUndefined();
    expect(pruefe(b.pq_pub, b.pq_sig, antragNachricht(N, ALT, TRESOR, 1700000100))).toBe(true);
  });

  it('Widerruf: nur fuer einen Umzug VOM Tresor weg', async () => {
    const o = { nullifier: N, alt: TRESOR, neu: ALT, angekuendigt: 1700000200, freiAb: 0, fest: false };
    const fetchFn = jest.fn(async () => antwort(200, { ok: true }));
    expect((await widerrufen(tresor, o, fetchFn as any)).ok).toBe(true);
    const b = gesendet(fetchFn);
    expect(b.alt).toBe(TRESOR);
    expect(pruefe(b.pq_pub, b.pq_sig, widerrufNachricht(N, ALT, 1700000200))).toBe(true);
    // Missbrauch: ein Umzug, an dem der Tresor nicht die alte Wallet ist.
    const fremd = jest.fn();
    expect(await widerrufen(tresor, { ...o, alt: ALT, neu: TRESOR }, fremd as any)).toEqual({ ok: false, meldung: 'fremd' });
    expect(fremd).not.toHaveBeenCalled();
  });

  it('Stand: Stichtag nur, wenn die Kette einen sicheren nennt (schlafend = 0)', async () => {
    const mit = jest.fn(async () => antwort(200, { aktiv_ab: 1, pq_unterschrift_ab: 1800000000 }));
    expect((await umzugStand(TRESOR, mit as any))?.pqAb).toBe(1800000000);
    // MaxInt64 kommt als unsichere Zahl an -- dann wie "noch nicht".
    const schlafend = jest.fn(async () => ({ ok: true, status: 200, json: async () => JSON.parse('{"aktiv_ab":1,"pq_unterschrift_ab":9223372036854775807}') }));
    expect((await umzugStand(TRESOR, schlafend as any))?.pqAb).toBe(0);
    const alt = jest.fn(async () => antwort(200, { aktiv_ab: 1 }));
    expect((await umzugStand(TRESOR, alt as any))?.pqAb).toBe(0);
  });
});

// Vektor fuer die Kette (aequitas-chain testdata/umzug_pq_app_vektor.json):
// der Knoten nimmt genau diese Unterschriften an (TestUmzugPQ_VektorAusDerApp).
describe('Pruefvektor fuer die Kette', () => {
  it('deterministisch und gegen die Datei geprueft', () => {
    const zeit = 1700000100;
    const hash = codeHash(TRESOR, 'ABCDEFGHJKMNPQRSTVWXYZ01');
    const antrag = antragNachricht(N, ALT, TRESOR, zeit);
    const code = codeSetzenNachricht(TRESOR, hash, zeit);
    const widerruf = widerrufNachricht(N, ALT, zeit);
    const a = tresor.unterschreibe(antrag)!;
    const v = {
      adresse: TRESOR,
      alt: ALT,
      nullifier: N,
      zeit,
      code_hash: hash,
      pub: a.pub,
      antrag,
      antrag_sig: a.sig,
      code,
      code_sig: tresor.unterschreibe(code)!.sig,
      widerruf,
      widerruf_sig: tresor.unterschreibe(widerruf)!.sig,
    };
    const datei = path.join(__dirname, 'vektoren', 'umzug_pq_app_vektor.json');
    if (process.env.VEKTOR_SCHREIBEN === '1') {
      fs.mkdirSync(path.dirname(datei), { recursive: true });
      fs.writeFileSync(datei, JSON.stringify(v, null, 1) + '\n');
    }
    expect(JSON.parse(fs.readFileSync(datei, 'utf8'))).toEqual(v);
  });
});
