// Weg C, Schritt C2b-2b-3c (forschung/quantengeld/WEG_C.md): die App als
// Inhaberin eines Tokens über eine Quantenleitung -- melden und ziehen.
//
// Ablauf auf der Kette (quanten_s3_vormerkung.go):
//   1. Der Ausgeber hat vorgemerkt: K, Inhaberin, Leitung, N Pulse, v Sender,
//      Wurzel, Deckung (GET /api/quanten-w/note?k=K zeigt art "s3").
//   2. Die Inhaberin misst die Photonen selbst (Empfänger, Format C3,
//      quantenSEmpfaenger.ts) und MELDET genau einmal die gemessenen Pulse:
//      je Abschnitt eines Senders mindestens gamma_det seiner Pulse (sonst
//      weist die Kette ab -- die App meldet nie weniger, als die Kette will).
//      Unterschrieben wird der SHA-256 des Meldungstexts.
//   3. Nach S3_ZIEH_ABSTAND zieht JEDER die Teilmenge mit der festen drand-Runde
//      (die erste ab Meldung + 600 s). Aus jedem Abschnitt gleich viele Pulse
//      (teilmengeAbschnitte, wie der Knoten).
//
// Was hier NICHT steht: ob das Gerät ehrlich misst (C5), und die Ausgabe
// selbst (Ausgeber, Validatoren). Alles ist streng und fail-closed: was nicht
// genau passt, wird abgewiesen, nie umgedeutet.

import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import { CHAIN_ID, N_MAX, QuantenSFehler, adresseVon, unterschreiben } from './quantenS';
import { EmpfaengerMessung, N_PULS_MAX, meldungPruefen } from './quantenSEmpfaenger';

/** Wie quantenS3ZiehAbstand: Meldung bis zur Runde, die zieht. */
export const S3_ZIEH_ABSTAND = 600;
/** Wie quantenS3MeldungTxHexMax: die Meldung in einer Transaktion. */
export const S3_MELDUNG_TX_HEX_MAX = 128 << 10;
/** Wie quantenS3MeldungMax: höchstens so viele Pulse in einer Meldung. */
export const MELDUNG_MAX = 1 << 16;
/** Wie quantenWVMax: höchstens so viele Sender. */
export const SENDER_MAX = 64;
/** drand quicknet (drand_zufall.go). */
export const DRAND_GENESIS = 1692803367;
export const DRAND_PERIODE = 3;

const DOM_MELDEN = 'aequitas-quanten-s3-melden-v1';
const DOM_S3_TEIL = 'aequitas-quanten-s3-teilmenge-v1|';
const HEX64 = /^[0-9a-f]{64}$/;
const ADRESSE = /^0x[0-9a-f]{40}$/;
const SIG_DRAND = /^[0-9a-f]{96}$/;

function fehler(text: string): never {
  throw new QuantenSFehler(`Weg C: ${text}`);
}

function ganz(x: unknown): x is number {
  return typeof x === 'number' && Number.isSafeInteger(x);
}

// ------------------------------------------------------------ Abschnitte

/** quantenS3AbschnittPulse: [von, bis) der Pulse von Sender x (1-basiert). */
export function abschnittPulse(nPuls: number, v: number, x: number): [number, number] {
  if (!ganz(nPuls) || !ganz(v) || !ganz(x) || v < 1 || v > SENDER_MAX || x < 1 || x > v || nPuls < v || nPuls > N_PULS_MAX) {
    fehler('Abschnitt');
  }
  return [Math.floor(((x - 1) * nPuls) / v), Math.floor((x * nPuls) / v)];
}

