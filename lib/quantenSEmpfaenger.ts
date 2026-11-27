// Weg C, Schritt C3 (forschung/quantengeld/WEG_C.md): ein Photonen-Empfänger
// gibt der App seine Messungen in EINEM festen Format. Erst wenn die
// Inhaberin die Photonen selbst misst, schützt die Physik den Token vor dem
// Verdoppeln: ein Photon lässt sich nicht kopieren, wer es misst, erfährt nur
// eine Basis.
//
// Was hier steht:
//   - empfaengerLesen: das Format "aequitas-empfaenger-v1", streng und
//     fail-closed gelesen (Größe vor dem Parsen, nur bekannte Felder, Pulse
//     aufsteigend und verschieden, Bits 0/1, Grenzen).
//   - meldungPruefen: die Meldung Lambda wie s_kette.s3_meldung (mindestens
//     gamma_det * N Pulse) -- die App meldet nie weniger, als die Kette will.
//   - teilmenge: die öffentliche Teilmenge wie s_kette.s3_teilmenge (die
//     n_max Pulse mit den kleinsten SHA-256(dom|K|"|"|zufall|"|"|i)) -- der
//     Zufall stammt aus einem Block NACH der Meldung.
//   - aufTeilmenge: Basen y und Messwerte x der Inhaberin für genau diese
//     Teilmenge, in ihrer Reihenfolge.
//   - empfaengerNachbau: ein Empfänger für Tests (Verluste, Messfehler,
//     Mehrphotonen-Pulse), NIE für echtes Geld.
//
// Was hier NICHT steht: ob ein Gerät ehrlich misst. Verkippung, Mehrphotonen-
// Anteil und Seitenkanäle misst man am Gerät (C5); die Kette rechnet die
// Prüfgröße damit (C1, quanten_s_leitung.go). Ein Gerät kann sich nicht selbst
// bescheinigen -- darum trägt das Format keine Geräteangaben.

import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { N_MAX, QuantenSFehler } from './quantenS';

export const EMPFAENGER_FORMAT = 'aequitas-empfaenger-v1';
/** Pulse je Ausgabe (wie s_kette.N_PULS_MAX; Kents Handsender: 4·10^7 in 4 s). */
export const N_PULS_MAX = 1 << 26;
/** Höchstens so viele Messungen je Datei (Kents Handsender: rund 760.000). */
export const MESSUNGEN_MAX = 1_000_000;
/** Höchstgröße des Textes, vor dem Parsen geprüft. */
export const EMPFAENGER_TEXT_MAX = 24 * 1024 * 1024;

const DOM_S3_TEIL = 'aequitas-quanten-s3-teilmenge-v1|';

export interface EmpfaengerMessung {
  k: string;
  nPuls: number;
  /** Pulsnummern, streng aufsteigend. */
  pulse: number[];
  /** je Puls die Basis der Messung (0/1) und das Ergebnis (0/1). */
  basen: Uint8Array;
  bits: Uint8Array;
}

function fehler(text: string): never {
  throw new QuantenSFehler(`Empfänger: ${text}`);
}

/**
 * Liest das Format streng. erwartetK: der Token, für den gemessen wurde (eine
 * Messung zu einem anderen K wird abgewiesen, nie umgedeutet).
 */
export function empfaengerLesen(text: string, erwartetK: string): EmpfaengerMessung {
  if (typeof text !== 'string' || text.length > EMPFAENGER_TEXT_MAX) fehler('zu groß');
  if (!/^[0-9a-f]{64}$/.test(erwartetK)) fehler('K unlesbar');
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch {
    fehler('kein JSON');
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) fehler('Form');
  const m = o as Record<string, unknown>;
  const felder = ['format', 'k', 'n_puls', 'messungen'];
  if (Object.keys(m).length !== felder.length || !felder.every((f) => f in m)) fehler('Felder');
  if (m.format !== EMPFAENGER_FORMAT) fehler('unbekanntes Format');
  if (m.k !== erwartetK) fehler('Messung gehört zu einem anderen Token');
  const nPuls = m.n_puls;
  if (typeof nPuls !== 'number' || !Number.isSafeInteger(nPuls) || nPuls < 1 || nPuls > N_PULS_MAX) fehler('n_puls');
  const ms = m.messungen;
  if (!Array.isArray(ms) || ms.length < 1 || ms.length > MESSUNGEN_MAX || ms.length > nPuls) fehler('messungen');
  const pulse: number[] = new Array(ms.length);
  const basen = new Uint8Array(ms.length);
  const bits = new Uint8Array(ms.length);
  let vorher = -1;
  for (let j = 0; j < ms.length; j++) {
    const e = ms[j];
    if (!Array.isArray(e) || e.length !== 3) fehler(`Messung ${j}: Form`);
    const [i, b, x] = e;
    if (typeof i !== 'number' || !Number.isSafeInteger(i) || i < 0 || i >= nPuls) fehler(`Messung ${j}: Puls`);
    if (i <= vorher) fehler(`Messung ${j}: Pulse nicht aufsteigend oder doppelt`);
    if ((b !== 0 && b !== 1) || (x !== 0 && x !== 1)) fehler(`Messung ${j}: Bits`);
    pulse[j] = i;
    basen[j] = b;
    bits[j] = x;
    vorher = i;
  }
  return { k: erwartetK, nPuls, pulse, basen, bits };
}

