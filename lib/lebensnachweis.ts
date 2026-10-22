// Jaehrlicher Lebensnachweis -- was die Kette in /api/balance dazu sagt, und
// was die App daraus macht. Rein, ohne Netz und ohne Expo-Module: getestet in
// lib/__tests__/lebensnachweis.test.ts.
//
// DIE REGEL (wie die Kette rechnet, hier nur angezeigt)
//
//   am          letzter Nachweis (bzw. Registrierung)
//   faellig_ab  am + 300 Tage: ab hier kann bestaetigt werden
//   frist       am + 365 Tage: bis hier sollte bestaetigt sein
//   pause_ab    frist + 30 Tage Nachfrist
//   pausiert    die Kette zahlt den taeglichen Anteil am Grundeinkommen
//               gerade nicht aus. Mensch-Status und Guthaben bleiben; nach
//               der Bestaetigung laeuft der Anteil sofort wieder.
//
// FAIL-CLOSED
//
// Fehlt das Objekt (aeltere Knoten) oder ist es kaputt, gibt es KEINEN Stand
// -- und dann zeigt die App nichts an: weder eine Karte noch eine Erinnerung.
// Ein halb gelesenes Objekt wuerde sonst "faellig" oder "pausiert" anzeigen,
// was die Kette nie gesagt hat. Geprueft wird ohnehin nicht hier: der
// Coordinator fragt die Kette selbst (lebensnachweis.stand_pruefen), und die
// Kette prueft die Bescheinigung selbst.

import type { Translations } from './i18n/types';

/** Ab wann ein Nachweis wieder moeglich ist, in Tagen nach dem letzten --
 *  nur fuer die Anzeige nach einem Erfolg, falls die Kette selbst keinen
 *  Termin nennt. Die Kette rechnet selbst. */
export const LEBENSNACHWEIS_FAELLIG_NACH_TAGE = 300;

export interface LebensnachweisStand {
  aktiv: boolean;
  am: number;
  faellig_ab: number;
  frist: number;
  pause_ab: number;
  pausiert: boolean;
}

export type LebensnachweisPhase =
  | 'inaktiv' // die Kette verlangt fuer dieses Konto (noch) keinen Nachweis
  | 'noch_nicht' // gueltig; der naechste ist ab faellig_ab moeglich
  | 'faellig' // kann jetzt bestaetigt werden, Frist laeuft
  | 'nachfrist' // Frist vorbei, Nachfrist bis pause_ab
  | 'pausiert'; // taeglicher Anteil ruht bis zur Bestaetigung

// Unix-Sekunden: ganze Zahl, nicht negativ, kein bool, kein Text -- und nicht
// absurd gross (nach dem Jahr 3000 ist ein Messfehler, kein Termin).
const ZEIT_MAX = 32_503_680_000;
function zeit(wert: unknown): number | null {
  if (typeof wert !== 'number' || !Number.isInteger(wert) || wert < 0 || wert > ZEIT_MAX) return null;
  return wert;
}

/** Liest balance.lebensnachweis. null, wenn das Objekt fehlt oder irgendein
 *  Feld nicht genau den erwarteten Typ hat -- dann zeigt die App nichts. */
export function lebensnachweisLesen(roh: unknown): LebensnachweisStand | null {
  if (!roh || typeof roh !== 'object' || Array.isArray(roh)) return null;
  const o = roh as Record<string, unknown>;
  if (typeof o.aktiv !== 'boolean' || typeof o.pausiert !== 'boolean') return null;
  const am = zeit(o.am);
  const faellig_ab = zeit(o.faellig_ab);
  const frist = zeit(o.frist);
  const pause_ab = zeit(o.pause_ab);
  if (am === null || faellig_ab === null || frist === null || pause_ab === null) return null;
  // Ein aktiver Stand muss in sich stimmen: faellig vor Frist vor Pause. Sonst
  // ist es kein Termin, den man einem Menschen nennen kann.
  if (o.aktiv && !(faellig_ab > 0 && faellig_ab <= frist && frist <= pause_ab)) return null;
  return { aktiv: o.aktiv, am, faellig_ab, frist, pause_ab, pausiert: o.pausiert };
}

