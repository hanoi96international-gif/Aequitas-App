// Quantengeld Weg B (B4b-4c-1): der Abschnitts-Auftrag an die App als
// Präparatorin.
//
// In Weg B schickt der Ausgeber den Auftrag als Hülle (Art `auftrag`,
// lib/quantenSHuelle.ts) an jede geloste Präparatorin. Er hat dieselbe Form
// wie der Auftrag an den Validator-Dienst (QuantenSAbschnittAnfrage in Aequitas
// x/humanity/keeper/quanten_s_abschnitt_dienst.go); die Basen y der Inhaberin
// sind an den Schlüssel der Präparatorin verschlüsselt
// (quanten_s_basen_chiffrat.go). Nachricht und Öffnen bildet die App genau wie
// der Knoten; der Prüfvektor lib/__tests__/vektoren/quanten_s_praep_auftrag_vektor.json
// (aus testdata/ im Knoten) hält das fest.
//
// `auftragPruefen` prüft wie quantenSAbschnittPruefen, in derselben Reihenfolge
// (billig vor teuer, Öffnen der Basen zuletzt), mit drei Unterschieden für Weg B:
//   - statt „Ausgeber ist ein Mensch mit Deckung“ und „K noch nicht ausgegeben“
//     (Kettenstand, den der Dienst selbst hält) die BESTELLUNG aus dem Register:
//     K bestellt, gelost, nicht verfallen, Ausgeber = Besteller, t und v wie
//     bestellt, und die Validatoren sind genau die Gelosten in Losreihenfolge.
//     Diese Angaben kommen von einem Knoten; ob die Ausgabe zum Los passt,
//     prüft ohnehin jeder Knoten selbst (quantenSAusgabeGegenLos). Die Prüfung
//     hier schützt die Präparatorin davor, für eine Ausgabe zu messen, die die
//     Kette nie annimmt.
//   - Basen NUR verschlüsselt: im Klartext würde der Ausgeber y kennen.
//   - Stichprobe NUR v2 (probe_art 2): sie ist der Ausweg aus Befund 5i
//     (bestochene Annahmestelle).
//
// Fail-closed: jede Abweichung wirft QuantenSFehler.

import { ethers } from 'ethers';
import {
  BASEN_CHIFFRAT_MAX,
  CHAIN_ID,
  N_MAX,
  QuantenSFehler,
  V_MAX,
  abschnitt,
  adresseVon,
  basenHash,
  eciesOeffnen,
  kNote,
  kanonisch,
  toleranzBekannt,
  unterschriftVon,
  validatorenHash,
} from './quantenS';
import { antwortBauen, schluesselPruefen, type Antwort, type AbschnittTresor, type Messung, type Zufall } from './quantenSPraeparieren';

const DOM_AUFTRAG = 'aequitas-quanten-s-abschnitt-auftrag-v1';
const DOM_BASEN = 'aequitas-quanten-s-basen-v1';
const T_MAX = 16; // quantenWTMax
/** quantenWAlt / quantenWVoraus: Fenster der Ausgabezeit. */
export const AUFTRAG_ALT = 86400;
export const AUFTRAG_VORAUS = 300;
/** Größter Auftrag als JSON: Basen-Chiffrat und je Validator Adresse + Schlüssel. */
export const AUFTRAG_MAX = BASEN_CHIFFRAT_MAX + V_MAX * (44 + 132 + 8) + 4096;