/** quantenS3MeldungPruefenAbschnitte: Summe und je Abschnitt mindestens gamma_det. */
export function meldungPruefenAbschnitte(e: EmpfaengerMessung, gammaDetPpm: number, v: number): number[] {
  const lam = meldungPruefen(e, gammaDetPpm);
  let j = 0;
  for (let x = 1; x <= v; x++) {
    const [von, bis] = abschnittPulse(e.nPuls, v, x);
    let zahl = 0;
    for (; j < lam.length && lam[j] < bis; j++) if (lam[j] >= von) zahl++;
    if (zahl * 1_000_000 < gammaDetPpm * (bis - von)) {
      fehler(`Abschnitt ${x}: ${zahl} von ${bis - von} Pulsen gemessen, verlangt ${gammaDetPpm} ppm`);
    }
  }
  return lam;
}

function rang(K: string, z: Uint8Array, lam: number[], n: number): number[] {
  const enc = new TextEncoder();
  const vorne = [enc.encode(DOM_S3_TEIL), enc.encode(K), enc.encode('|'), z, enc.encode('|')];
  const laenge = vorne.reduce((s, t) => s + t.length, 0);
  const r = lam.map((i) => {
    const zahl = enc.encode(String(i));
    const alles = new Uint8Array(laenge + zahl.length);
    let o = 0;
    for (const t of vorne) {
      alles.set(t, o);
      o += t.length;
    }
    alles.set(zahl, o);
    return { i, h: bytesToHex(sha256(alles)) };
  });
  r.sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : a.i - b.i));
  return r.slice(0, n).map((x) => x.i);
}

/**
 * quantenS3TeilmengeAbschnitte: aus jedem Abschnitt gleich viele Pulse
 * (je = min(kleinster Abschnitt, nMax / v)), je Abschnitt nach dem Rang der
 * Kette; aufsteigend. Mit v = 1 genau quantenSEmpfaenger.teilmenge.
 */
export function teilmengeAbschnitte(K: string, lambda: number[], zufallHex: string, meldungHoehe: number, zufallHoehe: number,
  nPuls: number, v: number, nMax: number = N_MAX): number[] {
  if (!(zufallHoehe > meldungHoehe)) fehler('Zufall nicht nach der Meldung');
  if (!HEX64.test(zufallHex) || !ganz(nMax) || nMax < 1 || nMax > N_MAX || !ganz(v) || v < 1 || v > nMax || lambda.length > MELDUNG_MAX) {
    fehler('Teilmenge: Form');
  }
  const z = hexToBytes(zufallHex);
  const teile: number[][] = [];
  let j = 0;
  for (let x = 1; x <= v; x++) {
    const [von, bis] = abschnittPulse(nPuls, v, x);
    const t: number[] = [];
    for (; j < lambda.length && lambda[j] < bis; j++) if (lambda[j] >= von) t.push(lambda[j]);
    teile.push(t);
  }
  let je = Math.floor(nMax / v);
  for (const t of teile) je = Math.min(je, t.length);
  if (je < 1) fehler('Teilmenge: ein Abschnitt ohne gemessenen Puls');
  const aus: number[] = [];
  for (const t of teile) aus.push(...rang(K, z, t, je));
  return aus.sort((a, b) => a - b);
}

// ------------------------------------------------------------ Kodierung

/** s3_kodieren / quantenS3Kodieren: Lücken als LEB128, Kleinbuchstaben-Hex. */
export function kodieren(lam: number[]): string {
  if (lam.length < 1 || lam.length > MELDUNG_MAX || !ganz(lam[0]) || lam[0] < 0 || lam[lam.length - 1] >= N_PULS_MAX) fehler('Kodierung: Form');
  const aus: number[] = [];
  let vorher = -1;
  for (const i of lam) {
    if (!ganz(i) || i <= vorher) fehler('Kodierung: Pulse nicht aufsteigend');
    let g = i - vorher - 1;
    for (;;) {
      const b = g & 0x7f;
      g = Math.floor(g / 128);
      aus.push(b | (g ? 0x80 : 0));
      if (!g) break;
    }
    vorher = i;
  }
  return bytesToHex(Uint8Array.from(aus));
}

// ------------------------------------------------------------ Vormerkung

