// Eineiige Zwillinge: Registrierung durch gemeinsame Aufnahme
// (coordinator/app/zwilling.py in aequitas-biometric-beta). Rein, ohne Netz
// und ohne Expo-Module -- getestet in lib/__tests__/zwilling.test.ts. Die
// Netzaufrufe stehen in lib/biometricIdentity.ts.
//
// DER ABLAUF
//
//   B (nicht registriert, sein Gesicht traf als duplicate_detected) legt eine
//   Anfrage an und zeigt sie als QR-Code. A (registriert) scannt, sieht B's
//   Wallet und eine Warnung und stimmt mit seiner Wallet zu. B fragt danach
//   (begrenzt) nach der Richtung der gegenlaeufigen Kopfdrehung, nimmt sich
//   selbst auf wie bei der Registrierung und danach beide zusammen.
//
// WARUM DER CODE-INHALT DEN COORDINATOR NENNT
//
// Die Anfrage liegt nur im Arbeitsspeicher DES Coordinators, der sie
// ausgestellt hat. A's App muss also genau dorthin zustimmen. Im QR-Code
// steht dafuer der Host dieses Coordinators -- aber A's App nimmt ihn nur,
// wenn er zu ihren EIGENEN Kandidaten gehoert (coordinatorCandidates()). Ein
// QR-Code kann die App so nie an eine beliebige Adresse schicken; ein fremder
// oder kaputter Inhalt wird abgelehnt.
//
//   aequitas-zwilling:<anfrage, 32 hex>:<wallet_b, 0x + 40 hex>:<host[:port]>

import type { Translations } from './i18n/types';

type IdentityKey = keyof Translations['identity'];

export const ZWILLING_ZUSTIMMUNG_DOMAIN = 'aequitas-zwilling-v1';
export const ZWILLING_REGISTER_DOMAIN = 'aequitas-zwilling-register-v1';
export const ZWILLING_QR_PRAEFIX = 'aequitas-zwilling';
/** Mehrlinge: hoechstens so viele Menschen in einer Gruppe (GRUPPE_MAX). */
export const ZWILLING_GRUPPE_MAX = 4;

const ANFRAGE = /^[0-9a-f]{32}$/;
const ADRESSE = /^0x[0-9a-f]{40}$/;
// Host ohne Schema, Pfad, Nutzer oder Abfrage; Kleinbuchstaben.
const HOST = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?(?::[0-9]{1,5})?$/;
const QR = /^aequitas-zwilling:([0-9a-f]{32}):(0x[0-9a-f]{40}):(.{1,260})$/;

export function istAnfrage(x: unknown): x is string {
  return typeof x === 'string' && ANFRAGE.test(x);
}

/** A stimmt zu: aequitas-zwilling-v1|<wallet_a>|<wallet_b>|<anfrage> */
export function zwillingZustimmungMessage(walletA: string, walletB: string, anfrage: string): string {
  return `${ZWILLING_ZUSTIMMUNG_DOMAIN}|${walletA.trim().toLowerCase()}|${walletB.trim().toLowerCase()}|${anfrage}`;
}

/** B registriert: aequitas-zwilling-register-v1|<wallet_b>|<anfrage>|<nonce> */
export function zwillingRegisterMessage(walletB: string, anfrage: string, nonce: string): string {
  return `${ZWILLING_REGISTER_DOMAIN}|${walletB.trim().toLowerCase()}|${anfrage}|${nonce}`;
}

/** Host[:Port] einer Basis-URL, klein -- ohne URL-Klasse (in React Native
 *  nur teilweise umgesetzt). null, wenn es keine http(s)-Adresse ist. */
