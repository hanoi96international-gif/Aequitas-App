// Prüfung vom 26.11.2026: Die Kette nimmt eine Bestellung nur an, wenn ihr
// Abbild mindestens 3 · v Konten hat (Knoten quantenSLosPoolFaktor) -- die
// Pilot-Anleitung nannte 9–10 Gemeldete für v = 7. Die App zählt vorher mit
// derselben Auswahl wie quantenSPraepAbbildLocked und sagt, wie viele fehlen.
import { ethers } from 'ethers';
import { adresseVon } from '../quantenS';
import { LOS_POOL_FAKTOR, losGroesse, losGroesseHolen, losNoetig, type AusgeberUmgebung } from '../quantenSAusgeber';
import type { Eintrag, Register } from '../quantenSPraeparator';

const JETZT = 1_800_000_000;
const TAG = 86400;
const schl = (i: number) => (i + 1).toString(16).padStart(64, '0');
const konto = (i: number) => adresseVon(schl(i));
/** öffentlicher Schlüssel wie im Register (unkomprimiert, ohne 0x) */
const pub = (i: number) => new ethers.SigningKey('0x' + schl(i)).publicKey.slice(2);

function eintrag(i: number, e: Partial<Eintrag> = {}): Eintrag {
  return { konto: konto(i), pub: '', gemeldet: JETZT - 2 * TAG, imLosAb: JETZT - TAG, ...e };
}

function register(eintraege: Eintrag[]): Register {
  return { aktiv: true, vorlauf: TAG, nachlauf: 8 * TAG, eintraege };
}

describe('losNoetig', () => {
  it('3 · v wie im Knoten: 21 für v = 7, 12 für v = 4', () => {
    expect(LOS_POOL_FAKTOR).toBe(3);
    expect(losNoetig(7)).toBe(21);
    expect(losNoetig(4)).toBe(12);
  });
});

describe('losGroesse', () => {
  it('zählt Gemeldete, die zur Bestellung im Los stünden', () => {
    const reg = register(Array.from({ length: 21 }, (_, i) => eintrag(i)));
    expect(losGroesse(reg, konto(99), JETZT, false)).toBe(21);
  });

  it('der Ausgeber zählt nie mit (Kettenregel: nie im eigenen Los)', () => {
    const reg = register(Array.from({ length: 21 }, (_, i) => eintrag(i)));
    expect(losGroesse(reg, konto(0), JETZT, false)).toBe(20);
    expect(losGroesse(reg, konto(0).toUpperCase().replace('0X', '0x'), JETZT, false)).toBe(20);
  });

  it('erst ab „im Los ab“ (Meldung + Vorlauf), genau an der Grenze schon', () => {
    const reg = register([eintrag(0, { imLosAb: JETZT + 1 }), eintrag(1, { imLosAb: JETZT })]);
    expect(losGroesse(reg, konto(99), JETZT, false)).toBe(1);
  });

  it('Abgemeldete nicht -- eine Abmeldung erst nach jetzt zählt noch nicht', () => {
    const reg = register([eintrag(0, { abgemeldet: JETZT }), eintrag(1, { abgemeldet: JETZT - 5 }), eintrag(2, { abgemeldet: JETZT + 5 })]);
    expect(losGroesse(reg, konto(99), JETZT, false)).toBe(1);
  });

  it('ab dem Stichtag des Pfands je Präparatorin (praep_pfand_ab) nur mit Pfand', () => {
    const reg = register([eintrag(0), eintrag(1, { pfand: 10_000_000 })]);
    expect(losGroesse(reg, konto(99), JETZT, false)).toBe(2);
    expect(losGroesse(reg, konto(99), JETZT, true)).toBe(1);
  });
});

describe('losGroesseHolen', () => {
  function umgebung(antworten: Record<string, unknown>): AusgeberUmgebung {
    const fetchFn = (async (url: string) => {
      const a = antworten[url];
      if (a === undefined) return { ok: false, status: 404, text: async () => '' };
      return { ok: true, status: 200, text: async () => JSON.stringify(a) };
    }) as unknown as typeof fetch;
    return { fetchFn, apiBasis: 'https://k.test/api', ablage: null as never, zufall: null as never, jetzt: () => JETZT * 1000 };
  }

  it('Register nicht lesbar: null (die Kette prüft dann selbst)', async () => {
    expect(await losGroesseHolen(umgebung({}), konto(99))).toBeNull();
    expect(await losGroesseHolen(umgebung({ 'https://k.test/api/quanten-w/praeparatoren': { kaputt: true } }), konto(99))).toBeNull();
  });

  it('Pfand zählt erst ab praep_pfand_ab (nicht ab pfaender_ab)', async () => {
    const roh = {
      aktiv: true, vorlauf: TAG, nachlauf: 8 * TAG,
      praeparatoren: [{ konto: konto(0), pub: pub(0), gemeldet: JETZT - 2 * TAG, im_los_ab: JETZT - TAG }],
    };
    const reg = 'https://k.test/api/quanten-w/praeparatoren';
    const st = 'https://k.test/api/status';
    expect(await losGroesseHolen(umgebung({ [reg]: roh, [st]: { quanten_w: { pfaender_ab: JETZT - 10 } } }), konto(99))).toBe(1);
    expect(await losGroesseHolen(umgebung({ [reg]: roh, [st]: { quanten_w: { praep_pfand_ab: JETZT - 10 } } }), konto(99))).toBe(0);
    expect(await losGroesseHolen(umgebung({ [reg]: roh, [st]: { quanten_w: { praep_pfand_ab: JETZT + 10 } } }), konto(99))).toBe(1);
  });

  it('leeres Register: 0', async () => {
    const u = umgebung({ 'https://k.test/api/quanten-w/praeparatoren': { aktiv: true, vorlauf: TAG, nachlauf: 8 * TAG, praeparatoren: [] } });
    expect(await losGroesseHolen(u, konto(99))).toBe(0);
  });
});
