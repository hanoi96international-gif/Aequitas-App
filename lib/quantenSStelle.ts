// Quantengeld Variante S: die App als ANNAHMESTELLE (aequitas
// forschung/quantengeld/DEZENTRAL.md 17, R6).
//
// Wer bei der Bestellung als Stelle genannt ist (Adresse und oeffentlicher
// Schluessel dieses Kontos), nimmt hier die Vorlage einer Inhaberin an -- den
// QR-Code aus deren App -- und loest den Token ein. Der Wert (die Deckung)
// geht dann an dieses Konto. Genau so wie quantenSAnnahmeLauf im Knoten
// (aequitas x/humanity/keeper/quanten_s_rollen.go), Schritt fuer Schritt gegen
// den Pruefvektor des Knotens getestet
// (lib/__tests__/vektoren/quanten_s_stelle_vektor.json):
//
//  1. Stand von der Kette: Token mit Stichprobe v2, gebunden und gewaehlt,
//     nicht tot, keine offene Anmeldung, Stelle b ist dieses Konto.
//  2. Die Vorlage ist von der Inhaberin AUF DER KETTE unterschrieben.
//  3. Die Blaetter von jedem Validator selbst (seine Unterschrift), zusammen
//     die Wurzel auf der Kette.
//  4. Erst nach der Finalitaet von Bindung und Wahl gibt jeder Validator die
//     Oeffnung fuer diese Stelle heraus (verschluesselt auf ihren Schluessel).
//     Jeder Wert passt zu seinem Blatt und gehoert zu dieser Stelle; Stichprobe
//     und Salze ergeben die Bindung der Ausgabe auf der Kette.
//  5. Vorab dieselbe Rechnung wie die Kette (Basis an Stelle b: d XOR b XOR c).
//  6. Anmelden (unterschrieben von diesem Konto), dann das Urteil der Kette.
//     Weicht es von der eigenen Rechnung ab: BEFUND.
//
// Fail-closed: jede Abweichung bricht ab, bevor angemeldet wird. Grenzen:
// Antworten hoechstens ABSCHNITT_MAX, Warten hoechstens WARTEN_MAX_MS je
// Schritt (das Urteil: Offenlegungsfrist der Kette plus Nachlauf).
import { ethers } from 'ethers';
import {
  CHAIN_ID,
  QuantenSFehler,
  abschnitt,
  abschnittPruefen,
  adresseVon,
  bestuende,
  eciesOeffnen,
  kNote,
  merkleWurzel,
  probeHashV2,
  pubVon,
  unterschreiben,
  unterschriftVon,
  kanonisch,
  vorlageText,
  type KettenStand,
} from './quantenS';
import {
  ABSCHNITT_MAX,
  WARTEN_MAX_MS,
  abschnittHolen,
  apiPruefen,
  einreichen,
  holeJson,
  stand,
  type Umgebung,
  type ValidatorAngabe,
  type Vorlage,
} from './quantenSInhaberin';

const DOM_POS = 'aequitas-quanten-w-pos-v1|chain:1926|';
const DOM_OEFFNUNG = 'aequitas-quanten-s-oeffnung-v1';
const DOM_PROBE_TEIL = 'aequitas-quanten-s-probe-teil-v1|';
const DOM_ANMELDEN = 'aequitas-quanten-s-anmelden-v1';
const SALZ_BITS = 124; // quantenWSalzBits
const FEHL_MAX = 3; // quantenWFehlMax
const FRIST_OFFEN_MS = 1800_000; // quantenWFristOffen
const NACHLAUF_MS = 3 * 60_000; // quantenSUrteilNachlauf
const NACHFRAGEN_MS = 2_000; // quantenSV2Nachfragen
const N_MAX = 16384;

const HEX64 = /^[0-9a-f]{64}$/;
const ADRESSE = /^0x[0-9a-f]{40}$/;

function fehler(text: string): never {
  throw new QuantenSFehler(text);
}

const utf8 = (s: string) => ethers.toUtf8Bytes(s);
const sha256Hex = (...t: Uint8Array[]) => ethers.sha256(ethers.concat(t)).slice(2);

// ------------------------------------------------------------ Rechnung (wie der Knoten)

/** quantenWPruefsumme: Blatt zu Stelle i und Wert w (16 Byte, big-endian). */
export function pruefsumme(K: string, i: number, w: bigint): string {
  if (w < 0n || w >= 1n << 128n) fehler('Wert');
  const vb = ethers.getBytes(ethers.toBeHex(w, 16));
  return sha256Hex(utf8(DOM_POS), utf8(K), utf8('|'), utf8(String(i)), utf8('|'), vb);
}