/** Wo der Mensch gerade steht. jetzt in Unix-Sekunden. */
export function lebensnachweisPhase(stand: LebensnachweisStand, jetzt: number): LebensnachweisPhase {
  if (!stand.aktiv) return 'inaktiv';
  // Was die Kette als pausiert meldet, ist pausiert -- auch wenn die Uhr des
  // Telefons noch vor pause_ab steht. Umgekehrt zeigt die App ab pause_ab
  // schon "pausiert", bevor der naechste Block es bestaetigt.
  if (stand.pausiert || jetzt >= stand.pause_ab) return 'pausiert';
  if (jetzt >= stand.frist) return 'nachfrist';
  if (jetzt >= stand.faellig_ab) return 'faellig';
  return 'noch_nicht';
}

/** Erinnerung auf der Startseite: nur, wenn jetzt etwas zu tun ist. */
export function lebensnachweisErinnern(phase: LebensnachweisPhase | null): boolean {
  return phase === 'faellig' || phase === 'nachfrist' || phase === 'pausiert';
}

/** Stand und Phase aus dem rohen Kontostand -- null heisst: nichts anzeigen
 *  (kein Mensch, aelterer Knoten, kaputtes Objekt). */
export function lebensnachweisAusKontostand(
  balance: { is_human?: unknown; lebensnachweis?: unknown } | null | undefined,
  jetzt: number,
): { stand: LebensnachweisStand; phase: LebensnachweisPhase } | null {
  if (!balance || balance.is_human !== true) return null;
  const stand = lebensnachweisLesen(balance.lebensnachweis);
  if (!stand) return null;
  return { stand, phase: lebensnachweisPhase(stand, jetzt) };
}

// ---------------------------------------------------------------------------
// Antwort des Coordinators (/lebensnachweis) -> Text fuer den Menschen.
// Jeder Status hat eine eigene, klare Meldung; nur Unbekanntes faellt auf die
// allgemeine zurueck. Die Schluessel stehen in lib/i18n (Abschnitt identity).
// ---------------------------------------------------------------------------

export type LebensnachweisKette = 'angenommen' | 'schon_nachgewiesen' | 'abgelehnt' | 'nicht_erreichbar';

export interface LebensnachweisMeldung {
  key: keyof Translations['identity'];
  datum?: number | null;
}

export function lebensnachweisMeldung(
  r: { status?: string; faellig_ab?: number | null; kette?: LebensnachweisKette } | null | undefined,
): LebensnachweisMeldung {
  switch (r?.status) {
    case 'bescheinigt':
      switch (r.kette) {
        case 'angenommen':
        case 'schon_nachgewiesen': return { key: 'lnErgebnisBestaetigt' };
        case 'nicht_erreichbar': return { key: 'lnErgebnisKetteNichtErreichbar' };
        default: return { key: 'lnErgebnisKetteAbgelehnt' };
      }
    case 'zu_frueh': return { key: 'lnErgebnisZuFrueh', datum: r.faellig_ab ?? null };
    case 'nicht_aktiv': return { key: 'lnErgebnisNichtAktiv' };
    case 'kein_mensch': return { key: 'lnErgebnisKeinMensch' };
    case 'anderes_gesicht': return { key: 'lnErgebnisAnderesGesicht' };
    case 'unbekanntes_gesicht': return { key: 'lnErgebnisUnbekanntesGesicht' };
    case 'kein_quorum': return { key: 'lnErgebnisKeinQuorum' };
    case 'kette_nicht_erreichbar': return { key: 'lnErgebnisKetteNichtErreichbar' };
    case 'lebendigkeit_unsicher': return { key: 'lnErgebnisUnsicher' };
    case 'selbst_bescheinigung': return { key: 'lnErgebnisSelbst' };
    case 'vergleichsdienst_veraltet': return { key: 'lnErgebnisDienstVeraltet' };
    case 'signatur_ungueltig': return { key: 'lnErgebnisSignatur' };
    case 'nonce_ungueltig': return { key: 'lnErgebnisNonce' };
    case 'kein_schluessel': return { key: 'lnErgebnisKeinSchluessel' };
    case 'missing_consent':
    case 'consent_outdated': return { key: 'lnErgebnisEinwilligung' };
    case 'capture_failed': return { key: 'lnErgebnisAufnahme' };
    case 'liveness_failed': return { key: 'lnErgebnisLebendigkeit' };
    case 'risk_blocked': return { key: 'lnErgebnisRisiko' };
    case 'invalid_mode': return { key: 'lnErgebnisBetrieb' };
    default: return { key: 'lnErgebnisFehler' };
  }
}
