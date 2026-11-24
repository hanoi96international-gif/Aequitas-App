// Abschnitts-Auftrag an die App als Präparatorin (lib/quantenSPraepAuftrag.ts)
// gegen den Prüfvektor des Knotens (aequitas
// x/humanity/keeper/quanten_s_praep_auftrag_vektor_test.go).
import { ethers } from 'ethers';
import vektor from './vektoren/quanten_s_praep_auftrag_vektor.json';
import { CHAIN_ID, abschnitt, basenVerschluesseln, unterschreiben } from '../quantenS';
import {
  AUFTRAG_ALT,
  AUFTRAG_MAX,
  auftragLesen,
  auftragNachricht,
  auftragPruefen,
  basenOeffnen,
  bestellungenLesen,
  type AbschnittAuftrag,
  type Bestellung,
} from '../quantenSPraepAuftrag';

const PRAEGER = vektor.praeger_schluessel_nur_test;
const ICH = vektor.praeparatoren_schluessel_nur_test[vektor.auftrag.x - 1];
const ANDERE = vektor.praeparatoren_schluessel_nur_test[0];
const JETZT = vektor.auftrag.zeit + 10;

const roh = (o: unknown) => ethers.toUtf8Bytes(JSON.stringify(o));
const auftrag = (): AbschnittAuftrag => auftragLesen(roh(vektor.auftrag));
const bestellung = (x: Partial<Bestellung> = {}): Bestellung => ({
  k: vektor.auftrag.k, ausgeber: vektor.auftrag.praeger, v: 3, t: 2, zeit: vektor.auftrag.zeit - 600, frist: vektor.auftrag.zeit + 3000,
  los: [...vektor.auftrag.validatoren], ...x,
});

/** Ein veränderter Auftrag, vom Ausgeber neu unterschrieben (prüft so genau die eine Regel). */
function neuUnterschrieben(x: Partial<AbschnittAuftrag>): AbschnittAuftrag {
  const q = { ...auftrag(), ...x };
  return { ...q, praeger_sig: unterschreiben(PRAEGER, auftragNachricht(q)) };
}

function festerZufall(saat: string) {
  let n = 0;
  return (len: number) => {
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i += 32) out.set(ethers.getBytes(ethers.sha256(ethers.toUtf8Bytes(`${saat}|${n++}`))).slice(0, Math.min(32, len - i)), i);
    return out;
  };
}

describe('Prüfvektor Knoten ↔ App', () => {
  it('bildet die Nachricht des Ausgebers wie der Knoten', () => {
    expect(vektor.chain_id).toBe(CHAIN_ID);
    expect(auftragNachricht(auftrag())).toBe(vektor.auftrag_nachricht);
  });

  it('prüft den Auftrag und öffnet genau die Basen des Knotens', () => {
    const r = auftragPruefen(auftrag(), ICH, [bestellung()], JETZT);
    expect([r.von, r.bis]).toEqual([vektor.von, vektor.bis]);
    expect(r.y).toBe(vektor.basen);
    expect(r.auftragHash).toBe(ethers.sha256(ethers.toUtf8Bytes(vektor.auftrag_nachricht)).slice(2));
  });

  it('eine andere Präparatorin bekommt diesen Auftrag nicht durch', () => {
    expect(() => auftragPruefen(auftrag(), ANDERE, [bestellung()], JETZT)).toThrow('gehört nicht');
  });
});

