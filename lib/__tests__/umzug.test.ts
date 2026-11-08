// Umzug in der App (lib/umzug.ts): Code, Hash und Saetze byte-gleich zur
// Kette (umzug_test.go, TestUmzug_PruefvektorenFuerDieApp), Formen streng.
jest.mock('expo-crypto', () => ({ getRandomBytes: jest.fn() }));
import { ethers } from 'ethers';
import {
  antragEinreichen,
  antragNachricht,
  bescheinigungAusAntwort,
  codeAnzeige,
  codeErzeugen,
  codeHash,
  codeHinterlegen,
  codeNormal,
  codeSetzenNachricht,
  startNachricht,
  widerrufen,
  widerrufNachricht,
} from '../umzug';

const ALT = '0x00000000000000000000000000000000000000a1';

describe('Pruefvektoren wie in der Kette', () => {
  it('Code-Hash', () => {
    expect(codeHash(ALT, 'ABCDEFGHJKMNPQRSTVWXYZ01')).toBe('abfd9a9f06ddeadaf8b4a8ab9eb4f30363ceabbdb34e44b57cb9503d68529777');
    // an die Wallet gebunden
    expect(codeHash('0x00000000000000000000000000000000000000a2', 'ABCDEFGHJKMNPQRSTVWXYZ01')).not.toBe(
      codeHash(ALT, 'ABCDEFGHJKMNPQRSTVWXYZ01')
    );
  });
  it('Saetze', () => {
    expect(codeSetzenNachricht(ALT, 'ab', 7)).toBe(`aequitas-umzug-code-setzen-v1|chain:1926|${ALT}|ab|7`);
    expect(antragNachricht('42', ALT, '0xB', 9)).toBe(`aequitas-umzug-v1|chain:1926|42|${ALT}|0xb|9`);
    expect(widerrufNachricht('42', '0xb', 9)).toBe('aequitas-umzug-widerruf-v1|chain:1926|42|0xb|9');
    expect(startNachricht('0xABC', 'n1')).toBe('aequitas-umzug-start-v1|chain:1926|0xabc|n1');
  });
});

describe('Code', () => {
  it('24 Zeichen aus dem Alphabet, gleichverteilt ueber die unteren 5 Bit', () => {
    const c = codeErzeugen((n) => Uint8Array.from({ length: n }, (_, i) => i * 37));
    expect(c).toHaveLength(24);
    expect(codeNormal(c)).toBe(c);
    expect(codeAnzeige(c).split('-')).toHaveLength(6);
  });
  it('ohne Zufall kein Code', () => {
    expect(() => codeErzeugen(() => new Uint8Array(3))).toThrow();
  });
  it.each([
    ['abcd-efgh-jkmn-pqrs-tvwx-yz01', 'ABCDEFGHJKMNPQRSTVWXYZ01'],
    ['ABCD EFGH JKMN PQRS TVWX YZ01', 'ABCDEFGHJKMNPQRSTVWXYZ01'],
    ['ABCD-EFGH-JKMN-PQRS-TVWX-YZ0', null], // zu kurz
    // Abgeschrieben: O -> 0, I und L -> 1 (kommen in keinem Code vor).
    ['ABCD-EFGH-JKMN-PQRS-TVWX-YZOI', 'ABCDEFGHJKMNPQRSTVWXYZ01'],
    ['abcd-efgh-jkmn-pqrs-tvwx-yzol', 'ABCDEFGHJKMNPQRSTVWXYZ01'],
    ['ABCD-EFGH-JKMN-PQRS-TVWX-YZ0U', null], // U gibt es nicht
    ['ABCD-EFGH-JKMN-PQRS-TVWX-YZ0!', null],
    ['ABCD-EFGH-JKMN-PQRS-TVWX-YZ0\u0130', null], // tuerkisches I mit Punkt
    ['', null],
  ])('%s -> %s', (roh, erwartet) => {
    expect(codeNormal(roh)).toBe(erwartet);
  });
});

describe('Bescheinigung des Coordinators', () => {
  const gut = { status: 'bescheinigt', alt: ALT, nullifier: '42', zeit: 1800000000, modus: 'test', bescheinigung: ['v3:' + 'a'.repeat(128)], pruefung: 'streng' };
  it('gute Form', () => {
    expect(bescheinigungAusAntwort(gut)).toEqual({ alt: ALT, nullifier: '42', zeit: 1800000000, modus: 'test', bescheinigung: gut.bescheinigung, pruefung: 'streng' });
  });
  it.each([
    { ...gut, status: 'unbekanntes_gesicht' },
    { ...gut, alt: '0xABC' },
    { ...gut, nullifier: '042' },
    { ...gut, modus: 'Real' },
    { ...gut, zeit: -1 },
    { ...gut, bescheinigung: [] },
    { ...gut, bescheinigung: ['x:' + 'a'.repeat(10)] },
    { ...gut, bescheinigung: ['v3:a,b'] },
    { ...gut, pruefung: 'Streng' },
    { ...gut, pruefung: undefined },
  ])('Missbrauch wird nicht weitergereicht (%#)', (j) => {
    expect(bescheinigungAusAntwort(j)).toBeNull();
  });
});

