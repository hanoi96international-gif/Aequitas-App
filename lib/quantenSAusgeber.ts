// Quantengeld Weg B (B4b-4c-2a): die App als Ausgeber -- bestellen und losen.
//
// Gegenstück zur Präparatorin (lib/quantenSPraepAblauf.ts). Der Knoten
// (Aequitas x/humanity/keeper/quanten_s_bestellung.go) führt die Bestellungen:
//   - quanten_w_s_bestellen (Menschen-Wallet = Ausgeber, EIP-191): K, v
//     (praep_zahl), t und die Deckung. Die Kette hält ein Abbild des Registers
//     fest und nimmt das Pfand (max(1 AEQ, 10 % der Deckung)) bis zur Ausgabe.
//   - quanten_w_s_losen (ohne Wallet, jeder): Runde und Signatur von drand
//     quicknet. Die Runde ist FEST (die erste ab Buchzeit + 600 s); jeder Knoten
//     prüft die BLS-Signatur selbst und rechnet das Los nach.
// Nachricht, Runde und Pfand bildet die App genau wie der Knoten; der
// Prüfvektor lib/__tests__/vektoren/quanten_s_ausgeber_bestellen_vektor.json
// entsteht hier und der Knoten prüft ihn mit eigenem Code.
//
// Ablauf (`bestellen`, dann `losStand` so oft wie nötig):
//   1. bestellen: Zustand ZUERST sichern (Stand `eingereicht`, mit K), dann
//      einreichen. Weist der Knoten ab, wird der Zustand gelöscht; bricht das
//      Netz ab, klärt `losStand` später am Register, ob die Bestellung steht.
//   2. losStand: Register lesen. Steht das Los, wird es gesichert (`gelost`).
//      Sonst, sobald die feste Runde erreicht ist, ihre Signatur bei den
//      drand-Relais holen (feste Liste, nie eine Adresse von außen), streng
//      lesen und einreichen. Eine falsche Signatur eines Relais weist der Knoten
//      ab; dann kommt das nächste Relais.
//
// Was die App NICHT glaubt: die Runde (rechnet sie selbst aus der Buchzeit der
// Bestellung und vergleicht), das Pfand (rechnet es selbst), das Los (streng:
// genau v verschiedene, kanonische Konten). Das Los selbst kann sie ohne das
// Abbild nicht nachrechnen -- das tut jeder Knoten (Ehrlich: das Handy kennt
// es nur vom befragten Knoten, wie die Präparatorin).
//
// Fail-closed und begrenzt: jede Anfrage mit Frist und Größengrenze, höchstens
// RELAIS.length Versuche je Runde, eine offene Bestellung je Gerät.

import { ethers } from 'ethers';
import { CHAIN_ID, QuantenSFehler, adresseVon, kanonisch, unterschreiben, unterschriftVon } from './quantenS';
import type { Speicher } from './quantenSInhaberin';
import { REGISTER_MAX } from './quantenSPraeparator';
import type { Zufall } from './quantenSPraeparieren';

const DOM_BESTELLEN = 'aequitas-quanten-s-bestellen-v1';
const ZUSTAND = 'aequitas.quantenS.ausgeber.zustand';
/** Rahmen der Aufträge und die Antworten je Geloster (B4b-4c-2c, lib/quantenSAusgeberRunde.ts). */
export const RAHMEN = 'aequitas.quantenS.ausgeber.rahmen';
export const ANTWORT = 'aequitas.quantenS.ausgeber.antwort.';
/** Bestätigung je Geloster (B4b-4c-2d). */
export const BESTAETIGUNG = 'aequitas.quantenS.ausgeber.bestaetigung.';
const FRIST_MS = 20_000;
const DRAND_FRIST_MS = 10_000;
const DRAND_MAX = 4096;