describe('auftragPruefen weist ab', () => {
  const v = vektor.auftrag.validatoren;
  it.each([
    ['nicht bestellt', () => auftragPruefen(auftrag(), ICH, [], JETZT), 'nicht bestellt'],
    ['noch nicht gelost', () => auftragPruefen(auftrag(), ICH, [bestellung({ los: [] })], JETZT), 'gelost'],
    ['Bestellung verfallen', () => auftragPruefen(auftrag(), ICH, [bestellung({ frist: JETZT - 1 })], JETZT), 'verfallen'],
    ['fremder Ausgeber', () => auftragPruefen(auftrag(), ICH, [bestellung({ ausgeber: '0x' + '11'.repeat(20) })], JETZT), 'Bestellung'],
    ['anderes t bestellt', () => auftragPruefen(auftrag(), ICH, [bestellung({ t: 3 })], JETZT), 'Bestellung'],
    ['Los in anderer Reihenfolge', () => auftragPruefen(auftrag(), ICH, [bestellung({ los: [v[1], v[0], v[2]] })], JETZT), 'Losreihenfolge'],
    ['zweimal dieselbe Bestellung', () => auftragPruefen(auftrag(), ICH, [bestellung(), bestellung()], JETZT), 'nicht bestellt'],
    ['zu alt', () => auftragPruefen(auftrag(), ICH, [bestellung({ frist: JETZT + AUFTRAG_ALT })], vektor.auftrag.zeit + AUFTRAG_ALT + 1), 'Fenster'],
    ['aus der Zukunft', () => auftragPruefen(auftrag(), ICH, [bestellung()], vektor.auftrag.zeit - 301), 'Fenster'],
    ['nach der Unterschrift verändert', () => auftragPruefen({ ...auftrag(), zeit: vektor.auftrag.zeit + 1 }, ICH, [bestellung()], JETZT), 'unterschrieben'],
    ['Stellen vertauscht (ohne neue Unterschrift)', () => auftragPruefen({ ...auftrag(), stellen: [...vektor.auftrag.stellen].reverse(), stellen_schluessel: [...vektor.auftrag.stellen_schluessel].reverse() }, ICH, [bestellung()], JETZT), 'unterschrieben'],
    ['Basen im Klartext', () => auftragPruefen(neuUnterschrieben({ basen: '0'.repeat(vektor.bis - vektor.von), basen_verschluesselt: undefined }), ICH, [bestellung()], JETZT), 'nur verschlüsselt'],
    ['Basen zugleich im Klartext und verschlüsselt', () => auftragPruefen(neuUnterschrieben({ basen: '0'.repeat(vektor.bis - vektor.von) }), ICH, [bestellung()], JETZT), 'nur verschlüsselt'],
    ['Stichprobe v1', () => auftragPruefen(neuUnterschrieben({ probe_art: undefined }), ICH, [bestellung()], JETZT), 'v2'],
    ['Präparatorin doppelt', () => auftragPruefen(neuUnterschrieben({ validatoren: [v[0], v[0], v[2]] }), ICH, [bestellung()], JETZT), 'doppelt'],
    ['falscher Schlüssel einer Präparatorin', () => auftragPruefen(neuUnterschrieben({ schluessel: [vektor.auftrag.schluessel[1], vektor.auftrag.schluessel[1], vektor.auftrag.schluessel[2]] }), ICH, [bestellung()], JETZT), 'Präparatorin 1'],
    ['Annahmestelle = Inhaberin', () => auftragPruefen(neuUnterschrieben({ stellen: [vektor.auftrag.inhaberin, vektor.auftrag.stellen[1]], stellen_schluessel: [vektor.auftrag.inhaberin_schluessel, vektor.auftrag.stellen_schluessel[1]] }), ICH, [bestellung()], JETZT), 'Annahmestelle 0'],
    ['unbekannte Toleranz', () => auftragPruefen(neuUnterschrieben({ tol: 99 }), ICH, [bestellung()], JETZT), 'Größen'],
    ['zu wenige Stellen', () => auftragPruefen(neuUnterschrieben({ n: 600 }), ICH, [bestellung()], JETZT), 'zu wenige'],
    ['K groß geschrieben', () => auftragPruefen(neuUnterschrieben({ k: vektor.auftrag.k.toUpperCase() }), ICH, [bestellung()], JETZT), 'K'],
  ])('%s', (_n, f, grund) => {
    expect(f).toThrow(grund);
  });

  it('Basen für eine andere Inhaberin (vom Ausgeber gültig unterschrieben)', () => {
    const v3 = vektor.auftrag.validatoren;
    const a = abschnitt(vektor.auftrag.n, 3, 2)!;
    const fremd = basenVerschluesseln(vektor.auftrag.schluessel[1], v3, vektor.auftrag.n, 2, '0x' + '22'.repeat(20), '1'.repeat(a.bis - a.von), festerZufall('x'));
    expect(() => auftragPruefen(neuUnterschrieben({ basen_verschluesselt: fremd }), ICH, [bestellung()], JETZT)).toThrow('andere Inhaberin');
  });

  it('Basen für einen anderen Abschnitt', () => {
    expect(() => basenOeffnen(ICH, vektor.auftrag.basen_verschluesselt, vektor.auftrag.n, vektor.auftrag.validatoren, 3, vektor.auftrag.inhaberin)).toThrow('anderen Abschnitt');
    expect(() => basenOeffnen(ANDERE, vektor.auftrag.basen_verschluesselt, vektor.auftrag.n, vektor.auftrag.validatoren, 2, vektor.auftrag.inhaberin)).toThrow('nicht für diese');
  });
});

describe('auftragLesen', () => {
  it.each([
    ['fremdes Feld', { ...vektor.auftrag, extra: 1 }, 'Feld extra'],
    ['Feld fehlt', { ...vektor.auftrag, k: undefined }, 'k fehlt'],
    ['Zahl als Text', { ...vektor.auftrag, n: '2400' }, 'n'],
    ['Liste zu lang', { ...vektor.auftrag, stellen: ['a', 'b', 'c'] }, 'Listen'],
    ['probe_art als Text', { ...vektor.auftrag, probe_art: '2' }, 'probe_art'],
  ])('weist ab: %s', (_n, o, grund) => {
    expect(() => auftragLesen(roh(o))).toThrow(grund);
  });

  it('weist kein JSON und zu Großes ab', () => {
    expect(() => auftragLesen(ethers.toUtf8Bytes('{'))).toThrow('kein JSON');
    expect(() => auftragLesen(new Uint8Array(AUFTRAG_MAX + 1))).toThrow('zu groß');
  });
});

describe('bestellungenLesen', () => {
  const gut = { bestellungen: [{ k: vektor.auftrag.k, ausgeber: vektor.auftrag.praeger, v: 3, t: 2, zeit: 10, frist: 20, im_abbild: 5, runde: 7, deckung: 1, pfand: 1, los: vektor.auftrag.validatoren }] };
  it('liest Bestellungen mit und ohne Los', () => {
    expect(bestellungenLesen(gut)?.[0].los).toEqual(vektor.auftrag.validatoren);
    const ohne = { bestellungen: [{ ...gut.bestellungen[0], los: undefined }] };
    expect(bestellungenLesen(ohne)?.[0].los).toEqual([]);
  });
  it.each([
    ['Los zu kurz', { ...gut.bestellungen[0], los: vektor.auftrag.validatoren.slice(0, 2) }],
    ['Los doppelt', { ...gut.bestellungen[0], los: [vektor.auftrag.validatoren[0], vektor.auftrag.validatoren[0], vektor.auftrag.validatoren[2]] }],
    ['t > v', { ...gut.bestellungen[0], t: 4 }],
    ['Frist vor der Bestellung', { ...gut.bestellungen[0], frist: 5 }],
    ['Ausgeber groß', { ...gut.bestellungen[0], ausgeber: vektor.auftrag.praeger.toUpperCase() }],
  ])('weist ab: %s', (_n, b) => {
    expect(bestellungenLesen({ bestellungen: [b] })).toBeNull();
  });
});
