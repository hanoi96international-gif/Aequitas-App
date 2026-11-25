// Quantengeld Weg B (B4b-4c-2c): der Ausgeber beauftragt die Gelosten und
// sammelt ihre Antworten über den Briefkasten.
//
// Gegenstück zu `auftragBeantworten` der Präparatorin (lib/quantenSPraepAblauf.ts)
// und zu `abschnitteHolen` des Werkzeugs im Knoten (Aequitas
// x/humanity/keeper/quanten_s_ausgabe_abschnitte.go), dort per HTTP an den
// Validator-Dienst, hier als Hülle Art `auftrag` an jede Geloste:
//
//   1. beauftragen: die Bestellung der Inhaberin (neuWegB: y je Abschnitt an
//      die Gelosten verschlüsselt, Inhaberin, Annahmestellen) und die Toleranz.
//      Geprüft wie `auftragPruefen` der Präparatorin, damit keine Geloste für
//      einen Auftrag misst, den sie ablehnt: Größen, Prüfgröße k_note, Schlüssel
//      zu ihren Adressen, Stellen verschieden und nicht die Inhaberin, Inhaberin
//      nicht der Ausgeber selbst (wie quantenSAusgabeFuerInhaberin). Die
//      Schlüssel der Gelosten kommen aus dem Register und müssen genau ihre
//      Adressen ergeben (registerLesen/pubPasst). Der RAHMEN (alles, woraus die
//      Aufträge entstehen, auch die Zeit) wird ZUERST gesichert, dann gesendet.
//   2. auftraegeSenden: je Geloster ohne Antwort ihr Auftrag, vom Ausgeber
//      unterschrieben (auftragNachricht). Die Unterschrift ist deterministisch
//      (RFC 6979), also ist ein wiederholter Auftrag Byte für Byte derselbe --
//      die Präparatorin antwortet dann aus ihrem Tresor dasselbe noch einmal.
//   3. antwortAufnehmen (aus der Runde des Briefkastens, `runde` in
//      lib/quantenSPraepAblauf.ts -- EIN Leser je Wallet, denn Präparatorin und
//      Ausgeber teilen sich den Kasten): Hülle von der Gelosten x, Antwort streng
//      gelesen und geprüft wie abschnitteHolen: K, x, Abschnitt, Längen, eigenes
//      Bündel leer, basen_hash = Hash des Chiffrats, das ihr geschickt wurde,
//      Stichprobe v2 (Teil-Hashes, Zählung möglich), Unterschrift der Gelosten.
//      Gesichert wird nur die erste gültige Antwort je x; eine andere wird
//      abgewiesen (fail-closed, nie überschrieben).
//   4. Sind alle v Antworten da: Wurzel aus allen Blättern, Bindungen der
//      Stichproben v2 aus den Teil-Hashes, Zählungen addiert; die ehrliche
//      Vorlage muss an BEIDEN Stellen bestehen (quantenSEhrlichBesteht), sonst
//      Abbruch, bevor etwas auf die Kette geht. Stand `beantwortet`.
//
// Was der Ausgeber NICHT kann: y lesen (an die Gelosten verschlüsselt) und die
// Bündel öffnen (an die anderen Gelosten). Ob sie stimmen, prüft jede Geloste
// beim Bestätigen (2d), die Annahmestellen beim Laden ihrer Stichprobe.
//
// Grenzen: v ≤ 16 Aufträge je Bestellung; eine Antwort ≤ ANTWORT_SPEICHER_MAX
// Zeichen, alle zusammen ≤ ANTWORTEN_MAX (Android-AsyncStorage: ~2 MB je
// Eintrag, 6 MB gesamt ohne eigene Einstellung). Größere n brauchen eine Ablage
// in Dateien (4c-3).