/** Wie s_kette.s3_meldung: mindestens gammaDetPpm/10^6 der Pulse gemessen. */
export function meldungPruefen(e: EmpfaengerMessung, gammaDetPpm: number): number[] {
  if (!Number.isSafeInteger(gammaDetPpm) || gammaDetPpm < 1 || gammaDetPpm > 1_000_000) fehler('gamma_det');
  if (e.pulse.length * 1_000_000 < gammaDetPpm * e.nPuls) {
    fehler(`${e.pulse.length} Pulse gemessen, verlangt ${gammaDetPpm} ppm von ${e.nPuls}`);
  }
  return e.pulse.slice();
}

function rangSchluessel(K: string, zufall: Uint8Array, i: number): string {
  const enc = new TextEncoder();
  const teile = [enc.encode(DOM_S3_TEIL), enc.encode(K), enc.encode('|'), zufall, enc.encode('|'), enc.encode(String(i))];
  const n = teile.reduce((s, t) => s + t.length, 0);
  const alles = new Uint8Array(n);
  let o = 0;
  for (const t of teile) {
    alles.set(t, o);
    o += t.length;
  }
  return bytesToHex(sha256(alles));
}

/**
 * Wie s_kette.s3_teilmenge: die nMax Pulse der Meldung mit den kleinsten
 * Rangschlüsseln, sortiert. zufallHex: 32 Byte aus einem Block NACH der
 * Meldung; die Höhen prüft die Kette, hier nur, dass sie so liegen.
 */
export function teilmenge(K: string, lambda: number[], zufallHex: string, meldungHoehe: number, zufallHoehe: number, nMax: number = N_MAX): number[] {
  if (!(zufallHoehe > meldungHoehe)) fehler('Zufall nicht nach der Meldung');
  if (!/^[0-9a-f]{64}$/.test(zufallHex) || !Number.isSafeInteger(nMax) || nMax < 1 || nMax > N_MAX) fehler('Teilmenge: Form');
  const z = hexToBytes(zufallHex);
  const rang = lambda.map((i) => ({ i, r: rangSchluessel(K, z, i) }));
  rang.sort((a, b) => (a.r < b.r ? -1 : a.r > b.r ? 1 : 0));
  return rang.slice(0, nMax).map((x) => x.i).sort((a, b) => a - b);
}

/** Basen y und Messwerte x der Inhaberin für die Teilmenge, in deren Reihenfolge. */
export function aufTeilmenge(e: EmpfaengerMessung, teil: number[]): { y: Uint8Array; x: Uint8Array } {
  const wo = new Map<number, number>();
  e.pulse.forEach((p, j) => wo.set(p, j));
  const y = new Uint8Array(teil.length);
  const x = new Uint8Array(teil.length);
  let vorher = -1;
  teil.forEach((p, n) => {
    if (p <= vorher) fehler('Teilmenge nicht aufsteigend');
    const j = wo.get(p);
    if (j === undefined) fehler(`Puls ${p} der Teilmenge wurde nicht gemessen`);
    y[n] = e.basen[j];
    x[n] = e.bits[j];
    vorher = p;
  });
  return { y, x };
}

// ------------------------------------------------------------ Nachbau (Tests)

export interface NachbauOptionen {
  k: string;
  nPuls: number;
  /** Wahrscheinlichkeit, dass ein Puls ankommt und gemessen wird. */
  pDet: number;
  /** Messfehler bei passender Basis. */
  fehler: number;
  /** Präparation je Puls: Basis u und Wert t. */
  praeparation: (i: number) => { u: number; t: number };
  /** Zufall in [0, 1). */
  zufall: () => number;
}

/**
 * Ein Empfänger zum Testen: misst jeden ankommenden Puls in einer zufälligen
 * Basis; passt sie, kommt t (mit Fehler), sonst ein Zufallsbit. NIE für
 * echtes Geld -- ein Nachbau schützt nichts.
 */
export function empfaengerNachbau(o: NachbauOptionen): string {
  const messungen: [number, number, number][] = [];
  for (let i = 0; i < o.nPuls; i++) {
    if (o.zufall() >= o.pDet) continue;
    const b = o.zufall() < 0.5 ? 0 : 1;
    const { u, t } = o.praeparation(i);
    let x = b === u ? t : o.zufall() < 0.5 ? 0 : 1;
    if (b === u && o.zufall() < o.fehler) x ^= 1;
    messungen.push([i, b, x]);
  }
  return JSON.stringify({ format: EMPFAENGER_FORMAT, k: o.k, n_puls: o.nPuls, messungen });
}
