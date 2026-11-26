// Quantengeld Variante S: die App als INHABERIN eines Tokens (R4b,
// aequitas forschung/quantengeld/DEZENTRAL.md 17).
//
// Genau so wie das Werkzeug der Inhaberin im Knoten
// (aequitas x/humanity/keeper/quanten_s_rollen.go), Zeichen fuer Zeichen
// gegen den Pruefvektor des Knotens getestet
// (lib/__tests__/vektoren/quanten_s_inhaberin_vektor.json):
//
//  - x aus fuer_inhaberin lesen: ECIES wie go-ethereum (secp256k1-ECDH,
//    Concat-KDF mit SHA-256, AES-128-CTR, HMAC-SHA-256 ueber IV und Chiffrat).
//  - jeden Abschnitt gegen die Unterschrift SEINES Validators pruefen (die
//    Validatoren nennt die App selbst, nie ein Paket oder eine Antwort),
//    Blaetter gegen die Wurzel, Proben gegen die Teil-Hashes, alles gegen die
//    Kette; die ehrliche Vorlage aus den unterschriebenen Zaehlungen.
//  - Bindung d = y XOR z, Wahl c = b XOR z und die Vorlage unterschreiben
//    (EIP-191, wie quantenSUnterschreiben).
//  - R8 (quanten_s_basen_chiffrat.go): y je Abschnitt an den Validator
//    verschluesseln (gebunden an Kette, Empfaenger, n, v, Nummer,
//    Validatorenliste und Inhaberin); der Validator unterschreibt den Hash
//    des Chiffrats, die App vergleicht ihn mit ihrem eigenen.
//
// Nichts hier haelt einen Schluessel fest: der Aufrufer gibt ihn herein und
// bewahrt ihn im Geraet (SecureStore, hoechstens 2048 Byte je Wert -- darum
// sind x und y hier hex statt '0'/'1').
import { ctr } from '@noble/ciphers/aes.js';
import { ethers } from 'ethers';

export const CHAIN_ID = 1926; // eingefroreneChainID (chain_id_wechsel.go)
const DOM_ANTWORT = 'aequitas-quanten-s-abschnitt-antwort-v1';
const DOM_FUER_INHABERIN = 'aequitas-quanten-s-fuer-inhaberin-v1';
const DOM_PROBE_V2 = 'aequitas-quanten-s-probe-v2|';
const DOM_BINDEN = 'aequitas-quanten-s-binden-v1';
const DOM_WAHL = 'aequitas-quanten-s-wahl-v1';
const DOM_VORLAGE = 'aequitas-quanten-s-vorlage-v1|';
const DOM_BASEN = 'aequitas-quanten-s-basen-v1';
/** quantenSBasenChiffratMax: Hex-Zeichen eines Chiffrats der Basen. */
export const BASEN_CHIFFRAT_MAX = 2 * (16384 + 1024);

export const N_MAX = 16384;
export const V_MAX = 64;
const MIN_TREFFER = 4; // quantenWMinTreffer
/** quantenWKTabelle (quanten_w.go): Toleranz -> k_note je f16. */
const K_TABELLE: Record<number, number[]> = {
  2: [552, 600, 672, 752, 856, 984, 1168, 1408, 1760],
  3: [672, 752, 856, 984, 1144, 1368, 1680, 2144, 2880],
  4: [840, 960, 1112, 1304, 1576, 1960, 2536, 3472, 5200],
  5: [1064, 1240, 1464, 1784, 2240, 2936, 4096, 6264, 0],
  6: [1360, 1632, 2000, 2536, 3360, 4752, 7416, 0, 0],
  8: [2440, 3144, 4256, 6184, 0, 0, 0, 0, 0],
  10: [5240, 7808, 0, 0, 0, 0, 0, 0, 0],
};

const HEX64 = /^[0-9a-f]{64}$/;
const ADRESSE = /^0x[0-9a-f]{40}$/;
const SIG = /^0x[0-9a-f]{128}(1b|1c)$/;
const BITS = /^[01]*$/;

export class QuantenSFehler extends Error {}
function fehler(text: string): never {
  throw new QuantenSFehler(text);
}

const utf8 = (s: string) => ethers.toUtf8Bytes(s);
const hexOhne = (b: ethers.BytesLike) => ethers.hexlify(b).slice(2);
function sha256Hex(...teile: Uint8Array[]): string {
  return hexOhne(ethers.sha256(ethers.concat(teile)));
}