/** Die Vormerkung, wie GET /api/quanten-w/note?k=K sie zeigt (quantenS3Ansicht). */
export interface S3Vormerkung {
  k: string;
  von: string;
  inhaber: string;
  leitung: string;
  theta: number;
  frei: number;
  gamma: number;
  nPuls: number;
  sender: number;
  wurzel: string;
  deckung: number;
  pfand: number;
  zeit: number;
  frist: number;
  gemeldet: number;
  meldung?: string;
  meldungZeit?: number;
  runde?: number;
  gezogen?: number;
}

/** Streng: nur art "s3" und genau dieses K; alles andere ist ein Fehler. */
export function vormerkungLesen(roh: unknown, K: string): S3Vormerkung {
  if (!HEX64.test(K)) fehler('K unlesbar');
  if (!roh || typeof roh !== 'object' || Array.isArray(roh)) fehler('Vormerkung: Form');
  const r = roh as Record<string, unknown>;
  if (r.art !== 's3' || r.k !== K) fehler('keine Vormerkung über eine Leitung zu diesem K');
  const zahlen = ['theta', 'frei', 'gamma', 'n_puls', 'sender', 'deckung', 'pfand', 'zeit', 'frist', 'gemeldet'];
  for (const f of zahlen) if (!ganz(r[f]) || (r[f] as number) < 0) fehler(`Vormerkung: ${f}`);
  for (const f of ['von', 'inhaber']) if (typeof r[f] !== 'string' || !ADRESSE.test(r[f] as string)) fehler(`Vormerkung: ${f}`);
  if (typeof r.leitung !== 'string' || !/^leitung-[a-z0-9-]{0,24}$/.test(r.leitung)) fehler('Vormerkung: Leitung');
  if (typeof r.wurzel !== 'string' || !HEX64.test(r.wurzel)) fehler('Vormerkung: Wurzel');
  const v: S3Vormerkung = {
    k: K, von: r.von as string, inhaber: r.inhaber as string, leitung: r.leitung, theta: r.theta as number, frei: r.frei as number,
    gamma: r.gamma as number, nPuls: r.n_puls as number, sender: r.sender as number, wurzel: r.wurzel, deckung: r.deckung as number,
    pfand: r.pfand as number, zeit: r.zeit as number, frist: r.frist as number, gemeldet: r.gemeldet as number,
  };
  if (v.gamma < 1 || v.gamma > 1_000_000 || v.nPuls < 1 || v.nPuls > N_PULS_MAX || v.sender < 1 || v.sender > SENDER_MAX || v.sender > v.nPuls) {
    fehler('Vormerkung: Größen');
  }
  if (v.gemeldet > 0) {
    if (typeof r.meldung !== 'string' || !HEX64.test(r.meldung) || !ganz(r.meldung_zeit) || !ganz(r.runde)) fehler('Vormerkung: Meldung');
    v.meldung = r.meldung;
    v.meldungZeit = r.meldung_zeit as number;
    v.runde = r.runde as number;
    if (v.runde !== ziehRunde(v.meldungZeit)) fehler('Vormerkung: Runde passt nicht zur Meldezeit');
  }
  if (r.gezogen !== undefined) {
    if (!ganz(r.gezogen) || v.gemeldet === 0) fehler('Vormerkung: gezogen');
    v.gezogen = r.gezogen;
  }
  return v;
}

// ------------------------------------------------------------ melden, ziehen

/** quantenS3MeldenNachricht: die Inhaberin unterschreibt den Hash der Meldung. */
export function meldenNachricht(wallet: string, K: string, meldungHashHex: string): string {
  return `${DOM_MELDEN}|chain:${CHAIN_ID}|${wallet.toLowerCase()}|${K}|${meldungHashHex}`;
}

export function meldungHash(text: string): string {
  return bytesToHex(sha256(utf8ToBytes(text)));
}

