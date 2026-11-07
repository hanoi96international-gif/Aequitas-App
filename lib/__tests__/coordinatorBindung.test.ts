import { ethers } from 'ethers';
import {
  coordinatorAdresse,
  coordinatorBesitzNachricht,
  coordinatorFreigabeNachricht,
  coordinatorFreigeben,
  holeBesitznachweis,
  schluesselKurz,
  type Besitznachweis,
} from '../coordinatorBindung';
import { API_BASE } from '../config';
import type { AequitasSigner } from '../signer';

const mensch = ethers.Wallet.createRandom();
const fremd = ethers.Wallet.createRandom();
const W = mensch.address.toLowerCase();
const KEY = 'ab'.repeat(32);
const SIG = 'cd'.repeat(64);

function signerAus(w: ethers.HDNodeWallet | ethers.Wallet, unterschreibtMit = w): AequitasSigner {
  return {
    address: w.address,
    kind: 'local',
    signMessage: (m: string) => unterschreibtMit.signMessage(m),
    signTypedData: async () => { throw new Error('nicht benutzt'); },
    sendTransaction: async () => { throw new Error('nicht benutzt'); },
  };
}

function antwort(status: number, body: unknown) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text) } as unknown as Response;
}

describe('Saetze', () => {
  it('match the node exactly (coordinator_nachrichten.go, chain 1926)', () => {
    expect(coordinatorFreigabeNachricht('AB'.repeat(32))).toBe(`Aequitas: authorize coordinator ${'ab'.repeat(32)} chain:1926`);
    expect(coordinatorBesitzNachricht(mensch.address)).toBe(`Aequitas: coordinator key for human ${W} chain:1926`);
  });
});

describe('coordinatorAdresse', () => {
  it('accepts a public https address and strips the trailing slash', () => {
    expect(coordinatorAdresse('https://proof1.aequitas.digital/coordinator/')).toBe('https://proof1.aequitas.digital/coordinator');
    expect(coordinatorAdresse(' https://Coord.Example.org ')).toBe('https://coord.example.org');
  });

  it('refuses http, IPs, local names, user parts, queries, shut-down hosts and junk', () => {
    for (const roh of [
      undefined, null, 42, '', 'proof1.aequitas.digital',
      'http://proof1.aequitas.digital/coordinator',
      'https://127.0.0.1/coordinator', 'https://10.0.0.1', 'https://[::1]/',
      'https://localhost/coordinator', 'https://box.local', 'https://svc.internal',
      'https://user@proof1.aequitas.digital', 'https://proof1.aequitas.digital/c?x=1',
      'https://proof1.aequitas.digital/c#frag', 'https://proof2.aequitas.digital/coordinator',
      'https://a.b/' + 'x'.repeat(250), 'javascript:alert(1)', 'https://nodot',
    ]) {
      expect(coordinatorAdresse(roh as any)).toBeNull();
    }
  });
});

describe('holeBesitznachweis', () => {
  const URL = 'https://proof1.aequitas.digital/coordinator';

  it('fetches the proof for exactly this wallet and normalises it', async () => {
    const f = jest.fn().mockResolvedValue(antwort(200, { public_key: KEY.toUpperCase(), key_signature: '0x' + SIG, human_wallet: W }));
    const r = await holeBesitznachweis(URL + '/', mensch.address, f as any);
    expect(r).toEqual({ ok: true, nachweis: { url: URL, schluessel: KEY, unterschrift: SIG, wallet: W } });
    expect(f).toHaveBeenCalledWith(`${URL}/besitznachweis?wallet=${W}`, expect.anything());
  });

  it('refuses a proof issued for another wallet (coordinator lies or is someone else\'s)', async () => {
    const f = jest.fn().mockResolvedValue(antwort(200, { public_key: KEY, key_signature: SIG, human_wallet: fremd.address.toLowerCase() }));
    expect(await holeBesitznachweis(URL, mensch.address, f as any)).toEqual({ ok: false, fehler: 'andere_wallet' });
  });

  it('refuses malformed keys and signatures', async () => {
    for (const body of [
      { public_key: KEY.slice(2), key_signature: SIG, human_wallet: W },
      { public_key: KEY, key_signature: SIG.slice(2), human_wallet: W },
      { public_key: 'zz'.repeat(32), key_signature: SIG, human_wallet: W },
      { public_key: KEY },
      [],
    ]) {
      const f = jest.fn().mockResolvedValue(antwort(200, body));
      const r = await holeBesitznachweis(URL, mensch.address, f as any);
      expect(r.ok).toBe(false);
    }
  });

  it('reads at most 4 KiB of the answer', async () => {
    const f = jest.fn().mockResolvedValue(antwort(200, JSON.stringify({ public_key: KEY, key_signature: SIG, human_wallet: W, x: 'y'.repeat(5000) })));
    expect(await holeBesitznachweis(URL, mensch.address, f as any)).toEqual({ ok: false, fehler: 'antwort_ungueltig' });
  });

  it('passes on the coordinator\'s refusal and network errors', async () => {
    const f400 = jest.fn().mockResolvedValue(antwort(400, { detail: 'no proof' }));
    expect(await holeBesitznachweis(URL, mensch.address, f400 as any)).toEqual({ ok: false, fehler: 'kein_nachweis', meldung: 'no proof' });
    const fNetz = jest.fn().mockRejectedValue(new Error('offline'));
    expect(await holeBesitznachweis(URL, mensch.address, fNetz as any)).toEqual({ ok: false, fehler: 'nicht_erreichbar', meldung: 'offline' });
  });

  it('never contacts a refused address', async () => {
    const f = jest.fn();
    expect(await holeBesitznachweis('http://evil.example', mensch.address, f as any)).toEqual({ ok: false, fehler: 'adresse' });
    expect(f).not.toHaveBeenCalled();
  });
});