/** Toleranz der Note ist ein Schluessel von quantenWKTabelle. */
export function toleranzBekannt(tol: number): boolean {
  return Object.prototype.hasOwnProperty.call(K_TABELLE, tol);
}

/** quantenSAbschnitt: Abschnitt x (1-basiert) von n Stellen bei v Validatoren. */
export function abschnitt(n: number, v: number, x: number): { von: number; bis: number } | null {
  if (!Number.isInteger(n) || !Number.isInteger(v) || !Number.isInteger(x)) return null;
  if (v < 1 || n < v || x < 1 || x > v || n > N_MAX || v > V_MAX) return null;
  return { von: Math.floor(((x - 1) * n) / v), bis: Math.floor((x * n) / v) };
}

/** quantenWKNote: k je Annahmestelle, 0 = unbekannt. */
export function kNote(tol: number, t: number, v: number): number {
  const z = K_TABELLE[tol];
  if (!z || v <= 0 || t < 1) return 0;
  const f = Math.floor((16 * (t - 1) + v - 1) / v);
  return f >= 0 && f < z.length ? z[f] : 0;
}

/** quantenWUrteil == quantenWEcht. */
export function bestuende(treffer: number, fehlerZahl: number, tol: number): boolean {
  return treffer >= MIN_TREFFER && fehlerZahl * 100 <= tol * treffer;
}

/** quantenSHashListe: SHA-256 der mit ',' verbundenen Liste, hex. */
export function hashListe(l: string[]): string {
  return sha256Hex(utf8(l.join(',')));
}

/** quantenWMerkleWurzel: Knoten = SHA-256(0x01 | a | b), ungerade Ebenen verdoppeln das letzte Blatt. */
export function merkleWurzel(blaetterHex: string[]): string {
  if (blaetterHex.length === 0) fehler('keine Blaetter');
  let ebene = blaetterHex.map((h) => {
    if (!HEX64.test(h)) fehler('Blatt');
    return ethers.getBytes('0x' + h);
  });
  while (ebene.length > 1) {
    if (ebene.length % 2 === 1) ebene.push(ebene[ebene.length - 1]);
    const naechste: Uint8Array[] = [];
    for (let i = 0; i < ebene.length; i += 2) {
      naechste.push(ethers.getBytes(ethers.sha256(ethers.concat([new Uint8Array([1]), ebene[i], ebene[i + 1]]))));
    }
    ebene = naechste;
  }
  return hexOhne(ebene[0]);
}

/**
 * quantenWMerklePfad fuer mehrere Stellen auf einmal: je Stelle die Nachbarn
 * von unten nach oben (hex), wie der Knoten sie in quantenWMerklePruefen
 * erwartet. Die Ebenen werden einmal gebaut.
 */
export function merklePfade(blaetterHex: string[], stellen: number[]): Map<number, string[]> {
  if (blaetterHex.length === 0) fehler('keine Blaetter');
  let ebene = blaetterHex.map((h) => {
    if (!HEX64.test(h)) fehler('Blatt');
    return ethers.getBytes('0x' + h);
  });
  const ebenen: Uint8Array[][] = [];
  while (ebene.length > 1) {
    if (ebene.length % 2 === 1) ebene.push(ebene[ebene.length - 1]);
    ebenen.push(ebene);
    const naechste: Uint8Array[] = [];
    for (let i = 0; i < ebene.length; i += 2) {
      naechste.push(ethers.getBytes(ethers.sha256(ethers.concat([new Uint8Array([1]), ebene[i], ebene[i + 1]]))));
    }
    ebene = naechste;
  }
  const out = new Map<number, string[]>();
  for (const s of stellen) {
    if (!Number.isInteger(s) || s < 0 || s >= blaetterHex.length) fehler('Merkle-Pfad: Stelle');
    const pfad: string[] = [];
    let i = s;
    for (const e of ebenen) {
      pfad.push(hexOhne(e[i ^ 1]));
      i >>= 1;
    }
    out.set(s, pfad);
  }
  return out;
}