/** quantenS3ZiehRunde: die erste drand-Runde mit Zeit >= Meldezeit + 600 s. */
export function ziehRunde(meldungZeit: number): number {
  if (!ganz(meldungZeit) || meldungZeit <= 0) fehler('Meldezeit');
  const t = meldungZeit + S3_ZIEH_ABSTAND;
  if (t <= DRAND_GENESIS) return 1;
  const d = t - DRAND_GENESIS;
  return Math.floor(d / DRAND_PERIODE) + 1 + (d % DRAND_PERIODE !== 0 ? 1 : 0);
}

/** Zeit der drand-Runde r. */
export function zeitDerRunde(r: number): number {
  if (!ganz(r) || r < 1) fehler('Runde');
  return DRAND_GENESIS + (r - 1) * DRAND_PERIODE;
}

export interface Meldung {
  /** Körper für POST /api/quanten-w/s3_melden */
  koerper: string;
  /** der Meldungstext (Hex), fürs Ziehen aufbewahren */
  text: string;
  lambda: number[];
}

/**
 * Baut die Meldung der Inhaberin aus ihrer Messung. Prüft vorher: die
 * Vormerkung gehört zu ihr, ist nicht gemeldet und nicht verfallen, die
 * Messung passt (N), jeder Abschnitt erfüllt gamma_det, der Text passt in eine
 * Transaktion.
 */
export function meldenBauen(schluesselHex: string, v: S3Vormerkung, m: EmpfaengerMessung, jetzt: number): Meldung {
  const wallet = adresseVon(schluesselHex);
  if (wallet !== v.inhaber) fehler('diese Vormerkung gehört einer anderen Inhaberin');
  if (v.gemeldet !== 0) fehler('schon gemeldet (eine zweite Meldung gibt es nicht)');
  if (!ganz(jetzt) || jetzt > v.frist) fehler('Vormerkung verfallen');
  if (m.k !== v.k || m.nPuls !== v.nPuls) fehler('Messung passt nicht zur Vormerkung (K oder Zahl der Pulse)');
  const lambda = meldungPruefenAbschnitte(m, v.gamma, v.sender);
  const text = kodieren(lambda);
  if (text.length > S3_MELDUNG_TX_HEX_MAX) fehler(`Meldung ${text.length} Zeichen, höchstens ${S3_MELDUNG_TX_HEX_MAX}`);
  const sig = unterschreiben(schluesselHex, meldenNachricht(wallet, v.k, meldungHash(text)));
  return { koerper: JSON.stringify({ wallet, zeit: 0, quanten_w: { k: v.k, meldung: text, wallet_sig: sig } }), text, lambda };
}

/**
 * Körper für POST /api/quanten-w/s3_ziehen (ohne Wallet, jeder): die Meldung
 * noch einmal und die feste Runde mit ihrer drand-Signatur.
 */
export function ziehenBauen(v: S3Vormerkung, text: string, rundeSig: string): string {
  if (v.gemeldet === 0 || v.meldung === undefined || v.runde === undefined) fehler('noch nicht gemeldet');
  if (v.gezogen !== undefined) fehler('schon gezogen');
  if (meldungHash(text) !== v.meldung) fehler('nicht die gemeldete Meldung');
  if (!SIG_DRAND.test(rundeSig)) fehler('drand-Signatur unlesbar');
  return JSON.stringify({ wallet: '', zeit: 0, quanten_w: { k: v.k, meldung: text, runde: v.runde, runde_sig: rundeSig } });
}

/**
 * Die Teilmenge, die die Kette mit dieser Runde zieht (Zufall = SHA-256 der
 * drand-Signatur). Stelle i des Tokens ist Puls teil[i].
 */
export function teilNachZiehen(v: S3Vormerkung, lambda: number[], rundeSig: string): number[] {
  if (!SIG_DRAND.test(rundeSig)) fehler('drand-Signatur unlesbar');
  const zufall = bytesToHex(sha256(hexToBytes(rundeSig)));
  return teilmengeAbschnitte(v.k, lambda, zufall, 0, 1, v.nPuls, v.sender);
}
