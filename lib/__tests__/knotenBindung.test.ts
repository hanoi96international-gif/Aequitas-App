import { ethers } from 'ethers';
import {
  ablehnungsNachricht,
  ausParametern,
  bindungsanfrageAblehnen,
  holeBindungsanfragen,
  bindungsNachricht,
  knotenBinden,
  knotenNachweisGueltig,
  knotenNachweisNachricht,
  kontrollzahl,
  leseKnotenbindung,
  type Knotenbindung,
} from '../knotenBindung';
import type { AequitasSigner } from '../signer';

const knoten = ethers.Wallet.createRandom();
const mensch = ethers.Wallet.createRandom();
const fremd = ethers.Wallet.createRandom();

async function code(nachweisVon = knoten, fuerWallet = mensch.address): Promise<string> {
  const beweis = await nachweisVon.signMessage(knotenNachweisNachricht(fuerWallet));
  return `aequitasapp://knoten-binden?adresse=${knoten.address}&wallet=${fuerWallet}&beweis=${beweis}`;
}

function signerAus(w: ethers.HDNodeWallet | ethers.Wallet, unterschreibtMit = w): AequitasSigner {
  return {
    address: w.address,
    kind: 'local',
    signMessage: (m: string) => unterschreibtMit.signMessage(m),
    signTypedData: async () => { throw new Error('nicht benutzt'); },
    sendTransaction: async () => { throw new Error('nicht benutzt'); },
  };
}

function okFetch() {
  return jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true }) });
}

describe('leseKnotenbindung', () => {
  it('reads a valid code and lower-cases addresses', async () => {
    const b = leseKnotenbindung(await code());
    expect(b).not.toBeNull();
    expect(b!.adresse).toBe(knoten.address.toLowerCase());
    expect(b!.wallet).toBe(mensch.address.toLowerCase());
  });

  it('refuses anything that is not a binding code', () => {
    for (const roh of [
      '', 'hello', knoten.address, 'ethereum:' + knoten.address,
      'https://evil.example/knoten-binden?adresse=' + knoten.address,
      'aequitasapp://knoten-binden?adresse=0x123&wallet=0x456&beweis=0x789',
      `aequitasapp://knoten-binden?adresse=${knoten.address}&wallet=${mensch.address}`,
      `aequitasapp://knoten-binden?adresse=${knoten.address}&wallet=${mensch.address}&beweis=0x${'zz'.repeat(65)}`,
    ]) {
      expect(leseKnotenbindung(roh)).toBeNull();
    }
    expect(ausParametern(undefined, mensch.address, '0x' + 'ab'.repeat(65))).toBeNull();
    expect(ausParametern(['x'], mensch.address, '0x' + 'ab'.repeat(65))).toBeNull();
  });
});

describe('knotenNachweisGueltig', () => {
  it('accepts the proof signed by the named signing key', async () => {
    expect(knotenNachweisGueltig(leseKnotenbindung(await code())!)).toBe(true);
  });

  it('rejects a proof made by a different key (forged node proof)', async () => {
    expect(knotenNachweisGueltig(leseKnotenbindung(await code(fremd))!)).toBe(false);
  });

  it('rejects a proof that names a different wallet', async () => {
    const b = leseKnotenbindung(await code())!;
    const umgelenkt: Knotenbindung = { ...b, wallet: fremd.address.toLowerCase() };
    expect(knotenNachweisGueltig(umgelenkt)).toBe(false);
  });
});

