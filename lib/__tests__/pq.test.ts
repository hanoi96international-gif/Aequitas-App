// Quantenschutz (lib/pq.ts): Ableitung byte-gleich zur Kette und zum Server
// (derselbe Pruefvektor wurde mit Go crypto/mldsa und Python cryptography
// gerechnet), Satz wie pq_zusage_test.go, und die Missbrauchsfaelle: fremde
// Phrase, Fehlantworten, Unterschrift einer anderen Wallet.
jest.mock('expo-secure-store', () => {
  const m = new Map<string, string>();
  return {
    setItemAsync: jest.fn(async (k: string, v: string) => void m.set(k, v)),
    getItemAsync: jest.fn(async (k: string) => m.get(k) ?? null),
    deleteItemAsync: jest.fn(async (k: string) => void m.delete(k)),
  };
});
import { ethers } from 'ethers';
import {
  pqHash,
  pqHashFuerWallet,
  pqHashGemerkt,
  pqHashMerken,
  pqHashVergessen,
  pqSeed,
  pqStand,
  zusageHinterlegen,
  zusageNachricht,
  zusageSchonDa,
} from '../pq';

const PHRASE = 'test test test test test test test test test test test junk';
const ADRESSE = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';

describe('Ableitung wie Kette und Server', () => {
  it('ML-DSA-Seed und Hash (Pruefvektor Go/Python)', () => {
    expect(ethers.hexlify(pqSeed(PHRASE)).slice(2)).toBe('7393899bba90173df43fcf5689f9bcf1dc37687a3339033dd4f119922077a7c8');
    expect(pqHash(PHRASE)).toBe('32ee3828ba23f88891f9960d3d54ec007c706edf9470bb768005fb8a46dd1eb8');
    // Gross/klein und Leerzeichen am Rand aendern nichts.
    expect(pqHash(`  ${PHRASE.toUpperCase()} `)).toBe(pqHash(PHRASE));
  });
  it('nicht aus dem Wallet-Schluessel ableitbar: andere Phrase, anderer Hash', () => {
    const andere = ethers.Wallet.createRandom().mnemonic!.phrase;
    expect(pqHash(andere)).not.toBe(pqHash(PHRASE));
  });
  it('Satz wie pqZusageNachricht', () => {
    expect(zusageNachricht('0x00000000000000000000000000000000000000A1', 'ab', 7)).toBe(
      'aequitas-pq-zusage-v1|chain:1926|0x00000000000000000000000000000000000000a1|ab|7',
    );
  });
});

describe('Phrase gehoert zur Wallet', () => {
  it('passende Phrase', () => {
    expect(pqHashFuerWallet(PHRASE, ADRESSE)).toBe(pqHash(PHRASE));
  });
  it('fremde Phrase oder Unsinn: nichts', () => {
    expect(pqHashFuerWallet(PHRASE, '0x00000000000000000000000000000000000000a1')).toBeNull();
    expect(pqHashFuerWallet('kein gueltiger satz', ADRESSE)).toBeNull();
    expect(pqHashFuerWallet('', ADRESSE)).toBeNull();
  });
  it('merken nur fuer die passende Wallet', async () => {
    await pqHashMerken(PHRASE, '0x00000000000000000000000000000000000000a1');
    expect(await pqHashGemerkt('0x00000000000000000000000000000000000000a1')).toBeNull();
    await pqHashMerken(PHRASE, ADRESSE);
    expect(await pqHashGemerkt(ADRESSE.toUpperCase().replace('0X', '0x'))).toBe(pqHash(PHRASE));
    await pqHashVergessen(ADRESSE);
    expect(await pqHashGemerkt(ADRESSE)).toBeNull();
  });
});

function antwort(status: number, body: unknown): typeof fetch {
  return jest.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body })) as any;
}

describe('Hinterlegen', () => {
  const wallet = ethers.Wallet.fromPhrase(PHRASE);
  const signer = { address: wallet.address, signMessage: (m: string) => wallet.signMessage(m) } as any;

  it('schickt genau, was die Kette prueft', async () => {
    const f = antwort(200, { ok: true });
    const r = await zusageHinterlegen(signer, pqHash(PHRASE), f, () => 1795000000);
    expect(r.ok).toBe(true);
    const [url, init] = (f as jest.Mock).mock.calls[0];
    expect(url).toMatch(/\/pq\/zusage$/);
    const b = JSON.parse(init.body);
    expect(b).toEqual({ wallet: ADRESSE, pq_hash: pqHash(PHRASE), zeit: 1795000000, sig: expect.stringMatching(/^0x[0-9a-f]{130}$/) });
    expect(ethers.verifyMessage(zusageNachricht(ADRESSE, b.pq_hash, 1795000000), b.sig).toLowerCase()).toBe(ADRESSE);
  });
  it('Unterschrift einer anderen Wallet: nicht gesendet', async () => {
    const fremd = ethers.Wallet.createRandom();
    const f = antwort(200, {});
    const r = await zusageHinterlegen({ address: ADRESSE, signMessage: (m: string) => fremd.signMessage(m) } as any, pqHash(PHRASE), f);
    expect(r).toEqual({ ok: false, meldung: 'unterschrift' });
    expect(f).not.toHaveBeenCalled();
  });
  it('kaputter Hash: nicht gesendet', async () => {
    const f = antwort(200, {});
    expect((await zusageHinterlegen(signer, 'zz', f)).ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
  it('Ablehnung der Kette kommt an, "schon da" erkennbar', async () => {
    const r = await zusageHinterlegen(signer, pqHash(PHRASE), antwort(409, { error: 'rejected: pq_fest: 0xf39f…: hat schon eine PQ-Zusage' }));
    expect(r.ok).toBe(false);
    expect(zusageSchonDa(r.meldung)).toBe(true);
    expect(zusageSchonDa('rejected: pq_zeit: x')).toBe(false);
  });
});

describe('Stand', () => {
  it('liest Stichtag und Zusage', async () => {
    const h = pqHash(PHRASE);
    expect(await pqStand(ADRESSE, antwort(200, { pq_zusage_ab: 1794938400, pq_zusage_seit: 1795000000, pq_hash: h }))).toEqual({
      ab: 1794938400,
      seit: 1795000000,
      hash: h,
    });
  });
  it('Unsinn wird zu "nichts"', async () => {
    expect(await pqStand(ADRESSE, antwort(200, { pq_zusage_ab: -1, pq_zusage_seit: 5, pq_hash: 'X' }))).toEqual({ ab: 0, seit: 0, hash: '' });
    expect(await pqStand(ADRESSE, antwort(500, {}))).toBeNull();
  });
});
