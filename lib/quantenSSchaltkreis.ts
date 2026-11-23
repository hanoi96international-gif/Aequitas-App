// Quantengeld Weg B (B4b): der Schaltkreis eines Abschnitts, im Handy gebaut.
//
// Vorbild: forschung/quantengeld/hardware_ibm.py s_messen_basen mit
// wiesner_hardware.note (Aequitas). Je Stelle i des Abschnitts:
//   präparieren:  X, wenn t_i = 1; H, wenn u_i = 1   (BB84-Zustand)
//   Barriere      (nichts darf über die Grenze gekürzt werden)
//   messen:       H, wenn y_i = 1 (Basis der Inhaberin); dann messen
// Höchstens 16 Stellen je Schaltkreis (MAX_QUBITS_NOTE), kein 2-Qubit-Gatter.
//
// IBM nimmt nur Schaltkreise in den nativen Gattern der Maschine (ISA) auf
// physischen Qubits an. Für diese Schaltkreise reicht das ohne qiskit:
// H = rz(π/2) · sx · rz(π/2) (bis auf eine globale Phase), X ist nativ. Die
// Richtigkeit belegt simuliereStelle (2×2, exakt): passt die Basis (y = u),
// kommt immer t heraus; sonst 0 und 1 je zur Hälfte.
//
// Auswertung wie im Python: Bit i des Ergebnisses = Stelle i (Bit 0 rechts),
// R Schüsse je Schaltkreis (R ungerade), je Stelle entscheidet die Mehrheit.

export const MAX_QUBITS_KREIS = 16;
export const MAX_WIEDERHOLUNGEN = 15;

export type Gatter = { art: 'x' | 'sx' | 'rz'; q: number; winkel?: number } | { art: 'barrier'; qs: number[] } | { art: 'measure'; q: number; bit: number };

function bits(name: string, a: number[]): void {
  if (!a.every((v) => v === 0 || v === 1)) throw new Error(`${name}: nur 0/1`);
}

function hadamard(q: number): Gatter[] {
  return [{ art: 'rz', q, winkel: Math.PI / 2 }, { art: 'sx', q }, { art: 'rz', q, winkel: Math.PI / 2 }];
}

/**
 * Gatter eines Schaltkreises für die Stellen u, t, y (je ≤ 16) auf den
 * physischen Qubits qubits (verschieden, ≥ 0). Bit i misst Stelle i.
 */
export function kreisGatter(u: number[], t: number[], y: number[], qubits: number[]): Gatter[] {
  const n = u.length;
  if (n < 1 || n > MAX_QUBITS_KREIS || t.length !== n || y.length !== n || qubits.length !== n) throw new Error('Kreis: Längen');
  bits('u', u);
  bits('t', t);
  bits('y', y);
  if (!qubits.every((q) => Number.isInteger(q) && q >= 0 && q < 100_000) || new Set(qubits).size !== n) throw new Error('Kreis: Qubits');
  const g: Gatter[] = [];
  for (let i = 0; i < n; i++) {
    if (t[i]) g.push({ art: 'x', q: qubits[i] });
    if (u[i]) g.push(...hadamard(qubits[i]));
  }
  g.push({ art: 'barrier', qs: [...qubits] });
  for (let i = 0; i < n; i++) {
    if (y[i]) g.push(...hadamard(qubits[i]));
  }
  for (let i = 0; i < n; i++) g.push({ art: 'measure', q: qubits[i], bit: i });
  return g;
}

/** OpenQASM 3 mit physischen Qubits ($k) und einem Register c[n]. */
export function alsQasm3(g: Gatter[], n: number): string {
  const z: string[] = ['OPENQASM 3.0;', 'include "stdgates.inc";', `bit[${n}] c;`];
  for (const x of g) {
    switch (x.art) {
      case 'x':
        z.push(`x $${x.q};`);
        break;
      case 'sx':
        z.push(`sx $${x.q};`);
        break;
      case 'rz':
        if (x.winkel !== Math.PI / 2) throw new Error('rz: nur π/2');
        z.push(`rz(pi/2) $${x.q};`);
        break;
      case 'barrier':
        z.push(`barrier ${x.qs.map((q) => '$' + q).join(', ')};`);
        break;
      case 'measure':
        z.push(`c[${x.bit}] = measure $${x.q};`);
        break;
    }
  }
  return z.join('\n') + '\n';
}

