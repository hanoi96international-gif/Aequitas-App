// Quantengeld Weg B (B4b-4b): der Briefkasten der Knoten aus der App.
//
// Präparatorinnen auf dem Handy sind nicht immer erreichbar. Sie tauschen
// verschlüsselte Pakete über einen Briefkasten beim Knoten (Aequitas
// x/humanity/keeper/briefkasten.go): ablegen (nur ein registrierter Mensch,
// unterschrieben), abholen und quittieren (nur der Empfänger, unterschrieben).
// Nachrichten und Grenzen bildet die App genau wie der Knoten; der Prüfvektor
// (lib/__tests__/vektoren/briefkasten_vektor.json, aus
// testdata/briefkasten_vektor.json im Knoten) hält das fest.
//
// Der Knoten ist NICHT vertrauenswürdig: Das Feld `von` eines abgeholten
// Briefs behauptet nur der Knoten. Wer einen Brief liest, prüft den Absender
// an der Unterschrift IM Inhalt (Hülle, nächster Schritt), nie an `von`.
//
// Fail-closed: Die Antwort wird streng gelesen (Größe, Formen, Reihenfolge,
// Grenzen); was so nicht vom Knoten kommen kann, ist ein Fehler. Eine eigene
// Unterschrift, die nicht zur eigenen Adresse passt, wird nie eingereicht.

import { ethers } from 'ethers';
import { API_BASE } from './config';
import { CHAIN_ID, QuantenSFehler, kanonisch, unterschriftVon } from './quantenS';
import { sigNormal, type Unterzeichner } from './quantenSPraeparator';

const DOM_ABLEGEN = 'aequitas-briefkasten-ablegen-v1';
const DOM_ABHOLEN = 'aequitas-briefkasten-abholen-v1';
const DOM_QUITTIEREN = 'aequitas-briefkasten-quittieren-v1';

/** briefInhaltMax: Byte je Brief. */
export const INHALT_MAX = 64 * 1024;
/** briefAbholenHoechstens / briefAbholenBytes: je Abholen. */
export const ABHOLEN_HOECHSTENS = 32;
export const ABHOLEN_BYTES = 2 * 1024 * 1024;
/** briefZeitSpiel: so weit darf die unterschriebene Zeit von der Uhr des Knotens abweichen. */
export const ZEIT_SPIEL = 300;
/** Größte Antwort beim Abholen: Inhalt als Hex (doppelt) und je Brief die Felder. */
export const ANTWORT_MAX = 2 * ABHOLEN_BYTES + ABHOLEN_HOECHSTENS * 256 + 1024;

const FRIST_MS = 20_000;
const ADRESSE = /^0x[0-9a-f]{40}$/;
const HEX = /^(?:[0-9a-f]{2})+$/;

export function ablegenNachricht(von: string, an: string, inhaltHash: string, zeit: number): string {
  return `${DOM_ABLEGEN}|chain:${CHAIN_ID}|${von}|${an}|${inhaltHash}|${zeit}`;
}

export function abholenNachricht(an: string, nach: number, zeit: number): string {
  return `${DOM_ABHOLEN}|chain:${CHAIN_ID}|${an}|${nach}|${zeit}`;
}

export function quittierenNachricht(an: string, bis: number, zeit: number): string {
  return `${DOM_QUITTIEREN}|chain:${CHAIN_ID}|${an}|${bis}|${zeit}`;
}

/** SHA-256 des Inhalts (Bytes, nicht Hex-Text), wie der Knoten. */
export function inhaltHash(inhaltHex: string): string {
  return ethers.sha256('0x' + inhaltHex).slice(2);
}

function fehler(text: string): never {
  throw new QuantenSFehler(text);
}

function adresse(a: string, was: string): string {
  const x = a.trim().toLowerCase();
  if (!ADRESSE.test(x)) fehler(`${was}: Adresse`);
  return x;
}

function ganz(x: unknown): x is number {
  return typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;
}

async function unterschrift(signer: Unterzeichner, nachricht: string, wer: string): Promise<string> {
  const sig = sigNormal(await signer.signMessage(nachricht));
  if (!kanonisch(sig) || !unterschriftVon(nachricht, sig, wer)) fehler('Unterschrift passt nicht zur Wallet');
  return sig;
}

/** POST an den Knoten, Antwort als Text (höchstens max Zeichen), sonst QuantenSFehler. */
async function posten(fetchFn: typeof fetch, url: string, koerper: unknown, max: number): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FRIST_MS);
  try {
    const r = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(koerper),
      signal: ctrl.signal,
      redirect: 'error',
    } as RequestInit);
    const text = await r.text();
    if (!r.ok) {
      let grund = '';
      try {
        const j = JSON.parse(text.slice(0, 2000)) as { error?: unknown };
        if (typeof j.error === 'string') grund = j.error.slice(0, 200);
      } catch {
        // kein JSON
      }
      fehler(`HTTP ${r.status}${grund ? `: ${grund}` : ''}`);
    }
    if (text.length > max) fehler('Antwort zu groß');
    return text;
  } catch (e) {
    if (e instanceof QuantenSFehler) throw e;
    return fehler('Netz');
  } finally {
    clearTimeout(t);
  }
}