/** quantenSProbeTeilHash: Teil der Stichprobe von Stelle b im Abschnitt j. */
export function probeTeilHash(K: string, b: number, j: number, salzHex: string, stellen: number[]): string {
  if (!HEX64.test(salzHex)) fehler('Salz');
  const s = [...stellen].sort((a, c) => a - c);
  return sha256Hex(
    utf8(DOM_PROBE_TEIL), utf8(K), utf8('|'), utf8(String(b)), utf8('|'), utf8(String(j)), utf8('|'),
    ethers.getBytes('0x' + salzHex), utf8('|'), utf8(s.join(',')),
  );
}

/** quantenSProbeV2Pruefen: aus Stichprobe und Salzen die Bindung (hex). */
export function probeV2Pruefen(K: string, b: number, n: number, v: number, probe: number[], salze: string[]): string {
  if (b !== 0 && b !== 1) fehler('Stichprobe v2: Stelle');
  if (v < 1 || n < v || n > N_MAX || salze.length !== v) fehler('Stichprobe v2: ein Salz je Abschnitt');
  const s = [...probe].sort((a, c) => a - c);
  s.forEach((p, i) => {
    if (!Number.isInteger(p) || p < 0 || p >= n || (i > 0 && s[i - 1] === p)) fehler('Stichprobe v2: Stelle doppelt oder ausserhalb');
  });
  const teile: string[] = [];
  let k = 0;
  for (let j = 1; j <= v; j++) {
    const a = abschnitt(n, v, j);
    if (!a) fehler('Stichprobe v2: Abschnitte');
    const start = k;
    while (k < s.length && s[k] < a.bis) k++;
    if (start < k && s[start] < a.von) fehler('Stichprobe v2: Abschnitte');
    teile.push(probeTeilHash(K, b, j, salze[j - 1], s.slice(start, k)));
  }
  return probeHashV2(K, b, teile);
}

/** quantenWSAnmeldenNachricht: was die Stelle zur Anmeldung unterschreibt. */
export function anmeldenNachricht(wallet: string, K: string, b: string, xBits: string, probe: number[], fehl: number): string {
  return `${DOM_ANMELDEN}|chain:${CHAIN_ID}|${wallet.toLowerCase()}|${K}|${b}|${sha256Hex(utf8(xBits))}|${sha256Hex(utf8(probe.join(',')))}|${fehl}`;
}

/** quantenSOeffnungLesen (v2): die Werte des Abschnitts x fuer Stelle b und das Salz. */
export function oeffnungLesen(schluesselHex: string, chiffratHex: string, K: string, b: number, x: number, von: number, bis: number): { werte: Map<number, bigint>; salz: string } {
  if (chiffratHex.length === 0 || chiffratHex.length > ABSCHNITT_MAX) fehler('Oeffnung: Form');
  const roh = eciesOeffnen(schluesselHex, chiffratHex);
  let inhalt: any;
  try {
    inhalt = JSON.parse(ethers.toUtf8String(roh));
  } catch {
    fehler('Oeffnung: kein JSON');
  }
  // Streng wie im Knoten (DisallowUnknownFields); v2 verlangt das Salz.
  if (!inhalt || typeof inhalt !== 'object' || Array.isArray(inhalt) || Object.keys(inhalt).sort().join(',') !== 'b,bis,dom,k,salz,von,werte,x') {
    fehler('Oeffnung: Felder');
  }
  if (inhalt.dom !== DOM_OEFFNUNG || inhalt.k !== K || inhalt.b !== b || inhalt.x !== x || inhalt.von !== von || inhalt.bis !== bis) fehler('Oeffnung: passt nicht');
  if (typeof inhalt.salz !== 'string' || !HEX64.test(inhalt.salz)) fehler('Oeffnung: Salz');
  if (!inhalt.werte || typeof inhalt.werte !== 'object' || Array.isArray(inhalt.werte)) fehler('Oeffnung: Werte');
  const werte = new Map<number, bigint>();
  for (const [si, wh] of Object.entries(inhalt.werte)) {
    const i = Number(si);
    if (!/^(0|[1-9][0-9]*)$/.test(si) || i < von || i >= bis || typeof wh !== 'string' || !/^[0-9a-f]{1,33}$/.test(wh)) fehler(`Oeffnung: Stelle ${si}`);
    werte.set(i, BigInt('0x' + wh));
  }
  return { werte, salz: inhalt.salz };
}

