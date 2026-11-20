// Quantengeld Varianten W (Note) und S (Token): den oeffentlichen Stand einer
// Kennung K ansehen (aequitas: GET /api/quanten-w/note?k=, quanten_w_kette.go
// quantenWNoteAnsicht, quanten_w_s_kette.go quantenWSTokenAnsichtLocked).
//
// Nur Anzeige. Die App prueft keine Note -- das tun die Validatoren und jeder
// Knoten. Die Antwort des Netzes wird streng in Form gebracht: was nicht
// passt, wird nicht angezeigt (null), statt halb.
import { API_BASE } from './config';

const K_FORM = /^[0-9a-f]{64}$/;
const ADRESSE = /^0x[0-9a-f]{40}$/;
/** Grenzen wie im Knoten (quanten_w.go): Stellen je Note, Validatoren, Schwelle. */
const N_MAX = 16384;
const V_MAX = 64;
const T_MAX = 16;
const FEHL_MAX = 3;
// Eine offene Anfrage traegt Stellen, Basen und Antwort (bis k = 8192): ~100 KB.
const ANTWORT_MAX = 256 * 1024;

export interface QuantenWAnfrageStand {
  /** Zahl der gezogenen Stellen der laufenden Pruefung. */
  k: number;
  /** So viele sind schon offengelegt. */
  offen: number;
  /** Pruefung zum Einloesen (sonst nur pruefen). */
  einloesen: boolean;
}

export type QuantenWStand =
  | {
      art: 'w';
      k: string;
      aktiv: boolean;
      n: number;
      t: number;
      v: number;
      tol: number;
      kNote: number;
      frei: number;
      fehl: number;
      gesperrt: boolean;
      wertMikro: number;
      anfrage: QuantenWAnfrageStand | null;
    }
  | {
      art: 's';
      k: string;
      aktiv: boolean;
      n: number;
      t: number;
      /** Validatoren, bei denen das Geheimnis liegt; null bei einem Knoten,
       *  der es noch nicht meldet (vor dem 18.11.2026, quanten_w_s_kette.go). */
      v: number | null;
      tol: number;
      inhaber: string;
      gebunden: boolean;
      gewaehlt: boolean;
      fehl: number;
      wertMikro: number;
      /** Laufende Einloesung: so viele Stellen der Stichprobe, so viele offen. */
      anmeldung: { probe: number; offen: number } | null;
      /** Stichprobe v2 (probe_art 2): vor Bindung und Wahl kannte keine
       *  Annahmestelle eine Stelle der Stichproben. false bei Token im
       *  bisherigen Weg und bei Knoten, die das Feld noch nicht melden. */
      stichprobeNachBindung: boolean;
    }
  | { art: 'tot'; k: string; aktiv: boolean };

export type QuantenWErgebnis = { ok: true; stand: QuantenWStand } | { ok: false; grund: 'eingabe' | 'unbekannt' | 'netz' };

function ganz(x: unknown, min: number, max: number): x is number {
  return typeof x === 'number' && Number.isSafeInteger(x) && x >= min && x <= max;
}

function bool(x: unknown): x is boolean {
  return typeof x === 'boolean';
}

/** Kennung K wie die Kette sie schreibt: 64 Zeichen 0-9, a-f. */
export function kennungGueltig(k: string): boolean {
  return K_FORM.test(k);
}

