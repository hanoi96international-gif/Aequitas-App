import { ethers } from 'ethers';
import { buergen, leseQr, nachricht, qrInhalt, stand } from '../altersbuergschaft';
import { _setCoordinatorCandidatesForTest } from '../biometricIdentity';

const W = '0x' + '11'.repeat(20);
const A = 'a'.repeat(32);

describe('Altersbuergschaft', () => {
  it('Nachricht wie Coordinator und Vergleichsdienst', () => {
    expect(nachricht(A, 1800000000)).toBe(
      'Aequitas: Altersbuergschaft\nIch kenne diese Person persoenlich. Sie ist mindestens 18 Jahre alt und in ihrem Land volljaehrig.\n' +
        `Anfrage: ${A}\nZeit: 1800000000`,
    );
  });

  it('QR hin und zurueck, alles andere nicht', () => {
    expect(leseQr(qrInhalt(W.toUpperCase().replace('0X', '0x'), A))).toEqual({ wallet: W, anfrage: A });
    for (const roh of ['', 'ethereum:' + W, 'aequitas-alter:' + W, 'aequitas-alter:0x123:' + A, `aequitas-alter:${W}:${A}x`]) {
      expect(leseQr(roh)).toBeNull();
    }
  });

  it('buergt bei allen Coordinatoren und meldet die hoechste Zahl', async () => {
    _setCoordinatorCandidatesForTest(['https://c1', 'https://c2']);
    const gesehen: string[] = [];
    (global as any).fetch = jest.fn(async (url: string, init: any) => {
      gesehen.push(url);
      const body = JSON.parse(init.body);
      const wallet = ethers.verifyMessage(nachricht(body.anfrage, body.zeit), body.sig).toLowerCase();
      expect(wallet).toBe(body.buerge);
      return { ok: true, json: async () => ({ ok: true, buergen: url.includes('c2') ? 2 : 1 }) };
    });
    const k = ethers.Wallet.createRandom();
    const r = await buergen(k, k.address, W, A, 1800000000);
    expect(r).toEqual({ ok: true, buergen: 2 });
    expect(gesehen).toEqual(['https://c1/alter/buergschaft', 'https://c2/alter/buergschaft']);
    _setCoordinatorCandidatesForTest(null);
  });

  it('Ablehnung kommt mit Grund zurueck', async () => {
    _setCoordinatorCandidatesForTest(['https://c1']);
    (global as any).fetch = jest.fn(async () => ({ ok: false, json: async () => ({ detail: 'zu_oft' }) }));
    const k = ethers.Wallet.createRandom();
    expect(await buergen(k, k.address, W, A)).toEqual({ ok: false, buergen: 0, grund: 'zu_oft' });
    _setCoordinatorCandidatesForTest(null);
  });

  it('Stand: hoechster Wert, Netzfehler zaehlen nicht', async () => {
    _setCoordinatorCandidatesForTest(['https://c1', 'https://c2']);
    (global as any).fetch = jest.fn(async (url: string) => {
      if (url.startsWith('https://c1')) throw new Error('weg');
      return { ok: true, json: async () => ({ buergen: 1 }) };
    });
    expect(await stand(A)).toBe(1);
    _setCoordinatorCandidatesForTest(null);
  });
});
