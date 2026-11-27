// Quantengeld Weg B (B4b-4c-1e): der echte Messer der Präparatorin -- IBM
// Quantum direkt aus dem Handy (Weg 1: der IBM-Schlüssel bleibt im Gerät).
//
// messen(u, t, y):
//   1. Token aus dem API-Schlüssel (holeToken); läuft er ab, ein neuer.
//   2. Gerät NUR aus der eigenen Instanz (crn des Zugangs): das freie Gerät mit
//      der kürzesten Schlange und genug Qubits (geraeteListe).
//   3. Schaltkreise des Abschnitts (abschnittKreise, ≤ 16 Stellen je Kreis), je
//      höchstens KREISE_MAX in einem Auftrag (auftragKoerper, SCHUESSE Schüsse).
//   4. Status abfragen im Takt, höchstens bis zur Frist; FAILED/CANCELLED oder
//      Frist -> Fehler (fail-closed: nie eine erfundene oder halbe Messung).
//   5. Ergebnis streng lesen (ergebnisSchuesse), Mehrheit je Stelle
//      (abschnittAuswerten).
//
// Der Zugang (API-Schlüssel und Instanz) liegt in SecureStore, geheim
// (Biometrie, nur dieses Gerät); er verlässt das Gerät nur zu IBM.

import {
  IbmFehler,
  KREISE_MAX,
  auftragKoerper,
  einreichen,
  ergebnisRoh,
  ergebnisSchuesse,
  geraeteListe,
  holeToken,
  status,
  zugangPruefen,
  type IbmZugang,
} from './ibmQuantum';
import type { Speicher } from './quantenSInhaberin';
import type { Fortsetzung, Messer } from './quantenSPraepAblauf';
import { MAX_QUBITS_KREIS, abschnittAuswerten, abschnittKreise } from './quantenSSchaltkreis';

export const IBM_ZUGANG = 'aequitas.quantenS.praep.ibmZugang';
/** Schüsse je Schaltkreis (ungerade, Mehrheit je Stelle). */
export const SCHUESSE = 5;
/** So lange wartet ein Auftrag höchstens auf IBM (Schlange + Lauf). */
export const FRIST_MS = 2 * 60 * 60_000;
export const TAKT_MS = 15_000;

export async function ibmZugangSpeichern(geheim: Speicher, z: IbmZugang): Promise<void> {
  const g = zugangPruefen(z);
  await geheim.schreiben(IBM_ZUGANG, JSON.stringify(g), true);
}

/** Der gespeicherte Zugang, streng gelesen; null, wenn keiner da ist. */
export async function ibmZugangLesen(geheim: Speicher): Promise<IbmZugang | null> {
  const roh = await geheim.lesen(IBM_ZUGANG);
  if (roh === null) return null;
  let o: unknown;
  try {
    o = JSON.parse(roh);
  } catch {
    throw new IbmFehler('IBM-Zugang im Gerät beschädigt');
  }
  if (!o || typeof o !== 'object' || Object.keys(o).sort().join(',') !== 'apiKey,crn') throw new IbmFehler('IBM-Zugang im Gerät beschädigt');
  return zugangPruefen(o as IbmZugang);
}

/** Warum eine Prüfung des Zugangs scheiterte (die App nennt es in Worten). */
export type IbmTestGrund = 'schluessel' | 'instanz' | 'kein_geraet' | 'netz' | 'form';

export class IbmTestFehler extends IbmFehler {
  constructor(public grund: IbmTestGrund, text: string) {
    super(text);
  }
}

/**
 * Prüft einen Zugang, BEVOR er gespeichert wird -- ohne Rechenzeit: Anmeldung
 * mit dem API-Schlüssel und die Liste der Quantenrechner dieser Instanz. Es gibt
 * mindestens einen freien mit genug Qubits, sonst ein Fehler mit Grund. Der
 * Schlüssel erscheint in keiner Meldung.
 */
