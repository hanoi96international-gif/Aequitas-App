import { ethers } from 'ethers';
import {
  KETTENNACHWEIS_HOECHSTENS_ALT_S,
  KETTENNACHWEIS_HOECHSTENS_VORAUS_S,
  ablehnungsNachricht,
  kettenbindungsNachricht,
  kettennachweisGueltig,
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
    expect(r).toEqual({ ok: true, kette: 'nicht_angeboten' });
    const posts = fetchFn.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(posts).toHaveLength(1);
    const [url, init] = posts[0];
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
    // Gelesen werden darf (offene Anfragen), eingereicht wird nichts.
    expect(fetchFn.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
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

describe('Kettenbindung (Validator-Register auf der Kette)', () => {
  const JETZT = 1_792_900_000;
  const jetzt = () => JETZT;

  it('builds exactly the sentence the node checks (validatorBindungNachricht, chain frozen at 1926)', () => {
    expect(kettenbindungsNachricht('0xABCDEF0000000000000000000000000000000001', '0x00000000000000000000000000000000000000Aa', 1792900000))
      .toBe('Aequitas: bind validator 0xabcdef0000000000000000000000000000000001 to operator 0x00000000000000000000000000000000000000aa chain:1926 ts:1792900000');
  });

  async function anfrage(opts: { von?: ethers.HDNodeWallet; satzAdresse?: string; satzWallet?: string; zeit?: number; satzZeit?: number } = {}) {
    const von = opts.von ?? knoten;
    const zeit = opts.zeit ?? JETZT;
    const satz = kettenbindungsNachricht(opts.satzAdresse ?? knoten.address, opts.satzWallet ?? mensch.address, opts.satzZeit ?? zeit);
    return {
      signing_address: knoten.address.toLowerCase(),
      wallet: mensch.address.toLowerCase(),
      beweis: await knoten.signMessage(knotenNachweisNachricht(mensch.address)),
      ip: '203.0.113.7',
      zeit: '2026-10-25T07:00:00Z',
      bindung_zeit: zeit,
      bindung_signatur_knoten: await von.signMessage(satz),
    };
  }

  /** Netz-Attrappe: GET bindungsanfragen liefert `anfragen`, POSTs nach `antworten`. */
  function netz(anfragen: unknown[], antworten: Record<string, { status: number; body: unknown }> = {}) {
    return jest.fn(async (url: string, init?: any) => {
      if (!init?.method || init.method === 'GET') {
        return { ok: true, status: 200, json: async () => ({ anfragen }) };
      }
      const pfad = String(url).replace(/^.*\/api/, '');
      const a = antworten[pfad] ?? { status: 200, body: { success: true } };
      return { ok: a.status < 300, status: a.status, json: async () => a.body };
    });
  }
  const posts = (f: jest.Mock) => f.mock.calls.filter(([, init]) => init?.method === 'POST').map(([url, init]) => ({ url: String(url), body: JSON.parse(init.body) }));

  it('one confirmation: binds at the node AND submits the chain binding with both signatures', async () => {
    const a = await anfrage();
    const f = netz([a]);
    const b = leseKnotenbindung(await code())!;
    const r = await knotenBinden(signerAus(mensch), b, f as any, jetzt);
    expect(r).toEqual({ ok: true, kette: 'eingetragen' });
    const p = posts(f);
    expect(p.map((x) => x.url.replace(/^.*\/api/, ''))).toEqual(['/register-validator-key', '/validator-bindung']);
    const k = p[1].body;
    expect(k).toEqual({
      operator: b.wallet,
      signing: b.adresse,
      ts: JETZT,
      operator_signature: k.operator_signature,
      signing_signature: a.bindung_signatur_knoten.toLowerCase(),
    });
    expect(ethers.verifyMessage(kettenbindungsNachricht(b.adresse, b.wallet, JETZT), k.operator_signature).toLowerCase()).toBe(b.wallet);
    expect(k.operator_signature).toMatch(/^0x[0-9a-f]{130}$/);
    expect(['1b', '1c']).toContain(k.operator_signature.slice(-2));
  });

  it('ignores a forged or foreign chain proof and binds only at the node', async () => {
    const b = leseKnotenbindung(await code())!;
    for (const a of [
      await anfrage({ von: fremd }),                                    // nicht der Knotenschluessel
      await anfrage({ satzWallet: fremd.address }),                     // Satz nennt eine andere Wallet
      await anfrage({ satzAdresse: fremd.address }),                    // Satz nennt eine andere Signieradresse
      await anfrage({ satzZeit: JETZT - 5 }),                           // Zeit passt nicht zum Satz
      { ...(await anfrage()), bindung_zeit: String(JETZT) },            // Zeit als Text
      { ...(await anfrage()), bindung_signatur_knoten: '0x1234' },      // kaputt
    ]) {
      const f = netz([a]);
      const r = await knotenBinden(signerAus(mensch), b, f as any, jetzt);
      expect(r).toEqual({ ok: true, kette: 'nicht_angeboten' });
      expect(posts(f).map((x) => x.url)).toEqual([expect.stringMatching(/\/register-validator-key$/)]);
    }
  });

  it('does not sign a stale or future chain proof (the chain would refuse it)', async () => {
    const b = leseKnotenbindung(await code())!;
    for (const zeit of [JETZT - KETTENNACHWEIS_HOECHSTENS_ALT_S - 1, JETZT - 3600, JETZT + KETTENNACHWEIS_HOECHSTENS_VORAUS_S + 1]) {
      const signMessage = jest.fn((m: string) => mensch.signMessage(m));
      const f = netz([await anfrage({ zeit })]);
      const r = await knotenBinden({ ...signerAus(mensch), signMessage }, b, f as any, jetzt);
      expect(r).toEqual({ ok: true, kette: 'nicht_angeboten' });
      expect(signMessage).toHaveBeenCalledTimes(1);
    }
  });

  it('reports a chain refusal without undoing the node binding', async () => {
    const b = leseKnotenbindung(await code())!;
    const f = netz([await anfrage()], { '/validator-bindung': { status: 409, body: { error: 'binding too soon after the previous one' } } });
    const r = await knotenBinden(signerAus(mensch), b, f as any, jetzt);
    expect(r).toEqual({ ok: true, kette: 'fehlgeschlagen', ketteMeldung: 'binding too soon after the previous one' });
  });

  it('does not submit the chain binding when the wallet signs it with another key', async () => {
    const b = leseKnotenbindung(await code())!;
    const signMessage = (m: string) => (m.startsWith('Aequitas: bind validator') ? fremd : mensch).signMessage(m);
    const f = netz([await anfrage()]);
    const r = await knotenBinden({ ...signerAus(mensch), signMessage }, b, f as any, jetzt);
    expect(r.ok).toBe(true);
    expect(r.kette).toBe('fehlgeschlagen');
    expect(posts(f).map((x) => x.url)).toEqual([expect.stringMatching(/\/register-validator-key$/)]);
  });

  it('never touches the chain when the node binding is refused', async () => {
    const b = leseKnotenbindung(await code())!;
    const f = netz([await anfrage()], { '/register-validator-key': { status: 403, body: { error: 'wallet is not a registered human' } } });
    const r = await knotenBinden(signerAus(mensch), b, f as any, jetzt);
    expect(r).toEqual({ ok: false, fehler: 'abgelehnt', meldung: 'wallet is not a registered human' });
    expect(posts(f)).toHaveLength(1);
  });

  it('holeBindungsanfragen keeps the chain proof only when it checks out', async () => {
    const gut = await holeBindungsanfragen(mensch.address, netz([await anfrage()]) as any);
    expect(gut[0].kette).toEqual({ zeit: JETZT, signaturKnoten: expect.stringMatching(/^0x/) });
    const b = leseKnotenbindung(await code())!;
    expect(kettennachweisGueltig(b, gut[0].kette!)).toBe(true);
    const falsch = await holeBindungsanfragen(mensch.address, netz([await anfrage({ von: fremd })]) as any);
    expect(falsch).toHaveLength(1);
    expect(falsch[0].kette).toBeUndefined();
  });
});