const ADRESSE = /^0x[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const BITS = /^[01]*$/;

export interface AbschnittAuftrag {
  k: string;
  n: number;
  t: number;
  tol: number;
  x: number;
  validatoren: string[];
  schluessel: string[];
  basen: string;
  basen_verschluesselt?: string;
  inhaberin: string;
  inhaberin_schluessel: string;
  stellen: string[];
  stellen_schluessel: string[];
  zeit: number;
  praeger: string;
  praeger_sig: string;
  probe_art?: number;
}

function fehler(text: string): never {
  throw new QuantenSFehler(text);
}

function ganz(x: unknown): x is number {
  return typeof x === 'number' && Number.isSafeInteger(x);
}

function texte(x: unknown, max: number): x is string[] {
  return Array.isArray(x) && x.length <= max && x.every((s) => typeof s === 'string');
}

const PFLICHT = ['basen', 'inhaberin', 'inhaberin_schluessel', 'k', 'n', 'praeger', 'praeger_sig', 'schluessel', 'stellen', 'stellen_schluessel', 't', 'tol', 'validatoren', 'x', 'zeit'];
const WAHL = ['basen_verschluesselt', 'probe_art'];

/** Den Auftrag aus der Nutzlast einer Hülle lesen: genau diese Felder, Typen streng. */
export function auftragLesen(nutzlast: Uint8Array): AbschnittAuftrag {
  if (nutzlast.length > AUFTRAG_MAX) fehler('Auftrag zu groß');
  let o: unknown;
  try {
    o = JSON.parse(ethers.toUtf8String(nutzlast));
  } catch {
    return fehler('Auftrag: kein JSON');
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) fehler('Auftrag: Form');
  const a = o as Record<string, unknown>;
  for (const k of Object.keys(a)) if (!PFLICHT.includes(k) && !WAHL.includes(k)) fehler(`Auftrag: Feld ${k}`);
  for (const k of PFLICHT) if (!(k in a)) fehler(`Auftrag: ${k} fehlt`);
  for (const k of ['k', 'basen', 'inhaberin', 'inhaberin_schluessel', 'praeger', 'praeger_sig']) if (typeof a[k] !== 'string') fehler(`Auftrag: ${k}`);
  for (const k of ['n', 't', 'tol', 'x', 'zeit']) if (!ganz(a[k])) fehler(`Auftrag: ${k}`);
  if (!texte(a.validatoren, V_MAX) || !texte(a.schluessel, V_MAX) || !texte(a.stellen, 2) || !texte(a.stellen_schluessel, 2)) fehler('Auftrag: Listen');
  if ('basen_verschluesselt' in a && typeof a.basen_verschluesselt !== 'string') fehler('Auftrag: basen_verschluesselt');
  if ('probe_art' in a && !ganz(a.probe_art)) fehler('Auftrag: probe_art');
  return a as unknown as AbschnittAuftrag;
}

/** quantenSAbschnittAuftragNachricht: was der Ausgeber unterschreibt. */
export function auftragNachricht(q: AbschnittAuftrag): string {
  const hb = ethers.sha256(ethers.toUtf8Bytes(q.basen)).slice(2);
  let m = `${DOM_AUFTRAG}|chain:${CHAIN_ID}|${q.praeger.toLowerCase()}|${q.k}|${q.n}|${q.t}|${q.tol}|${q.x}|${q.validatoren.join(',')}|${q.schluessel.join(',')}|${hb}|${q.inhaberin.toLowerCase()}|${q.inhaberin_schluessel}|${q.stellen.join(',')}|${q.stellen_schluessel.join(',')}|${q.zeit}`;
  if (q.probe_art) m += `|probe:${q.probe_art}`;
  if (q.basen_verschluesselt) m += '|basen:' + ethers.sha256(ethers.toUtf8Bytes(q.basen_verschluesselt)).slice(2);
  return m;
}

/**
 * quantenSBasenOeffnen: die Präparatorin (eigener Schlüssel) öffnet das
 * Chiffrat und prüft jedes Feld gegen den Auftrag. Heraus kommt y als '0'/'1'.
 */
export function basenOeffnen(schluessel: string, chiffrat: string, n: number, validatoren: string[], x: number, inhaberin: string): string {
  const v = validatoren.length;
  if (chiffrat.length === 0 || chiffrat.length > BASEN_CHIFFRAT_MAX || chiffrat.length % 2 !== 0 || !/^[0-9a-f]+$/.test(chiffrat)) {
    fehler('verschlüsselte Basen: Form oder Größe');
  }
  const a = abschnitt(n, v, x);
  if (!a) fehler('Abschnitte');
  let klar: Uint8Array;
  try {
    klar = eciesOeffnen(schluessel, chiffrat);
  } catch {
    return fehler('verschlüsselte Basen: nicht für diese Präparatorin');
  }
  let o: unknown;
  try {
    o = JSON.parse(ethers.toUtf8String(klar));
  } catch {
    return fehler('verschlüsselte Basen: Inhalt unlesbar');
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) fehler('verschlüsselte Basen: Inhalt unlesbar');
  const b = o as Record<string, unknown>;
  if (Object.keys(b).sort().join(',') !== 'an,basen,chain,dom,inhaberin,n,v,validatoren,x') fehler('verschlüsselte Basen: Inhalt unlesbar');
  if (b.dom !== DOM_BASEN || b.chain !== CHAIN_ID || b.an !== adresseVon(schluessel)) fehler('verschlüsselte Basen: Domäne, Kette oder Empfänger');
  if (b.n !== n || b.v !== v || b.x !== x || b.validatoren !== validatorenHash(validatoren)) fehler('verschlüsselte Basen: für einen anderen Abschnitt');
  if (b.inhaberin !== inhaberin.trim().toLowerCase()) fehler('verschlüsselte Basen: für eine andere Inhaberin');
  if (typeof b.basen !== 'string' || b.basen.length !== a.bis - a.von || !BITS.test(b.basen)) fehler(`verschlüsselte Basen: ${a.bis - a.von} Bits verlangt, nur 0 und 1`);
  return b.basen;
}

/** Eine Bestellung, wie GET /api/quanten-w/praeparatoren sie zeigt (quantenSBestellungAnsicht). */
export interface Bestellung {
  k: string;
  ausgeber: string;
  v: number;
  t: number;
  zeit: number;
  frist: number;
  /** Leer, solange nicht gelost. */
  los: string[];
}

/** Die Bestellungen aus der Antwort des Registers, streng gelesen (sonst null). */
export function bestellungenLesen(roh: unknown): Bestellung[] | null {
  if (!roh || typeof roh !== 'object' || Array.isArray(roh)) return null;
  const liste = (roh as Record<string, unknown>).bestellungen;
  if (!Array.isArray(liste) || liste.length > 1024) return null;
  const out: Bestellung[] = [];
  for (const e of liste) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) return null;
    const b = e as Record<string, unknown>;
    if (typeof b.k !== 'string' || !HEX64.test(b.k) || typeof b.ausgeber !== 'string' || !ADRESSE.test(b.ausgeber)) return null;
    if (!ganz(b.v) || b.v < 1 || b.v > V_MAX || !ganz(b.t) || b.t < 1 || b.t > b.v || !ganz(b.zeit) || !ganz(b.frist) || b.frist < b.zeit) return null;
    let los: string[] = [];
    if (b.los !== undefined) {
      if (!texte(b.los, V_MAX) || b.los.length !== b.v || !b.los.every((a) => ADRESSE.test(a)) || new Set(b.los).size !== b.los.length) return null;
      los = b.los;
    }
    out.push({ k: b.k, ausgeber: b.ausgeber, v: b.v, t: b.t, zeit: b.zeit, frist: b.frist, los });
  }
  return out;
}

