/**
 * lib/quantenSEmpfaenger.ts (Weg C, C3): das Format des Photonen-Empfängers,
 * Meldung und Teilmenge gleich wie die Spezifikation (s_kette.py --vektor-s3),
 * und der Nachbau für Tests.
 */
import {
  aufTeilmenge,
  EMPFAENGER_FORMAT,
  EMPFAENGER_TEXT_MAX,
  empfaengerLesen,
  empfaengerNachbau,
  meldungPruefen,
  MESSUNGEN_MAX,
  N_PULS_MAX,
  teilmenge,
} from '../quantenSEmpfaenger';
import { QuantenSFehler } from '../quantenS';

const vektor = require('./vektoren/quanten_s3_vektor.json');

const K = 'ab'.repeat(32);
const text = (o: Record<string, unknown>) => JSON.stringify({ format: EMPFAENGER_FORMAT, k: K, n_puls: 10, messungen: [[1, 0, 1], [4, 1, 0]], ...o });

function zufallsquelle(saat: number) {
  let s = saat >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('Format lesen', () => {
  it('Gutfall', () => {
    const e = empfaengerLesen(text({}), K);
    expect(e.pulse).toEqual([1, 4]);
    expect(Array.from(e.basen)).toEqual([0, 1]);
    expect(Array.from(e.bits)).toEqual([1, 0]);
    expect(e.nPuls).toBe(10);
  });

  it.each([
    ['anderer Token', text({ k: 'cd'.repeat(32) })],
    ['anderes Format', text({ format: 'aequitas-empfaenger-v2' })],
    ['fremdes Feld (Gerät bescheinigt sich selbst)', text({ geraet: { theta: 0 } })],
    ['Feld fehlt', JSON.stringify({ format: EMPFAENGER_FORMAT, k: K, n_puls: 10 })],
    ['Pulse absteigend', text({ messungen: [[4, 0, 1], [1, 1, 0]] })],
    ['Puls doppelt (zweimal gemessen)', text({ messungen: [[4, 0, 1], [4, 1, 0]] })],
    ['Puls außerhalb', text({ messungen: [[10, 0, 1]] })],
    ['negativer Puls', text({ messungen: [[-1, 0, 1]] })],
    ['Bruch als Puls', text({ messungen: [[1.5, 0, 1]] })],
    ['Bit 2', text({ messungen: [[1, 0, 2]] })],
    ['Basis als Text', text({ messungen: [[1, '0', 1]] })],
    ['Messung mit 4 Werten', text({ messungen: [[1, 0, 1, 0]] })],
    ['keine Messung', text({ messungen: [] })],
    ['mehr Messungen als Pulse', text({ n_puls: 1, messungen: [[0, 0, 1], [1, 0, 1]] })],
    ['n_puls zu groß', text({ n_puls: N_PULS_MAX + 1 })],
    ['n_puls 0', text({ n_puls: 0 })],
    ['kein JSON', '{'],
    ['Liste statt Objekt', '[]'],
  ])('abgewiesen: %s', (_, t) => {
    expect(() => empfaengerLesen(t, K)).toThrow(QuantenSFehler);
  });

  it('Größe vor dem Parsen, Zahl der Messungen begrenzt', () => {
    expect(() => empfaengerLesen(' '.repeat(EMPFAENGER_TEXT_MAX + 1), K)).toThrow('zu groß');
    const viele = Array.from({ length: MESSUNGEN_MAX + 1 }, (_, i) => [i, 0, 0]);
    expect(() => empfaengerLesen(text({ n_puls: MESSUNGEN_MAX + 5, messungen: viele }), K)).toThrow('messungen');
  });

  it('K des Aufrufers muss lesbar sein', () => {
    expect(() => empfaengerLesen(text({}), 'xyz')).toThrow('K unlesbar');
  });
});

describe('gleich wie die Spezifikation (s_kette.py --vektor-s3)', () => {
  it('Teilmenge', () => {
    expect(teilmenge(vektor.k, vektor.lambda, vektor.zufall, 5, 6, 10)).toEqual(vektor.teilmenge_10);
    expect(teilmenge(vektor.k, vektor.lambda, vektor.zufall, 5, 6, 400)).toEqual(vektor.teilmenge_400);
    expect(teilmenge(vektor.k, vektor.lambda, '00'.repeat(32), 5, 6, 10)).toEqual(vektor.teilmenge_anderer_zufall);
  });

  it('Meldung', () => {
    for (const m of vektor.meldungen) {
      const e = { k: K, nPuls: m.n_puls, pulse: Array.from({ length: m.anzahl }, (_, i) => i), basen: new Uint8Array(m.anzahl), bits: new Uint8Array(m.anzahl) };
      const geht = (() => {
        try {
          meldungPruefen(e, m.gamma_det_ppm);
          return true;
        } catch {
          return false;
        }
      })();
      expect(geht).toBe(m.ok);
    }
  });

  it('Missbrauch: Zufall nicht nach der Meldung, Form', () => {
    expect(() => teilmenge(vektor.k, vektor.lambda, vektor.zufall, 6, 6)).toThrow('nicht nach der Meldung');
    expect(() => teilmenge(vektor.k, vektor.lambda, 'zz', 5, 6)).toThrow('Form');
    expect(() => teilmenge(vektor.k, vektor.lambda, vektor.zufall, 5, 6, 16385)).toThrow('Form');
  });
});

describe('auf die Teilmenge', () => {
  it('Basen und Werte in der Reihenfolge der Teilmenge', () => {
    const e = empfaengerLesen(text({ messungen: [[1, 0, 1], [4, 1, 0], [7, 1, 1]] }), K);
    const { y, x } = aufTeilmenge(e, [1, 7]);
    expect(Array.from(y)).toEqual([0, 1]);
    expect(Array.from(x)).toEqual([1, 1]);
  });

  it('Missbrauch: ein nicht gemessener Puls in der Teilmenge, Reihenfolge', () => {
    const e = empfaengerLesen(text({}), K);
    expect(() => aufTeilmenge(e, [1, 2])).toThrow('nicht gemessen');
    expect(() => aufTeilmenge(e, [4, 1])).toThrow('aufsteigend');
  });
});

describe('Nachbau', () => {
  const prae = (i: number) => ({ u: i % 2, t: (i * 7) % 3 === 0 ? 1 : 0 });

  it('liefert das Format, Verluste und Fehler wie eingestellt', () => {
    const t = empfaengerNachbau({ k: K, nPuls: 40_000, pDet: 0.05, fehler: 0.02, praeparation: prae, zufall: zufallsquelle(7) });
    const e = empfaengerLesen(t, K);
    expect(e.pulse.length).toBeGreaterThan(40_000 * 0.045);
    expect(e.pulse.length).toBeLessThan(40_000 * 0.055);
    let treffer = 0;
    let falsch = 0;
    e.pulse.forEach((p, j) => {
      const { u, t: wert } = prae(p);
      if (e.basen[j] === u) {
        treffer++;
        if (e.bits[j] !== wert) falsch++;
      }
    });
    expect(treffer / e.pulse.length).toBeGreaterThan(0.45);
    expect(falsch / treffer).toBeGreaterThan(0.005);
    expect(falsch / treffer).toBeLessThan(0.04);
    // Die Meldung reicht für gamma_det = 0,95 · P_det, nicht für P_det · 1,2.
    expect(() => meldungPruefen(e, 47_500)).not.toThrow();
    expect(() => meldungPruefen(e, 60_000)).toThrow();
  });

  it('bei falscher Basis ist das Ergebnis Zufall (die Inhaberin erfährt t nicht)', () => {
    const t = empfaengerNachbau({ k: K, nPuls: 40_000, pDet: 0.5, fehler: 0, praeparation: prae, zufall: zufallsquelle(11) });
    const e = empfaengerLesen(t, K);
    let anders = 0;
    let gleich = 0;
    e.pulse.forEach((p, j) => {
      const { u, t: wert } = prae(p);
      if (e.basen[j] !== u) {
        if (e.bits[j] === wert) gleich++;
        else anders++;
      }
    });
    const anteil = gleich / (gleich + anders);
    expect(anteil).toBeGreaterThan(0.47);
    expect(anteil).toBeLessThan(0.53);
  });
});
