// Quantengeld Variante S, Weg B (B4b-3): die App als PRAEPARATORIN eines
// Abschnitts -- reine Bausteine ohne Netz (aequitas forschung/quantengeld/
// DEZENTRAL.md 18).
//
// Genau wie der Validator-Dienst des Knotens
// (aequitas x/humanity/keeper/quanten_s_abschnitt.go, quanten_s_abschnitt_dienst.go):
//
//  - abschnittWerte: gesalzene Werte w = u + 2 t + 4 (Stellen-Bit + 2 Salz),
//    123 Bit Salz, Stellen-Bits je Abschnitt genau zur Haelfte
//    (quantenSAbschnittWerte).
//  - koeffizienten / anteilAus: Shamir t-von-v ueber F_P, P = 2^127 - 1
//    (quantenSTeilen, quantenSAnteilAus).
//  - blaetter: Pruefsumme je Stelle (quantenWPruefsumme).
//  - buendelVersiegeln: die Anteile EINES Empfaengers als JSON, ECIES an dessen
//    Schluessel, EIP-191 unterschrieben ueber den Hash des Chiffrats
//    (quantenSBuendelVersiegeln, quantenSBuendelNachricht).
//
// Zufall kommt immer vom Aufrufer (im Geraet: expo-crypto); mit festem Zufall
// sind alle Ergebnisse reproduzierbar und gegen den Knoten pruefbar
// (lib/__tests__/vektoren/quanten_s_praep_buendel_vektor.json; der Knoten
// oeffnet das Buendel der App in quanten_s_praep_buendel_vektor_test.go).
// Nichts hier haelt einen Schluessel fest.
import { ethers } from 'ethers';
import { CHAIN_ID, eciesVerschluesseln, N_MAX, QuantenSFehler, unterschreiben, V_MAX } from './quantenS';
import { pruefsumme } from './quantenSStelle';

export const DOM_BUENDEL = 'aequitas-quanten-s-buendel-v1';
/** quantenWP */
export const P = (1n << 127n) - 1n;
/** quantenWSalzBits: das Salz hat ein Bit weniger (das unterste traegt das Stellen-Bit). */
export const SALZ_BITS = 124;
/** Versuche, bis ein Zufallswert unter der Grenze liegt (sonst Abbruch). */
const ZUFALL_VERSUCHE = 64;

export type Zufall = (n: number) => Uint8Array;

function fehler(text: string): never {
  throw new QuantenSFehler(text);
}

/** Gleichverteilt in [0, grenze) durch Verwerfen; kein Modulo-Versatz. */
export function zufallUnter(grenze: bigint, zufall: Zufall): bigint {
  if (grenze < 1n) fehler('Zufall: Grenze');
  if (grenze === 1n) return 0n;
  const bits = (grenze - 1n).toString(2).length;
  const bytes = Math.ceil(bits / 8);
  const maske = (1n << BigInt(bits)) - 1n;
  for (let i = 0; i < ZUFALL_VERSUCHE; i++) {
    const r = zufall(bytes);
    if (r.length !== bytes) fehler('Zufall');
    const k = BigInt(ethers.hexlify(r)) & maske;
    if (k < grenze) return k;
  }
  return fehler('Zufall: keine Zahl unter der Grenze');
}

function bit01(a: number[], name: string): void {
  if (!a.every((b) => b === 0 || b === 1)) fehler(`${name}: nur 0 und 1`);
}

/**
 * quantenSAbschnittWerte: zu Basen u und Werten t eines Abschnitts die
 * gesalzenen Werte. Stellen-Bits genau zur Haelfte (bei ungerader Laenge eine
 * mehr fuer Stelle 1), in zufaelliger Reihenfolge (Fisher-Yates).
 */