export interface GepruefterAuftrag {
  von: number;
  bis: number;
  /** Basen y der Inhaberin auf dem eigenen Abschnitt, '0'/'1'. */
  y: string;
  /** SHA-256 der Auftragsnachricht: derselbe Auftrag noch einmal = dieselbe Antwort. */
  auftragHash: string;
}

/**
 * Den Auftrag ganz prüfen (siehe oben) und erst dann die Basen öffnen.
 * schluessel = eigener Schlüssel (die Wallet, deren pub im Register steht).
 */
export function auftragPruefen(q: AbschnittAuftrag, schluessel: string, bestellungen: Bestellung[], jetztSek: number): GepruefterAuftrag {
  const ich = adresseVon(schluessel);
  const K = q.k.trim().toLowerCase();
  if (!HEX64.test(K) || K !== q.k) fehler('K');
  const v = q.validatoren.length;
  if (q.schluessel.length !== v || q.stellen.length !== 2 || q.stellen_schluessel.length !== 2) fehler('Zahl der Schlüssel oder Annahmestellen');
  const gesehen = new Set<string>();
  q.validatoren.forEach((a, j) => {
    if (!ADRESSE.test(a) || gesehen.has(a)) fehler('Präparatorin nicht kanonisch oder doppelt');
    gesehen.add(a);
    try {
      schluesselPruefen(q.schluessel[j], a);
    } catch (e) {
      fehler(`Präparatorin ${j + 1}: ${(e as Error).message}`);
    }
  });
  if (q.x < 1 || q.x > v || q.validatoren[q.x - 1] !== ich) fehler(`Nummer ${q.x} gehört nicht zu dieser Präparatorin`);
  if (!ADRESSE.test(q.inhaberin)) fehler('Inhaberin');
  schluesselPruefen(q.inhaberin_schluessel, q.inhaberin);
  for (let b = 0; b < 2; b++) {
    const s = q.stellen[b];
    if (!ADRESSE.test(s) || s === q.inhaberin || (b === 1 && s === q.stellen[0])) fehler(`Annahmestelle ${b}`);
    schluesselPruefen(q.stellen_schluessel[b], s);
  }
  // Form des Tokens wie die Kette; jede Stelle bekommt mindestens k_note.
  if (q.n < 2 || q.n > N_MAX || q.t < 1 || q.t > T_MAX || v < q.t || v > V_MAX || !toleranzBekannt(q.tol)) fehler('Größen');
  const kn = kNote(q.tol, q.t, v);
  let klein = 0;
  for (let x = 1; x <= v; x++) {
    const a = abschnitt(q.n, v, x);
    if (!a) fehler('Abschnitte');
    klein += Math.floor((a.bis - a.von) / 2);
  }
  if (kn <= 0 || klein < kn) fehler(`zu wenige Stellen je Annahmestelle (${klein}, verlangt ${kn})`);
  const eigen = abschnitt(q.n, v, q.x);
  if (!eigen) fehler('Abschnitte');
  // Weg B: nur verschlüsselt und nur Stichprobe v2.
  if (q.basen !== '' || !q.basen_verschluesselt) fehler('Basen nur verschlüsselt');
  if (q.probe_art !== 2) fehler('Stichprobe nur v2');
  if (!ADRESSE.test(q.praeger) || !kanonisch(q.praeger_sig)) fehler('Auftrag nicht vom Ausgeber unterschrieben');
  const nachricht = auftragNachricht(q);
  if (!unterschriftVon(nachricht, q.praeger_sig, q.praeger)) fehler('Auftrag nicht vom Ausgeber unterschrieben');
  if (q.zeit < jetztSek - AUFTRAG_ALT || q.zeit > jetztSek + AUFTRAG_VORAUS) fehler('Ausgabezeit außerhalb des Fensters');
  // Weg B: die Bestellung (statt des Kettenstands des Dienstes).
  const best = bestellungen.filter((b) => b.k === K);
  if (best.length !== 1) fehler('K ist nicht bestellt');
  const b = best[0];
  if (b.los.length === 0) fehler('noch nicht gelost');
  if (jetztSek > b.frist) fehler('Bestellung verfallen');
  if (b.ausgeber !== q.praeger || b.t !== q.t || b.v !== v) fehler('Auftrag passt nicht zur Bestellung (Ausgeber, t oder v)');
  if (b.los.join(',') !== q.validatoren.join(',')) fehler('Präparatorinnen sind nicht die Gelosten in Losreihenfolge');
  // Der Ausgeber nie im eigenen Los (Kette seit 25.11.2026; hier noch einmal, fail-closed).
  if (q.validatoren.includes(q.praeger)) fehler('der Ausgeber steht selbst im Los');
  // Erst jetzt öffnen.
  const y = basenOeffnen(schluessel, q.basen_verschluesselt, q.n, q.validatoren, q.x, q.inhaberin);
  return { von: eigen.von, bis: eigen.bis, y, auftragHash: ethers.sha256(ethers.toUtf8Bytes(nachricht)).slice(2) };
}

