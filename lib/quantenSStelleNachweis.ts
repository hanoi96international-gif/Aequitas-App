// Quantengeld Variante S, P5c: die Annahmestelle WEIST EINE FÄLSCHUNG NACH
// (Knoten x/humanity/keeper/quanten_s_faelschung.go, P4 und P4b).
//
// Lage: Eine Inhaberin hat ihre Vorlage hier gezeigt, die Vorlage bestand die
// Stichprobe dieser Stelle (eigene Rechnung beim Annehmen, `vorab`), und der
// Token wurde trotzdem an der ANDEREN Stelle eingelöst. Dann hat die
// Inhaberin zwei Vorlagen unterschrieben, die beide bestehen. Diese Stelle
// bekommt dafür das Pfand der Inhaberin (Deckung + 10 %), wenn sie es in der
// Frist (7 Tage nach dem Ende) auf der Kette beweist:
//
//   1. quanten_w_s_faelschung_anmelden: Vorlage (x und Unterschrift der
//      Inhaberin), Stichprobe, Salze -- unterschrieben von dieser Stelle über
//      aequitas-quanten-s-faelschung-anmelden-v1|chain|wallet|K|b|H(x)|H(probe)|fehl
//      (fehl = Fehlversuche des Nachweises, aus der Ansicht).
//   2. quanten_w_s_faelschung_offenlegen: in Teilen zu höchstens TEIL Stellen,
//      je Stelle der Wert w mit seinem Merkle-Pfad, KEINE Anteile (P4b; die
//      Anteile lägen bei den Mitfälschern). Jeder Knoten prüft w gegen die
//      Wurzel der Ausgabe.
//
// Den Stoff (Werte, Salze, Blätter, Vorlage) sichert annehmenAlsStelle vor
// dem Anmelden (nachweisSichern in lib/quantenSStelle.ts). Gelesen wird er
// fail-closed (jeder Wert gegen sein Blatt, die Blätter gegen die Wurzel).
//
// Fail-closed auch hier: nur wenn die Kette den Nachweis GENAU dieser Stelle
// anbietet (tot, Urteil eingelöst, nachweis_stelle = b, Frist offen) und die
// eigene Rechnung beim Annehmen „besteht“ war -- sonst kostete ein Versuch nur
// einen Fehlversuch. Ein unterbrochener Nachweis setzt beim Stand der Kette
// fort (nachweis_offen). Grenzen: Warten höchstens WARTEN_MAX_MS je Schritt,
// Antworten des Knotens höchstens ANTWORT_MAX Zeichen.

import { ethers } from 'ethers';
import { CHAIN_ID, QuantenSFehler, adresseVon, bestuende, merklePfade, unterschreiben, type KettenStand } from './quantenS';
import { TAKT_MS, WARTEN_MAX_MS, stand, type Umgebung } from './quantenSInhaberin';
import { nachweisLaden, nachweisVergessen, nachweiseGesichert, type NachweisStoff } from './quantenSStelle';

const DOM_FAELSCHUNG_ANMELDEN = 'aequitas-quanten-s-faelschung-anmelden-v1';
/** quantenWOffenTeil im Knoten */
export const TEIL = 64;
const FEHL_MAX = 3; // quantenWFehlMax
const FRIST_MS = 30_000;
const ANTWORT_MAX = 64 * 1024;

function fehler(text: string): never {
  throw new QuantenSFehler(text);
}

const utf8 = (s: string) => ethers.toUtf8Bytes(s);
const sha256Hex = (s: string) => ethers.sha256(utf8(s)).slice(2);

/** quantenSFaelschungAnmeldenNachricht: was die Stelle zum Nachweis unterschreibt. */
export function faelschungAnmeldenNachricht(wallet: string, K: string, b: string, xBits: string, probe: number[], fehl: number): string {
  return `${DOM_FAELSCHUNG_ANMELDEN}|chain:${CHAIN_ID}|${wallet.toLowerCase()}|${K}|${b}|${sha256Hex(xBits)}|${sha256Hex(probe.join(','))}|${fehl}`;
}

/** Die eigene Rechnung wie beim Annehmen: besteht x die Stichprobe dieser Stelle? */
export function nachweisBestuende(s: NachweisStoff): boolean {
  let treffer = 0;
  let fehlerZahl = 0;
  s.probe.forEach((i, j) => {
    const w = s.werte[j];
    if ((Number(s.d[i]) ^ s.b ^ s.c) === Number(w & 1n)) {
      treffer++;
      if (Number(s.x[i]) !== Number((w >> 1n) & 1n)) fehlerZahl++;
    }
  });
  return bestuende(treffer, fehlerZahl, s.tol);
}

