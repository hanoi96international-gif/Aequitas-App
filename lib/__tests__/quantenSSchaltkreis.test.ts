// Schaltkreis eines Abschnitts (lib/quantenSSchaltkreis.ts): dieselbe Physik
// wie hardware_ibm.py s_messen_basen, nur in nativen Gattern (rz, sx, x).
import {
  MAX_QUBITS_KREIS,
  abschnittAuswerten,
  abschnittKreise,
  alsQasm3,
  kreisGatter,
  mehrheit,
  schussBits,
  wahrscheinlichkeitEins,
} from '../quantenSSchaltkreis';

describe('Physik (exakt simuliert)', () => {
  it('passende Basis zeigt immer t, fremde Basis je zur Hälfte', () => {
    for (const u of [0, 1]) for (const t of [0, 1]) for (const y of [0, 1]) {
      const g = kreisGatter([u], [t], [y], [7]);
      const p = wahrscheinlichkeitEins(g, 7);
      if (u === y) expect(p).toBeCloseTo(t, 12);
      else expect(p).toBeCloseTo(0.5, 12);
    }
  });

  it('Stellen beeinflussen sich nicht (16 Stellen, alle Kombinationen gemischt)', () => {
    const u = [0, 0, 0, 0, 1, 1, 1, 1, 0, 1, 0, 1, 1, 0, 0, 1];
    const t = [0, 1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 0, 1, 1, 0, 0];
    const y = [0, 0, 1, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1];
    const q = Array.from({ length: 16 }, (_, i) => 100 + 3 * i);
    const g = kreisGatter(u, t, y, q);
    u.forEach((_, i) => {
      const p = wahrscheinlichkeitEins(g, q[i]);
      expect(p).toBeCloseTo(u[i] === y[i] ? t[i] : 0.5, 12);
    });
  });
});

describe('OpenQASM 3', () => {
  it('schreibt native Gatter auf physischen Qubits, Barriere vor dem Messen', () => {
    const g = kreisGatter([1, 0], [1, 1], [0, 1], [5, 9]);
    expect(alsQasm3(g, 2)).toBe(
      [
        'OPENQASM 3.0;',
        'include "stdgates.inc";',
        'bit[2] c;',
        'x $5;',
        'rz(pi/2) $5;',
        'sx $5;',
        'rz(pi/2) $5;',
        'x $9;',
        'barrier $5, $9;',
        'rz(pi/2) $9;',
        'sx $9;',
        'rz(pi/2) $9;',
        'c[0] = measure $5;',
        'c[1] = measure $9;',
        '',
      ].join('\n'),
    );
  });

  it('teilt einen Abschnitt in Schaltkreise zu höchstens 16 Stellen', () => {
    const n = 40;
    const z = Array.from({ length: n }, (_, i) => i % 2);
    const k = abschnittKreise(z, z, z, Array.from({ length: 16 }, (_, i) => i));
    expect(k.map((x) => x.n)).toEqual([16, 16, 8]);
    expect(k[2].qasm).toContain('bit[8] c;');
  });

  it.each([
    ['leer', [], [], [], []],
    ['17 Stellen', Array(17).fill(0), Array(17).fill(0), Array(17).fill(0), Array.from({ length: 17 }, (_, i) => i)],
    ['Längen', [0, 1], [0], [0, 1], [0, 1]],
    ['kein Bit', [2], [0], [0], [0]],
    ['Qubit doppelt', [0, 0], [0, 0], [0, 0], [3, 3]],
    ['Qubit negativ', [0], [0], [0], [-1]],
  ])('weist ab: %s', (_n, u, t, y, q) => {
    expect(() => kreisGatter(u as number[], t as number[], y as number[], q as number[])).toThrow();
  });
});

describe('Auswertung', () => {
  it('liest Bit i als Stelle i (Bit 0 rechts) und weist Bits über n ab', () => {
    expect(schussBits('0x1', 3)).toEqual([1, 0, 0]);
    expect(schussBits('0x6', 3)).toEqual([0, 1, 1]);
    expect(() => schussBits('0x8', 3)).toThrow();
    expect(() => schussBits('8', 3)).toThrow();
  });

  it('Mehrheit wie im Python: nur ungerade Zahl gleich langer Schüsse', () => {
    expect(mehrheit([[1, 0], [1, 1], [0, 1]])).toEqual([1, 1]);
    expect(() => mehrheit([[1], [0]])).toThrow();
    expect(() => mehrheit([[1], [0, 1], [1]])).toThrow();
    expect(() => mehrheit([])).toThrow();
  });

  it('wertet einen Abschnitt aus und prüft die Zahl der Schüsse', () => {
    const kreise = [{ n: 16 }, { n: 2 }];
    const x = abschnittAuswerten(kreise, [['0xffff', '0xfffe', '0x1'], ['0x2', '0x2', '0x3']], 3);
    expect(x).toEqual([...Array(16).fill(1), 0, 1]);
    expect(() => abschnittAuswerten(kreise, [['0x1', '0x1', '0x1']], 3)).toThrow('Zahl der Schaltkreise');
    expect(() => abschnittAuswerten(kreise, [['0x1', '0x1'], ['0x1', '0x1', '0x1']], 3)).toThrow('Schüsse');
    expect(() => abschnittAuswerten(kreise, [['0x1'], ['0x1']], 2)).toThrow('ungerade');
    expect(MAX_QUBITS_KREIS).toBe(16);
  });
});

// Regression gegen die mit qiskit geprüften Schaltkreise (40 Fälle, alle 8
// Kombinationen von u, t, y): dieselben Bytes wie damals.
import vektor from './vektoren/quanten_s_schaltkreis_vektor.json';

describe('Prüfvektor (mit qiskit gegen wiesner_hardware.note geprüft)', () => {
  it('erzeugt genau die geprüften Schaltkreise', () => {
    expect(vektor.faelle.length).toBe(40);
    for (const f of vektor.faelle) {
      const q = Array.from({ length: f.u.length }, (_, i) => i);
      expect(abschnittKreise(f.u, f.t, f.y, q)[0].qasm).toBe(f.qasm);
    }
  });
});