import { ethers } from 'ethers';
import { ablegen } from './briefkasten';
import {
  BASEN_CHIFFRAT_MAX,
  N_MAX,
  QuantenSFehler,
  abschnitt,
  adresseVon,
  antwortNachricht,
  basenHash,
  bestuende,
  hashListe,
  kNote,
  kanonisch,
  merkleWurzel,
  probeHashV2,
  toleranzBekannt,
  unterschreiben,
  unterschriftVon,
  type Bestellung,
} from './quantenS';
import {
  ANTWORT,
  RAHMEN,
  type AusgeberUmgebung,
  type AusgeberZustand,
  type WalletSchluessel,
  registerBestellungLesen,
  registerHolen,
  rundeLoeschen,
  schluesselAus,
  zustandLesen,
  zustandSchreiben,
} from './quantenSAusgeber';
import { einpacken, type Nachricht } from './quantenSHuelle';
import { AUFTRAG_ALT, auftragNachricht, type AbschnittAuftrag } from './quantenSPraepAuftrag';
import { registerLesen } from './quantenSPraeparator';
import { BUENDEL_MAX, schluesselPruefen, type Antwort } from './quantenSPraeparieren';

/** Eine Antwort, wie sie in der Ablage liegt (JSON). */
export const ANTWORT_SPEICHER_MAX = 1024 * 1024;
/** Alle Antworten einer Bestellung zusammen. */
export const ANTWORTEN_MAX = 4 * 1024 * 1024;
/** fuer_inhaberin: x des Abschnitts als JSON, ECIES, Hex. */
export const FUER_INHABERIN_MAX = 2 * (N_MAX + 4096);
/** So lange vor dem Ende des Zeitfensters der Präparatorin wird noch gesendet. */
export const SENDEN_RESERVE = 600;