export function abschnittWerte(u: number[], t: number[], zufall: Zufall): bigint[] {
  const n = u.length;
  if (n === 0 || t.length !== n || n > N_MAX) fehler('Abschnitt: Basen und Werte');
  bit01(u, 'Basen');
  bit01(t, 'Werte');
  const reihe = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Number(zufallUnter(BigInt(i + 1), zufall));
    [reihe[i], reihe[j]] = [reihe[j], reihe[i]];
  }
  const bit = new Array<number>(n).fill(0);
  reihe.forEach((i, j) => {
    if (j >= Math.floor(n / 2)) bit[i] = 1;
  });
  const salzGrenze = 1n << BigInt(SALZ_BITS - 1);
  return u.map((ui, i) => {
    const s = zufallUnter(salzGrenze, zufall);
    return (((s << 1n) + BigInt(bit[i])) << 2n) + BigInt(ui + 2 * t[i]);
  });
}

/** Stellen-Bit eines Werts (quantenSStellenBit, Bit 2). */
export function stellenBit(w: bigint): number {
  return Number((w >> 2n) & 1n);
}

/** quantenWZerlegen: (Basis, Wert). */
export function zerlegen(w: bigint): [number, number] {
  return [Number(w & 1n), Number((w >> 1n) & 1n)];
}

/** Koeffizienten des Shamir-Polynoms: [w, c1 .. c(t-1)], ci gleichverteilt in F_P. */
export function koeffizienten(w: bigint, t: number, v: number, zufall: Zufall): bigint[] {
  if (!Number.isInteger(t) || !Number.isInteger(v) || t < 1 || t > v || v > V_MAX || w < 0n || w >= P) fehler('Teilen: Schwelle oder Wert');
  const k = [w];
  for (let j = 1; j < t; j++) k.push(zufallUnter(P, zufall));
  return k;
}

/** quantenSAnteilAus: Wert des Polynoms an x (Validator, 1-basiert), Horner mod P. */
export function anteilAus(koeff: bigint[], x: number): bigint {
  if (!Number.isInteger(x) || x < 1 || x > V_MAX || koeff.length < 1) fehler('Anteil: Validator');
  let y = 0n;
  for (let j = koeff.length - 1; j >= 0; j--) y = (y * BigInt(x) + koeff[j]) % P;
  return y;
}

/** Blaetter eines Abschnitts: Pruefsumme je Stelle von + i. */
export function blaetter(K: string, von: number, werte: bigint[]): string[] {
  return werte.map((w, i) => pruefsumme(K, von + i, w));
}

/** quantenSBuendelNachricht: was der Praeparator ueber das Chiffrat unterschreibt. */
export function buendelNachricht(K: string, praeparator: number, empfaenger: number, chiffrat: string): string {
  const h = ethers.sha256(ethers.toUtf8Bytes(chiffrat)).slice(2);
  return `${DOM_BUENDEL}|chain:${CHAIN_ID}|${K}|${praeparator}|${empfaenger}|${h}`;
}

export interface BuendelInhalt {
  K: string;
  von: number;
  bis: number;
  praeparator: number;
  empfaenger: number;
  anteile: bigint[];
}

/**
 * Inhalt als JSON in der Feldreihenfolge von quantenSBuendelInhalt (Go liest
 * streng: keine fremden Felder). Anteile als Hex ohne fuehrende Nullen wie
 * big.Int.Text(16). Pakete fuer die Annahmestellen (Stichprobe v2) folgen.
 */
export function buendelJson(b: BuendelInhalt): string {
  if (b.anteile.length !== b.bis - b.von || b.anteile.some((y) => y < 0n || y >= P)) fehler('Buendel: Anteile');
  if (b.praeparator === b.empfaenger) fehler('Buendel: an sich selbst');
  return JSON.stringify({
    dom: DOM_BUENDEL,
    k: b.K,
    von: b.von,
    bis: b.bis,
    praeparator: b.praeparator,
    empfaenger: b.empfaenger,
    anteile: b.anteile.map((y) => y.toString(16)),
  });
}

/** quantenSBuendelVersiegeln: verschluesseln fuer den Empfaenger, unterschreiben vom Praeparator. */
export function buendelVersiegeln(praepSchluessel: string, empfPub: string, b: BuendelInhalt, zufall: Zufall): { chiffrat: string; sig: string } {
  const chiffrat = eciesVerschluesseln(empfPub, ethers.toUtf8Bytes(buendelJson(b)), zufall);
  return { chiffrat, sig: unterschreiben(praepSchluessel, buendelNachricht(b.K, b.praeparator, b.empfaenger, chiffrat)) };
}