/** quantenSOeffnungLaden: jede Stelle gegen ihr Blatt, Stellen-Bit = b; Basis und Wert. */
export function oeffnungLaden(b: number, K: string, n: number, wurzel: string, blaetter: string[], oeffnung: Map<number, bigint>, kSoll: number): Map<number, [number, number]> {
  if ((b !== 0 && b !== 1) || blaetter.length !== n || n > N_MAX || merkleWurzel(blaetter) !== wurzel) fehler('Ladung: Blaetter passen nicht zur Wurzel');
  if (kSoll <= 0 || oeffnung.size < kSoll) fehler(`Ladung: Stichprobe zu klein (${oeffnung.size} Stellen, verlangt ${kSoll})`);
  const grenze = 1n << BigInt(SALZ_BITS + 2);
  const out = new Map<number, [number, number]>();
  for (const [i, w] of oeffnung) {
    if (i < 0 || i >= n || w < 0n || w >= grenze || pruefsumme(K, i, w) !== blaetter[i]) fehler(`Ladung: Stelle ${i} passt nicht zu ihrem Blatt`);
    if (Number((w >> 2n) & 1n) !== b) fehler(`Ladung: Stelle ${i} gehoert zur anderen Annahmestelle`);
    out.set(i, [Number(w & 1n), Number((w >> 1n) & 1n)]);
  }
  return out;
}

// ------------------------------------------------------------ Vorlage und Kennung

/** Die kompakte Vorlage aus dem QR-Code: genau {k, b, x, vorlage}. */
export function vorlageLesen(text: string): Vorlage {
  if (text.length > 64 * 1024) fehler('Vorlage zu gross');
  let v: any;
  try {
    v = JSON.parse(text);
  } catch {
    fehler('Vorlage: kein JSON');
  }
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).sort().join(',') !== 'b,k,vorlage,x') fehler('Vorlage: genau k, b, x, vorlage');
  if (typeof v.k !== 'string' || !HEX64.test(v.k) || (v.b !== 0 && v.b !== 1) || typeof v.x !== 'string' || !/^[01]+$/.test(v.x) || typeof v.vorlage !== 'string') {
    fehler('Vorlage: Form');
  }
  return { k: v.k, b: v.b, x: v.x, vorlage: v.vorlage };
}

/** Wie eine Inhaberin dieses Konto als Annahmestelle eintraegt: "adresse=schluessel". */
export function stelleKennung(schluesselHex: string): string {
  return `${adresseVon(schluesselHex)}=${pubVon(schluesselHex)}`;
}

// ------------------------------------------------------------ Annehmen

export interface AnnahmeErgebnis {
  k: string;
  stelle_nummer: number;
  stelle: string;
  inhaberin: string;
  stichprobe: number;
  treffer: number;
  fehler: number;
  /** eigene Rechnung vor dem Anmelden: "besteht" oder "abgewiesen" */
  vorab: 'besteht' | 'abgewiesen';
  /** Urteil der Kette: "eingeloest", "abgewiesen" oder "frist" */
  urteil?: 'eingeloest' | 'abgewiesen' | 'frist';
  /** Wurzel und Proben der Ausgabe, vor dem Anmelden von der Kette gelesen (fuer den Nachweis nach dem Ende). */
  wurzel: string;
  proben: string[];
}

export type AnnahmeSchritt = 'pruefen' | 'blaetter' | 'oeffnung' | 'anmelden' | 'urteil';

const zahl = (v: unknown): number => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 1e6 ? v : -1);

async function standWarten(u: Umgebung, K: string, fertig: (st: KettenStand | null) => boolean, was: string, maxMs: number): Promise<KettenStand | null> {
  const ende = u.jetzt() + maxMs;
  for (;;) {
    const st = await stand(u, K);
    if (fertig(st)) return st;
    if (u.jetzt() >= ende) fehler(`${was}: nicht in ${Math.round(maxMs / 60_000)} Minuten`);
    await u.warten(5_000);
  }
}

async function oeffnungHolen(u: Umgebung, api: string, K: string, b: number, ende: number): Promise<string> {
  for (;;) {
    try {
      const { status, json } = await holeJson(u, `${apiPruefen(api)}/quanten-w/validator/oeffnung?k=${K}&b=${b}`, ABSCHNITT_MAX);
      const o = (json as { oeffnung?: unknown } | null)?.oeffnung;
      if (status === 200 && typeof o === 'string' && /^[0-9a-f]+$/.test(o)) return o;
    } catch (e) {
      // Vor der Finalitaet antwortet der Validator mit einem Fehler -- nachfragen.
      if (!(e instanceof QuantenSFehler)) throw e;
    }
    if (u.jetzt() >= ende) fehler('Oeffnung: der Validator gibt sie nicht heraus (Bindung und Wahl noch nicht final?)');
    await u.warten(NACHFRAGEN_MS);
  }
}