/** quantenSLosVMin / quantenSLosVMax / quantenWTMax */
export const LOS_V_MIN = 4;
export const LOS_V_MAX = 16;
export const T_MAX = 16;
/** quantenMindestDeckungMik: 1 AEQ */
export const DECKUNG_MIN = 1_000_000;
/** quantenWPfand: 1 AEQ */
export const PFAND_MIN = 1_000_000;
/** quantenSLosAbstand, quantenSBestellFrist, quantenSBestellBuchSpiel */
export const LOS_ABSTAND = 600;
export const BESTELL_FRIST = 2 * 86400;
export const BUCH_SPIEL = 120;
/** So lange nach dem Einreichen darf eine Bestellung im Register fehlen, bevor sie als nicht angenommen gilt. */
export const EINGEREICHT_WARTEN = BUCH_SPIEL + 180;

/** drand quicknet (drand_zufall.go): Genesis, Periode, Kennung der Kette. */
export const DRAND_GENESIS = 1692803367;
export const DRAND_PERIODE = 3;
export const DRAND_KETTE = '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971';
/** Feste Relais des League-of-Entropy-Verbunds; die Signatur prüft jeder Knoten selbst. */
export const RELAIS = ['https://api.drand.sh', 'https://api2.drand.sh', 'https://api3.drand.sh', 'https://drand.cloudflare.com'];