/**
 * u und t der Präparatorin für n Stellen: je Bit aus einem eigenen Zufallsbyte
 * (gleichverteilt). Beide bleiben im Gerät; nur die Messung braucht sie.
 */
export function messbitsZiehen(n: number, zufall: Zufall): { u: number[]; t: number[] } {
  if (!Number.isInteger(n) || n < 1 || n > N_MAX) fehler('Stellen');
  const r = zufall(2 * n);
  if (r.length !== 2 * n) fehler('Zufall');
  const u = Array.from(r.slice(0, n), (b) => b & 1);
  const t = Array.from(r.slice(n), (b) => b & 1);
  return { u, t };
}

/**
 * Die Antwort auf einen geprüften Auftrag (auftragPruefen) aus der eigenen
 * Messung. y der Messung muss genau das y des Auftrags sein.
 */
export function antwortAufAuftrag(
  schluessel: string,
  q: AbschnittAuftrag,
  g: GepruefterAuftrag,
  m: Messung,
  zufall: Zufall,
): { antwort: Antwort; tresor: AbschnittTresor } {
  if (adresseVon(schluessel) !== q.validatoren[q.x - 1]) fehler('Antwort: nicht meine Nummer');
  if (m.y.join('') !== g.y) fehler('Messung mit anderen Basen als im Auftrag');
  if (!q.basen_verschluesselt) fehler('Basen nur verschlüsselt');
  return antwortBauen(schluessel, {
    K: q.k, x: q.x, t: q.t, von: g.von, bis: g.bis, schluessel: q.schluessel,
    stellen: [{ adresse: q.stellen[0], pub: q.stellen_schluessel[0] }, { adresse: q.stellen[1], pub: q.stellen_schluessel[1] }],
    inhaberin: { adresse: q.inhaberin, pub: q.inhaberin_schluessel },
    basenHash: basenHash(q.basen_verschluesselt),
  }, m, zufall);
}
