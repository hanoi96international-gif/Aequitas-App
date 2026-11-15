// Tausch und Liquiditaet: Nachrichtenform 2 (Audit B15, 14.11.2026).
//
// Die Kette (aequitas-chain, x/humanity/keeper/auftrag_v2.go) nimmt die alte
// Nachricht ("Aequitas Swap: <richtung> <betrag> nonce ts") nur bis
// 01.12.2026 00:00 UTC an. Sie trug weder Kette noch Wallet noch die
// Schlupfgrenze: wer die Anfrage unterwegs aendern konnte, setzte
// min_amount_out auf 0. Form 2 bindet alles, was den Auftrag ausmacht:
//
//   aequitas-tausch-v2|chain:1926|<wallet>|<richtung>|<betrag>|min:<min>|nonce:<n>|ts:<t>
//   aequitas-liquiditaet-v2|chain:1926|<wallet>|<aeq>|<tusd>|nonce:<n>|ts:<t>
//   aequitas-liquiditaet-ab-v2|chain:1926|<wallet>|<anteile>|nonce:<n>|ts:<t>
//
// Die 1926 ist EINGEFROREN (wie in den Coordinator-Saetzen): sie aendert sich
// mit dem Chain-ID-Wechsel nicht.
//
// Betraege: der Knoten unterschreibt Go-"%.8f" des Werts, den er aus dem JSON
// liest. Darum werden Betrag und Grenze VOR dem Unterschreiben auf 8
// Nachkommastellen gebracht und genau dieser Wert geschickt -- dann ergeben
// toFixed(8) und %.8f dieselben Ziffern (kein Gleichstand an der 9. Stelle).

export const AUFTRAG_FORM = 2;
const KETTE = 1926;
const ACHT = 1e8;

export type Richtung = 'aeq_to_tusd' | 'tusd_to_aeq';

/** Betrag auf 8 Nachkommastellen (gerundet); ungueltig/negativ -> 0. */
export function achtStellen(x: number): number {
  if (!Number.isFinite(x) || x <= 0) return 0;
  return Math.round(x * ACHT) / ACHT;
}

/**
 * Mindestbetrag auf 8 Nachkommastellen, ABGERUNDET: die Grenze darf durch das
 * Runden nie ueber dem liegen, was der Nutzer akzeptiert hat.
 */
export function mindestAchtStellen(x: number): number {
  if (!Number.isFinite(x) || x <= 0) return 0;
  return Math.floor(x * ACHT) / ACHT;
}

function w(wallet: string): string {
  return wallet.trim().toLowerCase();
}

export function tauschNachricht(
  wallet: string,
  richtung: Richtung,
  betrag: number,
  min: number,
  nonce: number,
  ts: number,
): string {
  return (
    'aequitas-tausch-v2|chain:' + KETTE + '|' + w(wallet) + '|' + richtung + '|' +
    betrag.toFixed(8) + '|min:' + min.toFixed(8) + '|nonce:' + nonce + '|ts:' + ts
  );
}

export function liquiditaetNachricht(
  wallet: string,
  aeq: number,
  tusd: number,
  nonce: number,
  ts: number,
): string {
  return (
    'aequitas-liquiditaet-v2|chain:' + KETTE + '|' + w(wallet) + '|' +
    aeq.toFixed(8) + '|' + tusd.toFixed(8) + '|nonce:' + nonce + '|ts:' + ts
  );
}

export function liquiditaetAbNachricht(wallet: string, anteile: number, nonce: number, ts: number): string {
  return (
    'aequitas-liquiditaet-ab-v2|chain:' + KETTE + '|' + w(wallet) + '|' +
    anteile.toFixed(8) + '|nonce:' + nonce + '|ts:' + ts
  );
}