const ADRESSE = /^0x[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const HEX = /^(?:[0-9a-f]{2})+$/;
const PUB = /^04[0-9a-f]{128}$/;

function fehler(text: string): never {
  throw new QuantenSFehler(text);
}

function ganz(x: unknown): x is number {
  return typeof x === 'number' && Number.isSafeInteger(x);
}

// ------------------------------------------------------------ Rahmen

/** Alles, woraus die Aufträge entstehen (nichts Geheimes; y ist verschlüsselt). */
export interface Rahmen {
  k: string;
  n: number;
  tol: number;
  /** Ausgabezeit, in jedem Auftrag dieselbe */
  zeit: number;
  inhaberin: string;
  inhaberin_schluessel: string;
  stellen: [string, string];
  stellen_schluessel: [string, string];
  /** Schlüssel der Gelosten aus dem Register, in Losreihenfolge */
  schluessel: string[];
  /** y je Abschnitt, an die jeweilige Geloste verschlüsselt */
  basen_verschluesselt: string[];
}

const RAHMEN_FELDER = ['basen_verschluesselt', 'inhaberin', 'inhaberin_schluessel', 'k', 'n', 'schluessel', 'stellen', 'stellen_schluessel', 'tol', 'zeit'];

/**
 * Den Rahmen gegen die eigene, geloste Bestellung prüfen -- dieselben Regeln,
 * nach denen die Präparatorin den Auftrag prüft (auftragPruefen), soweit der
 * Ausgeber sie sehen kann. Wirft bei jeder Abweichung.
 */
export function rahmenPruefen(r: Rahmen, z: AusgeberZustand): void {
  if (!r || typeof r !== 'object' || Array.isArray(r) || Object.keys(r).sort().join(',') !== RAHMEN_FELDER.join(',')) fehler('Rahmen: Felder');
  const los = z.los;
  if (!los || los.length !== z.v) fehler('Rahmen: Bestellung nicht gelost');
  const v = los.length;
  if (r.k !== z.k) fehler('Rahmen: anderes K');
  if (!ganz(r.n) || r.n < 2 || r.n > N_MAX || r.n < v) fehler('Rahmen: n');
  if (!ganz(r.tol) || !toleranzBekannt(r.tol)) fehler('Rahmen: Toleranz unbekannt');
  if (!ganz(r.zeit) || r.zeit <= 0) fehler('Rahmen: Zeit');
  const kn = kNote(r.tol, z.t, v);
  let klein = 0;
  for (let x = 1; x <= v; x++) {
    const a = abschnitt(r.n, v, x);
    if (!a) fehler('Rahmen: Abschnitte');
    klein += Math.floor((a.bis - a.von) / 2);
  }
  if (kn <= 0 || klein < kn) fehler(`Prüfgröße: ${klein} Stellen je Annahmestelle, sicher erst ab ${kn} (Toleranz ${r.tol} %, t=${z.t}, v=${v}) -- größeres n`);
  if (typeof r.inhaberin !== 'string' || !ADRESSE.test(r.inhaberin)) fehler('Rahmen: Inhaberin');
  if (r.inhaberin === z.ausgeber) fehler('die Inhaberin ist der Ausgeber selbst -- das ist keine Trennung der Rollen');
  if (typeof r.inhaberin_schluessel !== 'string' || !PUB.test(r.inhaberin_schluessel)) fehler('Rahmen: Schlüssel der Inhaberin');
  schluesselPruefen(r.inhaberin_schluessel, r.inhaberin);
  if (!Array.isArray(r.stellen) || r.stellen.length !== 2 || !Array.isArray(r.stellen_schluessel) || r.stellen_schluessel.length !== 2) fehler('Rahmen: Annahmestellen');
  for (let b = 0; b < 2; b++) {
    const s = r.stellen[b];
    if (typeof s !== 'string' || !ADRESSE.test(s) || s === r.inhaberin || (b === 1 && s === r.stellen[0])) fehler(`Annahmestelle ${b}`);
    if (typeof r.stellen_schluessel[b] !== 'string' || !PUB.test(r.stellen_schluessel[b])) fehler(`Annahmestelle ${b}: Schlüssel`);
    schluesselPruefen(r.stellen_schluessel[b], s);
  }
  if (!Array.isArray(r.schluessel) || r.schluessel.length !== v) fehler('Rahmen: Schlüssel der Gelosten');
  r.schluessel.forEach((p, j) => {
    if (typeof p !== 'string' || !PUB.test(p)) fehler(`Geloste ${j + 1}: Schlüssel`);
    schluesselPruefen(p, los[j]);
  });
  if (!Array.isArray(r.basen_verschluesselt) || r.basen_verschluesselt.length !== v) fehler(`verschlüsselte Basen: ${v} Abschnitte verlangt`);
  r.basen_verschluesselt.forEach((c, j) => {
    if (typeof c !== 'string' || c.length === 0 || c.length > BASEN_CHIFFRAT_MAX || !HEX.test(c)) fehler(`verschlüsselte Basen, Abschnitt ${j + 1}: Form`);
  });
}

async function rahmenLaden(u: AusgeberUmgebung, z: AusgeberZustand): Promise<Rahmen> {
  const roh = await u.ablage.lesen(RAHMEN);
  if (roh === null) fehler('Rahmen der Aufträge fehlt');
  let r: Rahmen;
  try {
    r = JSON.parse(roh) as Rahmen;
  } catch {
    return fehler('Rahmen der Aufträge unlesbar');
  }
  rahmenPruefen(r, z);
  return r;
}

/** Der Auftrag an die Geloste x, unterschrieben (feste Reihenfolge der Felder). */
export function auftragBauen(schluessel: string, z: AusgeberZustand, r: Rahmen, x: number): AbschnittAuftrag {
  const los = z.los!;
  if (!Number.isInteger(x) || x < 1 || x > los.length) fehler('Nummer');
  if (adresseVon(schluessel) !== z.ausgeber) fehler('Wallet ist nicht die des Ausgebers');
  const q: AbschnittAuftrag = {
    k: r.k, n: r.n, t: z.t, tol: r.tol, x, validatoren: [...los], schluessel: [...r.schluessel], basen: '',
    basen_verschluesselt: r.basen_verschluesselt[x - 1], inhaberin: r.inhaberin, inhaberin_schluessel: r.inhaberin_schluessel,
    stellen: [...r.stellen], stellen_schluessel: [...r.stellen_schluessel], zeit: r.zeit, praeger: z.ausgeber, praeger_sig: '', probe_art: 2,
  };
  q.praeger_sig = unterschreiben(schluessel, auftragNachricht(q));
  return q;
}

// ------------------------------------------------------------ beauftragen, senden

/**
 * Die Gelosten beauftragen: Bestellung der Inhaberin (aus neuWegB) und
 * Toleranz in %. Nur einmal je Bestellung; danach auftraegeSenden für
 * Wiederholungen.
 */
export async function beauftragen(u: AusgeberUmgebung, wallet: WalletSchluessel, best: Bestellung, tol: number): Promise<{ gesendet: number[] }> {
  const z = await zustandLesen(u);
  if (!z) fehler('keine Bestellung');
  if (z.stand !== 'gelost') fehler(z.stand === 'eingereicht' || z.stand === 'bestellt' ? 'noch nicht gelost' : 'schon beauftragt');
  const schluessel = schluesselAus((await wallet.entsperren()).privateKey);
  if (adresseVon(schluessel) !== z.ausgeber) fehler('Wallet ist nicht die des Ausgebers');
  const jetzt = Math.floor(u.jetzt() / 1000);
  if (z.frist === undefined || jetzt > z.frist) fehler('Bestellung verfallen');
  if (!best || typeof best !== 'object' || best.basen !== undefined || !Array.isArray(best.basen_verschluesselt)) fehler('Bestellung der Inhaberin: Basen nur verschlüsselt (Weg B)');
  if (!Array.isArray(best.stellen) || best.stellen.length !== 2 || !best.stellen.every((s) => s && typeof s === 'object')) fehler('Bestellung der Inhaberin: Annahmestellen');
  // Register: Weg B aktiv, die Bestellung unverändert gelost, die Schlüssel der Gelosten.
  const roh = await registerHolen(u);
  const reg = registerLesen(roh);
  if (!reg) fehler('Register: Form');
  const b = registerBestellungLesen(roh, z.k);
  if (!b) fehler('Bestellung nicht (mehr) im Register');
  if (b.ausgeber !== z.ausgeber || b.los.join(',') !== z.los!.join(',')) fehler('Register: Bestellung oder Los passt nicht zur eigenen');
  const schl = z.los!.map((konto) => {
    const e = reg.eintraege.filter((x) => x.konto === konto);
    if (e.length !== 1) fehler(`Geloste ${konto} nicht (eindeutig) im Register`);
    return e[0].pub;
  });
  const r: Rahmen = {
    k: z.k,
    n: best.n,
    tol,
    zeit: jetzt,
    inhaberin: typeof best.inhaberin === 'string' ? best.inhaberin.trim().toLowerCase() : '',
    inhaberin_schluessel: typeof best.inhaberin_schluessel === 'string' ? best.inhaberin_schluessel.trim().toLowerCase().replace(/^0x/, '') : '',
    stellen: [String(best.stellen[0].adresse).trim().toLowerCase(), String(best.stellen[1].adresse).trim().toLowerCase()],
    stellen_schluessel: [String(best.stellen[0].schluessel).trim().toLowerCase().replace(/^0x/, ''), String(best.stellen[1].schluessel).trim().toLowerCase().replace(/^0x/, '')],
    schluessel: schl,
    basen_verschluesselt: [...best.basen_verschluesselt],
  };
  rahmenPruefen(r, z);
  // Erst sichern, dann senden: geht das Senden schief, entstehen dieselben Aufträge noch einmal.
  // Reste einer früheren Runde zählen nie als Antwort auf diese.
  await rundeLoeschen(u);
  await u.ablage.schreiben(RAHMEN, JSON.stringify(r), false);
  await zustandSchreiben(u, { ...z, stand: 'beauftragt' });
  return auftraegeSenden(u, wallet);
}

/** Antworten, die schon gesichert sind (x -> Text). */
async function antwortenLaden(u: AusgeberUmgebung, v: number): Promise<(string | null)[]> {
  const out: (string | null)[] = [];
  for (let x = 1; x <= v; x++) out.push(await u.ablage.lesen(ANTWORT + x));
  return out;
}

/**
 * Den Auftrag an jede Geloste senden, deren Antwort noch fehlt (auch noch
 * einmal: derselbe Auftrag, dieselbe Antwort). Gibt die Nummern.
 */
export async function auftraegeSenden(u: AusgeberUmgebung, wallet: WalletSchluessel): Promise<{ gesendet: number[] }> {
  const z = await zustandLesen(u);
  if (!z) fehler('keine Bestellung');
  if (z.stand !== 'beauftragt') fehler(z.stand === 'beantwortet' ? 'alle Antworten sind da' : 'noch nicht beauftragt');
  const r = await rahmenLaden(u, z);
  const schluessel = schluesselAus((await wallet.entsperren()).privateKey);
  if (adresseVon(schluessel) !== z.ausgeber) fehler('Wallet ist nicht die des Ausgebers');
  const jetzt = Math.floor(u.jetzt() / 1000);
  if (z.frist === undefined || jetzt > z.frist) fehler('Bestellung verfallen');
  if (jetzt > r.zeit + AUFTRAG_ALT - SENDEN_RESERVE) fehler('die Aufträge sind zu alt für die Präparatorinnen -- diese Ausgabe neu bestellen');
  const da = await antwortenLaden(u, z.v);
  const signer = { signMessage: async (m: string) => unterschreiben(schluessel, m) };
  const gesendet: number[] = [];
  for (let x = 1; x <= z.v; x++) {
    if (da[x - 1] !== null) continue;
    const q = auftragBauen(schluessel, z, r, x);
    const an = { adresse: z.los![x - 1], pub: r.schluessel[x - 1] };
    for (const brief of einpacken(schluessel, an, 'auftrag', ethers.toUtf8Bytes(JSON.stringify(q)), jetzt, u.zufall)) {
      await ablegen(z.ausgeber, an.adresse, brief, signer, jetzt, u.fetchFn, u.apiBasis);
    }
    gesendet.push(x);
  }
  return { gesendet };
}

// ------------------------------------------------------------ Antworten

const ANTWORT_PFLICHT = ['bis', 'buendel', 'buendel_sig', 'fuer_inhaberin', 'k', 'sig', 'validator', 'von', 'x', 'blaetter'];
const ANTWORT_WAHL = ['basen_hash', 'teile', 'zaehlung'];

/** Die Antwort einer Gelosten aus der Nutzlast, streng (genau diese Felder, Typen, Größen). */
export function antwortLesen(nutzlast: Uint8Array | string): Antwort {
  const text = typeof nutzlast === 'string' ? nutzlast : ethers.toUtf8String(nutzlast);
  if (text.length > ANTWORT_SPEICHER_MAX) fehler('Antwort zu groß für die Ablage (kleineres n)');
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch {
    return fehler('Antwort: kein JSON');
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) fehler('Antwort: Form');
  const a = o as Record<string, unknown>;
  for (const k of Object.keys(a)) if (!ANTWORT_PFLICHT.includes(k) && !ANTWORT_WAHL.includes(k)) fehler(`Antwort: Feld ${k}`);
  for (const k of ANTWORT_PFLICHT) if (!(k in a)) fehler(`Antwort: ${k} fehlt`);
  for (const k of ['k', 'fuer_inhaberin', 'validator', 'sig']) if (typeof a[k] !== 'string') fehler(`Antwort: ${k}`);
  for (const k of ['x', 'von', 'bis']) if (!ganz(a[k])) fehler(`Antwort: ${k}`);
  for (const k of ['blaetter', 'buendel', 'buendel_sig']) if (!Array.isArray(a[k]) || !(a[k] as unknown[]).every((s) => typeof s === 'string')) fehler(`Antwort: ${k}`);
  if ('basen_hash' in a && typeof a.basen_hash !== 'string') fehler('Antwort: basen_hash');
  if ('teile' in a && (!Array.isArray(a.teile) || !a.teile.every((s) => typeof s === 'string'))) fehler('Antwort: teile');
  if ('zaehlung' in a && (!Array.isArray(a.zaehlung) || !a.zaehlung.every((p) => Array.isArray(p) && p.length === 2 && p.every(ganz)))) fehler('Antwort: zaehlung');
  return a as unknown as Antwort;
}

/**
 * Die Antwort der Gelosten x prüfen wie abschnitteHolen (Weg B: immer
 * verschlüsselte Basen und Stichprobe v2). von = Absender der Hülle.
 */
export function antwortPruefen(ans: Antwort, von: string, z: AusgeberZustand, r: Rahmen): void {
  const los = z.los!;
  const v = los.length;
  const x = ans.x;
  if (!Number.isInteger(x) || x < 1 || x > v) fehler('Antwort: Nummer');
  if (von !== los[x - 1] || ans.validator !== los[x - 1]) fehler(`Antwort ${x}: nicht von der Gelosten ${x}`);
  const a = abschnitt(r.n, v, x)!;
  if (ans.k !== z.k || ans.von !== a.von || ans.bis !== a.bis || ans.blaetter.length !== a.bis - a.von) fehler(`Antwort ${x}: K oder Abschnitt passt nicht`);
  if (!ans.blaetter.every((h) => HEX64.test(h))) fehler(`Antwort ${x}: Blatt`);
  if (ans.buendel.length !== v || ans.buendel_sig.length !== v || ans.buendel[x - 1] !== '' || ans.buendel_sig[x - 1] !== '') fehler(`Antwort ${x}: Bündel`);
  for (let e = 0; e < v; e++) {
    if (e === x - 1) continue;
    const c = ans.buendel[e];
    if (c.length === 0 || c.length > BUENDEL_MAX || !HEX.test(c) || !kanonisch(ans.buendel_sig[e])) fehler(`Antwort ${x}: Bündel an ${e + 1}`);
  }
  if (ans.fuer_inhaberin.length === 0 || ans.fuer_inhaberin.length > FUER_INHABERIN_MAX || !HEX.test(ans.fuer_inhaberin)) fehler(`Antwort ${x}: für die Inhaberin`);
  if (ans.basen_hash !== basenHash(r.basen_verschluesselt[x - 1])) fehler(`Antwort ${x}: nicht mit den Basen ihres Auftrags`);
  // Stichprobe v2 (quantenSAntwortV2Pruefen).
  const t = ans.teile;
  const zl = ans.zaehlung;
  if (!t || !zl || t.length !== 2 || zl.length !== 2) fehler(`Antwort ${x}: Stichprobe v2 fehlt`);
  for (let s = 0; s < 2; s++) {
    const [tr, fe] = zl[s];
    if (!HEX64.test(t[s]) || fe < 0 || tr < fe || tr > a.bis - a.von) fehler(`Antwort ${x}: Zählung ${fe}/${tr} unmöglich`);
  }
  const m = antwortNachricht(ans.k, x, ans.von, ans.bis, hashListe(ans.blaetter), ans.fuer_inhaberin, hashListe(ans.buendel), hashListe(ans.buendel_sig), t, zl, ans.basen_hash);
  if (!unterschriftVon(m, ans.sig, los[x - 1])) fehler(`Antwort ${x}: nicht von der Gelosten unterschrieben`);
}

/** Wurzel, Bindungen der Stichproben v2 und Zählungen aus allen Antworten. */
export interface Ergebnis {
  wurzel: string;
  proben: [string, string];
  treffer: [number, number];
  fehler: [number, number];
}

/** probenV2 + Wurzel; die ehrliche Vorlage muss an beiden Stellen bestehen. */
export function auswerten(antworten: Antwort[], z: AusgeberZustand, r: Rahmen): Ergebnis {
  if (antworten.length !== z.v) fehler('nicht alle Antworten');
  const blaetter: string[] = [];
  const treffer: [number, number] = [0, 0];
  const fehlerZ: [number, number] = [0, 0];
  antworten.forEach((a, i) => {
    if (a.x !== i + 1) fehler('Antworten: Reihenfolge');
    blaetter.push(...a.blaetter);
    for (let s = 0; s < 2; s++) {
      treffer[s] += a.zaehlung![s][0];
      fehlerZ[s] += a.zaehlung![s][1];
    }
  });
  if (blaetter.length !== r.n) fehler('Antworten: Blätter');
  const wurzel = merkleWurzel(blaetter);
  const proben: [string, string] = [probeHashV2(z.k, 0, antworten.map((a) => a.teile![0])), probeHashV2(z.k, 1, antworten.map((a) => a.teile![1]))];
  for (let s = 0; s < 2; s++) {
    if (!bestuende(treffer[s], fehlerZ[s], r.tol)) {
      fehler(`Annahmestelle ${s}: ${fehlerZ[s]} Fehler bei ${treffer[s]} Treffern -- die ehrliche Vorlage bestünde bei Toleranz ${r.tol} % nicht; abgebrochen, bevor etwas auf die Kette geht`);
    }
  }
  return { wurzel, proben, treffer, fehler: fehlerZ };
}

/**
 * Eine fertige Hülle Art `antwort` aufnehmen (aus der Runde des Briefkastens).
 * Gibt die Nummer und ob damit alle Antworten da sind.
 */
export async function antwortAufnehmen(u: AusgeberUmgebung, m: Nachricht): Promise<{ k: string; x: number; art: 'neu' | 'wiederholt'; ergebnis?: Ergebnis }> {
  if (m.art !== 'antwort') fehler('keine Antwort');
  const z = await zustandLesen(u);
  if (!z) fehler('keine Bestellung');
  if (z.stand !== 'beauftragt' && z.stand !== 'beantwortet') fehler('keine offenen Aufträge');
  const r = await rahmenLaden(u, z);
  const text = ethers.toUtf8String(m.nutzlast);
  const ans = antwortLesen(text);
  antwortPruefen(ans, m.von, z, r);
  const da = await antwortenLaden(u, z.v);
  const alt = da[ans.x - 1];
  if (alt !== null) {
    if (alt !== text) fehler(`Antwort ${ans.x}: schon eine andere Antwort gesichert`);
    return { k: z.k, x: ans.x, art: 'wiederholt' };
  }
  const summe = da.reduce((s, d) => s + (d?.length ?? 0), 0) + text.length;
  if (summe > ANTWORTEN_MAX) fehler('Antworten zu groß für die Ablage (kleineres n)');
  await u.ablage.schreiben(ANTWORT + ans.x, text, false);
  da[ans.x - 1] = text;
  if (da.some((d) => d === null)) return { k: z.k, x: ans.x, art: 'neu' };
  // Alle da: noch einmal streng aus der Ablage lesen und auswerten.
  const alle = da.map((d) => {
    const a = antwortLesen(d!);
    antwortPruefen(a, z.los![a.x - 1], z, r);
    return a;
  });
  const ergebnis = auswerten(alle, z, r);
  await zustandSchreiben(u, { ...z, stand: 'beantwortet', wurzel: ergebnis.wurzel, proben: ergebnis.proben });
  return { k: z.k, x: ans.x, art: 'neu', ergebnis };
}

/** Welche Gelosten noch nicht geantwortet haben (Nummern) und, wenn alle da sind, Wurzel und Proben. */
export async function antwortenStand(u: AusgeberUmgebung): Promise<{ fehlen: number[]; wurzel?: string; proben?: [string, string] }> {
  const z = await zustandLesen(u);
  if (!z) fehler('keine Bestellung');
  if (z.stand !== 'beauftragt' && z.stand !== 'beantwortet') fehler('noch nicht beauftragt');
  const da = await antwortenLaden(u, z.v);
  const fehlen = da.flatMap((d, i) => (d === null ? [i + 1] : []));
  return z.stand === 'beantwortet' ? { fehlen, wurzel: z.wurzel, proben: z.proben } : { fehlen };
}