/**
 * annehmenAlsStelle: die Vorlage (Text des QR-Codes) an dieser Stelle einloesen.
 * schluesselHex: der Schluessel des Kontos, das bei der Bestellung als Stelle
 * genannt ist. validatoren: die Validatoren des Tokens mit ihrer API, in der
 * Reihenfolge der Abschnitte (nennt die Stelle selbst, nie die Vorlage).
 */
export async function annehmenAlsStelle(
  u: Umgebung,
  schluesselHex: string,
  vorlageRoh: string,
  validatoren: ValidatorAngabe[],
  fortschritt: (s: AnnahmeSchritt) => void = () => {},
): Promise<AnnahmeErgebnis> {
  const stelle = adresseVon(schluesselHex);
  const vl = vorlageLesen(vorlageRoh);
  const K = vl.k;
  const b = vl.b;
  fortschritt('pruefen');
  const st = await stand(u, K);
  if (!st) fehler('der Token steht nicht (mehr) auf der Kette -- eingeloest, tot oder nie ausgegeben');
  const stellen = st.stellen;
  if (st.art !== 's' || zahl(st.probe_art) !== 2) fehler('auf der Kette kein Token mit Stichprobe v2');
  if (st.gebunden !== true || st.gewaehlt !== true) fehler('erst nach Bindung und Wahl der Inhaberin');
  if (st.tot === true) fehler('der Token ist tot');
  if (st.anmeldung != null) fehler('es gibt schon eine offene Anmeldung');
  if (!Array.isArray(stellen) || stellen.length !== 2 || stellen[b] !== stelle) fehler(`die Vorlage ist fuer Stelle ${b}, das ist nicht dieses Konto`);
  const n = zahl(st.n), t = zahl(st.t), v = zahl(st.v), tol = zahl(st.tol), fehl = zahl(st.fehl);
  const kn = kNote(tol, t, v);
  if (n < 2 || n > N_MAX || v !== validatoren.length || kn === 0 || fehl < 0) fehler(`die Kette nennt n = ${n}, t = ${t}, v = ${v}, Toleranz ${tol}; angegeben ${validatoren.length} Validatoren`);
  if (fehl + 1 >= FEHL_MAX) fehler('zu viele Fehlversuche, um das Urteil eindeutig zu lesen');
  const inhaber = st.inhaber;
  if (typeof inhaber !== 'string' || !ADRESSE.test(inhaber)) fehler('Stand: Inhaberin');
  if (vl.x.length !== n) fehler(`Vorlage: x hat nicht ${n} Bits`);
  if (!kanonisch(vl.vorlage) || !unterschriftVon(vorlageText(K, b, vl.x), vl.vorlage, inhaber)) fehler('die Vorlage ist nicht von der Inhaberin auf der Kette unterschrieben');
  const wurzel = st.wurzel, proben = st.proben;
  if (typeof wurzel !== 'string' || !HEX64.test(wurzel) || !Array.isArray(proben) || proben.length !== 2 || typeof proben[b] !== 'string' || !HEX64.test(proben[b])) {
    fehler('Stand: Wurzel oder Proben');
  }
  const dText = st.d, c = st.c;
  if (typeof dText !== 'string' || dText.length !== n || !/^[01]+$/.test(dText) || (c !== 0 && c !== 1)) fehler('Stand: Bindung oder Wahl');

  // Blaetter von jedem Validator selbst.
  fortschritt('blaetter');
  const adressen = validatoren.map((x) => x.adresse.trim().toLowerCase());
  if (adressen.some((a) => !ADRESSE.test(a)) || new Set(adressen).size !== adressen.length) fehler('Validatoren: Adresse');
  const blaetter: string[] = [];
  for (let x = 1; x <= v; x++) {
    const ab = await abschnittHolen(u, validatoren[x - 1].api, K);
    abschnittPruefen(ab, K, n, v, x, adressen[x - 1]);
    blaetter.push(...ab.blaetter);
  }
  if (merkleWurzel(blaetter) !== wurzel) fehler('die Blaetter ergeben nicht die Wurzel auf der Kette');

  // Oeffnung je Validator, erst nach der Finalitaet von Bindung und Wahl.
  fortschritt('oeffnung');
  const ende = u.jetzt() + WARTEN_MAX_MS;
  const oe = new Map<number, bigint>();
  const salze: string[] = [];
  for (let x = 1; x <= v; x++) {
    const a = abschnitt(n, v, x)!;
    const ch = await oeffnungHolen(u, validatoren[x - 1].api, K, b, ende);
    const o = oeffnungLesen(schluesselHex, ch, K, b, x, a.von, a.bis);
    o.werte.forEach((w, i) => oe.set(i, w));
    salze.push(o.salz);
  }
  const geladen = oeffnungLaden(b, K, n, wurzel, blaetter, oe, kn);
  const probe = [...geladen.keys()].sort((a, c2) => a - c2);
  if (probeV2Pruefen(K, b, n, v, probe, salze) !== proben[b]) fehler('Stichprobe und Salze passen nicht zur Bindung der Ausgabe');

  // Vorab dieselbe Rechnung wie die Kette.
  const erg: AnnahmeErgebnis = {
    k: K, stelle_nummer: b, stelle, inhaberin: inhaber, stichprobe: probe.length, treffer: 0, fehler: 0, vorab: 'abgewiesen',
    wurzel, proben: [proben[0] as string, proben[1] as string],
  };
  for (const [i, [basis, wert]] of geladen) {
    if ((Number(dText[i]) ^ b ^ c) === basis) {
      erg.treffer++;
      if (Number(vl.x[i]) !== wert) erg.fehler++;
    }
  }
  if (bestuende(erg.treffer, erg.fehler, tol)) erg.vorab = 'besteht';

  // Anmelden, dann das Urteil.
  fortschritt('anmelden');
  const vorher = await stand(u, K);
  if (!vorher || zahl(vorher.fehl) !== fehl || vorher.anmeldung != null) fehler('vor der Anmeldung: der Token hat sich geaendert');
  const bs = String(b);
  const sig = unterschreiben(schluesselHex, anmeldenNachricht(stelle, K, bs, vl.x, probe, fehl));
  await einreichen(u, 's_anmelden', stelle, { k: K, b: bs, x: vl.x, probe, vorlage: vl.vorlage, salze, wallet_sig: sig });
  await standWarten(u, K, (s) => s == null || s.anmeldung != null || zahl(s.fehl) !== fehl, 'Anmeldung', WARTEN_MAX_MS);
  fortschritt('urteil');
  const nach = await standWarten(u, K, (s) => s == null || s.tot === true || s.anmeldung == null, 'Urteil', Math.max(WARTEN_MAX_MS, FRIST_OFFEN_MS + NACHLAUF_MS));
  if (nach == null || nach.tot === true) erg.urteil = 'eingeloest'; // fehl+1 < FEHL_MAX: tot ist ausgeschlossen
  else if (zahl(nach.fehl) === fehl + 1) erg.urteil = 'abgewiesen';
  else if (zahl(nach.fehl) === fehl) erg.urteil = 'frist';
  else fehler('Stand nach der Anmeldung unlesbar');
  if (erg.urteil !== 'frist' && (erg.vorab === 'besteht') !== (erg.urteil === 'eingeloest')) {
    fehler(`BEFUND: vorab ${erg.vorab}, die Kette urteilt ${erg.urteil}`);
  }
  return erg;
}

