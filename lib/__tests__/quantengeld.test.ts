import { ethers } from 'ethers';
import {
  leseQuantenAbstimmungen,
  leseQuantenStand,
  quantenStimmenNoetig,
  QUANTEN_MINDEST_PRUEFER,
  ordnungBits,
  ordnungKurz,
  quantenAbstimmen,
  quantenAuftragNachricht,
  quantenStimmSatz,
  vorschlagGueltig,
  QUANTEN_VORLAUF_S,
} from '../quantengeld';
import { coordinatorFreigabeNachricht } from '../coordinatorBindung';
import { API_BASE } from '../config';
import type { AequitasSigner } from '../signer';

const mensch = ethers.Wallet.createRandom();
const fremd = ethers.Wallet.createRandom();
const W = mensch.address.toLowerCase();
const KEY = 'ab'.repeat(32);
const SIG = 'cd'.repeat(64);
const URL = 'https://proof1.aequitas.digital/coordinator';
const JETZT = 1_800_000_000;
const SATZ = 'csidh-8192';
const ORDNUNG = (BigInt(2) ** BigInt(256) + BigInt(297)).toString();
const AB = JETZT + 31 * 86400;

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
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text) } as unknown as Response;
}

describe('Saetze', () => {
  it('vote sentence matches the chain (quantenFreischaltungNachricht)', () => {
    expect(quantenStimmSatz('s', '123', 5, 7)).toBe('aequitas-quanten-freischaltung-v1|chain:1926|s|123|5|7');
  });
  it('order fingerprint is SHA-256 hex like the coordinator (hashlib)', () => {
    expect(ordnungKurz('123')).toBe('a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3');
  });
  it('order message for the wallet', () => {
    expect(quantenAuftragNachricht('s', '123', 5, 7)).toBe(`Aequitas: quantum money vote set s order-sha256 ${ordnungKurz('123')} ab 5 chain:1926 ts:7`);
  });
});

describe('vorschlagGueltig', () => {
  it('accepts a real-size set with 30 days lead', () => {
    expect(vorschlagGueltig(SATZ, ORDNUNG, JETZT + QUANTEN_VORLAUF_S, JETZT)).toBe(true);
    expect(ordnungBits(ORDNUNG)).toBe(257);
  });
  it('refuses lab/test sets, small or non-canonical orders and short lead time', () => {
    expect(vorschlagGueltig('labor-1', ORDNUNG, AB, JETZT)).toBe(false);
    expect(vorschlagGueltig('test', ORDNUNG, AB, JETZT)).toBe(false);
    expect(vorschlagGueltig('Gross', ORDNUNG, AB, JETZT)).toBe(false);
    expect(vorschlagGueltig(SATZ, (BigInt(2) ** BigInt(256) - BigInt(1)).toString(), AB, JETZT)).toBe(false);
    expect(vorschlagGueltig(SATZ, '0' + ORDNUNG, AB, JETZT)).toBe(false);
    expect(vorschlagGueltig(SATZ, (BigInt(2) ** BigInt(8193)).toString(), AB, JETZT)).toBe(false);
    expect(vorschlagGueltig(SATZ, ORDNUNG, JETZT + QUANTEN_VORLAUF_S - 1, JETZT)).toBe(false);
  });
});

describe('Stand und Abstimmungen', () => {
  const stand = { aktiv: true, topf: '0x' + '9'.repeat(40), saetze: [], noten: 0, gedeckt_aeq: 0, mindest_deckung: 1, ab: 1794748500 };
  it('reads the node status', () => {
    expect(leseQuantenStand(stand)).toEqual({ aktiv: true, topf: stand.topf, saetze: [], noten: 0, gedecktAeq: 0, mindestDeckung: 1 });
    expect(leseQuantenStand({ ...stand, saetze: [{ name: SATZ, ordnung_bits: 257, ab: AB, beschlossen: JETZT }] })?.saetze[0].name).toBe(SATZ);
  });
  it('reads the minimum number of verifiers, if the node reports a plausible one', () => {
    expect(leseQuantenStand({ ...stand, mindest_pruefer: 5 })?.mindestPruefer).toBe(5);
    expect(leseQuantenStand({ ...stand, mindest_pruefer: 0 })?.mindestPruefer).toBeUndefined();
    expect(leseQuantenStand({ ...stand, mindest_pruefer: 'x' })?.mindestPruefer).toBeUndefined();
    expect(leseQuantenStand({ ...stand, mindest_pruefer: 1e6 })?.mindestPruefer).toBeUndefined();
  });
  it('counts the votes an activation needs like the node: two thirds, at least the minimum', () => {
    expect(QUANTEN_MINDEST_PRUEFER).toBe(5);
    const erwartet: Record<number, number> = { 0: 5, 1: 5, 4: 5, 6: 5, 7: 5, 8: 6, 9: 6, 30: 20, 256: 171 };
    for (const [n, noetig] of Object.entries(erwartet)) expect(quantenStimmenNoetig(Number(n))).toBe(noetig);
    expect(quantenStimmenNoetig(3, 7)).toBe(7);
  });
  it('refuses malformed status', () => {
    expect(leseQuantenStand({ ...stand, topf: 'x' })).toBeNull();
    expect(leseQuantenStand({ ...stand, noten: -1 })).toBeNull();
    expect(leseQuantenStand({ ...stand, saetze: [{ name: 'BAD', ordnung_bits: 1, ab: 1, beschlossen: 1 }] })).toBeNull();
    expect(leseQuantenStand(null)).toBeNull();
  });
  it('reads open votes, at most 4', () => {
    const a = { satz: SATZ, ordnung: ORDNUNG, ab: AB, stimmen: 1, noetig: 1 };
    expect(leseQuantenAbstimmungen({ abstimmungen: [a] })).toEqual([a]);
    expect(leseQuantenAbstimmungen({ abstimmungen: [a, a, a, a, a] })).toBeNull();
    expect(leseQuantenAbstimmungen({ abstimmungen: [{ ...a, ordnung: '12x' }] })).toBeNull();
  });
});

