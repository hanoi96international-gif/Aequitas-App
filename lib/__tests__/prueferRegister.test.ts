import { ethers } from 'ethers';
import { abstimmen, antragNachricht, auftragNachricht, bewerben, holeRegisterStand } from '../prueferRegister';
import { coordinatorFreigabeNachricht } from '../coordinatorBindung';
import { API_BASE } from '../config';
import type { AequitasSigner } from '../signer';

const mensch = ethers.Wallet.createRandom();
const fremd = ethers.Wallet.createRandom();
const W = mensch.address.toLowerCase();
const KANDIDAT = '0x' + 'cd'.repeat(20);
const URL = 'https://proof1.aequitas.digital/coordinator';
const KEY = 'ab'.repeat(32);
const SIG = 'cd'.repeat(64);
const JETZT = 1_800_000_000;

function signerAus(w: ethers.HDNodeWallet, unterschreibtMit = w): AequitasSigner {
  return {
    address: w.address,
    kind: 'local',
    signMessage: (m: string) => unterschreibtMit.signMessage(m),
    signTypedData: async () => { throw new Error('nicht benutzt'); },
    sendTransaction: async () => { throw new Error('nicht benutzt'); },
  };
}

function antwort(status: number, body: unknown) {
  const text = JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text) } as unknown as Response;
}

/** Ein ehrlicher Coordinator und Knoten; `stimmeAendern` verfaelscht die Antwort des Coordinators. */
function netz(stimmeAendern: (s: any) => any = (s) => s, knoten = antwort(200, { ok: true, eingereicht: true, stimmen: 1, noetig: 1 })) {
  return jest.fn(async (ziel: string, init?: any) => {
    if (ziel.startsWith(`${URL}/besitznachweis`)) return antwort(200, { public_key: KEY, key_signature: SIG, human_wallet: W });
    if (ziel === `${URL}/pruefer/stimme`) {
      const b = JSON.parse(init.body);
      return antwort(200, stimmeAendern({
        zeit: b.zeit,
        bescheinigung: { public_key: KEY, signature: 'ee'.repeat(64), mensch: W, mensch_sig: b.freigabe, schluessel_sig: SIG },
      }));
    }
    if (ziel === `${API_BASE}/verifier/stimme`) return knoten;
    throw new Error('unerwartet: ' + ziel);
  });
}

describe('Saetze', () => {
  it('match coordinator and node exactly', () => {
    expect(auftragNachricht('aufnahme', KANDIDAT.toUpperCase().replace('0X', '0x'), 5)).toBe(`Aequitas: verifier vote aufnahme ${KANDIDAT} chain:1926 ts:5`);
    expect(antragNachricht(mensch.address, 7)).toBe(`Aequitas: apply as verifier ${W} chain:1926 ts:7`);
  });
});