function jsonObjekt(text: string): Record<string, unknown> {
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch {
    return fehler('Antwort kein JSON');
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) fehler('Antwort kein Objekt');
  return o as Record<string, unknown>;
}

/**
 * Einen Brief ablegen: von (eigene Menschen-Wallet) an an, Inhalt als Hex
 * (klein, 1 bis INHALT_MAX Byte). Gibt die Nummer im Kasten dieses Knotens.
 */
export async function ablegen(
  von: string,
  an: string,
  inhaltHex: string,
  signer: Unterzeichner,
  jetztSek: number,
  fetchFn: typeof fetch = fetch,
  api: string = API_BASE,
): Promise<number> {
  const v = adresse(von, 'von');
  const a = adresse(an, 'an');
  if (!HEX.test(inhaltHex) || inhaltHex.length / 2 > INHALT_MAX) fehler(`Inhalt: 1 bis ${INHALT_MAX} Byte, Hex klein`);
  const sig = await unterschrift(signer, ablegenNachricht(v, a, inhaltHash(inhaltHex), jetztSek), v);
  const o = jsonObjekt(await posten(fetchFn, `${api}/briefkasten/ablegen`, { von: v, an: a, inhalt: inhaltHex, zeit: jetztSek, sig }, 1024));
  if (o.ok !== true || !ganz(o.id) || o.id === 0) fehler('Antwort: id');
  return o.id;
}

export interface Brief {
  id: number;
  /** Nur vom Knoten behauptet -- den Absender prüft die Hülle. */
  von: string;
  inhalt: string;
  zeit: number;
}

export interface Abgeholt {
  briefe: Brief[];
  mehr: boolean;
}

/** Die Antwort von /briefkasten/abholen, streng gelesen (sonst null). */
export function abholenLesen(roh: unknown, nach: number): Abgeholt | null {
  if (!roh || typeof roh !== 'object' || Array.isArray(roh)) return null;
  const o = roh as Record<string, unknown>;
  if (typeof o.mehr !== 'boolean' || !Array.isArray(o.briefe) || o.briefe.length > ABHOLEN_HOECHSTENS) return null;
  const briefe: Brief[] = [];
  let letzte = nach;
  let bytes = 0;
  for (const b of o.briefe) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) return null;
    const x = b as Record<string, unknown>;
    if (Object.keys(x).length !== 4) return null;
    if (!ganz(x.id) || x.id <= letzte || typeof x.von !== 'string' || !ADRESSE.test(x.von) || !ganz(x.zeit) || x.zeit === 0) return null;
    if (typeof x.inhalt !== 'string' || !HEX.test(x.inhalt) || x.inhalt.length / 2 > INHALT_MAX) return null;
    bytes += x.inhalt.length / 2;
    if (bytes > ABHOLEN_BYTES) return null;
    letzte = x.id;
    briefe.push({ id: x.id, von: x.von, inhalt: x.inhalt, zeit: x.zeit });
  }
  // "mehr" ohne einen Brief wäre eine Schleife ohne Fortschritt.
  if (o.mehr && briefe.length === 0) return null;
  return { briefe, mehr: o.mehr };
}

/** Die eigenen Briefe nach der Nummer nach abholen (höchstens ABHOLEN_HOECHSTENS). */
export async function abholen(
  an: string,
  nach: number,
  signer: Unterzeichner,
  jetztSek: number,
  fetchFn: typeof fetch = fetch,
  api: string = API_BASE,
): Promise<Abgeholt> {
  const a = adresse(an, 'an');
  if (!ganz(nach)) fehler('nach');
  const sig = await unterschrift(signer, abholenNachricht(a, nach, jetztSek), a);
  const text = await posten(fetchFn, `${api}/briefkasten/abholen`, { an: a, nach, zeit: jetztSek, sig }, ANTWORT_MAX);
  const r = abholenLesen(jsonObjekt(text), nach);
  if (!r) fehler('Antwort: Briefe');
  return r;
}

/** Die eigenen Briefe bis einschließlich bis löschen. Gibt die Zahl der gelöschten. */
export async function quittieren(
  an: string,
  bis: number,
  signer: Unterzeichner,
  jetztSek: number,
  fetchFn: typeof fetch = fetch,
  api: string = API_BASE,
): Promise<number> {
  const a = adresse(an, 'an');
  if (!ganz(bis)) fehler('bis');
  const sig = await unterschrift(signer, quittierenNachricht(a, bis, jetztSek), a);
  const o = jsonObjekt(await posten(fetchFn, `${api}/briefkasten/quittieren`, { an: a, bis, zeit: jetztSek, sig }, 1024));
  if (o.ok !== true || !ganz(o.geloescht)) fehler('Antwort: geloescht');
  return o.geloescht;
}