/** Bringt die Antwort des Knotens in Form; null, wenn etwas nicht passt. */
export function leseQuantenWStand(j: any, k: string): QuantenWStand | null {
  if (!j || typeof j !== 'object' || j.k !== k || !bool(j.aktiv)) return null;
  if (j.tot === true) return { art: 'tot', k, aktiv: j.aktiv };
  if (!ganz(j.n, 2, N_MAX) || !ganz(j.t, 1, T_MAX) || !ganz(j.tol, 1, 99) || !ganz(j.fehl, 0, FEHL_MAX) || !ganz(j.wert_mikro, 0, Number.MAX_SAFE_INTEGER)) {
    return null;
  }
  if (j.art === 's') {
    if (typeof j.inhaber !== 'string' || !ADRESSE.test(j.inhaber) || !bool(j.gebunden) || !bool(j.gewaehlt)) return null;
    // v fehlt bei aelteren Knoten (dann leer); ist es da, muss es passen.
    if (j.v !== undefined && !ganz(j.v, j.t, V_MAX)) return null;
    const v: number | null = j.v === undefined ? null : j.v;
    let anmeldung: { probe: number; offen: number } | null = null;
    if (j.anmeldung != null) {
      const a = j.anmeldung;
      if (!a || !Array.isArray(a.probe) || a.probe.length > j.n || !ganz(a.offen, 0, a.probe.length)) return null;
      anmeldung = { probe: a.probe.length, offen: a.offen };
    }
    // probe_art fehlt (bisheriger Weg, aelterer Knoten) oder ist 2 (v2);
    // jede andere Angabe passt nicht -- dann nichts anzeigen statt halb.
    if (j.probe_art !== undefined && j.probe_art !== 2) return null;
    const stichprobeNachBindung = j.probe_art === 2;
    return { art: 's', k, aktiv: j.aktiv, n: j.n, t: j.t, v, tol: j.tol, inhaber: j.inhaber, gebunden: j.gebunden, gewaehlt: j.gewaehlt, fehl: j.fehl, wertMikro: j.wert_mikro, anmeldung, stichprobeNachBindung };
  }
  if (j.art !== undefined) return null;
  const v = Array.isArray(j.validatoren) ? j.validatoren.length : -1;
  if (!ganz(v, j.t, V_MAX) || !j.validatoren.every((x: unknown) => typeof x === 'string' && ADRESSE.test(x))) return null;
  if (!ganz(j.k_note, 1, j.n) || !ganz(j.frei, 0, j.n) || !bool(j.gesperrt) || !ganz(j.zaehl, 0, 1 << 20)) return null;
  let anfrage: QuantenWAnfrageStand | null = null;
  if (j.anfrage != null) {
    // Die Kette gibt die Anfrage als Go-Struktur aus (Felder gross geschrieben).
    const a = j.anfrage;
    if (!a || !ganz(a.K, 1, j.n) || !ganz(a.Offen, 0, a.K) || typeof a.EinloesenAn !== 'string') return null;
    anfrage = { k: a.K, offen: a.Offen, einloesen: a.EinloesenAn !== '' };
  }
  return {
    art: 'w', k, aktiv: j.aktiv, n: j.n, t: j.t, v, tol: j.tol, kNote: j.k_note, frei: j.frei,
    fehl: j.fehl, gesperrt: j.gesperrt, wertMikro: j.wert_mikro, anfrage,
  };
}

/** Holt den Stand einer Kennung vom Knoten. */
export async function holeQuantenWStand(eingabe: string, fetchFn: typeof fetch = fetch): Promise<QuantenWErgebnis> {
  const k = eingabe.trim().toLowerCase();
  if (!kennungGueltig(k)) return { ok: false, grund: 'eingabe' };
  try {
    const r = await fetchFn(`${API_BASE}/quanten-w/note?k=${k}`, { headers: { Accept: 'application/json' } });
    if (r.status === 404) return { ok: false, grund: 'unbekannt' };
    if (!r.ok) return { ok: false, grund: 'netz' };
    const text = await r.text();
    if (text.length > ANTWORT_MAX) return { ok: false, grund: 'netz' };
    const stand = leseQuantenWStand(JSON.parse(text), k);
    return stand ? { ok: true, stand } : { ok: false, grund: 'netz' };
  } catch {
    return { ok: false, grund: 'netz' };
  }
}

/** Mikro-AEQ als Text mit vier Nachkommastellen (wie die Seite den Topf zeigt). */
export function aeqText(mikro: number): string {
  return (mikro / 1_000_000).toFixed(4) + ' AEQ';
}
