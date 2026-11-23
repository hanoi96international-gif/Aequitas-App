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
import { adresseVon, antwortNachricht, CHAIN_ID, eciesVerschluesseln, hashListe, N_MAX, QuantenSFehler, unterschreiben, V_MAX } from './quantenS';
import { probeTeilHash, pruefsumme } from './quantenSStelle';

export const DOM_BUENDEL = 'aequitas-quanten-s-buendel-v1';
export const DOM_ANTEIL_OEFFNUNG = 'aequitas-quanten-s-anteil-oeffnung-v1';
export const DOM_FUER_INHABERIN = 'aequitas-quanten-s-fuer-inhaberin-v1';
export const DOM_OEFFNUNG = 'aequitas-quanten-s-oeffnung-v1';
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
  /** Stichprobe v2: je Annahmestelle b ein Paket (anteilOeffnungPakete); sonst leer. */
  oeffnung?: string[];
}

/**
 * Inhalt als JSON in der Feldreihenfolge von quantenSBuendelInhalt (Go liest
 * streng: keine fremden Felder). Anteile als Hex ohne fuehrende Nullen wie
 * big.Int.Text(16). oeffnung nur, wenn vorhanden (omitempty), dann genau zwei.
 */
export function buendelJson(b: BuendelInhalt): string {
  if (b.anteile.length !== b.bis - b.von || b.anteile.some((y) => y < 0n || y >= P)) fehler('Buendel: Anteile');
  if (b.praeparator === b.empfaenger) fehler('Buendel: an sich selbst');
  const oe = b.oeffnung ?? [];
  if (oe.length !== 0 && (oe.length !== 2 || oe.some((c) => !/^[0-9a-f]+$/.test(c)))) fehler('Buendel: Pakete fuer die Annahmestellen');
  return JSON.stringify({
    dom: DOM_BUENDEL,
    k: b.K,
    von: b.von,
    bis: b.bis,
    praeparator: b.praeparator,
    empfaenger: b.empfaenger,
    anteile: b.anteile.map((y) => y.toString(16)),
    ...(oe.length ? { oeffnung: oe } : {}),
  });
}

/** quantenSBuendelVersiegeln: verschluesseln fuer den Empfaenger, unterschreiben vom Praeparator. */
export function buendelVersiegeln(praepSchluessel: string, empfPub: string, b: BuendelInhalt, zufall: Zufall): { chiffrat: string; sig: string } {
  const chiffrat = eciesVerschluesseln(empfPub, ethers.toUtf8Bytes(buendelJson(b)), zufall);
  return { chiffrat, sig: unterschreiben(praepSchluessel, buendelNachricht(b.K, b.praeparator, b.empfaenger, chiffrat)) };
}

// ------------------------------------------------------------ Schluessel

/** quantenSSchluesselPruefen: unkomprimierter Schluessel (65 Byte) muss zur Adresse gehoeren. */
export function schluesselPruefen(pubHex: string, adresse: string): string {
  const pub = pubHex.trim().replace(/^0x/, '').toLowerCase();
  if (!/^04[0-9a-f]{128}$/.test(pub)) fehler('Schluessel: Form');
  let a: string;
  try {
    a = ethers.computeAddress('0x' + pub).toLowerCase();
  } catch {
    return fehler('Schluessel: kein Punkt der Kurve');
  }
  if (a !== adresse.trim().toLowerCase()) fehler('Schluessel gehoert nicht zur Adresse');
  return pub;
}

export interface Empfaenger {
  adresse: string;
  pub: string;
}

// ------------------------------------------------------------ Stichprobe v2 (quanten_s_probe_v2.go)

export interface ProbeV2 {
  /** je Annahmestelle b das Salz (hex, 32 Byte) -- geheim bis zur Oeffnung */
  salze: string[];
  /** je b der Teil-Hash ueber die Stellen mit Stellen-Bit b */
  teile: string[];
  /** je b (Treffer, Fehler): Treffer, wo y = u; Fehler, wo dort x != t */
  zaehlung: [number, number][];
}

/** quantenSAbschnittStand.probeV2: Salz, Teil-Hash und Zaehlung je Annahmestelle. */
export function probeV2(K: string, x: number, von: number, y: number[], u: number[], t: number[], xm: number[], werte: bigint[], zufall: Zufall): ProbeV2 {
  const n = werte.length;
  if (n === 0 || y.length !== n || u.length !== n || t.length !== n || xm.length !== n) fehler('Stichprobe v2: Laengen');
  for (const [a, name] of [[y, 'y'], [u, 'u'], [t, 't'], [xm, 'x']] as [number[], string][]) bit01(a, name);
  const out: ProbeV2 = { salze: [], teile: [], zaehlung: [] };
  for (let b = 0; b < 2; b++) {
    const salz = zufall(32);
    if (salz.length !== 32) fehler('Zufall');
    const salzHex = ethers.hexlify(salz).slice(2);
    const stellen: number[] = [];
    let tr = 0, fe = 0;
    werte.forEach((w, i) => {
      if (stellenBit(w) !== b) return;
      stellen.push(von + i);
      if (y[i] === u[i]) {
        tr++;
        if (xm[i] !== t[i]) fe++;
      }
    });
    out.salze.push(salzHex);
    out.teile.push(probeTeilHash(K, b, x, salzHex, stellen));
    out.zaehlung.push([tr, fe]);
  }
  return out;
}

