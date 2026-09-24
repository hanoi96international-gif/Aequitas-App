/**
 * Die Überweisungsgebühr der Kette (ueberweisungsgebuehr.go), hier nur zur
 * Anzeige und für die Vorabprüfung: Die Kette rechnet selbst und bucht ab.
 *
 * Seit 24.09.2026 zahlt jede Überweisung 0,1 %, OBENDRAUF: der Empfänger
 * bekommt genau den Betrag, der Absender zahlt Betrag + Gebühr. Aufschlag
 * nur für große Guthaben, gemessen am fairen Anteil (1.000 AEQ): ab dem
 * 5-fachen +0,1 %, ab dem 10-fachen +0,5 %, ab dem 20-fachen +1 %. Die
 * Gebühr geht ganz ans Grundeinkommen.
 */
export const FAIRER_ANTEIL_AEQ = 1000;
export const GEBUEHR_BPS = 10;

/** Gebühr in AEQ für betrag bei einem Guthaben des Absenders, auf
 *  Mikro-AEQ gerundet wie in der Kette. */
export function ueberweisungsGebuehr(betrag: number, guthaben: number): number {
  if (!Number.isFinite(betrag) || betrag <= 0) return 0;
  let bps = GEBUEHR_BPS;
  const g = Number.isFinite(guthaben) ? guthaben : 0;
  if (g >= 20 * FAIRER_ANTEIL_AEQ) bps += 100;
  else if (g >= 10 * FAIRER_ANTEIL_AEQ) bps += 50;
  else if (g >= 5 * FAIRER_ANTEIL_AEQ) bps += 10;
  return Math.round((betrag * bps) / 10_000 * 1e6) / 1e6;
}

/** Gebührensatz in Prozent (für die Anzeige, z. B. "0,1"). */
export function gebuehrProzent(guthaben: number): number {
  return (ueberweisungsGebuehr(10_000, guthaben) / 10_000) * 100;
}

/** Größter Betrag, den guthaben samt Gebühr noch deckt (Mikro-AEQ, abgerundet). */
export function hoechsterBetrag(guthaben: number): number {
  if (!Number.isFinite(guthaben) || guthaben <= 0) return 0;
  const satz = gebuehrProzent(guthaben) / 100;
  let b = Math.floor((guthaben / (1 + satz)) * 1e6) / 1e6;
  // Rundung der Gebühr kann den Rand um ein Mikro-AEQ verschieben.
  while (b > 0 && b + ueberweisungsGebuehr(b, guthaben) > guthaben + 1e-9) b = Math.round((b - 1e-6) * 1e6) / 1e6;
  return b;
}