function signerVon(w: ethers.Wallet) {
  return { address: w.address, signMessage: (m: string) => w.signMessage(m) } as any;
}

function fetchMerker(antwort: any, status = 200) {
  const aufrufe: { url: string; body: any }[] = [];
  const f = jest.fn(async (url: string, init?: any) => {
    aufrufe.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    return { ok: status === 200, status, json: async () => antwort } as any;
  });
  return { f: f as unknown as typeof fetch, aufrufe };
}

describe('An den Knoten', () => {
  const w = ethers.Wallet.createRandom();
  it('Code hinterlegen schickt nur den Hash, unterschrieben von dieser Wallet', async () => {
    const { f, aufrufe } = fetchMerker({ ok: true });
    const r = await codeHinterlegen(signerVon(w as any), 'abcd-efgh-jkmn-pqrs-tvwx-yz01', f, () => 7);
    expect(r.ok).toBe(true);
    const b = aufrufe[0].body;
    expect(b.code_hash).toBe(codeHash(w.address.toLowerCase(), 'ABCDEFGHJKMNPQRSTVWXYZ01'));
    expect(JSON.stringify(b)).not.toContain('ABCDEFGHJKMNPQRSTVWXYZ01');
    expect(ethers.verifyMessage(codeSetzenNachricht(w.address, b.code_hash, 7), b.sig).toLowerCase()).toBe(w.address.toLowerCase());
  });
  it('Antrag: Unterschrift der neuen Wallet, Code normalisiert, Frist gemeldet', async () => {
    const { f, aufrufe } = fetchMerker({ ok: true, sofort: false, frei_ab: 123 });
    const b = { alt: ALT, nullifier: '42', zeit: 9, modus: 'test' as const, bescheinigung: ['v3:' + 'a'.repeat(128)], pruefung: 'streng' as const };
    const r = await antragEinreichen(signerVon(w as any), b, null, f);
    expect(r).toEqual({ ok: true, sofort: false, freiAb: 123 });
    expect(aufrufe[0].body.code).toBe('');
    expect(ethers.verifyMessage(antragNachricht('42', ALT, w.address, 9), aufrufe[0].body.sig).toLowerCase()).toBe(w.address.toLowerCase());
  });
  it('Antrag mit kaputtem Code geht nicht raus', async () => {
    const { f, aufrufe } = fetchMerker({ ok: true });
    const b = { alt: ALT, nullifier: '42', zeit: 9, modus: 'test' as const, bescheinigung: ['v3:' + 'a'.repeat(128)], pruefung: 'streng' as const };
    expect((await antragEinreichen(signerVon(w as any), b, 'O0O0', f)).ok).toBe(false);
    expect(aufrufe).toHaveLength(0);
  });
  it('ohne Code und nur einfach geprueft: geht nicht raus (die Kette lehnte ab)', async () => {
    const { f, aufrufe } = fetchMerker({ ok: true });
    const b = { alt: ALT, nullifier: '42', zeit: 9, modus: 'test' as const, bescheinigung: ['v3:' + 'a'.repeat(128)], pruefung: 'einfach' as const };
    expect(await antragEinreichen(signerVon(w as any), b, null, f)).toEqual({ ok: false, meldung: 'nur_mit_code' });
    expect(aufrufe).toHaveLength(0);
  });
  it('Widerruf nur fuer die eigene alte Wallet', async () => {
    const { f, aufrufe } = fetchMerker({ ok: true });
    const fremd = { nullifier: '42', alt: ALT, neu: '0x00000000000000000000000000000000000000b2', angekuendigt: 5, freiAb: 0, fest: false };
    expect((await widerrufen(signerVon(w as any), fremd, f)).ok).toBe(false);
    expect(aufrufe).toHaveLength(0);
    const eigen = { ...fremd, alt: w.address.toLowerCase() };
    expect((await widerrufen(signerVon(w as any), eigen, f)).ok).toBe(true);
    expect(ethers.verifyMessage(widerrufNachricht('42', eigen.neu, 5), aufrufe[0].body.sig).toLowerCase()).toBe(w.address.toLowerCase());
  });
  it('Fehler des Knotens kommen als Meldung zurueck', async () => {
    const { f } = fetchMerker({ error: 'rejected: umzug_code: passt nicht' }, 409);
    const b = { alt: ALT, nullifier: '42', zeit: 9, modus: 'test' as const, bescheinigung: ['v3:' + 'a'.repeat(128)], pruefung: 'streng' as const };
    const r = await antragEinreichen(signerVon(w as any), b, 'abcd-efgh-jkmn-pqrs-tvwx-yz01', f);
    expect(r.ok).toBe(false);
    expect(r.meldung).toContain('umzug_code');
  });
});