export type NachweisLage =
  /** kein Stoff im Gerät */
  | { art: 'kein_stoff' }
  /** der Token läuft noch (oder diese Stelle hat selbst eingelöst und die Kette hat ihn noch) */
  | { art: 'laeuft' }
  /** der Nachweis ist möglich: anmelden bis `bis` (Sekunden) */
  | { art: 'moeglich'; bis: number; fehl: number }
  /** angemeldet, `offen` Stellen der Stichprobe sind offengelegt */
  | { art: 'angemeldet'; bis: number; fehl: number; offen: number }
  /** keiner (mehr): an dieser Stelle eingelöst, Frist vorbei, erledigt oder nie angeboten */
  | { art: 'vorbei' };

const ganz = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

/** Die Lage aus dem Stand der Kette, für den Stoff dieser Stelle. */
export function lageAus(st: KettenStand | null, b: 0 | 1, jetztS: number): NachweisLage {
  if (st === null) return { art: 'vorbei' };
  if (st.tot !== true) return { art: 'laeuft' };
  const o = st as Record<string, unknown>;
  if (o.urteil !== 'eingeloest' || o.nachweis_stelle !== b || !ganz(o.nachweis_bis) || !ganz(o.nachweis_fehl) || (o.nachweis_fehl as number) >= FEHL_MAX) return { art: 'vorbei' };
  const bis = o.nachweis_bis as number;
  const fehl = o.nachweis_fehl as number;
  if (o.nachweis_angemeldet !== undefined) {
    if (!ganz(o.nachweis_offen)) return { art: 'vorbei' };
    return { art: 'angemeldet', bis, fehl, offen: o.nachweis_offen as number };
  }
  return jetztS <= bis ? { art: 'moeglich', bis, fehl } : { art: 'vorbei' };
}

/** Die Lage für einen gesicherten Stoff (liest die Kette). */
export async function nachweisLage(u: Umgebung, schluesselHex: string, K: string): Promise<NachweisLage> {
  const s = await nachweisLaden(u, schluesselHex, K);
  if (!s) return { art: 'kein_stoff' };
  return lageAus(await stand(u, K), s.b, Math.floor(u.jetzt() / 1000));
}

/**
 * Aufräumen: Stoff, zu dem es keinen Nachweis (mehr) geben kann, löschen --
 * die Kette hat den Token vergessen oder bietet ihn nicht (mehr) an. Läuft
 * der Token noch, bleibt der Stoff. Gibt die K zurück, zu denen ein Nachweis
 * möglich oder angemeldet ist.
 */
export async function nachweiseAufraeumen(u: Umgebung, schluesselHex: string): Promise<{ k: string; lage: NachweisLage }[]> {
  const offen: { k: string; lage: NachweisLage }[] = [];
  for (const K of await nachweiseGesichert(u)) {
    let lage: NachweisLage;
    try {
      lage = await nachweisLage(u, schluesselHex, K);
    } catch (e) {
      // Stoff unlesbar oder fremder Schlüssel: nicht anfassen, nicht anbieten.
      if (e instanceof QuantenSFehler) continue;
      throw e;
    }
    if (lage.art === 'vorbei') await nachweisVergessen(u, K);
    else if (lage.art === 'moeglich' || lage.art === 'angemeldet') offen.push({ k: K, lage });
  }
  return offen;
}