describe('coordinatorFreigeben', () => {
  const n: Besitznachweis = { url: 'https://proof1.aequitas.digital/coordinator', schluessel: KEY, unterschrift: SIG, wallet: W };

  it('signs the fixed sentence with the wallet and submits both proofs to the node', async () => {
    const f = jest.fn().mockResolvedValue(antwort(200, { success: true, bescheinigungstauglich: true }));
    const r = await coordinatorFreigeben(signerAus(mensch), n, f as any);
    expect(r).toEqual({ ok: true, tauglich: true });
    expect(f).toHaveBeenCalledTimes(1);
    const [ziel, init] = f.mock.calls[0];
    expect(ziel).toBe(`${API_BASE}/register-coordinator-key`);
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ public_key: KEY, human_wallet: W, key_signature: SIG, url: n.url });
    expect(ethers.verifyMessage(coordinatorFreigabeNachricht(KEY), body.human_signature).toLowerCase()).toBe(W);
    // kanonisch: klein, v = 27/28 (kanonischeSignatur im Knoten)
    expect(body.human_signature).toBe(body.human_signature.toLowerCase());
    expect(['1b', '1c']).toContain(body.human_signature.slice(-2));
  });

  it('reports an old-form registration as not usable for votes', async () => {
    const f = jest.fn().mockResolvedValue(antwort(200, { success: true, bescheinigungstauglich: false }));
    expect(await coordinatorFreigeben(signerAus(mensch), n, f as any)).toEqual({ ok: true, tauglich: false });
  });

  it('refuses a proof for another wallet before signing anything', async () => {
    const sign = jest.fn();
    const s = { ...signerAus(mensch), signMessage: sign };
    const f = jest.fn();
    expect(await coordinatorFreigeben(s, { ...n, wallet: fremd.address.toLowerCase() }, f as any)).toEqual({ ok: false, fehler: 'andere_wallet' });
    expect(sign).not.toHaveBeenCalled();
    expect(f).not.toHaveBeenCalled();
  });

  it('refuses a signature from a different key (e.g. WalletConnect with another account)', async () => {
    const f = jest.fn();
    expect(await coordinatorFreigeben(signerAus(mensch, fremd), n, f as any)).toEqual({ ok: false, fehler: 'unterschrift_ungueltig' });
    expect(f).not.toHaveBeenCalled();
  });

  it('refuses a tampered proof before signing', async () => {
    const sign = jest.fn();
    const s = { ...signerAus(mensch), signMessage: sign };
    for (const kaputt of [{ ...n, schluessel: 'x' }, { ...n, unterschrift: 'x' }, { ...n, url: 'http://evil.example' }]) {
      expect((await coordinatorFreigeben(s, kaputt, jest.fn() as any)).ok).toBe(false);
    }
    expect(sign).not.toHaveBeenCalled();
  });

  it('passes on the node\'s refusal', async () => {
    const f = jest.fn().mockResolvedValue(antwort(400, { error: 'invalid key_signature' }));
    expect(await coordinatorFreigeben(signerAus(mensch), n, f as any)).toEqual({ ok: false, fehler: 'abgelehnt', meldung: 'invalid key_signature' });
  });
});

describe('schluesselKurz', () => {
  it('shows head and tail', () => {
    expect(schluesselKurz(KEY)).toBe('abababab…abababab');
  });
});