describe('knotenBinden', () => {
  it('signs the binding and submits both signatures', async () => {
    const b = leseKnotenbindung(await code())!;
    const fetchFn = okFetch();
    const r = await knotenBinden(signerAus(mensch), b, fetchFn as unknown as typeof fetch);
    expect(r).toEqual({ ok: true });
    const [url, init] = fetchFn.mock.calls[0];
    expect(String(url)).toMatch(/\/register-validator-key$/);
    const body = JSON.parse(init.body);
    expect(body.signing_address).toBe(b.adresse);
    expect(body.human_wallet).toBe(b.wallet);
    expect(body.signing_key_signature).toBe(b.beweis);
    expect(ethers.verifyMessage(bindungsNachricht(b.adresse), body.human_signature).toLowerCase()).toBe(b.wallet);
  });

  it('refuses a code made for another wallet and signs nothing', async () => {
    const b = leseKnotenbindung(await code(knoten, fremd.address))!;
    const signMessage = jest.fn();
    const fetchFn = okFetch();
    const r = await knotenBinden({ ...signerAus(mensch), signMessage }, b, fetchFn as unknown as typeof fetch);
    expect(r).toEqual({ ok: false, fehler: 'andere_wallet' });
    expect(signMessage).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('refuses a forged node proof and signs nothing', async () => {
    const b = leseKnotenbindung(await code(fremd))!;
    const signMessage = jest.fn();
    const fetchFn = okFetch();
    const r = await knotenBinden({ ...signerAus(mensch), signMessage }, b, fetchFn as unknown as typeof fetch);
    expect(r).toEqual({ ok: false, fehler: 'nachweis_ungueltig' });
    expect(signMessage).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('does not submit when the wallet signed with a different key', async () => {
    const b = leseKnotenbindung(await code())!;
    const fetchFn = okFetch();
    const r = await knotenBinden(signerAus(mensch, fremd), b, fetchFn as unknown as typeof fetch);
    expect(r).toEqual({ ok: false, fehler: 'unterschrift_ungueltig' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('reports the node refusal', async () => {
    const b = leseKnotenbindung(await code())!;
    const fetchFn = jest.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'wallet is not a registered human' }) });
    const r = await knotenBinden(signerAus(mensch), b, fetchFn as unknown as typeof fetch);
    expect(r).toEqual({ ok: false, fehler: 'abgelehnt', meldung: 'wallet is not a registered human' });
  });
});

describe('holeBindungsanfragen', () => {
  async function eintrag(nachweisVon = knoten, fuerWallet = mensch.address, ip = '203.0.113.7') {
    return {
      signing_address: knoten.address.toLowerCase(),
      wallet: fuerWallet.toLowerCase(),
      beweis: await nachweisVon.signMessage(knotenNachweisNachricht(fuerWallet)),
      ip,
      zeit: '2026-10-02T13:00:00Z',
    };
  }
  function antwort(anfragen: unknown) {
    return jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ anfragen }) });
  }

  it('shows a valid request with the server IP', async () => {
    const a = await holeBindungsanfragen(mensch.address, antwort([await eintrag()]) as any);
    expect(a).toHaveLength(1);
    expect(a[0].adresse).toBe(knoten.address.toLowerCase());
    expect(a[0].ip).toBe('203.0.113.7');
  });

  it('drops what the network should never have sent: foreign proof, other wallet, bad IP text', async () => {
    const a = await holeBindungsanfragen(mensch.address, antwort([
      await eintrag(fremd),
      await eintrag(knoten, fremd.address),
      { ...(await eintrag()), signing_address: '0x123' },
    ]) as any);
    expect(a).toHaveLength(0);
    const b = await holeBindungsanfragen(mensch.address, antwort([await eintrag(knoten, mensch.address, '<script>')]) as any);
    expect(b[0].ip).toBe('?');
  });

  it('returns an empty list on errors', async () => {
    expect(await holeBindungsanfragen(mensch.address, jest.fn().mockRejectedValue(new Error('offline')) as any)).toEqual([]);
    expect(await holeBindungsanfragen(mensch.address, jest.fn().mockResolvedValue({ ok: false, status: 500 }) as any)).toEqual([]);
  });
});

describe('bindungsanfrageAblehnen', () => {
  it('signs the rejection with the wallet and sends DELETE', async () => {
    const f = okFetch();
    expect(await bindungsanfrageAblehnen(signerAus(mensch), knoten.address, f as any)).toBe(true);
    const [url, opts] = f.mock.calls[0];
    expect(opts.method).toBe('DELETE');
    const q = new URL(url).searchParams;
    expect(ethers.verifyMessage(ablehnungsNachricht(knoten.address), q.get('signatur')!).toLowerCase()).toBe(mensch.address.toLowerCase());
  });
});

describe('kontrollzahl', () => {
  it('matches the setup script (fixed vector computed with Python hashlib)', () => {
    expect(kontrollzahl('0x3066639af1653325100c1074a9696612dbdc42dc')).toBe('161 502');
    expect(kontrollzahl('0x3066639AF1653325100C1074A9696612DBDC42DC')).toBe('161 502');
  });
  it('differs between servers', () => {
    expect(kontrollzahl(knoten.address)).not.toBe(kontrollzahl(fremd.address));
    expect(kontrollzahl(knoten.address)).toMatch(/^\d{3} \d{3}$/);
  });
});