/** Die Schaltkreise eines Abschnitts: je 16 Stellen einer, alle auf denselben Qubits. */
export function abschnittKreise(u: number[], t: number[], y: number[], qubits: number[]): { qasm: string; n: number }[] {
  if (u.length < 1 || t.length !== u.length || y.length !== u.length) throw new Error('Abschnitt: Längen');
  const out: { qasm: string; n: number }[] = [];
  for (let i = 0; i < u.length; i += MAX_QUBITS_KREIS) {
    const n = Math.min(MAX_QUBITS_KREIS, u.length - i);
    out.push({ qasm: alsQasm3(kreisGatter(u.slice(i, i + n), t.slice(i, i + n), y.slice(i, i + n), qubits.slice(0, n)), n), n });
  }
  return out;
}

// ------------------------------------------------------------ Simulation

type K = [number, number]; // komplexe Zahl
const mul = (a: K, b: K): K => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const add = (a: K, b: K): K => [a[0] + b[0], a[1] + b[1]];

function anwenden(m: [K, K, K, K], v: [K, K]): [K, K] {
  return [add(mul(m[0], v[0]), mul(m[1], v[1])), add(mul(m[2], v[0]), mul(m[3], v[1]))];
}

const MATRIX: Record<'x' | 'sx' | 'rz', (w?: number) => [K, K, K, K]> = {
  x: () => [[0, 0], [1, 0], [1, 0], [0, 0]],
  // sx = ½ [[1+i, 1−i], [1−i, 1+i]]
  sx: () => [[0.5, 0.5], [0.5, -0.5], [0.5, -0.5], [0.5, 0.5]],
  // rz(θ) = diag(e^{−iθ/2}, e^{iθ/2})
  rz: (w = 0) => [[Math.cos(w / 2), -Math.sin(w / 2)], [0, 0], [0, 0], [Math.cos(w / 2), Math.sin(w / 2)]],
};

/**
 * Wahrscheinlichkeit, dass Stelle i (Qubit q) beim Messen 1 zeigt -- exakt
 * aus den Gattern (jede Stelle ist ein eigenes Qubit, nichts verschränkt).
 */
export function wahrscheinlichkeitEins(g: Gatter[], q: number): number {
  let v: [K, K] = [[1, 0], [0, 0]];
  for (const x of g) {
    if (x.art === 'barrier' || x.art === 'measure') continue;
    if (x.q !== q) continue;
    v = anwenden(MATRIX[x.art](x.winkel), v);
  }
  return v[1][0] * v[1][0] + v[1][1] * v[1][1];
}

// ------------------------------------------------------------ Auswertung

/**
 * Ein Schuss aus dem Ergebnis (Ganzzahl der Bits, hex wie "0x1b") in die
 * Stellenwerte: Bit i = Stelle i. Fail-closed bei Bits über n.
 */
export function schussBits(hex: string, n: number): number[] {
  if (!/^0x[0-9a-f]+$/i.test(hex) || n < 1 || n > MAX_QUBITS_KREIS) throw new Error('Schuss: Form');
  const v = BigInt(hex);
  if (v >> BigInt(n) !== 0n) throw new Error('Schuss: Bits über n');
  return Array.from({ length: n }, (_, i) => Number((v >> BigInt(i)) & 1n));
}

/** Je Stelle der Wert der Mehrheit (ungerade Zahl gleich langer Schüsse). */
export function mehrheit(schuesse: number[][]): number[] {
  if (schuesse.length === 0 || schuesse.length % 2 === 0 || new Set(schuesse.map((s) => s.length)).size !== 1) {
    throw new Error('Mehrheit: ungerade Zahl gleich langer Schüsse nötig');
  }
  return schuesse[0].map((_, i) => (2 * schuesse.reduce((s, a) => s + a[i], 0) > schuesse.length ? 1 : 0));
}

/**
 * Das Ergebnis x eines Abschnitts aus den Schüssen je Schaltkreis (gleiche
 * Reihenfolge wie abschnittKreise). Fail-closed: falsche Zahl der Schüsse
 * oder der Schaltkreise.
 */
export function abschnittAuswerten(kreise: { n: number }[], schuesseHex: string[][], wiederholungen: number): number[] {
  if (wiederholungen < 1 || wiederholungen > MAX_WIEDERHOLUNGEN || wiederholungen % 2 === 0) throw new Error('Wiederholungen ungerade');
  if (schuesseHex.length !== kreise.length) throw new Error('Ergebnis: Zahl der Schaltkreise');
  const x: number[] = [];
  kreise.forEach((k, j) => {
    if (schuesseHex[j].length !== wiederholungen) throw new Error(`Ergebnis: ${schuesseHex[j].length} statt ${wiederholungen} Schüsse`);
    x.push(...mehrheit(schuesseHex[j].map((h) => schussBits(h, k.n))));
  });
  return x;
}
