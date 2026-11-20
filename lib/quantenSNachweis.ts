// Quantengeld Variante S: der Nachweis nach dem Ende (aequitas
// forschung/quantengeld/DEZENTRAL.md 17, R7) -- in der App nachgerechnet.
//
// Ist ein Token eingeloest oder tot und ist das Ende final, legt jeder
// Validator seinen Abschnitt offen: die gesalzenen Werte (Basis, Wert,
// Stellen-Bit je Stelle), die Salze der Stichprobe, die Messergebnisse der
// Inhaberin, Bindung d, Wahl c und die Stelle der Anmeldung. Die App rechnet
// daraus -- genau wie quantenSNachweisePruefen im Knoten (gegen den Pruefvektor
// getestet) -- Blaetter, Wurzel und Proben nach, gegen die Wurzel und Proben
// der Ausgabe, die die Annahmestelle VOR dem Anmelden von der Kette gelesen hat,
// und zaehlt Treffer und Fehler.
//
// Das zeigt: genau diese Praeparation war bei der Ausgabe festgelegt, so viele
// Messfehler gab es. Es zeigt NICHT, dass ein Quantenrechner gemessen hat.
import { ethers } from 'ethers';
import { CHAIN_ID, QuantenSFehler, abschnitt, kanonisch, merkleWurzel, probeHashV2, unterschriftVon } from './quantenS';
import { ABSCHNITT_MAX, apiPruefen, holeJson, type Umgebung, type ValidatorAngabe } from './quantenSInhaberin';
import { probeTeilHash, pruefsumme } from './quantenSStelle';

const DOM = 'aequitas-quanten-s-nachweis-v1';
const SALZ_BITS = 124n;
const HEX64 = /^[0-9a-f]{64}$/;
const BITS = /^[01]+$/;

function fehler(text: string): never {
  throw new QuantenSFehler(text);
}

/** QuantenSNachweis (quanten_s_nachweis.go), Felder in der Reihenfolge des Knotens. */
export interface Nachweis {
  dom: string;
  k: string;
  n: number;
  t: number;
  x: number;
  von: number;
  bis: number;
  validator: string;
  validatoren: string[];
  wurzel: string;
  proben: string[];
  werte: string[];
  salze: string[];
  x_inhaberin: string;
  d?: string;
  c?: number;
  stelle?: number;
  zeit: number;
  sig: string;
}

export interface NachweisBericht {
  k: string;
  n: number;
  v: number;
  wurzel: string;
  proben: string[];
  wurzel_gegen: '' | 'kette';
  stichprobe: [number, number];
  basen_bekannt: number;
  treffer: number;
  fehler: number;
  stelle?: number;
  stellen_uneinheitlich?: boolean;
  treffer_stelle: number;
  fehler_stelle: number;
}

const FELDER = 'bis,dom,k,n,proben,salze,sig,t,validator,validatoren,von,werte,wurzel,x,x_inhaberin,zeit';

/** quantenSNachweisNachricht: JSON wie Go (feste Reihenfolge, omitempty fuer d, c, stelle), ohne sig. */
export function nachweisNachricht(n: Nachweis): string {
  const o: Record<string, unknown> = {
    dom: n.dom, k: n.k, n: n.n, t: n.t, x: n.x, von: n.von, bis: n.bis, validator: n.validator, validatoren: n.validatoren,
    wurzel: n.wurzel, proben: n.proben, werte: n.werte, salze: n.salze, x_inhaberin: n.x_inhaberin,
  };
  if (n.d) o.d = n.d;
  if (n.c !== undefined && n.c !== null) o.c = n.c;
  if (n.stelle !== undefined && n.stelle !== null) o.stelle = n.stelle;
  o.zeit = n.zeit;
  o.sig = '';
  const h = ethers.sha256(ethers.toUtf8Bytes(JSON.stringify(o))).slice(2);
  return `${DOM}|chain:${CHAIN_ID}|${n.validator}|${n.k}|${n.x}|${h}`;
}