export async function ibmZugangTesten(z: IbmZugang, fetchFn: typeof fetch, jetztMs: number): Promise<{ geraete: number; bestes: string }> {
  let g: IbmZugang;
  try {
    g = zugangPruefen(z);
  } catch {
    throw new IbmTestFehler('form', 'Schlüssel oder Instanz nicht in gültiger Form');
  }
  let token: string;
  try {
    token = (await holeToken(g, jetztMs, fetchFn)).token;
  } catch (e) {
    // Nur eine Ablehnung (HTTP 4xx) heißt "Schlüssel falsch"; alles andere
    // (Netz, 5xx, seltsame Antwort) heißt "IBM gerade nicht erreichbar".
    if (/^Anmeldung bei IBM: HTTP 4\d\d$/.test(String((e as Error)?.message ?? ''))) {
      throw new IbmTestFehler('schluessel', 'IBM nimmt den API-Schlüssel nicht an');
    }
    throw new IbmTestFehler('netz', 'IBM nicht erreichbar');
  }
  let liste;
  try {
    liste = await geraeteListe(token, g.crn, fetchFn);
  } catch (e) {
    const t = String((e as Error)?.message ?? '');
    if (/^Geräte: HTTP 4\d\d$/.test(t) || t === 'Instanz (CRN): unbekannte Region') {
      throw new IbmTestFehler('instanz', 'Die Instanz (CRN) passt nicht zu diesem Schlüssel');
    }
    throw new IbmTestFehler('netz', 'IBM nicht erreichbar');
  }
  const passend = liste.filter((d) => d.qubits >= MAX_QUBITS_KREIS);
  if (passend.length === 0) throw new IbmTestFehler('kein_geraet', 'In dieser Instanz ist gerade kein Quantenrechner frei');
  return { geraete: passend.length, bestes: passend[0].name };
}

export interface IbmUmgebung {
  fetchFn: typeof fetch;
  /** Millisekunden */
  jetzt: () => number;
  warten: (ms: number) => Promise<void>;
}

export function ibmMesser(zugang: IbmZugang, u: IbmUmgebung, opt: { schuesse?: number; fristMs?: number; taktMs?: number } = {}): Messer {
  const z = zugangPruefen(zugang);
  const schuesse = opt.schuesse ?? SCHUESSE;
  const frist = opt.fristMs ?? FRIST_MS;
  const takt = opt.taktMs ?? TAKT_MS;
  if (schuesse % 2 !== 1) throw new IbmFehler('Schüsse ungerade');
  let tok: { token: string; bis: number } | null = null;
  const token = async () => {
    if (!tok || u.jetzt() > tok.bis - 60_000) tok = await holeToken(z, u.jetzt(), u.fetchFn);
    return tok.token;
  };
  return {
    async messen(ub: number[], tb: number[], y: number[], fort?: Fortsetzung): Promise<number[]> {
      const n = ub.length;
      if (n < 1 || tb.length !== n || y.length !== n) throw new IbmFehler('Messung: Längen');
      const qubits = Math.min(MAX_QUBITS_KREIS, n);
      // Das Gerät wird nur zum Einreichen gebraucht; fortgesetzte Aufträge laufen schon.
      let geraet: string | null = null;
      const geraetName = async () => {
        if (geraet === null) {
          const g = (await geraeteListe(await token(), z.crn, u.fetchFn)).find((d) => d.qubits >= qubits);
          if (!g) throw new IbmFehler('Geräte: kein freies Gerät mit genug Qubits in dieser Instanz');
          geraet = g.name;
        }
        return geraet;
      };
      const kreise = abschnittKreise(ub, tb, y, Array.from({ length: qubits }, (_, i) => i));
      const teile = Math.ceil(kreise.length / KREISE_MAX);
      if (fort && fort.jobs.length > teile) throw new IbmFehler('Fortsetzung: Aufträge passen nicht zur Messung');
      const jobs: (string | null)[] = Array.from({ length: teile }, (_, c) => fort?.jobs[c] ?? null);
      const x: number[] = [];
      for (let c = 0; c < teile; c++) {
        const teil = kreise.slice(c * KREISE_MAX, (c + 1) * KREISE_MAX);
        let id = jobs[c];
        if (id === null) {
          id = await einreichen(await token(), z.crn, auftragKoerper(await geraetName(), teil.map((k) => k.qasm), schuesse), u.fetchFn);
          jobs[c] = id;
          // Sichern, BEVOR gewartet wird: bricht die App ab, geht der Auftrag nicht verloren.
          if (fort) await fort.merken([...jobs]);
        }
        const start = u.jetzt();
        for (;;) {
          const s = await status(await token(), z.crn, id, u.fetchFn);
          if (s === 'COMPLETED') break;
          if (s === 'FAILED' || s === 'CANCELLED') {
            // Dieser Auftrag liefert nie ein Ergebnis: vergessen, die nächste Runde reicht neu ein.
            jobs[c] = null;
            if (fort) await fort.merken([...jobs]);
            throw new IbmFehler(`IBM-Auftrag ${id}: ${s}`);
          }
          // Frist dieser Runde: der Auftrag bleibt gemerkt (er kann noch in der Schlange laufen).
          if (u.jetzt() - start > frist) throw new IbmFehler(`IBM-Auftrag ${id}: Frist überschritten`);
          await u.warten(takt);
        }
        const roh = await ergebnisRoh(await token(), z.crn, id, u.fetchFn);
        x.push(...abschnittAuswerten(teil, ergebnisSchuesse(roh, teil.map((k) => k.n)), schuesse));
      }
      if (x.length !== n) throw new IbmFehler('Messung: Zahl der Stellen');
      return x;
    },
  };
}