async function senden(u: Umgebung, art: 's_faelschung_anmelden' | 's_faelschung_offenlegen', wallet: string, q: Record<string, unknown>): Promise<Record<string, unknown>> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FRIST_MS);
  let status = 0;
  let text = '';
  try {
    const r = await u.fetchFn(`${u.apiBasis}/quanten-w/${art}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ wallet, zeit: 0, quanten_w: q }),
      signal: ctrl.signal,
      redirect: 'error',
    } as RequestInit);
    status = r.status;
    text = await r.text();
  } catch {
    fehler('Netz');
  } finally {
    clearTimeout(t);
  }
  if (text.length > ANTWORT_MAX) fehler('Antwort des Knotens zu gross');
  let j: unknown = null;
  try {
    j = JSON.parse(text);
  } catch {
    // unten
  }
  if (status !== 200) {
    const grund = (j as { error?: unknown } | null)?.error;
    fehler(`Knoten: HTTP ${status}${typeof grund === 'string' ? ` – ${grund.slice(0, 200)}` : ''}`);
  }
  const g = (j as { gerechnet?: unknown } | null)?.gerechnet;
  return g && typeof g === 'object' && !Array.isArray(g) ? (g as Record<string, unknown>) : {};
}

async function lageWarten(u: Umgebung, K: string, b: 0 | 1, fertig: (l: NachweisLage) => boolean, was: string): Promise<NachweisLage> {
  const ende = u.jetzt() + WARTEN_MAX_MS;
  for (;;) {
    const l = lageAus(await stand(u, K), b, Math.floor(u.jetzt() / 1000));
    if (fertig(l)) return l;
    if (u.jetzt() >= ende) fehler(`${was}: nicht in ${WARTEN_MAX_MS / 60_000} Minuten auf der Kette`);
    await u.warten(TAKT_MS);
  }
}

export type NachweisSchritt = 'pruefen' | 'anmelden' | 'offenlegen';

export interface NachweisErgebnis {
  k: string;
  /** "faelschung": bestanden, das Pfand ging an diese Stelle; "abgewiesen": ein Fehlversuch */
  urteil: 'faelschung' | 'abgewiesen';
  /** Mikro-AEQ an diese Stelle (nur bei "faelschung") */
  pfand: number;
}

/**
 * Den Nachweis führen (oder fortsetzen). schluesselHex: der Schlüssel dieser
 * Stelle (derselbe wie beim Annehmen).
 */
export async function nachweisFuehren(u: Umgebung, schluesselHex: string, K: string, fortschritt: (s: NachweisSchritt, teil?: { offen: number; von: number }) => void = () => {}): Promise<NachweisErgebnis> {
  fortschritt('pruefen');
  const s = await nachweisLaden(u, schluesselHex, K);
  if (!s) fehler('zu diesem Token liegt kein Stoff für einen Nachweis im Gerät');
  const ich = adresseVon(schluesselHex);
  if (s.vorab !== 'besteht' || !nachweisBestuende(s)) fehler('die Vorlage bestand die Stichprobe dieser Stelle nicht -- ein Nachweis gelänge nicht');
  let lage = lageAus(await stand(u, K), s.b, Math.floor(u.jetzt() / 1000));
  if (lage.art !== 'moeglich' && lage.art !== 'angemeldet') {
    fehler(lage.art === 'laeuft' ? 'der Token läuft noch -- ein Nachweis gibt es erst, wenn er an der anderen Stelle eingelöst ist' : 'die Kette bietet diesen Nachweis nicht (mehr) an');
  }

  if (lage.art === 'moeglich') {
    fortschritt('anmelden');
    const bs = String(s.b);
    const sig = unterschreiben(schluesselHex, faelschungAnmeldenNachricht(ich, K, bs, s.x, s.probe, lage.fehl));
    await senden(u, 's_faelschung_anmelden', ich, { k: K, b: bs, x: s.x, probe: s.probe, vorlage: s.vorlage, salze: s.salze, wallet_sig: sig });
    lage = await lageWarten(u, K, s.b, (l) => l.art === 'angemeldet' || l.art === 'vorbei', 'Anmeldung des Nachweises');
    if (lage.art !== 'angemeldet') fehler('die Anmeldung des Nachweises steht nicht auf der Kette');
  }

  // Offenlegen ab dem Stand der Kette, in Teilen; je Stelle w und Merkle-Pfad.
  const offenAb = (lage as { offen: number }).offen;
  if (offenAb > s.probe.length) fehler('die Kette nennt mehr offene Stellen, als die Stichprobe hat');
  const pfade = merklePfade(s.blaetter, s.probe.slice(offenAb));
  let letzt: Record<string, unknown> = {};
  for (let ab = offenAb; ab < s.probe.length; ab += TEIL) {
    fortschritt('offenlegen', { offen: ab, von: s.probe.length });
    const bis = Math.min(ab + TEIL, s.probe.length);
    const offen = [];
    for (let j = ab; j < bis; j++) offen.push({ anteile: [], pfad: pfade.get(s.probe[j]) as string[], w: s.werte[j].toString(16) });
    letzt = await senden(u, 's_faelschung_offenlegen', '', { k: K, ab, offen });
    if (bis < s.probe.length && letzt.urteil !== 'teil') fehler(`Teil ab ${ab}: die Kette antwortet ${String(letzt.urteil)}`);
  }
  const urteil = letzt.urteil;
  if (urteil === 'faelschung') {
    const pfand = letzt.pfand;
    if (!ganz(pfand) || letzt.pfand_an !== ich) fehler('BEFUND: der Nachweis bestand, aber das Pfand ging nicht an diese Stelle');
    await nachweisVergessen(u, K);
    return { k: K, urteil, pfand };
  }
  if (urteil === 'abgewiesen') return { k: K, urteil, pfand: 0 };
  return fehler(`unerwartetes Urteil der Kette: ${String(urteil)}`);
}