/** quantenWMerklePruefen: passt das Blatt mit diesem Pfad zur Wurzel? */
export function merklePruefen(wurzelHex: string, blattHex: string, i: number, pfad: string[], n: number): boolean {
  let tiefe = 0;
  for (let m = n; m > 1; m = Math.floor((m + 1) / 2)) tiefe++;
  if (!Number.isInteger(i) || i < 0 || i >= n || pfad.length !== tiefe || !HEX64.test(blattHex) || !pfad.every((h) => HEX64.test(h))) return false;
  let x = ethers.getBytes('0x' + blattHex);
  for (const h of pfad) {
    const nachbar = ethers.getBytes('0x' + h);
    x = ethers.getBytes(ethers.sha256(ethers.concat([new Uint8Array([1]), i % 2 === 0 ? x : nachbar, i % 2 === 0 ? nachbar : x])));
    i = Math.floor(i / 2);
  }
  return hexOhne(x) === wurzelHex;
}

/** quantenSProbeHashV2: Bindung der Stichprobe von Stelle b aus den Teil-Hashes. */
export function probeHashV2(K: string, b: number, teileHex: string[]): string {
  if (teileHex.length === 0) fehler('keine Teil-Hashes');
  const roh = teileHex.map((h) => {
    if (!HEX64.test(h)) fehler('Teil-Hash');
    return ethers.getBytes('0x' + h);
  });
  return sha256Hex(utf8(DOM_PROBE_V2), utf8(K), utf8('|'), utf8(String(b)), utf8('|'), ethers.concat(roh) as unknown as Uint8Array);
}

/** quantenSAbschnittAntwortNachrichtAus: was der Validator ueber seinen Abschnitt unterschreibt. */
export function antwortNachricht(
  K: string,
  x: number,
  von: number,
  bis: number,
  blaetterHash: string,
  fuerInhaberin: string,
  buendelHash: string,
  buendelSigHash: string,
  teile: string[] | null,
  zaehlung: [number, number][] | null,
  basenHash = '',
): string {
  const hf = sha256Hex(utf8(fuerInhaberin));
  let m = `${DOM_ANTWORT}|chain:${CHAIN_ID}|${K}|${x}|${von}|${bis}|${blaetterHash}|${hf}|${buendelHash}|${buendelSigHash}`;
  if (teile != null || zaehlung != null) {
    const z: string[] = [];
    for (const p of zaehlung ?? []) z.push(String(p[0]), String(p[1]));
    m += `|teile:${(teile ?? []).join(',')}|zaehlung:${z.join(',')}`;
  }
  if (basenHash !== '') m += `|basen:${basenHash}`; // nur bei verschluesselten Basen (R8)
  return m;
}

export function bindenNachricht(wallet: string, K: string, d: string): string {
  return `${DOM_BINDEN}|chain:${CHAIN_ID}|${wallet.toLowerCase()}|${K}|${sha256Hex(utf8(d))}`;
}

export function wahlNachricht(wallet: string, K: string, c: string): string {
  return `${DOM_WAHL}|chain:${CHAIN_ID}|${wallet.toLowerCase()}|${K}|${c}`;
}

/** quantenSVorlageText: Domaene | K | "|" | b | "|" | SHA-256 der x-Bytes (je Stelle ein Byte 0/1). */
export function vorlageText(K: string, b: number, xBits: string): string {
  if (!BITS.test(xBits)) fehler('x');
  const roh = new Uint8Array(xBits.length);
  for (let i = 0; i < xBits.length; i++) roh[i] = xBits.charCodeAt(i) - 48;
  return `${DOM_VORLAGE}${K}|${b}|${sha256Hex(roh)}`;
}

/** quantenSUnterschreiben: EIP-191, v = 27/28, klein geschrieben. */
export function unterschreiben(schluesselHex: string, nachricht: string): string {
  const w = new ethers.Wallet(schluesselHex.startsWith('0x') ? schluesselHex : '0x' + schluesselHex);
  const sig = w.signingKey.sign(ethers.hashMessage(nachricht));
  return sig.serialized.toLowerCase();
}

// Ordnung der Gruppe von secp256k1.
const N_KURVE = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');

/**
 * kanonischeSignatur (validator_register.go): 0x + 130 Hex-Zeichen klein, v 1b/1c,
 * 1 <= r < N und 1 <= s <= N/2 (crypto.ValidateSignatureValues mit homestead) --
 * die gespiegelte Unterschrift (N - s) nimmt der Knoten nicht, also auch die App nicht.
 */