const ADRESSE = /^0x[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const SIG_DRAND = /^[0-9a-f]{96}$/;

function fehler(text: string): never {
  throw new QuantenSFehler(text);
}

function ganz(x: unknown): x is number {
  return typeof x === 'number' && Number.isSafeInteger(x);
}

/** quantenSBestellNachricht: was die Wallet des Ausgebers unterschreibt. */
export function bestellNachricht(wallet: string, K: string, v: number, t: number, deckung: number, zeit: number): string {
  return `${DOM_BESTELLEN}|chain:${CHAIN_ID}|${wallet.toLowerCase()}|${K}|${v}|${t}|${deckung}|${zeit}`;
}

/** quantenSBestellungGroessen */
export function groessenGehen(v: number, t: number): boolean {
  return ganz(v) && ganz(t) && v >= LOS_V_MIN && v <= LOS_V_MAX && t >= 1 && t <= v && t <= T_MAX;
}

/** quantenSBestellPfandFuer: max(1 AEQ, ceil(D * 10 %)). */
export function bestellPfand(deckung: number): number {
  if (!ganz(deckung) || deckung < 0) fehler('Deckung');
  const p = Math.floor(deckung / 100) * 10 + Math.ceil(((deckung % 100) * 10) / 100);
  return p < PFAND_MIN ? PFAND_MIN : p;
}

/** drandNetz.zeitDerRunde */
export function zeitDerRunde(r: number): number {
  if (!ganz(r) || r < 1) fehler('Runde');
  return DRAND_GENESIS + (r - 1) * DRAND_PERIODE;
}

/** quantenSLosRunde: die erste Runde, deren Zeit >= Bestellzeit + 600 s ist. */
export function losRunde(bestellZeit: number): number {
  if (!ganz(bestellZeit) || bestellZeit <= 0) fehler('Bestellzeit');
  const t = bestellZeit + LOS_ABSTAND;
  if (t <= DRAND_GENESIS) return 1;
  const d = t - DRAND_GENESIS;
  let r = Math.floor(d / DRAND_PERIODE) + 1;
  if (d % DRAND_PERIODE !== 0) r++;
  return r;
}

// ------------------------------------------------------------ Zustand

export type Stand = 'eingereicht' | 'bestellt' | 'gelost' | 'beauftragt' | 'beantwortet' | 'bestaetigt' | 'ausgegeben';

/** Stände, in denen das Los feststeht. */
const MIT_LOS: Stand[] = ['gelost', 'beauftragt', 'beantwortet', 'bestaetigt', 'ausgegeben'];

/** Was das Gerät zur eigenen Bestellung aufbewahrt (nichts Geheimes). */
export interface AusgeberZustand {
  k: string;
  ausgeber: string;
  v: number;
  t: number;
  deckung: number;
  /** unterschriebene Zeit der Einreichung */
  zeit: number;
  stand: Stand;
  /** Buchzeit der Kette (ab `bestellt`) */
  buchzeit?: number;
  runde?: number;
  frist?: number;
  /** die Gelosten in Losreihenfolge (ab `gelost`) */
  los?: string[];
  /** ab `beantwortet` (B4b-4c-2c): Wurzel und Bindungen der Stichproben v2 (auch `bestaetigt`) */
  wurzel?: string;
  proben?: [string, string];
}

export interface AusgeberUmgebung {
  fetchFn: typeof fetch;
  apiBasis: string;
  /** AsyncStorage */
  ablage: Speicher;
  zufall: Zufall;
  /** Millisekunden */
  jetzt: () => number;
  /** drand-Relais (Vorgabe RELAIS; nur Tests setzen andere) */
  relais?: string[];
}

export interface WalletSchluessel {
  entsperren(): Promise<{ privateKey: string }>;
}

function zustandPruefen(o: unknown): AusgeberZustand {
  if (!o || typeof o !== 'object' || Array.isArray(o)) fehler('Zustand des Ausgebers unlesbar');
  const z = o as Record<string, unknown>;
  const erlaubt = ['k', 'ausgeber', 'v', 't', 'deckung', 'zeit', 'stand', 'buchzeit', 'runde', 'frist', 'los', 'wurzel', 'proben'];
  if (Object.keys(z).some((k) => !erlaubt.includes(k))) fehler('Zustand des Ausgebers unlesbar');
  if (typeof z.k !== 'string' || !HEX64.test(z.k) || typeof z.ausgeber !== 'string' || !ADRESSE.test(z.ausgeber)) fehler('Zustand des Ausgebers unlesbar');
  if (!groessenGehen(z.v as number, z.t as number) || !ganz(z.deckung) || z.deckung < DECKUNG_MIN || !ganz(z.zeit) || z.zeit <= 0) fehler('Zustand des Ausgebers unlesbar');
  if (z.stand !== 'eingereicht' && z.stand !== 'bestellt' && !MIT_LOS.includes(z.stand as Stand)) fehler('Zustand des Ausgebers unlesbar');
  if (z.stand !== 'eingereicht' && (!ganz(z.buchzeit) || !ganz(z.runde) || !ganz(z.frist))) fehler('Zustand des Ausgebers unlesbar');
  if (MIT_LOS.includes(z.stand as Stand)) {
    const los = z.los;
    if (!Array.isArray(los) || los.length !== z.v || !los.every((a) => typeof a === 'string' && ADRESSE.test(a)) || new Set(los).size !== los.length) {
      fehler('Zustand des Ausgebers unlesbar');
    }
  } else if (z.los !== undefined) fehler('Zustand des Ausgebers unlesbar');
  if (z.stand === 'beantwortet' || z.stand === 'bestaetigt' || z.stand === 'ausgegeben') {
    const p = z.proben;
    if (typeof z.wurzel !== 'string' || !HEX64.test(z.wurzel) || !Array.isArray(p) || p.length !== 2 || !p.every((h) => typeof h === 'string' && HEX64.test(h))) {
      fehler('Zustand des Ausgebers unlesbar');
    }
  } else if (z.wurzel !== undefined || z.proben !== undefined) fehler('Zustand des Ausgebers unlesbar');
  return z as unknown as AusgeberZustand;
}

export async function zustandLesen(u: AusgeberUmgebung): Promise<AusgeberZustand | null> {
  const roh = await u.ablage.lesen(ZUSTAND);
  if (roh === null) return null;
  let o: unknown;
  try {
    o = JSON.parse(roh);
  } catch {
    return fehler('Zustand des Ausgebers unlesbar');
  }
  return zustandPruefen(o);
}

export async function zustandSchreiben(u: AusgeberUmgebung, z: AusgeberZustand): Promise<void> {
  zustandPruefen(z);
  await u.ablage.schreiben(ZUSTAND, JSON.stringify(z), false);
}

/** Die eigene Bestellung vergessen -- nur, wenn sie nicht (mehr) gilt. */
export async function vergessen(u: AusgeberUmgebung): Promise<void> {
  const z = await zustandLesen(u);
  if (z && !(z.frist !== undefined && Math.floor(u.jetzt() / 1000) > z.frist)) fehler('die Bestellung gilt noch -- erst nach der Frist vergessen');
  await rundeLoeschen(u);
  await u.ablage.loeschen(ZUSTAND);
}

/** Rahmen und Antworten einer früheren Runde löschen (vor einer neuen Bestellung oder Beauftragung). */
export async function rundeLoeschen(u: AusgeberUmgebung): Promise<void> {
  for (let x = 1; x <= LOS_V_MAX; x++) {
    await u.ablage.loeschen(ANTWORT + x);
    await u.ablage.loeschen(BESTAETIGUNG + x);
  }
  await u.ablage.loeschen(RAHMEN);
}

// ------------------------------------------------------------ Netz

export async function anfrage(u: AusgeberUmgebung, url: string, init: RequestInit, max: number, frist = FRIST_MS): Promise<{ status: number; text: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), frist);
  try {
    const r = await u.fetchFn(url, { ...init, signal: ctrl.signal, redirect: 'error' } as RequestInit);
    const text = await r.text();
    if (text.length > max) fehler('Antwort zu groß');
    return { status: r.status, text };
  } catch (e) {
    if (e instanceof QuantenSFehler) throw e;
    return fehler('Netz');
  } finally {
    clearTimeout(t);
  }
}