/**
 * quantenSAbschnittStand.anteilOeffnungPakete (R9): fuer Validator empfaenger
 * je Annahmestelle b seine Anteile an GENAU den Stellen mit Stellen-Bit b und
 * das Salz von b, verschluesselt an b. empfaenger kann es nicht lesen.
 */
export function anteilOeffnungPakete(
  K: string,
  praeparator: number,
  empfaenger: number,
  von: number,
  bis: number,
  werte: bigint[],
  koeff: bigint[][],
  salze: string[],
  stellen: [Empfaenger, Empfaenger],
  zufall: Zufall,
): string[] {
  if (werte.length !== bis - von || koeff.length !== werte.length || salze.length !== 2 || stellen.length !== 2) fehler('Pakete: Laengen');
  if (salze.some((h) => !/^[0-9a-f]{64}$/.test(h))) fehler('Pakete: Salz');
  return [0, 1].map((b) => {
    const pub = schluesselPruefen(stellen[b].pub, stellen[b].adresse);
    const anteile: Record<string, string> = {};
    werte.forEach((w, i) => {
      if (stellenBit(w) === b) anteile[String(von + i)] = anteilAus(koeff[i], empfaenger).toString(16);
    });
    const roh = JSON.stringify({ dom: DOM_ANTEIL_OEFFNUNG, k: K, b, praeparator, empfaenger, von, bis, anteile, salz: salze[b] });
    return eciesVerschluesseln(pub, ethers.toUtf8Bytes(roh), zufall);
  });
}

// ------------------------------------------------------------ Inhaberin, Oeffnung, Antwort

/** fuer_inhaberin: x des Abschnitts, verschluesselt an die Inhaberin (abschnittAntwort). */
export function fuerInhaberin(inhaberin: Empfaenger, K: string, von: number, bis: number, xm: number[], zufall: Zufall): string {
  if (xm.length !== bis - von) fehler('fuer die Inhaberin: x');
  bit01(xm, 'x');
  const pub = schluesselPruefen(inhaberin.pub, inhaberin.adresse);
  const roh = JSON.stringify({ dom: DOM_FUER_INHABERIN, k: K, von, bis, x: xm.join('') });
  return eciesVerschluesseln(pub, ethers.toUtf8Bytes(roh), zufall);
}

/**
 * oeffnungFuerStelle: die Werte des eigenen Abschnitts mit Stellen-Bit b,
 * verschluesselt an die Annahmestelle b; bei Stichprobe v2 mit dem Salz von b.
 * Herausgeben erst, wenn Bindung und Wahl auf der Kette final sind -- das
 * prueft der Aufrufer (Ablauf, B4b-4), wie der Knoten in oeffnungFuerStelle.
 */
export function oeffnungFuerStelle(stelle: Empfaenger, K: string, b: number, x: number, von: number, bis: number, werte: bigint[], salz: string | null, zufall: Zufall): string {
  if (b !== 0 && b !== 1) fehler('Stelle 0 oder 1');
  if (werte.length !== bis - von) fehler('Oeffnung: Werte');
  if (salz !== null && !/^[0-9a-f]{64}$/.test(salz)) fehler('Oeffnung: Salz');
  const pub = schluesselPruefen(stelle.pub, stelle.adresse);
  const w: Record<string, string> = {};
  werte.forEach((v, i) => {
    if (stellenBit(v) === b) w[String(von + i)] = v.toString(16);
  });
  const inhalt: Record<string, unknown> = { dom: DOM_OEFFNUNG, k: K, b, x, von, bis, werte: w };
  if (salz !== null) inhalt.salz = salz;
  return eciesVerschluesseln(pub, ethers.toUtf8Bytes(JSON.stringify(inhalt)), zufall);
}

/** QuantenSAbschnittAntwort: was die Praeparatorin dem Ausgeber zurueckgibt. */
export interface Antwort {
  k: string;
  x: number;
  von: number;
  bis: number;
  blaetter: string[];
  fuer_inhaberin: string;
  buendel: string[];
  buendel_sig: string[];
  validator: string;
  sig: string;
  teile?: string[];
  zaehlung?: [number, number][];
  basen_hash?: string;
}

/** abschnittAntwort: unterschrieben ueber quantenSAbschnittAntwortNachricht. */
export function antwortUnterschreiben(schluessel: string, a: Omit<Antwort, 'validator' | 'sig'>): Antwort {
  if (a.blaetter.length !== a.bis - a.von || a.buendel.length !== a.buendel_sig.length) fehler('Antwort: Laengen');
  if (a.buendel[a.x - 1] !== '' || a.buendel_sig[a.x - 1] !== '') fehler('Antwort: Buendel an sich selbst');
  if ((a.teile == null) !== (a.zaehlung == null)) fehler('Antwort: Teile und Zaehlung nur zusammen');
  const m = antwortNachricht(a.k, a.x, a.von, a.bis, hashListe(a.blaetter), a.fuer_inhaberin, hashListe(a.buendel), hashListe(a.buendel_sig),
    a.teile ?? null, a.zaehlung ?? null, a.basen_hash ?? '');
  return { ...a, validator: adresseVon(schluessel), sig: unterschreiben(schluessel, m) };
}