export function kanonisch(sig: string): boolean {
  if (!SIG.test(sig)) return false;
  const r = BigInt('0x' + sig.slice(2, 66));
  const s = BigInt('0x' + sig.slice(66, 130));
  return r >= 1n && r < N_KURVE && s >= 1n && s <= N_KURVE / 2n;
}

/** kanonischeSignatur + verifyPersonalSign. */
export function unterschriftVon(nachricht: string, sig: string, adresse: string): boolean {
  if (!kanonisch(sig) || !ADRESSE.test(adresse)) return false;
  try {
    return ethers.verifyMessage(nachricht, sig).toLowerCase() === adresse;
  } catch {
    return false;
  }
}

export function adresseVon(schluesselHex: string): string {
  return new ethers.Wallet(schluesselHex.startsWith('0x') ? schluesselHex : '0x' + schluesselHex).address.toLowerCase();
}

export function pubVon(schluesselHex: string): string {
  return new ethers.SigningKey(schluesselHex.startsWith('0x') ? schluesselHex : '0x' + schluesselHex).publicKey.slice(2);
}

// ------------------------------------------------------------ ECIES (go-ethereum)

function gleich(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

/**
 * eciesOeffnen: go-ethereum crypto/ecies, ECIES_AES128_SHA256:
 * R (65) | IV (16) | AES-128-CTR-Chiffrat | Tag (32);
 * z = x(prv * R), K = Concat-KDF-SHA256(z, 32), Ke = K[0:16], Km = SHA-256(K[16:32]),
 * Tag = HMAC-SHA-256(Km, IV | Chiffrat).
 */
export function eciesOeffnen(schluesselHex: string, chiffratHex: string): Uint8Array {
  if (!/^[0-9a-f]+$/.test(chiffratHex) || chiffratHex.length % 2 !== 0) fehler('Chiffrat: Form');
  const c = ethers.getBytes('0x' + chiffratHex);
  if (c.length < 65 + 16 + 32 || c[0] !== 4) fehler('Chiffrat: zu kurz');
  const R = ethers.hexlify(c.slice(0, 65));
  const em = c.slice(65, c.length - 32);
  const tag = c.slice(c.length - 32);
  let geteilt: Uint8Array;
  try {
    geteilt = ethers.getBytes(new ethers.SigningKey(schluesselHex.startsWith('0x') ? schluesselHex : '0x' + schluesselHex).computeSharedSecret(R));
  } catch {
    fehler('Chiffrat: kein Punkt der Kurve');
  }
  const z = geteilt.slice(1, 33); // x-Koordinate, 32 Byte
  const k = ethers.getBytes(ethers.sha256(ethers.concat([new Uint8Array([0, 0, 0, 1]), z])));
  const ke = k.slice(0, 16);
  const km = ethers.getBytes(ethers.sha256(k.slice(16, 32)));
  const soll = ethers.getBytes(ethers.computeHmac('sha256', km, em));
  if (!gleich(soll, tag)) fehler('nicht fuer diesen Schluessel');
  return ctr(ke, em.slice(0, 16)).decrypt(em.slice(16));
}

/**
 * eciesVerschluesseln: go-ethereum ecies.Encrypt (ECIES_AES128_SHA256), die
 * Umkehrung von eciesOeffnen. Ephemerer Schluessel und IV aus zufall (dem
 * Zufall des Geraets); pubHex unkomprimiert (04...).
 */
export function eciesVerschluesseln(pubHex: string, klar: Uint8Array, zufall: (n: number) => Uint8Array): string {
  const pub = '0x' + pubHex.replace(/^0x/, '');
  let eph = '';
  for (let i = 0; i < 8 && !eph; i++) {
    const r = zufall(32);
    if (r.length !== 32) fehler('Zufall');
    const k = BigInt(ethers.hexlify(r));
    if (k > 0n && k < N_KURVE) eph = ethers.hexlify(r);
  }
  if (!eph) fehler('Zufall');
  const iv = zufall(16);
  if (iv.length !== 16) fehler('Zufall');
  let geteilt: Uint8Array;
  const sk = new ethers.SigningKey(eph);
  try {
    geteilt = ethers.getBytes(sk.computeSharedSecret(pub));
  } catch {
    fehler('Schluessel: kein Punkt der Kurve');
  }
  const z = geteilt.slice(1, 33);
  const k = ethers.getBytes(ethers.sha256(ethers.concat([new Uint8Array([0, 0, 0, 1]), z])));
  const ke = k.slice(0, 16);
  const km = ethers.getBytes(ethers.sha256(k.slice(16, 32)));
  const em = ethers.getBytes(ethers.concat([iv, ctr(ke, iv).encrypt(klar)]));
  const tag = ethers.getBytes(ethers.computeHmac('sha256', km, em));
  return hexOhne(ethers.concat([ethers.getBytes(sk.publicKey), em, tag]));
}

/** quantenSValidatorenHash: woran das Chiffrat der Basen die Validatorenliste bindet. */
export function validatorenHash(validatoren: string[]): string {
  return hashListe(validatoren.map((a) => a.trim().toLowerCase()));
}

/** quantenSBasenHash: was der Validator ueber das geoeffnete Chiffrat unterschreibt. */
export function basenHash(chiffrat: string): string {
  return sha256Hex(utf8(chiffrat));
}

/**
 * quantenSBasenVerschluesseln: y des Abschnitts x an dessen Validator
 * validatoren[x-1]; pubHex muss zu dieser Adresse gehoeren.
 */
export function basenVerschluesseln(
  pubHex: string,
  validatoren: string[],
  n: number,
  x: number,
  inhaberin: string,
  basen: string,
  zufall: (n: number) => Uint8Array,
): string {
  const v = validatoren.length;
  if (!Number.isInteger(x) || x < 1 || x > v) fehler(`Nummer ${x} bei ${v} Validatoren`);
  const an = validatoren[x - 1].trim().toLowerCase();
  const pub = pubHex.trim().toLowerCase().replace(/^0x/, '');
  if (!ADRESSE.test(an) || !/^04[0-9a-f]{128}$/.test(pub)) fehler('Validator: Form');
  let ab: string;
  try {
    ab = ethers.computeAddress('0x' + pub).toLowerCase();
  } catch {
    fehler('Validator: kein Punkt der Kurve');
  }
  if (ab !== an) fehler('Validator: Schluessel gehoert nicht zur Adresse');
  const a = abschnitt(n, v, x);
  if (!a || basen.length !== a.bis - a.von || !BITS.test(basen)) fehler(`Basen: ${a ? a.bis - a.von : 0} Bits verlangt, nur 0 und 1`);
  // Felder wie quantenSBasenInhalt (Go liest streng, die Reihenfolge ist egal).
  const klar = JSON.stringify({
    dom: DOM_BASEN, chain: CHAIN_ID, an, n, v, x, validatoren: validatorenHash(validatoren), inhaberin: inhaberin.toLowerCase(), basen,
  });
  return eciesVerschluesseln(pub, utf8(klar), zufall);
}

/** quantenSFuerInhaberinOeffnen: x des Abschnitts [von, bis) als '0'/'1'. */
export function fuerInhaberinOeffnen(schluesselHex: string, chiffratHex: string, K: string, von: number, bis: number): string {
  const roh = eciesOeffnen(schluesselHex, chiffratHex);
  let inhalt: any;
  try {
    inhalt = JSON.parse(ethers.toUtf8String(roh));
  } catch {
    fehler('fuer die Inhaberin: kein JSON');
  }
  const schluesselOk =
    inhalt && typeof inhalt === 'object' && !Array.isArray(inhalt) && Object.keys(inhalt).sort().join(',') === 'bis,dom,k,von,x';
  if (!schluesselOk || inhalt.dom !== DOM_FUER_INHABERIN || inhalt.k !== K || inhalt.von !== von || inhalt.bis !== bis) {
    fehler('fuer die Inhaberin: passt nicht');
  }
  if (typeof inhalt.x !== 'string' || inhalt.x.length !== bis - von || !BITS.test(inhalt.x)) fehler('fuer die Inhaberin: x');
  return inhalt.x;
}

// ------------------------------------------------------------ Abschnitt, Paket, Annahme

export interface PaketAbschnitt {
  x: number;
  von: number;
  bis: number;
  blaetter: string[];
  fuer_inhaberin: string;
  buendel_hash: string;
  buendel_sig_hash: string;
  teile: string[] | null;
  zaehlung: [number, number][] | null;
  sig: string;
  /** nur bei verschluesselten Basen (R8): Hash des geoeffneten Chiffrats. */
  basen_hash?: string;
}

/** quantenSPaketAbschnittPruefen: Form und Unterschrift des Validators (aus der eigenen Liste). */
export function abschnittPruefen(ab: PaketAbschnitt, K: string, n: number, v: number, x: number, validator: string): void {
  const a = abschnitt(n, v, x);
  if (
    !a ||
    ab.x !== x ||
    ab.von !== a.von ||
    ab.bis !== a.bis ||
    !Array.isArray(ab.blaetter) ||
    ab.blaetter.length !== a.bis - a.von ||
    !HEX64.test(ab.buendel_hash) ||
    !HEX64.test(ab.buendel_sig_hash) ||
    typeof ab.fuer_inhaberin !== 'string' ||
    (ab.basen_hash !== undefined && !HEX64.test(ab.basen_hash))
  ) {
    fehler(`Abschnitt ${x} hat nicht die Form`);
  }
  const m = antwortNachricht(K, x, a.von, a.bis, hashListe(ab.blaetter), ab.fuer_inhaberin, ab.buendel_hash, ab.buendel_sig_hash, ab.teile, ab.zaehlung, ab.basen_hash ?? '');
  if (!unterschriftVon(m, ab.sig, validator)) fehler(`Abschnitt ${x} ist nicht von Validator ${x} unterschrieben`);
}

/** quantenSAntwortV2Pruefen: zwei Teil-Hashes, zwei Zaehlungen 0 <= Fehler <= Treffer <= Stellen. */
function v2Pruefen(ab: PaketAbschnitt, stellen: number): void {
  if (!ab.teile || !ab.zaehlung || ab.teile.length !== 2 || ab.zaehlung.length !== 2) fehler('Teil-Hashes oder Zaehlung fehlen');
  for (let s = 0; s < 2; s++) {
    const [tr, fe] = ab.zaehlung[s];
    if (!HEX64.test(ab.teile[s]) || !Number.isInteger(tr) || !Number.isInteger(fe) || fe < 0 || fe > tr || tr > stellen) {
      fehler('Teil-Hash oder Zaehlung');
    }
  }
}

/** Was die App zu einem Token aufbewahrt (ohne den Schluessel). x hex (je Stelle ein Bit, MSB zuerst). */
export interface Angenommen {
  k: string;
  n: number;
  x: string;
}

/** Stand eines Tokens wie /api/quanten-w/note (quantenWSTokenAnsichtLocked). */
export type KettenStand = Record<string, unknown>;

export interface Bestellung {
  n: number;
  /** genau eines: Basen im Klartext ODER an die Validatoren verschluesselt (R8). */
  basen?: string[];
  basen_verschluesselt?: string[];
  inhaberin: string;
  inhaberin_schluessel: string;
  stellen: [{ adresse: string; schluessel: string }, { adresse: string; schluessel: string }];
}

/**
 * annehmen: quantenSInhaberinAnnehmen. Die Abschnitte kommen direkt von den
 * Validatoren (abholen) oder aus einem Paket; die Validatoren (Adressen in der
 * Reihenfolge der Abschnitte) nennt die App selbst. Wirft bei jeder Abweichung.
 */
export function annehmen(o: {
  schluessel: string;
  bestellung: Bestellung;
  validatoren: string[];
  K: string;
  stand: KettenStand | null;
  abschnitte: PaketAbschnitt[];
}): { x: string; treffer: [number, number]; fehler: [number, number] } {
  // Bei verschluesselten Basen muss jeder Validator den Hash GENAU des
  // eigenen Chiffrats unterschrieben haben; bei Klartext darf keiner dastehen.
  const chiffrate = o.bestellung.basen_verschluesselt;
  const { schluessel, bestellung: best, stand: st } = o;
  const K = o.K.toLowerCase();
  if (!HEX64.test(K)) fehler('K');
  const inhaberin = adresseVon(schluessel);
  if (inhaberin !== best.inhaberin) fehler('Schluessel gehoert nicht zur Bestellung');
  const v = o.validatoren.length;
  const n = best.n;
  if (v < 1 || v > V_MAX || o.validatoren.some((a) => !ADRESSE.test(a))) fehler('Validatoren');
  if (!st) fehler('der Token steht nicht auf der Kette');
  const stellen = st.stellen as unknown;
  const proben = st.proben as unknown;
  if (st.art !== 's' || st.probe_art !== 2) fehler('auf der Kette kein Token mit Stichprobe v2');
  if (st.inhaber !== inhaberin) fehler('auf der Kette gehoert der Token jemand anderem');
  if (st.n !== n || st.v !== v) fehler('n oder v auf der Kette weichen ab');
  const t = st.t as number;
  const tol = st.tol as number;
  if (!Number.isInteger(t) || t < 1 || t > v || kNote(tol, t, v) === 0) fehler('Schwelle oder Toleranz');
  if (!Array.isArray(stellen) || stellen.length !== 2 || stellen[0] !== best.stellen[0].adresse || stellen[1] !== best.stellen[1].adresse) {
    fehler('die Annahmestellen auf der Kette weichen von der Bestellung ab');
  }
  if (!Array.isArray(proben) || proben.length !== 2 || typeof st.wurzel !== 'string' || !HEX64.test(st.wurzel)) fehler('Wurzel oder Proben');
  if (st.tot === true) fehler('der Token ist tot');
  if (st.gebunden === true || st.anmeldung != null || st.fehl !== 0) {
    fehler('BEFUND: der Token ist schon gebunden oder angemeldet, bevor die Inhaberin ihn angenommen hat');
  }
  if (o.abschnitte.length !== v) fehler(`${o.abschnitte.length} Abschnitte fuer ${v} Validatoren`);
  const blaetter: string[] = [];
  let xBits = '';
  const treffer: [number, number] = [0, 0];
  const fehlerZ: [number, number] = [0, 0];
  const teile: [string[], string[]] = [[], []];
  o.abschnitte.forEach((ab, i) => {
    const xi = i + 1;
    abschnittPruefen(ab, K, n, v, xi, o.validatoren[i]);
    const soll = chiffrate ? basenHash(chiffrate[i] ?? '') : '';
    if ((ab.basen_hash ?? '') !== soll) fehler(`BEFUND: Validator ${xi} hat nicht in den eigenen Basen praepariert (Chiffrat getauscht)`);
    v2Pruefen(ab, ab.bis - ab.von);
    blaetter.push(...ab.blaetter);
    xBits += fuerInhaberinOeffnen(schluessel, ab.fuer_inhaberin, K, ab.von, ab.bis);
    for (let s = 0; s < 2; s++) {
      teile[s].push(ab.teile![s]);
      treffer[s] += ab.zaehlung![s][0];
      fehlerZ[s] += ab.zaehlung![s][1];
    }
  });
  if (merkleWurzel(blaetter) !== st.wurzel) fehler('die Blaetter ergeben nicht die Wurzel auf der Kette');
  for (let s = 0; s < 2; s++) {
    if (probeHashV2(K, s, teile[s]) !== proben[s]) fehler(`Probe ${s} passt nicht zu den Teil-Hashes der Validatoren`);
  }
  for (let s = 0; s < 2; s++) {
    if (!bestuende(treffer[s], fehlerZ[s], tol)) {
      fehler(`BEFUND: nach den Zaehlungen der Validatoren bestuende die ehrliche Vorlage an Stelle ${s} nicht`);
    }
  }
  return { x: xBits, treffer, fehler: fehlerZ };
}

// ------------------------------------------------------------ Bits kompakt

/** '0'/'1' -> hex (4 Stellen je Zeichen, aufgefuellt mit 0); n wird mitgespeichert. */
export function bitsZuHex(bits: string): string {
  if (!BITS.test(bits)) fehler('Bits');
  let out = '';
  for (let i = 0; i < bits.length; i += 4) out += parseInt(bits.slice(i, i + 4).padEnd(4, '0'), 2).toString(16);
  return out;
}

export function hexZuBits(h: string, n: number): string {
  if (!/^[0-9a-f]*$/.test(h) || h.length !== Math.ceil(n / 4)) fehler('Bits: Form');
  let out = '';
  for (const c of h) out += parseInt(c, 16).toString(2).padStart(4, '0');
  if (/1/.test(out.slice(n))) fehler('Bits: Rest');
  return out.slice(0, n);
}

/** d = y XOR z (z = 0 oder 1). */
export function binden(yBits: string, z: number): string {
  if (!BITS.test(yBits) || (z !== 0 && z !== 1)) fehler('Bindung');
  let d = '';
  for (const c of yBits) d += c === '1' ? String(1 ^ z) : String(z);
  return d;
}
