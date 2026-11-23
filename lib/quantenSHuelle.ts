// Quantengeld Weg B (B4b-4b, Teil 3): die Hülle der Nachrichten zwischen
// Präparatorinnen, Ausgeber und Inhaberin über den Briefkasten der Knoten.
//
// Der Knoten ist nicht vertrauenswürdig: Er sieht nur Chiffrat, und was er
// über den Absender sagt (`von` beim Abholen), zählt nicht. Darum trägt jede
// Hülle selbst, wer sie geschrieben hat:
//
//   1. UNTERSCHREIBEN (EIP-191, Schlüssel der Absenderin) über Art, Absender,
//      EMPFÄNGER, Nachrichten-Kennung, Zeit, Teil, Teilezahl, Hash der ganzen
//      Nutzlast und Hash dieses Teils. Weil der Empfänger in der Unterschrift
//      steht, kann ein Empfänger die Hülle nicht als "an dich" weiterreichen.
//   2. VERSCHLÜSSELN (ECIES wie die Bündel) an den öffentlichen Schlüssel des
//      Empfängers aus dem Register (pubPasst / schluesselPruefen).
//
// Öffnen prüft in fester Reihenfolge: Größe, Entschlüsseln mit dem eigenen
// Schlüssel, strenge Form (genau diese Felder), an = ich, Art bekannt, Zeit im
// Fenster, Hash des Teils, Unterschrift von `von`. Erst dann zählt der Teil.
//
// TEILE: Ein Brief hat höchstens 64 KiB. Eine Nutzlast wird in Teile zu
// höchstens TEIL_NUTZLAST Byte zerlegt (als Hex doppelt, dazu Felder und
// ECIES: unter INHALT_MAX). Höchstens TEILE_MAX Teile. Der Zusammensetzer
// prüft, dass alle Teile einer Kennung dieselbe Art, denselben Absender,
// dieselbe Teilezahl und denselben Gesamt-Hash tragen, und am Ende den Hash.
//
// GRENZEN (Zusammensetzer): höchstens OFFEN_MAX unfertige Nachrichten und
// OFFEN_BYTES_MAX Byte darin; höchstens GESEHEN_MAX erledigte Kennungen
// (Wiederholung). Eine Hülle älter als ALTER_MAX (Verfall im Briefkasten plus
// Spiel) oder weiter als ZEIT_SPIEL in der Zukunft wird abgewiesen, dann kann
// auch eine vergessene Kennung nicht wieder eingespielt werden. Ist die Liste
// der erledigten Kennungen voll, wird abgewiesen (fail-closed), nie eine
// noch gültige Kennung vergessen. Die Liste muss einen Neustart der App
// überleben: `gesehenListe()` speichern, dem Konstruktor wieder übergeben.

import { ethers } from 'ethers';
import { INHALT_MAX, ZEIT_SPIEL } from './briefkasten';
import { CHAIN_ID, QuantenSFehler, adresseVon, eciesOeffnen, eciesVerschluesseln, unterschreiben, unterschriftVon } from './quantenS';
import { schluesselPruefen, type Empfaenger, type Zufall } from './quantenSPraeparieren';

const DOM = 'aequitas-quanten-s-huelle-v1';

/** Byte Nutzlast je Teil: 2 × 30.000 Hex + Felder + ECIES (113) < 64 KiB. */
export const TEIL_NUTZLAST = 30_000;
/** Höchstens so viele Teile je Nachricht (≈ 1,9 MB Nutzlast). */
export const TEILE_MAX = 64;
/** Briefkasten: 8 Tage, dazu das Spiel der Uhren. */
export const ALTER_MAX = 8 * 86400 + ZEIT_SPIEL;
export const OFFEN_MAX = 32;
export const OFFEN_BYTES_MAX = 8 * 1024 * 1024;
export const GESEHEN_MAX = 16384;

/** Was über die Hülle läuft (B4b-4b): nichts sonst wird angenommen. */
export const ARTEN = ['auftrag', 'antwort', 'buendel', 'bestaetigung', 'oeffnung'] as const;
export type Art = (typeof ARTEN)[number];