describe('abstimmen', () => {
  it('signs the order and the key approval, checks the vote and submits it to the node', async () => {
    const f = netz();
    const r = await abstimmen(signerAus(mensch), URL, 'aufnahme', KANDIDAT, f as any, () => JETZT);
    expect(r).toEqual({ ok: true, eingereicht: true, stimmen: 1, noetig: 1 });
    const anCoord = JSON.parse((f.mock.calls.find((c) => c[0] === `${URL}/pruefer/stimme`) as any)[1].body);
    expect(anCoord).toMatchObject({ art: 'aufnahme', betroffener: KANDIDAT, zeit: JETZT });
    expect(ethers.verifyMessage(auftragNachricht('aufnahme', KANDIDAT, JETZT), anCoord.auftrag).toLowerCase()).toBe(W);
    expect(ethers.verifyMessage(coordinatorFreigabeNachricht(KEY), anCoord.freigabe).toLowerCase()).toBe(W);
    const anKnoten = JSON.parse((f.mock.calls.find((c) => c[0] === `${API_BASE}/verifier/stimme`) as any)[1].body);
    expect(anKnoten.art).toBe('aufnahme');
    expect(anKnoten.wallet).toBe(KANDIDAT);
    expect(anKnoten.stimme.bescheinigung.mensch).toBe(W);
    expect(Object.keys(anKnoten.stimme.bescheinigung).sort()).toEqual(['mensch', 'mensch_sig', 'public_key', 'schluessel_sig', 'signature']);
  });

  it('refuses a vote the coordinator altered (other key, other human, other time, extra or broken fields)', async () => {
    for (const aendern of [
      (s: any) => ({ ...s, zeit: s.zeit + 1 }),
      (s: any) => ({ ...s, bescheinigung: { ...s.bescheinigung, public_key: 'ff'.repeat(32) } }),
      (s: any) => ({ ...s, bescheinigung: { ...s.bescheinigung, mensch: fremd.address.toLowerCase() } }),
      (s: any) => ({ ...s, bescheinigung: { ...s.bescheinigung, mensch_sig: '0x' + '11'.repeat(65) } }),
      (s: any) => ({ ...s, bescheinigung: { ...s.bescheinigung, signature: 'zz' } }),
      (s: any) => ({ ...s, bescheinigung: undefined }),
    ]) {
      const f = netz(aendern);
      const r = await abstimmen(signerAus(mensch), URL, 'aufnahme', KANDIDAT, f as any, () => JETZT);
      expect(r).toEqual({ ok: false, fehler: 'stimme_ungueltig' });
      expect(f.mock.calls.some((c) => c[0] === `${API_BASE}/verifier/stimme`)).toBe(false);
    }
  });

  it('refuses a signature from another account before contacting the coordinator for a vote', async () => {
    const f = netz();
    const r = await abstimmen(signerAus(mensch, fremd), URL, 'aufnahme', KANDIDAT, f as any, () => JETZT);
    expect(r).toEqual({ ok: false, fehler: 'unterschrift_ungueltig' });
    expect(f.mock.calls.some((c) => c[0] === `${URL}/pruefer/stimme`)).toBe(false);
  });

  it('refuses bad input: self-vote, leaving for someone else, bad address, unsafe coordinator URL', async () => {
    const f = netz();
    const s = signerAus(mensch);
    expect((await abstimmen(s, URL, 'aufnahme', W, f as any)).fehler).toBe('eingabe');
    expect((await abstimmen(s, URL, 'austritt', KANDIDAT, f as any)).fehler).toBe('eingabe');
    expect((await abstimmen(s, URL, 'aufnahme', 'nope', f as any)).fehler).toBe('eingabe');
    expect((await abstimmen(s, 'http://evil.example', 'aufnahme', KANDIDAT, f as any)).fehler).toBe('eingabe');
    expect((await abstimmen(s, URL, 'befoerderung' as any, KANDIDAT, f as any)).fehler).toBe('eingabe');
    expect(f).not.toHaveBeenCalled();
  });

  it('passes on refusals of coordinator and node', async () => {
    const coordNein = jest.fn(async (ziel: string) =>
      ziel.includes('/besitznachweis') ? antwort(200, { public_key: KEY, key_signature: SIG, human_wallet: W }) : antwort(403, { detail: 'auftrag_nicht_vom_betreiber' }));
    expect(await abstimmen(signerAus(mensch), URL, 'aufnahme', KANDIDAT, coordNein as any, () => JETZT))
      .toEqual({ ok: false, fehler: 'coordinator', meldung: 'auftrag_nicht_vom_betreiber' });
    const f = netz((s) => s, antwort(403, { error: 'invalid vote: voter is not a verifier' }));
    expect(await abstimmen(signerAus(mensch), URL, 'aufnahme', KANDIDAT, f as any, () => JETZT))
      .toEqual({ ok: false, fehler: 'abgelehnt', meldung: 'invalid vote: voter is not a verifier' });
  });
});

describe('bewerben', () => {
  it('signs the application with the wallet and submits it', async () => {
    const f = jest.fn().mockResolvedValue(antwort(200, { ok: true }));
    expect(await bewerben(signerAus(mensch), f as any, () => JETZT)).toEqual({ ok: true });
    const [ziel, init] = f.mock.calls[0];
    expect(ziel).toBe(`${API_BASE}/verifier/antrag`);
    const b = JSON.parse(init.body);
    expect(b.wallet).toBe(W);
    expect(b.zeit).toBe(JETZT);
    expect(ethers.verifyMessage(antragNachricht(W, JETZT), b.signatur).toLowerCase()).toBe(W);
  });

  it('does not submit a signature from another account', async () => {
    const f = jest.fn();
    expect(await bewerben(signerAus(mensch, fremd), f as any)).toEqual({ ok: false, fehler: 'unterschrift_ungueltig' });
    expect(f).not.toHaveBeenCalled();
  });
});

describe('holeRegisterStand', () => {
  it('keeps only well-formed entries and bounds the lists', async () => {
    const viele = Array.from({ length: 100 }, (_, i) => ({ wallet: '0x' + i.toString(16).padStart(40, '0'), zeit: i }));
    const f = jest.fn().mockResolvedValue(antwort(200, {
      aktiv: true,
      pruefer: [W, 'kaputt', 42],
      antraege: viele,
      abstimmungen: [
        { art: 'aufnahme', wallet: KANDIDAT, stimmen: [{ mensch: W, zeit: 1 }, { mensch: 'x' }], noetig: 1 },
        { art: 'boese', wallet: KANDIDAT, stimmen: [], noetig: 1 },
        { art: 'entzug', wallet: 'kaputt', stimmen: [], noetig: 1 },
      ],
    }));
    const s = await holeRegisterStand(f as any);
    expect(s!.aktiv).toBe(true);
    expect(s!.pruefer).toEqual([W]);
    expect(s!.antraege).toHaveLength(64);
    expect(s!.abstimmungen).toEqual([{ art: 'aufnahme', wallet: KANDIDAT, stimmen: [{ mensch: W, zeit: 1 }], noetig: 1 }]);
  });

  it('is null on errors', async () => {
    expect(await holeRegisterStand(jest.fn().mockResolvedValue(antwort(500, {})) as any)).toBeNull();
    expect(await holeRegisterStand(jest.fn().mockRejectedValue(new Error('x')) as any)).toBeNull();
  });
});