/** Grund einer Abweisung aus {"error": ...} (gekürzt), sonst leer. */
function grundAus(text: string): string {
  try {
    const j = JSON.parse(text.slice(0, 4000)) as { error?: unknown };
    return typeof j.error === 'string' ? j.error.slice(0, 200) : '';
  } catch {
    return '';
  }
}

/** POST /api/quanten-w/<art>; wirft mit Grund, wenn der Knoten nicht annimmt. */
export async function einreichen(u: AusgeberUmgebung, art: string, wallet: string, zeit: number, quantenW: Record<string, unknown>): Promise<void> {
  const r = await anfrage(u, `${u.apiBasis}/quanten-w/${art}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ wallet, zeit, quanten_w: quantenW }),
  }, 4096);
  if (r.status !== 200) throw new AbweisungFehler(r.status, grundAus(r.text));
}

/** Der Knoten hat abgewiesen (HTTP-Status und Grund). */
export class AbweisungFehler extends QuantenSFehler {
  constructor(public status: number, public grund: string) {
    super(`HTTP ${status}${grund ? `: ${grund}` : ''}`);
  }
}

/** Die eigene Bestellung im Register, streng (null = nicht dort). */
export interface RegisterBestellung {
  k: string;
  ausgeber: string;
  v: number;
  t: number;
  zeit: number;
  frist: number;
  runde: number;
  deckung: number;
  pfand: number;
  los: string[];
}

export function registerBestellungLesen(roh: unknown, K: string): RegisterBestellung | null {
  if (!roh || typeof roh !== 'object' || Array.isArray(roh)) fehler('Register: Form');
  const r = roh as Record<string, unknown>;
  if (r.aktiv !== true) fehler('Weg B ist im Knoten nicht aktiv');
  const liste = r.bestellungen;
  if (liste === undefined || liste === null) return null;
  if (!Array.isArray(liste) || liste.length > 1024) fehler('Register: Form');
  const treffer = liste.filter((e) => e && typeof e === 'object' && (e as Record<string, unknown>).k === K);
  if (treffer.length === 0) return null;
  if (treffer.length > 1) fehler('Register: K doppelt');
  const b = treffer[0] as Record<string, unknown>;
  if (typeof b.ausgeber !== 'string' || !ADRESSE.test(b.ausgeber)) fehler('Register: Ausgeber');
  for (const k of ['v', 't', 'zeit', 'frist', 'runde', 'deckung', 'pfand']) if (!ganz(b[k])) fehler(`Register: ${k}`);
  const v = b.v as number;
  const t = b.t as number;
  const zeit = b.zeit as number;
  if (!groessenGehen(v, t)) fehler('Register: v oder t');
  if (b.frist !== zeit + BESTELL_FRIST) fehler('Register: Frist');
  if (b.runde !== losRunde(zeit)) fehler('Register: Runde passt nicht zur Bestellzeit');
  if (b.pfand !== bestellPfand(b.deckung as number)) fehler('Register: Pfand');
  let los: string[] = [];
  if (b.los !== undefined) {
    const l = b.los;
    if (!Array.isArray(l) || l.length !== v || !l.every((a) => typeof a === 'string' && ADRESSE.test(a)) || new Set(l).size !== l.length) fehler('Register: Los');
    los = l as string[];
  }
  return { k: K, ausgeber: b.ausgeber, v, t, zeit, frist: b.frist as number, runde: b.runde as number, deckung: b.deckung as number, pfand: b.pfand as number, los };
}

export async function registerHolen(u: AusgeberUmgebung): Promise<unknown> {
  const r = await anfrage(u, `${u.apiBasis}/quanten-w/praeparatoren`, { headers: { Accept: 'application/json' } }, REGISTER_MAX);
  if (r.status !== 200) fehler(`Register: HTTP ${r.status}`);
  try {
    return JSON.parse(r.text) as unknown;
  } catch {
    return fehler('Register: kein JSON');
  }
}

/** Signatur der Runde r von einem Relais, streng gelesen (round, signature, randomness = SHA-256(signature)). */
export async function drandHolen(u: AusgeberUmgebung, relais: string, r: number): Promise<string> {
  const res = await anfrage(u, `${relais}/${DRAND_KETTE}/public/${r}`, { headers: { Accept: 'application/json' } }, DRAND_MAX, DRAND_FRIST_MS);
  if (res.status !== 200) fehler(`drand: HTTP ${res.status}`);
  let o: unknown;
  try {
    o = JSON.parse(res.text);
  } catch {
    return fehler('drand: kein JSON');
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) fehler('drand: Form');
  const d = o as Record<string, unknown>;
  const sig = typeof d.signature === 'string' ? d.signature.toLowerCase() : '';
  if (d.round !== r || !SIG_DRAND.test(sig)) fehler('drand: Runde oder Signatur');
  if (d.randomness !== ethers.sha256('0x' + sig).slice(2)) fehler('drand: Zufall passt nicht zur Signatur');
  return sig;
}

// ------------------------------------------------------------ bestellen, losen

export function schluesselAus(privateKey: string): string {
  const s = privateKey.replace(/^0x/, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(s)) fehler('Wallet: Schlüssel unlesbar');
  return s;
}

/**
 * Eine Bestellung einreichen: v Präparatorinnen, Schwelle t, Deckung in
 * Mikro-AEQ. Es gibt höchstens eine offene Bestellung je Gerät (die Kette
 * erlaubt ohnehin nur eine je Mensch).
 */
export async function bestellen(u: AusgeberUmgebung, wallet: WalletSchluessel, v: number, t: number, deckung: number): Promise<AusgeberZustand> {
  if (!groessenGehen(v, t)) fehler(`v (${LOS_V_MIN}..${LOS_V_MAX}) oder t (1..v)`);
  if (!ganz(deckung) || deckung < DECKUNG_MIN) fehler(`Deckung mindestens ${DECKUNG_MIN} Mikro-AEQ`);
  const alt = await zustandLesen(u);
  const jetzt = Math.floor(u.jetzt() / 1000);
  if (alt && !(alt.frist !== undefined && jetzt > alt.frist)) fehler('es gibt schon eine offene Bestellung');
  const schluessel = schluesselAus((await wallet.entsperren()).privateKey);
  const ausgeber = adresseVon(schluessel);
  const kb = u.zufall(32);
  if (kb.length !== 32) fehler('Zufall');
  const K = ethers.hexlify(kb).slice(2);
  if (!HEX64.test(K)) fehler('Zufall');
  const nachricht = bestellNachricht(ausgeber, K, v, t, deckung, jetzt);
  const sig = unterschreiben(schluessel, nachricht);
  if (!kanonisch(sig) || !unterschriftVon(nachricht, sig, ausgeber)) fehler('Unterschrift passt nicht zur Wallet');
  // Erst sichern, dann einreichen: bricht das Netz ab, kennt das Gerät das K.
  const z: AusgeberZustand = { k: K, ausgeber, v, t, deckung, zeit: jetzt, stand: 'eingereicht' };
  await rundeLoeschen(u);
  await zustandSchreiben(u, z);
  try {
    await einreichen(u, 's_bestellen', ausgeber, jetzt, { k: K, t, praep_zahl: v, deckung, wallet_sig: sig });
  } catch (e) {
    // Abgewiesen: nichts steht auf der Kette, der Zustand muss weg (sonst sperrt er).
    if (e instanceof AbweisungFehler && e.status >= 400 && e.status < 500) await u.ablage.loeschen(ZUSTAND);
    throw e;
  }
  return z;
}

export type LosErgebnis =
  | { stand: 'gelost'; zustand: AusgeberZustand }
  | { stand: 'warten'; ab: number; zustand: AusgeberZustand }
  | { stand: 'eingereicht'; zustand: AusgeberZustand }
  | { stand: 'verworfen' }
  | { stand: 'verfallen'; zustand: AusgeberZustand };

/**
 * Den Stand der eigenen Bestellung klären und, sobald die feste Runde
 * erreicht ist, losen. So oft aufrufen, bis `gelost` (oder `verfallen`).
 */
export async function losStand(u: AusgeberUmgebung): Promise<LosErgebnis> {
  const z = await zustandLesen(u);
  if (!z) fehler('keine Bestellung');
  const jetzt = Math.floor(u.jetzt() / 1000);
  if (MIT_LOS.includes(z.stand)) return { stand: 'gelost', zustand: z };
  const b = registerBestellungLesen(await registerHolen(u), z.k);
  if (!b) {
    if (z.stand === 'eingereicht') {
      if (jetzt <= z.zeit + EINGEREICHT_WARTEN) return { stand: 'eingereicht', zustand: z };
      // Nie angenommen: vergessen, damit neu bestellt werden kann.
      await u.ablage.loeschen(ZUSTAND);
      return { stand: 'verworfen' };
    }
    // Stand bestellt, aber nicht mehr im Register: verfallen (oder schon ausgegeben -- das klärt ein späterer Schritt).
    return { stand: 'verfallen', zustand: z };
  }
  if (b.ausgeber !== z.ausgeber || b.v !== z.v || b.t !== z.t || b.deckung !== z.deckung) fehler('Register: Bestellung passt nicht zur eigenen (Ausgeber, v, t oder Deckung)');
  if (b.zeit < z.zeit - 300 || b.zeit > z.zeit + 86400) fehler('Register: Buchzeit passt nicht zur Einreichung');
  let neu: AusgeberZustand = { ...z, stand: 'bestellt', buchzeit: b.zeit, runde: b.runde, frist: b.frist };
  if (b.los.length > 0) {
    neu = { ...neu, stand: 'gelost', los: b.los };
    await zustandSchreiben(u, neu);
    return { stand: 'gelost', zustand: neu };
  }
  if (z.stand !== 'bestellt' || z.buchzeit !== b.zeit) await zustandSchreiben(u, neu);
  if (jetzt > b.frist) return { stand: 'verfallen', zustand: neu };
  const ab = zeitDerRunde(b.runde);
  if (jetzt < ab) return { stand: 'warten', ab, zustand: neu };
  // Die Runde ist da: bei den Relais holen, einreichen. Weist der Knoten eine
  // Signatur ab, das nächste Relais (höchstens alle einmal).
  const gruende: string[] = [];
  for (const relais of u.relais ?? RELAIS) {
    let sig: string;
    try {
      sig = await drandHolen(u, relais, b.runde);
    } catch (e) {
      gruende.push((e as Error).message);
      continue;
    }
    try {
      await einreichen(u, 's_losen', '', 0, { k: z.k, runde: b.runde, runde_sig: sig });
    } catch (e) {
      if (e instanceof AbweisungFehler && /quanten_s_los_doppelt/.test(e.grund)) break; // jemand war schneller
      gruende.push((e as Error).message);
      continue;
    }
    break;
  }
  const nach = registerBestellungLesen(await registerHolen(u), z.k);
  if (nach && nach.los.length > 0) {
    if (nach.zeit !== b.zeit || nach.runde !== b.runde) fehler('Register: Bestellung hat sich verändert');
    neu = { ...neu, stand: 'gelost', los: nach.los };
    await zustandSchreiben(u, neu);
    return { stand: 'gelost', zustand: neu };
  }
  return fehler(`Losen gescheitert${gruende.length ? ': ' + gruende.slice(0, 4).join('; ') : ''}`);
}