/** Streng wie DisallowUnknownFields: nur bekannte Felder, Pflichtfelder vorhanden. */
export function nachweisLesen(roh: unknown): Nachweis {
  if (!roh || typeof roh !== 'object' || Array.isArray(roh)) fehler('Nachweis: kein Objekt');
  const keys = Object.keys(roh as object);
  const pflicht = FELDER.split(',');
  if (pflicht.some((f) => !keys.includes(f)) || keys.some((f) => !pflicht.includes(f) && f !== 'd' && f !== 'c' && f !== 'stelle')) fehler('Nachweis: Felder');
  return roh as Nachweis;
}

/** quantenSNachweisePruefen: alle Validatoren zusammen, optional gegen Wurzel und Proben der Ausgabe. */
export function nachweisePruefen(K: string, validatoren: string[], nw: Nachweis[], soll: string | null, sollProben: string[] | null): NachweisBericht {
  const v = validatoren.length;
  if (v === 0 || nw.length !== v) fehler(`${nw.length} Nachweise fuer ${v} Validatoren`);
  const n = nw[0].n;
  if (!Number.isInteger(n) || n < 2 || n > 16384 || !HEX64.test(K)) fehler('n oder K');
  const ber: NachweisBericht = { k: K, n, v, wurzel: '', proben: [], wurzel_gegen: '', stichprobe: [0, 0], basen_bekannt: 0, treffer: 0, fehler: 0, treffer_stelle: 0, fehler_stelle: 0 };
  const blaetter: string[] = [];
  const werte: bigint[] = [];
  const xs: number[] = [];
  const dBits: number[] = new Array(n).fill(-1);
  const teile: [string[], string[]] = [[], []];
  let stelle = -2;
  let wahl = -2;
  const grenze = 1n << (SALZ_BITS + 2n);
  nw.forEach((a, j) => {
    const x = j + 1;
    const ab = abschnitt(n, v, x);
    if (a.dom !== DOM || a.k !== K || a.n !== n || a.x !== x || !ab || a.von !== ab.von || a.bis !== ab.bis) fehler(`Nachweis ${x}: K, n oder Abschnitt passen nicht`);
    if (a.validator !== validatoren[j] || !kanonisch(a.sig) || !unterschriftVon(nachweisNachricht(a), a.sig, validatoren[j])) fehler(`Nachweis ${x}: nicht von Validator ${validatoren[j]} unterschrieben`);
    const laenge = ab.bis - ab.von;
    if (!Array.isArray(a.werte) || a.werte.length !== laenge || !Array.isArray(a.salze) || a.salze.length !== 2 || a.x_inhaberin.length !== laenge) fehler(`Nachweis ${x}: Laengen`);
    if (j > 0 && (a.wurzel !== nw[0].wurzel || a.proben.join(',') !== nw[0].proben.join(',') || a.validatoren.join(',') !== validatoren.join(','))) {
      fehler(`Nachweis ${x}: Wurzel, Proben oder Validatoren anders als bei Validator 1`);
    }
    if (!BITS.test(a.x_inhaberin)) fehler(`Nachweis ${x}: x`);
    let da: string | null = null;
    if (a.d || (a.c !== undefined && a.c !== null)) {
      if (!a.d || a.d.length !== laenge || !BITS.test(a.d) || (a.c !== 0 && a.c !== 1)) fehler(`Nachweis ${x}: Bindung oder Wahl`);
      if (wahl === -2) wahl = a.c!;
      else if (wahl !== a.c) fehler('die Nachweise nennen verschiedene Wahlen');
      da = a.d;
    }
    if (a.stelle !== undefined && a.stelle !== null) {
      if (a.stelle !== 0 && a.stelle !== 1) fehler(`Nachweis ${x}: Stelle`);
      if (stelle === -2) stelle = a.stelle;
      else if (stelle !== a.stelle) ber.stellen_uneinheitlich = true;
    }
    const stellen: [number[], number[]] = [[], []];
    a.werte.forEach((wh, i) => {
      if (typeof wh !== 'string' || !/^[0-9a-f]{1,33}$/.test(wh)) fehler(`Nachweis ${x}: Wert ${i}`);
      const w = BigInt('0x' + wh);
      if (w >= grenze) fehler(`Nachweis ${x}: Wert ${i}`);
      blaetter.push(pruefsumme(K, ab.von + i, w));
      werte.push(w);
      stellen[Number((w >> 2n) & 1n)].push(ab.von + i);
      if (da) dBits[ab.von + i] = Number(da[i]);
    });
    for (let i = 0; i < laenge; i++) xs.push(Number(a.x_inhaberin[i]));
    for (const s of [0, 1] as const) {
      if (!HEX64.test(a.salze[s])) fehler(`Nachweis ${x}: Salz`);
      teile[s].push(probeTeilHash(K, s, x, a.salze[s], stellen[s]));
      ber.stichprobe[s] += stellen[s].length;
    }
  });
  ber.wurzel = merkleWurzel(blaetter);
  if (ber.wurzel !== nw[0].wurzel) fehler('die Werte ergeben nicht die Wurzel, die der Validator nennt');
  ber.proben = [probeHashV2(K, 0, teile[0]), probeHashV2(K, 1, teile[1])];
  if (nw[0].proben.length !== 2 || ber.proben[0] !== nw[0].proben[0] || ber.proben[1] !== nw[0].proben[1]) fehler('Werte und Salze ergeben nicht die Proben, die der Validator nennt');
  if (soll !== null) {
    if (ber.wurzel !== soll) fehler('BEFUND: die offengelegte Praeparation ergibt nicht die Wurzel der Ausgabe');
    ber.wurzel_gegen = 'kette';
  }
  if (sollProben !== null && (sollProben.length !== 2 || sollProben[0] !== ber.proben[0] || sollProben[1] !== ber.proben[1])) {
    fehler('BEFUND: die offengelegten Salze ergeben nicht die Proben der Ausgabe');
  }
  if (ber.stellen_uneinheitlich) stelle = -2;
  werte.forEach((w, i) => {
    if (stelle < 0 || wahl < 0 || dBits[i] < 0) return;
    const basis = dBits[i] ^ stelle ^ wahl;
    const u = Number(w & 1n);
    const t = Number((w >> 1n) & 1n);
    ber.basen_bekannt++;
    if (basis === u) {
      ber.treffer++;
      if (xs[i] !== t) ber.fehler++;
      if (Number((w >> 2n) & 1n) === stelle) {
        ber.treffer_stelle++;
        if (xs[i] !== t) ber.fehler_stelle++;
      }
    }
  });
  if (stelle >= 0) ber.stelle = stelle;
  return ber;
}

/**
 * nachweisAbwarten: von jedem Validator den Nachweis holen (bis er ihn nach
 * der Finalitaet herausgibt, hoechstens maxMs) und gegen Wurzel und Proben der
 * Ausgabe pruefen.
 */
export async function nachweisAbwarten(u: Umgebung, K: string, validatoren: ValidatorAngabe[], wurzel: string, proben: string[], maxMs: number): Promise<NachweisBericht> {
  const ende = u.jetzt() + maxMs;
  const nw: Nachweis[] = [];
  for (const v of validatoren) {
    for (;;) {
      try {
        const { status, json } = await holeJson(u, `${apiPruefen(v.api)}/quanten-w/validator/nachweis?k=${K}`, ABSCHNITT_MAX);
        if (status === 200) {
          nw.push(nachweisLesen(json));
          break;
        }
      } catch (e) {
        if (!(e instanceof QuantenSFehler)) throw e;
      }
      if (u.jetzt() >= ende) fehler('Nachweis: der Validator legt (noch) nicht offen');
      await u.warten(10_000);
    }
  }
  return nachweisePruefen(K, validatoren.map((v) => v.adresse.trim().toLowerCase()), nw, wurzel, proben);
}
