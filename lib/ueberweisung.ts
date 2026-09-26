// Ueberweisen: Gebuehr, Hoechstbetrag und verstaendliche Fehlermeldungen.
//
// Die Rechnung folgt der Kette (aequitas-chain, x/humanity/keeper/wirtschaft.go,
// gebuehrMitWirtschaft; aktiv seit 26.09.2026 15:00 UTC):
//   - Mensch: die ersten 1.000 AEQ Ausgaben im Monat gebuehrenfrei, danach
//     0,1 % obendrauf -- der Empfaenger bekommt immer den vollen Betrag.
//   - Unternehmen an Mensch: 0 (Lohn, Entnahme). Sonst 0,1 %.
// Den gebuehrenfreien Rest liefert /api/wirtschaft/konto. Ohne diese Auskunft
// rechnet die App mit 0,1 % auf den ganzen Betrag: lieber eine Gebuehr zu
// hoch anzeigen als eine Ueberweisung scheitern lassen.

export const GEBUEHR_BPS = 10; // 0,1 %
const MIKRO = 1_000_000;

export interface WirtschaftKonto {
  art: 'mensch' | 'unternehmen' | 'frei' | 'system' | string;
  guthaben: number;
  aktiv: boolean;
  gebuehrenfrei_rest_monat?: number;
  tausch_frei_rest_monat?: number;
  abgabe_pro_monat_bei_diesem_stand?: number;
  grenze?: number;
}

function runde6(x: number): number {
  return Math.round(x * MIKRO) / MIKRO;
}

/** Gebuehrenfreier Rest dieses Monats (0, wenn unbekannt oder kein Mensch). */
export function freierRest(konto: WirtschaftKonto | null | undefined): number {
  if (!konto || !konto.aktiv || konto.art !== 'mensch') return 0;
  return Math.max(0, konto.gebuehrenfrei_rest_monat ?? 0);
}

/** Gebuehr fuer betrag, wie die Kette sie berechnet (Absender-Sicht). */
export function gebuehrFuer(betrag: number, konto: WirtschaftKonto | null | undefined): number {
  if (!(betrag > 0) || !Number.isFinite(betrag)) return 0;
  const pflichtig = Math.max(0, betrag - freierRest(konto));
  return runde6((pflichtig * GEBUEHR_BPS) / 10_000);
}

/** Groesster Betrag, der samt Gebuehr ins Guthaben passt (auf Mikro-AEQ abgerundet). */
export function hoechstbetrag(guthaben: number, konto: WirtschaftKonto | null | undefined): number {
  if (!(guthaben > 0)) return 0;
  const frei = freierRest(konto);
  const satz = GEBUEHR_BPS / 10_000;
  const roh = guthaben <= frei ? guthaben : (guthaben + satz * frei) / (1 + satz);
  let b = Math.floor(roh * MIKRO) / MIKRO;
  // Rundung der Gebuehr kann um ein Mikro-AEQ darueber liegen.
  while (b > 0 && b + gebuehrFuer(b, konto) > guthaben + 1e-9) b = runde6(b - 1 / MIKRO);
  return Math.max(0, b);
}

export type FehlerArt =
  | 'abgebrochen'
  | 'zeitueberschreitung'
  | 'guthaben'
  | 'nonce'
  | 'beschaeftigt'
  | 'freieAdresseVoll'
  | 'nichtAngenommen'
  | 'netz'
  | 'unbekannt';

/** Ordnet eine Fehlermeldung aus Wallet, ethers oder Knoten einer Art zu. */
export function fehlerArt(e: unknown): FehlerArt {
  const roh = e as { code?: unknown; message?: unknown; shortMessage?: unknown; info?: unknown } | null;
  const code = roh?.code;
  const text = [roh?.shortMessage, roh?.message, JSON.stringify(roh?.info ?? '')]
    .filter((x) => typeof x === 'string')
    .join(' ')
    .toLowerCase();
  if (code === 'ACTION_REJECTED' || code === 4001 || /user rejected|user denied|abgelehnt vom nutzer/.test(text)) return 'abgebrochen';
  if (/zeit.?ueberschreitung|zeitüberschreitung|timeout|timed out/.test(text)) return 'zeitueberschreitung';
  if (code === 'INSUFFICIENT_FUNDS' || /insufficient|nicht genug|guthaben reicht/.test(text)) return 'guthaben';
  if (/free address|freie adresse/.test(text)) return 'freieAdresseVoll';
  if (/nonce too low|nonce too high|nonce has already been used|nonce.*verbraucht/.test(text)) return 'nonce';
  if (/server busy|beschaeftigt|-32005|try again/.test(text)) return 'beschaeftigt';
  if (/nur lesend|does not accept|nimmt keine|read.?only/.test(text)) return 'nichtAngenommen';
  if (code === 'NETWORK_ERROR' || code === 'SERVER_ERROR' || /network|failed to fetch|econn|socket/.test(text)) return 'netz';
  return 'unbekannt';
}

/** Betrag exakt, ohne Abkuerzung ("1500.5", nicht "1.50K") -- fuer Bestaetigung und Gebuehr. */
export function betragText(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(6).replace(/\.?0+$/, '');
}