export function hostVon(base: string): string | null {
  const m = /^https?:\/\/([^/?#@\s]+)(?:[/?#]|$)/i.exec(base.trim());
  if (!m) return null;
  const host = m[1].toLowerCase();
  return HOST.test(host) ? host : null;
}

/** Was B als QR-Code zeigt. Wirft, wenn etwas davon nicht kanonisch ist --
 *  ein solcher Code wuerde bei A ohnehin abgelehnt. */
export function zwillingQrInhalt(anfrage: string, walletB: string, base: string): string {
  const w = walletB.trim().toLowerCase();
  const host = hostVon(base);
  if (!istAnfrage(anfrage) || !ADRESSE.test(w) || !host) throw new Error('zwilling: QR-Inhalt nicht kanonisch');
  return `${ZWILLING_QR_PRAEFIX}:${anfrage}:${w}:${host}`;
}

export interface ZwillingQr {
  anfrage: string;
  walletB: string;
  /** Die Basis-URL aus den EIGENEN Kandidaten, deren Host im Code steht. */
  base: string;
}

/** Liest einen gescannten Inhalt. null bei allem, was nicht genau dieses
 *  Format hat, und bei einem Host, der nicht zu `kandidaten` gehoert. */
export function zwillingQrLesen(roh: unknown, kandidaten: readonly string[]): ZwillingQr | null {
  if (typeof roh !== 'string' || roh.length > 400) return null;
  const m = QR.exec(roh.trim());
  if (!m) return null;
  const [, anfrage, walletB, host] = m;
  if (!HOST.test(host)) return null;
  const base = kandidaten.find((k) => hostVon(k) === host);
  if (!base) return null;
  return { anfrage, walletB, base };
}

// ---------------------------------------------------------------------------
// Richtung der gegenlaeufigen Drehung
//
// Vertrag (zwilling.py): "links_rechts" heisst, das LINKE Gesicht im Bild
// dreht sich nach links, das rechte nach rechts -- beides in Bildrichtung.
//
// Gesagt wird das den beiden aber nicht mit links und rechts. Die Vorschau
// der Frontkamera ist gespiegelt, das hochgeladene Video oft nicht, und wer
// in die Kamera schaut, hat sein eigenes Links ohnehin auf der anderen Seite.
// "Das linke Gesicht dreht sich nach links" heisst in JEDER dieser Lagen
// dasselbe: beide drehen sich voneinander WEG, jeder zu seiner Aussenseite.
// "rechts_links" heisst: beide drehen sich ZUEINANDER. Eine Spiegelung
// vertauscht Ort und Richtung zugleich und laesst das unveraendert -- siehe
// drehungJePerson und den Test dazu.
// ---------------------------------------------------------------------------

export type ZwillingRichtung = 'links_rechts' | 'rechts_links';
export type Seite = 'links' | 'rechts';

export function zwillingRichtungLesen(x: unknown): ZwillingRichtung | null {
  return x === 'links_rechts' || x === 'rechts_links' ? x : null;
}

/** Was die beiden tun: auseinander (jeder nach aussen) oder zueinander. */
export function zwillingDrehung(richtung: ZwillingRichtung): 'auseinander' | 'zueinander' {
  return richtung === 'links_rechts' ? 'auseinander' : 'zueinander';
}

/** Der Text-Schluessel fuer die Anweisung (lib/i18n, Abschnitt identity). */
export function zwillingAnweisungKey(richtung: ZwillingRichtung): 'zwAnweisungAuseinander' | 'zwAnweisungZueinander' {
  return zwillingDrehung(richtung) === 'auseinander' ? 'zwAnweisungAuseinander' : 'zwAnweisungZueinander';
}

const andere = (s: Seite): Seite => (s === 'links' ? 'rechts' : 'links');

/** Fuer die Pruefung der Zuordnung: wohin sich die Person dreht, die -- aus
 *  Sicht der beiden selbst, in die Kamera blickend -- links bzw. rechts
 *  steht, und zwar in IHRER eigenen Links-Rechts-Richtung. `gespiegelt`: ob
 *  das Bild, in dem der Vertrag gilt, gespiegelt ist (wie die Vorschau) oder
 *  nicht (wie die Kamera es sieht). */
export function drehungJePerson(richtung: ZwillingRichtung, gespiegelt: boolean): Record<Seite, Seite> {
  // Bildseite -> Seite aus Sicht der Personen. Ungespiegelt sieht die Kamera
  // die Personen von vorn: ihr Bild-Links ist deren Rechts.
  const eigen = (bild: Seite): Seite => (gespiegelt ? bild : andere(bild));
  const drehtLinkesBildGesicht: Seite = richtung === 'links_rechts' ? 'links' : 'rechts';
  return {
    [eigen('links')]: eigen(drehtLinkesBildGesicht),
    [eigen('rechts')]: eigen(andere(drehtLinkesBildGesicht)),
  } as Record<Seite, Seite>;
}

// ---------------------------------------------------------------------------
// Warten auf die Zustimmung (/zwilling/start), begrenzt
// ---------------------------------------------------------------------------

export type StartAntwort =
  | { status: 'bereit'; richtung: ZwillingRichtung; gueltig_sekunden: number }
  | { status: 'nicht_zugestimmt' | 'anfrage_ungueltig' };

/** Liest die Antwort von /zwilling/start. Alles Unbekannte ist null. */
export function startAntwortLesen(roh: unknown): StartAntwort | null {
  if (!roh || typeof roh !== 'object') return null;
  const o = roh as Record<string, unknown>;
  if (o.status === 'nicht_zugestimmt' || o.status === 'anfrage_ungueltig') return { status: o.status };
  if (o.status === 'bereit') {
    const richtung = zwillingRichtungLesen(o.richtung);
    const s = o.gueltig_sekunden;
    if (!richtung || typeof s !== 'number' || !Number.isInteger(s) || s <= 0 || s > 3600) return null;
    return { status: 'bereit', richtung, gueltig_sekunden: s };
  }
  return null;
}

export type WartenErgebnis =
  | { ergebnis: 'bereit'; richtung: ZwillingRichtung; gueltig_sekunden: number }
  | { ergebnis: 'anfrage_ungueltig' | 'abgelaufen' | 'abgebrochen' };

/** Fragt hoechstens bis `bisMs` alle `intervallMs` nach, ob A zugestimmt
 *  hat. Endet bei "bereit", bei einer ungueltigen Anfrage, beim Abbruch
 *  (Bildschirm geschlossen) oder nach Ablauf -- nie unbegrenzt. Ein
 *  einzelner Netzfehler oder eine unlesbare Antwort zaehlt als "noch nicht". */
export async function wartenAufStart(
  start: () => Promise<StartAntwort | null>,
  opts: { intervallMs: number; bisMs: number; abgebrochen: () => boolean; schlafen?: (ms: number) => Promise<void> },
): Promise<WartenErgebnis> {
  const schlafen = opts.schlafen ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const versuche = Math.max(1, Math.ceil(opts.bisMs / Math.max(1000, opts.intervallMs)));
  for (let i = 0; i < versuche; i++) {
    if (opts.abgebrochen()) return { ergebnis: 'abgebrochen' };
    let a: StartAntwort | null = null;
    try {
      a = await start();
    } catch {
      a = null;
    }
    if (opts.abgebrochen()) return { ergebnis: 'abgebrochen' };
    if (a?.status === 'bereit') return { ergebnis: 'bereit', richtung: a.richtung, gueltig_sekunden: a.gueltig_sekunden };
    if (a?.status === 'anfrage_ungueltig') return { ergebnis: 'anfrage_ungueltig' };
    if (i < versuche - 1) await schlafen(opts.intervallMs);
  }
  return { ergebnis: 'abgelaufen' };
}

// ---------------------------------------------------------------------------
// Meldungen
// ---------------------------------------------------------------------------

export type ZustimmungStatus =
  | 'zugestimmt' | 'anfrage_ungueltig' | 'signatur_ungueltig' | 'kette_nicht_erreichbar'
  | 'nicht_registriert' | 'schon_registriert' | 'schon_zugestimmt';

/** Text-Schluessel fuer die Antwort auf A's Zustimmung. */
export function zustimmungMeldungKey(status: unknown): IdentityKey {
  switch (status) {
    case 'zugestimmt': return 'zwZustimmungOk';
    case 'anfrage_ungueltig': return 'zwZustimmungAnfrageUngueltig';
    case 'signatur_ungueltig': return 'zwZustimmungSignatur';
    case 'kette_nicht_erreichbar': return 'zwZustimmungKette';
    case 'nicht_registriert': return 'zwZustimmungNichtRegistriert';
    case 'schon_registriert': return 'zwZustimmungSchonRegistriert';
    case 'schon_zugestimmt': return 'zwZustimmungSchon';
    case 'eigene_wallet': return 'zwZustimmungEigeneWallet';
    default: return 'zwZustimmungFehler';
  }
}

/** Text-Schluessel fuer jede Entscheidung von /zwilling/register ausser dem
 *  Erfolg (new_enrollment geht weiter wie eine normale Registrierung). */
export function zwillingRegisterMeldungKey(decision: unknown): IdentityKey {
  switch (decision) {
    case 'kein_zwilling_noetig': return 'zwErgebnisKeinZwillingNoetig';
    case 'anderes_gesicht': return 'zwErgebnisAnderesGesicht';
    case 'gruppe_voll': return 'zwErgebnisGruppeVoll';
    case 'nicht_gestartet':
    case 'nicht_zugestimmt':
    case 'anfrage_ungueltig': return 'zwErgebnisNeuAnfangen';
    case 'schon_registriert': return 'zwErgebnisSchonRegistriert';
    case 'nicht_registriert': return 'zwErgebnisNichtRegistriert';
    case 'kette_nicht_erreichbar': return 'zwErgebnisKette';
    case 'commit_quorum_failed': return 'zwErgebnisCommit';
    case 'signatur_ungueltig': return 'zwErgebnisSignatur';
    case 'nonce_ungueltig': return 'zwErgebnisNonce';
    case 'kein_schluessel': return 'zwErgebnisKeinSchluessel';
    case 'risk_blocked': return 'zwErgebnisRisiko';
    case 'invalid_mode': return 'zwErgebnisBetrieb';
    case 'lebendigkeit_unsicher': return 'zwErgebnisUnsicher';
    // Dieselben Ausgaenge wie bei /register -- dieselben Texte.
    case 'age_proof_required': return 'biometricResultAgeProof';
    case 'age_below_minimum': return 'biometricResultAgeBelow';
    case 'age_declaration_missing':
    case 'age_declaration_invalid': return 'biometricResultAgeDeclaration';
    case 'capture_failed': return 'biometricResultCaptureFailed';
    case 'liveness_failed': return 'biometricResultLivenessFailed';
    case 'quorum_failed': return 'biometricResultQuorumFailed';
    case 'missing_consent':
    case 'consent_outdated': return 'biometricResultConsentOutdated';
    case 'tagesgrenze_einzelbetrieb': return 'biometricResultDailyLimit';
    default: return 'biometricResultFailed';
  }
}

// ---------------------------------------------------------------------------
// Gemeinsame Aufnahme: genau zwei Gesichter
// ---------------------------------------------------------------------------

export type ZweiGesichter = 'ok' | 'zu_wenige' | 'zu_viele';

/** Die Vorpruefung auf dem Geraet: genau zwei Gesichter im Bild. Die
 *  eigentliche Pruefung (getrennt, lebendig, gegenlaeufig) macht jeder
 *  Vergleichsdienst selbst. */
export function zweiGesichterStatus(anzahl: number): ZweiGesichter {
  if (!Number.isInteger(anzahl) || anzahl < 2) return 'zu_wenige';
  return anzahl === 2 ? 'ok' : 'zu_viele';
}