const ADRESSE = /^0x[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const ID = /^[0-9a-f]{32}$/;
const HEX = /^(?:[0-9a-f]{2})+$/;
const SIG = /^0x[0-9a-f]{130}$/;
const FELDER = ['an', 'art', 'gesamt', 'id', 'nutzlast', 'sig', 'teil', 'teile', 'v', 'von', 'zeit'];

function fehler(text: string): never {
  throw new QuantenSFehler(text);
}

function sha(b: Uint8Array): string {
  return ethers.sha256(b).slice(2);
}

/** Was die Absenderin je Teil unterschreibt. */
export function huelleNachricht(art: Art, von: string, an: string, id: string, zeit: number, teil: number, teile: number, gesamt: string, teilHash: string): string {
  return `${DOM}|chain:${CHAIN_ID}|${art}|${von}|${an}|${id}|${zeit}|${teil}|${teile}|${gesamt}|${teilHash}`;
}

/**
 * Eine Nutzlast für einen Empfänger einpacken: je Teil unterschreiben und
 * verschlüsseln. Gibt die Inhalte der Briefe (Hex) in Reihenfolge.
 */
export function einpacken(schluessel: string, an: Empfaenger, art: Art, nutzlast: Uint8Array, jetztSek: number, zufall: Zufall): string[] {
  if (!(ARTEN as readonly string[]).includes(art)) fehler('Art');
  const von = adresseVon(schluessel);
  const empf = an.adresse.trim().toLowerCase();
  const pub = schluesselPruefen(an.pub, empf);
  if (nutzlast.length === 0) fehler('Nutzlast leer');
  const teile = Math.ceil(nutzlast.length / TEIL_NUTZLAST);
  if (teile > TEILE_MAX) fehler(`Nutzlast: höchstens ${TEILE_MAX * TEIL_NUTZLAST} Byte`);
  if (!Number.isSafeInteger(jetztSek) || jetztSek <= 0) fehler('Zeit');
  const idRoh = zufall(16);
  if (idRoh.length !== 16) fehler('Zufall');
  const id = ethers.hexlify(idRoh).slice(2);
  const gesamt = sha(nutzlast);
  const out: string[] = [];
  for (let i = 0; i < teile; i++) {
    const stueck = nutzlast.slice(i * TEIL_NUTZLAST, (i + 1) * TEIL_NUTZLAST);
    const sig = unterschreiben(schluessel, huelleNachricht(art, von, empf, id, jetztSek, i, teile, gesamt, sha(stueck)));
    const innen = JSON.stringify({ v: 1, art, von, an: empf, id, zeit: jetztSek, teil: i, teile, gesamt, nutzlast: ethers.hexlify(stueck).slice(2), sig });
    const brief = eciesVerschluesseln(pub, ethers.toUtf8Bytes(innen), zufall);
    if (brief.length / 2 > INHALT_MAX) fehler('Brief zu groß');
    out.push(brief);
  }
  return out;
}

export interface Teil {
  art: Art;
  von: string;
  id: string;
  zeit: number;
  teil: number;
  teile: number;
  gesamt: string;
  stueck: Uint8Array;
}

function ganz(x: unknown): x is number {
  return typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;
}

/**
 * Einen Brief öffnen und ganz prüfen (siehe oben). Wirft QuantenSFehler, wenn
 * irgendetwas nicht stimmt -- nie ein halb geprüfter Teil.
 */
export function oeffnen(schluessel: string, inhaltHex: string, jetztSek: number): Teil {
  if (typeof inhaltHex !== 'string' || !HEX.test(inhaltHex) || inhaltHex.length / 2 > INHALT_MAX) fehler('Brief: Form');
  const ich = adresseVon(schluessel);
  let o: unknown;
  try {
    o = JSON.parse(ethers.toUtf8String(eciesOeffnen(schluessel, inhaltHex)));
  } catch (e) {
    if (e instanceof QuantenSFehler) throw e;
    return fehler('Hülle: kein JSON');
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) fehler('Hülle: Form');
  const h = o as Record<string, unknown>;
  if (Object.keys(h).sort().join(',') !== FELDER.join(',')) fehler('Hülle: Felder');
  if (h.v !== 1) fehler('Hülle: Version');
  if (h.an !== ich) fehler('Hülle: nicht an mich');
  if (typeof h.art !== 'string' || !(ARTEN as readonly string[]).includes(h.art)) fehler('Hülle: Art');
  if (typeof h.von !== 'string' || !ADRESSE.test(h.von)) fehler('Hülle: von');
  if (typeof h.id !== 'string' || !ID.test(h.id)) fehler('Hülle: id');
  if (!ganz(h.zeit) || h.zeit === 0 || h.zeit > jetztSek + ZEIT_SPIEL || h.zeit < jetztSek - ALTER_MAX) fehler('Hülle: Zeit');
  if (!ganz(h.teile) || h.teile < 1 || h.teile > TEILE_MAX || !ganz(h.teil) || h.teil >= h.teile) fehler('Hülle: Teil');
  if (typeof h.gesamt !== 'string' || !HEX64.test(h.gesamt)) fehler('Hülle: gesamt');
  if (typeof h.nutzlast !== 'string' || !HEX.test(h.nutzlast) || h.nutzlast.length / 2 > TEIL_NUTZLAST) fehler('Hülle: Nutzlast');
  // Nur der letzte Teil darf kürzer sein: sonst ließe sich dieselbe Nutzlast
  // auf viele Arten zerlegen.
  if (h.teil < h.teile - 1 && h.nutzlast.length / 2 !== TEIL_NUTZLAST) fehler('Hülle: Teilgröße');
  if (typeof h.sig !== 'string' || !SIG.test(h.sig)) fehler('Hülle: sig');
  const stueck = ethers.getBytes('0x' + h.nutzlast);
  const art = h.art as Art;
  if (!unterschriftVon(huelleNachricht(art, h.von, ich, h.id, h.zeit, h.teil, h.teile, h.gesamt, sha(stueck)), h.sig, h.von)) {
    fehler('Hülle: Unterschrift passt nicht zum Absender');
  }
  return { art, von: h.von, id: h.id, zeit: h.zeit, teil: h.teil, teile: h.teile, gesamt: h.gesamt, stueck };
}

export interface Nachricht {
  art: Art;
  von: string;
  id: string;
  zeit: number;
  nutzlast: Uint8Array;
}

interface Offen {
  art: Art;
  von: string;
  zeit: number;
  teile: number;
  gesamt: string;
  stuecke: (Uint8Array | undefined)[];
  bytes: number;
}

/**
 * Setzt geprüfte Teile zu Nachrichten zusammen, begrenzt (siehe oben).
 * `hinzu` gibt die fertige Nachricht oder null (noch unvollständig); wirft bei
 * Widerspruch, Wiederholung oder voller Grenze.
 */
export class Zusammensetzer {
  private offen = new Map<string, Offen>();
  private offenBytes = 0;
  private gesehen = new Map<string, number>(); // Schlüssel -> Zeit der Hülle

  constructor(gesehen: [string, number][] = []) {
    if (gesehen.length > GESEHEN_MAX) fehler('gespeicherte Liste zu lang');
    for (const [k, z] of gesehen) {
      if (typeof k !== 'string' || !/^0x[0-9a-f]{40}\|[0-9a-f]{32}$/.test(k) || !ganz(z)) fehler('gespeicherte Liste: Form');
      this.gesehen.set(k, z);
    }
  }

  /** Die erledigten Kennungen zum Speichern (übersteht so einen Neustart). */
  gesehenListe(): [string, number][] {
    return [...this.gesehen];
  }

  private schluesselVon(von: string, id: string): string {
    return `${von}|${id}`;
  }

  /** Vergisst, was älter als ALTER_MAX ist (danach weist oeffnen es ohnehin ab). */
  aufraeumen(jetztSek: number): void {
    for (const [k, z] of this.gesehen) if (z < jetztSek - ALTER_MAX) this.gesehen.delete(k);
    for (const [k, o] of this.offen) {
      if (o.zeit < jetztSek - ALTER_MAX) {
        this.offenBytes -= o.bytes;
        this.offen.delete(k);
      }
    }
  }

  hinzu(t: Teil, jetztSek: number): Nachricht | null {
    this.aufraeumen(jetztSek);
    const k = this.schluesselVon(t.von, t.id);
    if (this.gesehen.has(k)) fehler('Hülle: schon erhalten');
    let o = this.offen.get(k);
    if (!o) {
      if (this.offen.size >= OFFEN_MAX) fehler('zu viele unfertige Nachrichten');
      // Platz für die fertige Kennung muss schon jetzt da sein (unfertige mitgezählt).
      if (this.gesehen.size + this.offen.size >= GESEHEN_MAX) fehler('zu viele erledigte Nachrichten');
      o = { art: t.art, von: t.von, zeit: t.zeit, teile: t.teile, gesamt: t.gesamt, stuecke: new Array(t.teile).fill(undefined), bytes: 0 };
      this.offen.set(k, o);
    } else if (o.art !== t.art || o.zeit !== t.zeit || o.teile !== t.teile || o.gesamt !== t.gesamt) {
      fehler('Hülle: Teil passt nicht zu den anderen');
    }
    if (o.stuecke[t.teil]) fehler('Hülle: Teil doppelt');
    if (this.offenBytes + t.stueck.length > OFFEN_BYTES_MAX) fehler('zu viele Byte in unfertigen Nachrichten');
    o.stuecke[t.teil] = t.stueck;
    o.bytes += t.stueck.length;
    this.offenBytes += t.stueck.length;
    if (o.stuecke.some((s) => !s)) return null;

    this.offen.delete(k);
    this.offenBytes -= o.bytes;
    const nutzlast = ethers.getBytes(ethers.concat(o.stuecke as Uint8Array[]));
    if (sha(nutzlast) !== o.gesamt) fehler('Hülle: Gesamt-Hash passt nicht');
    this.gesehen.set(k, o.zeit);
    return { art: o.art, von: o.von, id: t.id, zeit: o.zeit, nutzlast };
  }

  /** Für Tests und Anzeige: unfertige Nachrichten und ihre Byte. */
  stand(): { offen: number; bytes: number; gesehen: number } {
    return { offen: this.offen.size, bytes: this.offenBytes, gesehen: this.gesehen.size };
  }
}