/**
 * validatorKennung: der Validator-Dienst des eigenen Knotens (u.apiBasis) --
 * als Annahmestelle ("adresse=schluessel", fuer die Bestellung) und als
 * Validator ("adresse=api", fuer Abholen und Annehmen). Der Schluessel muss zur
 * gemeldeten Adresse gehoeren.
 */
export async function validatorKennung(u: Umgebung): Promise<{ stelle: string; validator: string }> {
  const { status, json } = await holeJson(u, `${u.apiBasis}/quanten-w/validator/schluessel`, 4096);
  const j = json as { validator?: unknown; schluessel?: unknown } | null;
  if (status !== 200 || !j || typeof j.validator !== 'string' || typeof j.schluessel !== 'string') fehler('Validator-Dienst: keine Antwort');
  const adresse = j.validator.toLowerCase();
  const schluessel = j.schluessel.toLowerCase();
  if (!ADRESSE.test(adresse) || !/^04[0-9a-f]{128}$/.test(schluessel)) fehler('Validator-Dienst: Form');
  let ab: string;
  try {
    ab = ethers.computeAddress('0x' + schluessel).toLowerCase();
  } catch {
    fehler('Validator-Dienst: kein Punkt der Kurve');
  }
  if (ab !== adresse) fehler('Validator-Dienst: Schluessel gehoert nicht zur Adresse');
  return { stelle: `${adresse}=${schluessel}`, validator: `${adresse}=${apiPruefen(u.apiBasis)}` };
}
