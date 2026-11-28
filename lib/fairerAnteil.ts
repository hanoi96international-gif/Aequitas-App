// Der faire Anteil und was die Regeln netto bewirken -- nur Anzeige
// (Vorschlag 2 in aequitas docs/WIRTSCHAFT_STARTBETRAG.md).
//
// Fairer Anteil = Startbetrag g; nach der Regel M = N x g ist das die Geldmenge
// je Mensch (GET /api/wirtschaft/regeln, "fairer_anteil"). Die App zeigt das
// Guthaben als Anteil daran ("92 % deines fairen Anteils") und, fuer Menschen,
// das ungefaehre Netto im Monat:
//   Grundeinkommen der letzten 30 Tage (aus dem Kontoverlauf der Kette)
//   - Umlaufabgabe bei diesem Stand (GET /api/wirtschaft/konto).
// Wer unter dem fairen Anteil liegt, bekommt so netto dazu, wer darueber liegt,
// gibt ab. An den Regeln aendert sich nichts. Antworten werden streng gelesen:
// was nicht passt, wird nicht angezeigt (null), statt halb.
import type { WirtschaftKonto } from './ueberweisung';

const BETRAG_MAX = 1e12;

export interface WirtschaftRegeln {
  /** AEQ, > 0 */
  fairerAnteil: number;
  /** Grundeinkommen eines Menschen in den letzten 30 Tagen (AEQ); null = noch nicht berechnet. */
  grundeinkommen30: number | null;
}

const obj = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const betrag = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= BETRAG_MAX ? v : null;

export function leseRegeln(d: unknown): WirtschaftRegeln | null {
  const o = obj(d);
  if (!o) return null;
  const fairerAnteil = betrag(o.fairer_anteil);
  if (fairerAnteil === null || fairerAnteil <= 0) return null;
  const ge = obj(o.grundeinkommen_30_tage);
  const grundeinkommen30 = ge ? betrag(ge.je_mensch) : null;
  return { fairerAnteil, grundeinkommen30 };
}

/** Guthaben in ganzen Prozent des fairen Anteils; null, wenn etwas nicht passt. */
export function anteilProzent(guthaben: number, regeln: WirtschaftRegeln | null): number | null {
  if (!regeln || !Number.isFinite(guthaben) || guthaben < 0 || guthaben > BETRAG_MAX) return null;
  return Math.round((guthaben / regeln.fairerAnteil) * 100);
}

export interface NettoMonat {
  grundeinkommen: number;
  abgabe: number;
  /** grundeinkommen - abgabe, auf 6 Stellen gerundet */
  netto: number;
}

/**
 * Ungefaehres Netto im Monat -- nur fuer ein aktives Menschenkonto im
 * Gleichgewicht (sonst gelten andere Regeln, und Unternehmen bekommen kein
 * Grundeinkommen). null, wenn eine Zahl fehlt.
 */
export function nettoMonat(regeln: WirtschaftRegeln | null, konto: WirtschaftKonto | null | undefined): NettoMonat | null {
  if (!regeln || regeln.grundeinkommen30 === null) return null;
  if (!konto || konto.art !== 'mensch' || konto.aktiv !== true || konto.gleichgewicht !== true) return null;
  const abgabe = betrag(konto.abgabe_pro_monat_bei_diesem_stand ?? 0);
  if (abgabe === null) return null;
  const grundeinkommen = regeln.grundeinkommen30;
  return { grundeinkommen, abgabe, netto: Math.round((grundeinkommen - abgabe) * 1e6) / 1e6 };
}

/** Fuer die Anzeige: hoechstens zwei Nachkommastellen, ohne Nullen am Ende. */
export function zweiStellen(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return (Math.round(n * 100) / 100).toFixed(2).replace(/\.?0+$/, '');
}