describe('quantenAbstimmen', () => {
  const pqGut = jest.fn(async () => ({ pub: 'e'.repeat(3904), sig: 'f'.repeat(6618) }));

  function netz(stimmeVon: (body: any) => unknown) {
    const aufrufe: { url: string; body?: any }[] = [];
    const f = jest.fn(async (url: string, init?: any) => {
      const body = init?.body ? JSON.parse(init.body) : undefined;
      aufrufe.push({ url, body });
      if (url.startsWith(`${URL}/besitznachweis`)) return antwort(200, { public_key: KEY, key_signature: SIG, human_wallet: W });
      if (url === `${URL}/pruefer/quanten-stimme`) return antwort(200, stimmeVon(body));
      if (url === `${API_BASE}/quanten/stimme`) return antwort(200, { ok: true, stimmen: 1, noetig: 1, eingereicht: true });
      return antwort(404, {});
    });
    return { f, aufrufe };
  }

  const echteStimme = (body: any) => ({
    zeit: body.zeit,
    bescheinigung: { public_key: KEY, signature: SIG, mensch: W, mensch_sig: body.freigabe, schluessel_sig: SIG },
  });

  it('builds the vote, checks it and submits it with the PQ part', async () => {
    const { f, aufrufe } = netz(echteStimme);
    const r = await quantenAbstimmen(signerAus(mensch), URL, SATZ, ORDNUNG, AB, f as any, () => JETZT, pqGut);
    expect(r).toEqual({ ok: true, eingereicht: true, stimmen: 1, noetig: 1 });
    const coord = aufrufe.find((a) => a.url.endsWith('/pruefer/quanten-stimme'))!.body;
    expect(ethers.verifyMessage(quantenAuftragNachricht(SATZ, ORDNUNG, AB, JETZT), coord.auftrag).toLowerCase()).toBe(W);
    expect(ethers.verifyMessage(coordinatorFreigabeNachricht(KEY), coord.freigabe).toLowerCase()).toBe(W);
    const knoten = aufrufe.find((a) => a.url === `${API_BASE}/quanten/stimme`)!.body;
    expect(knoten).toEqual(expect.objectContaining({ satz: SATZ, ordnung: ORDNUNG, ab: AB }));
    expect(knoten.stimme.pq.pub).toHaveLength(3904);
    expect(pqGut).toHaveBeenCalledWith(W, quantenStimmSatz(SATZ, ORDNUNG, AB, JETZT), expect.anything());
  });

  it('without the vault nothing is signed and nothing is submitted', async () => {
    const { f, aufrufe } = netz(echteStimme);
    const sign = jest.fn(mensch.signMessage.bind(mensch));
    const s = { ...signerAus(mensch), signMessage: sign };
    const r = await quantenAbstimmen(s, URL, SATZ, ORDNUNG, AB, f as any, () => JETZT, async () => null);
    expect(r).toEqual({ ok: false, fehler: 'kein_pq' });
    expect(sign).not.toHaveBeenCalled();
    expect(aufrufe.some((a) => a.url === `${API_BASE}/quanten/stimme`)).toBe(false);
  });

  it('refuses an invalid proposal before any network call', async () => {
    const { f } = netz(echteStimme);
    expect(await quantenAbstimmen(signerAus(mensch), URL, 'labor-1', ORDNUNG, AB, f as any, () => JETZT, pqGut)).toEqual({ ok: false, fehler: 'eingabe' });
    expect(await quantenAbstimmen(signerAus(mensch), URL, SATZ, ORDNUNG, JETZT + 86400, f as any, () => JETZT, pqGut)).toEqual({ ok: false, fehler: 'eingabe' });
    expect(f).not.toHaveBeenCalled();
  });

  it('a coordinator vote for someone else or another time is not submitted', async () => {
    for (const falsch of [
      (b: any) => ({ ...echteStimme(b), zeit: b.zeit + 1 }),
      (b: any) => ({ ...echteStimme(b), bescheinigung: { ...echteStimme(b).bescheinigung, mensch: fremd.address.toLowerCase() } }),
      (b: any) => ({ ...echteStimme(b), bescheinigung: { ...echteStimme(b).bescheinigung, public_key: 'ef'.repeat(32) } }),
      (b: any) => ({ ...echteStimme(b), bescheinigung: { ...echteStimme(b).bescheinigung, signature: 'zz' } }),
    ]) {
      const { f, aufrufe } = netz(falsch);
      const r = await quantenAbstimmen(signerAus(mensch), URL, SATZ, ORDNUNG, AB, f as any, () => JETZT, pqGut);
      expect(r).toEqual({ ok: false, fehler: 'stimme_ungueltig' });
      expect(aufrufe.some((a) => a.url === `${API_BASE}/quanten/stimme`)).toBe(false);
    }
  });

  it('a wallet that signs with another key is caught', async () => {
    const { f } = netz(echteStimme);
    const r = await quantenAbstimmen(signerAus(mensch, fremd), URL, SATZ, ORDNUNG, AB, f as any, () => JETZT, pqGut);
    expect(r).toEqual({ ok: false, fehler: 'unterschrift_ungueltig' });
  });
});
