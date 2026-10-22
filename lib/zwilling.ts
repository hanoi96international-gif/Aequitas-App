// Eineiige Zwillinge: Registrierung durch gemeinsame Aufnahme
// (coordinator/app/zwilling.py in aequitas-biometric-beta). Rein, ohne Netz
// und ohne Expo-Module -- getestet in lib/__tests__/zwilling.test.ts. Die
// Netzaufrufe stehen in lib/biometricIdentity.ts.
//
// DER ABLAUF
//
//   B (nicht registriert, sein Gesicht traf als duplicate_detected) legt eine
//   Anfrage an und zeigt sie als QR-Code. A (registriert) scannt, sieht B's
//   volle Wallet, eine Warnung und den Text seiner EIGENEN Einwilligung
//   (sein Gesicht ist in der gemeinsamen Aufnahme) und stimmt mit seiner
//   Wallet zu -- die Fassung steht in der Signatur. B fragt danach (begrenzt)
//   nach, ob zugestimmt ist (/zwilling/start: 20 Minuten fuer beide
//   Aufnahmen), nimmt sich selbst auf wie bei der Registrierung, holt erst
//   DANN die Challenge der gemeinsamen Aufnahme (/zwilling/challenge:
//   Richtung + Farbfolge, 5 Minuten bis zum Absenden) und nimmt beide auf.
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

/** A stimmt zu: aequitas-zwilling-v1|<wallet_a>|<wallet_b>|<anfrage>|<einwilligung>
 *  -- <einwilligung> ist die Fassung, der A auf dem Bestaetigungsbildschirm
 *  fuer die gemeinsame Aufnahme zugestimmt hat (Pruefung 21.10.2026,
 *  MEDIUM-2). */
export function zwillingZustimmungMessage(walletA: string, walletB: string, anfrage: string, einwilligung: string): string {
  return `${ZWILLING_ZUSTIMMUNG_DOMAIN}|${walletA.trim().toLowerCase()}|${walletB.trim().toLowerCase()}|${anfrage}|${einwilligung.trim()}`;
}

/** Die volle Adresse in Vierergruppen, zum Vergleichen auf zwei
 *  Bildschirmen: "0x8327 9fae 0994 ...". Leer bei keiner Adresse. */
export function walletGruppiert(wallet: string): string {
  const w = wallet.trim().toLowerCase();
  if (!ADRESSE.test(w)) return '';
  return '0x' + (w.slice(2).match(/.{4}/g) ?? []).join(' ');
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
// Wer im Bild steht, und die Aufgabe der gemeinsamen Aufnahme
//
// ALLE MITGLIEDER IM BILD (zwilling.py, Pruefung 22.10.2026): in der
// gemeinsamen Aufnahme stehen alle schon registrierten Mitglieder der Gruppe
// UND der Neue -- gesichter = Zahl der Registrierten + 1, 2 bis 4. Eine
// weitere Identitaet braucht so immer einen weiteren lebendigen Menschen im
// selben Bild.
//
// DIE AUFGABE IST EINE FOLGE (Nachpruefung 22.10.2026): JEDE Person dreht
// den Kopf einmal ALLEIN, in der vorgegebenen Reihenfolge -- je Schritt die
// Person an `position` (0 = ganz links im GESPEICHERTEN Bild), so dass ihre
// Nase zum Bildrand `richtung` wandert; alle anderen halten still. Ein
// Spiegelbild bewegt sich immer mit seinem Original: spaetestens in dessen
// Schritt bewegen sich zwei Gesichter. (Drehte nur EINE Person, hielte bei
// drei oder vier Gesichtern das Spiegelbild eines Stillhaltenden ebenfalls
// still.) Der Vergleichsdienst teilt die gemeinsame Aufnahme in n gleich
// lange, aufeinanderfolgende Abschnitte, einen je Schritt (zwillingAufnahmePlan).
// Er nimmt die Folge auch VOLLSTAENDIG gespiegelt an (jede Position n-1-k,
// jede Seite getauscht), weil nicht sicher ist, ob die Frontkamera
// gespiegelt speichert.
//
// Gezeigt wird die Aufgabe in der (gespiegelten) Vorschau, so wie die
// Menschen sich darin sehen -- wie in einem Spiegel: wer aus eigener Sicht
// ganz links steht, steht dort links, und wer den Kopf nach seinem eigenen
// links dreht, dessen Nase wandert dort nach links. Abgebildet wird unter der
// Annahme, dass die Kamera UNGESPIEGELT speichert (so wie sie die Menschen
// von vorn sieht); stimmt das auf einem Geraet nicht, ergibt dieselbe
// Bewegung genau die gespiegelte Lesart -- die der Dienst ebenfalls annimmt.
// Siehe folgeAkzeptiert und den Test dazu.
// ---------------------------------------------------------------------------

export const ZWILLING_GESICHTER_MIN = 2;
export type Seite = 'links' | 'rechts';

export function istGesichterZahl(x: unknown): x is number {
  return typeof x === 'number' && Number.isInteger(x) && x >= ZWILLING_GESICHTER_MIN && x <= ZWILLING_GRUPPE_MAX;
}

/** Aus "wie viele von euch sind schon registriert" (1..3) die Zahl der
 *  Gesichter im gemeinsamen Bild -- oder null. */
export function gesichterAusRegistrierten(registriert: unknown): number | null {
  if (typeof registriert !== 'number' || !Number.isInteger(registriert)) return null;
  const g = registriert + 1;
  return istGesichterZahl(g) ? g : null;
}

export function seiteLesen(x: unknown): Seite | null {
  return x === 'links' || x === 'rechts' ? x : null;
}

const andere = (s: Seite): Seite => (s === 'links' ? 'rechts' : 'links');

export interface ZwillingSchritt {
  /** 0 = ganz links im gespeicherten Bild. */
  position: number;
  /** Bildrand, zu dem die Nase wandert (gespeichertes Bild). */
  richtung: Seite;
}

export interface ZwillingAufgabe {
  gesichter: number;
  /** Genau `gesichter` Schritte, jede Position genau einmal, in dieser
   *  Reihenfolge. */
  folge: ZwillingSchritt[];
}

/** Ein Schritt so, wie er in der gespiegelten Vorschau zu zeigen ist:
 *  welches Oval (0 = links auf dem Bildschirm) und zu welcher Seite -- das
 *  ist zugleich die Seite aus eigener Sicht der Person. */
export function schrittInVorschau(gesichter: number, s: ZwillingSchritt): { oval: number; seite: Seite } {
  return { oval: gesichter - 1 - s.position, seite: andere(s.richtung) };
}

/** Die ganze Folge fuer die Vorschau, in derselben Reihenfolge. */
export function folgeInVorschau(a: ZwillingAufgabe): { oval: number; seite: Seite }[] {
  return a.folge.map((s) => schrittInVorschau(a.gesichter, s));
}

/** Was ein Vergleichsdienst annimmt: die Folge Schritt fuer Schritt -- oder
 *  die VOLLSTAENDIG gespiegelte (jeder Schritt gespiegelt, kein Mischen). */
export function folgeAkzeptiert(a: ZwillingAufgabe, gesehen: readonly ZwillingSchritt[]): boolean {
  if (gesehen.length !== a.folge.length) return false;
  const genau = a.folge.every((s, i) => gesehen[i].position === s.position && gesehen[i].richtung === s.richtung);
  const gespiegelt = a.folge.every(
    (s, i) => gesehen[i].position === a.gesichter - 1 - s.position && gesehen[i].richtung === andere(s.richtung),
  );
  return genau || gespiegelt;
}

/** Was eine Kamera speichert, wenn die Person an Stelle `eigeneStelle` (von
 *  ihrer eigenen linken Seite aus gezaehlt, 0-basiert) den Kopf nach ihrer
 *  eigenen Seite `eigeneSeite` dreht -- fuer die Pruefung der Abbildung.
 *  Ungespiegelt sieht die Kamera die Menschen von vorn: links und rechts
 *  sind vertauscht. */
export function gespeichertesBild(
  gesichter: number,
  eigeneStelle: number,
  eigeneSeite: Seite,
  gespiegelt: boolean,
): { position: number; richtung: Seite } {
  return gespiegelt
    ? { position: eigeneStelle, richtung: eigeneSeite }
    : { position: gesichter - 1 - eigeneStelle, richtung: andere(eigeneSeite) };
}

// ---------------------------------------------------------------------------
// Warten auf die Zustimmung (/zwilling/start), begrenzt
// ---------------------------------------------------------------------------

export type StartAntwort =
  | { status: 'bereit'; gueltig_sekunden: number }
  | { status: 'nicht_zugestimmt' | 'anfrage_ungueltig' };

const sekunden = (s: unknown): number | null =>
  typeof s === 'number' && Number.isInteger(s) && s > 0 && s <= 3600 ? s : null;

/** Liest die Antwort von /zwilling/start. Alles Unbekannte ist null. Eine
 *  Richtung darin wird NICHT uebernommen -- sie kommt nur aus
 *  /zwilling/challenge. */
export function startAntwortLesen(roh: unknown): StartAntwort | null {
  if (!roh || typeof roh !== 'object') return null;
  const o = roh as Record<string, unknown>;
  if (o.status === 'nicht_zugestimmt' || o.status === 'anfrage_ungueltig') return { status: o.status };
  if (o.status === 'bereit') {
    const s = sekunden(o.gueltig_sekunden);
    return s === null ? null : { status: 'bereit', gueltig_sekunden: s };
  }
  return null;
}

export type Farbe = 'red' | 'green' | 'blue';
/** Wie /challenge: vier Farben aus red/green/blue (zwilling.FARBEN,
 *  FARBFOLGE_LAENGE). */
export const ZWILLING_FARBFOLGE_LAENGE = 4;

export type ChallengeAntwort =
  | ({ status: 'bereit'; farbfolge: Farbe[]; gueltig_sekunden: number } & ZwillingAufgabe)
  | { status: 'nicht_gestartet' | 'nicht_zugestimmt' | 'anfrage_ungueltig' };

/** Liest eine Folge fail-closed: genau `gesichter` Schritte, jede Position
 *  0..n-1 genau einmal (ganze Zahlen), jede Seite links|rechts -- sonst null.
 *  Wie folge_text im Coordinator. */
export function folgeLesen(roh: unknown, gesichter: number): ZwillingSchritt[] | null {
  if (!istGesichterZahl(gesichter) || !Array.isArray(roh) || roh.length !== gesichter) return null;
  const folge: ZwillingSchritt[] = [];
  const gesehen = new Set<number>();
  for (const s of roh) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
    const { position, richtung } = s as Record<string, unknown>;
    const seite = seiteLesen(richtung);
    if (typeof position !== 'number' || !Number.isInteger(position) || position < 0 || position >= gesichter) return null;
    if (!seite || gesehen.has(position)) return null;
    gesehen.add(position);
    folge.push({ position, richtung: seite });
  }
  return folge;
}

/** Liest die Antwort von /zwilling/challenge -- fail-closed: eine Zahl der
 *  Gesichter ausserhalb 2..4, eine kaputte Folge, eine Farbfolge mit
 *  unbekannter Farbe oder falscher Laenge, eine unplausible Frist ergeben
 *  null. */
export function challengeAntwortLesen(roh: unknown): ChallengeAntwort | null {
  if (!roh || typeof roh !== 'object') return null;
  const o = roh as Record<string, unknown>;
  if (o.status === 'nicht_gestartet' || o.status === 'nicht_zugestimmt' || o.status === 'anfrage_ungueltig') {
    return { status: o.status };
  }
  if (o.status !== 'bereit') return null;
  const s = sekunden(o.gueltig_sekunden);
  const g = o.gesichter;
  if (s === null || !istGesichterZahl(g)) return null;
  const folge = folgeLesen(o.folge, g);
  if (!folge) return null;
  if (typeof o.flash_sequence !== 'string') return null;
  const farben = o.flash_sequence.split(',');
  if (farben.length !== ZWILLING_FARBFOLGE_LAENGE || !farben.every((f) => f === 'red' || f === 'green' || f === 'blue')) {
    return null;
  }
  return { status: 'bereit', gesichter: g, folge, farbfolge: farben as Farbe[], gueltig_sekunden: s };
}

// ---------------------------------------------------------------------------
// Zeitplan der gemeinsamen Aufnahme
//
// Der Vergleichsdienst teilt die Aufnahme in n gleich lange,
// aufeinanderfolgende Abschnitte -- einen je Schritt, in der Reihenfolge der
// Folge. Etwa 2 s je Schritt plus 1 s Vorlauf (verteilt auf alle
// Abschnitte): genug, um zu hoeren, wer dran ist, sich zu drehen und die
// Drehung zu halten -- und danach bleibt die Person gedreht, bis die Aufnahme
// endet (siehe ovalZustaende).
// ---------------------------------------------------------------------------

export const ZWILLING_SCHRITT_MS = 2000;
export const ZWILLING_VORLAUF_MS = 1000;

export interface AufnahmePlan {
  dauerMs: number;
  /** Je Schritt der Folge sein Abschnitt in der Aufnahme. */
  abschnitte: { schritt: number; beginnMs: number; endeMs: number }[];
}

export function zwillingAufnahmePlan(gesichter: number): AufnahmePlan {
  const n = istGesichterZahl(gesichter) ? gesichter : ZWILLING_GESICHTER_MIN;
  const dauerMs = n * ZWILLING_SCHRITT_MS + ZWILLING_VORLAUF_MS;
  const abschnitte = Array.from({ length: n }, (_, i) => ({
    schritt: i,
    beginnMs: Math.round((i * dauerMs) / n),
    endeMs: Math.round(((i + 1) * dauerMs) / n),
  }));
  return { dauerMs, abschnitte };
}

export interface PlanEreignis {
  atMs: number;
  schritt: number;
  /** Ganze Sekunden bis zum Ende dieses Abschnitts (Countdown). */
  rest: number;
  /** Erstes Ereignis des Abschnitts: ansagen und das Oval hervorheben. */
  ansage: boolean;
}

/** Was die App waehrend der Aufnahme wann zeigt und sagt: zu Beginn jedes
 *  Abschnitts die Ansage, dann jede Sekunde den Countdown bis zum Ende des
 *  Abschnitts -- an den Grenzen ausgerichtet, die der Dienst schneidet. */
export function zwillingPlanEreignisse(plan: AufnahmePlan): PlanEreignis[] {
  const ereignisse: PlanEreignis[] = [];
  for (const a of plan.abschnitte) {
    for (let t = a.beginnMs; t < a.endeMs; t += 1000) {
      ereignisse.push({ atMs: t, schritt: a.schritt, rest: Math.ceil((a.endeMs - t) / 1000), ansage: t === a.beginnMs });
    }
  }
  return ereignisse;
}

export type WartenErgebnis =
  | { ergebnis: 'bereit'; gueltig_sekunden: number }
  | { ergebnis: 'anfrage_ungueltig' | 'abgelaufen' | 'abgebrochen' };

/** Fragt hoechstens bis `bisMs` alle `intervallMs` nach, ob A zugestimmt
 *  hat. Doppelt begrenzt: nach Zahl der Versuche UND nach der Uhr (Frist =
 *  jetzt + bisMs) -- haengt eine Antwort, zaehlt die Wartezeit mit. Endet bei
 *  "bereit", bei einer ungueltigen Anfrage, beim Abbruch (Bildschirm
 *  geschlossen) oder nach Ablauf -- nie unbegrenzt. Ein einzelner Netzfehler
 *  oder eine unlesbare Antwort zaehlt als "noch nicht". */
export async function wartenAufStart(
  start: () => Promise<StartAntwort | null>,
  opts: {
    intervallMs: number;
    bisMs: number;
    abgebrochen: () => boolean;
    schlafen?: (ms: number) => Promise<void>;
    jetzt?: () => number;
  },
): Promise<WartenErgebnis> {
  const schlafen = opts.schlafen ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const jetzt = opts.jetzt ?? Date.now;
  const frist = jetzt() + opts.bisMs;
  const versuche = Math.max(1, Math.ceil(opts.bisMs / Math.max(1000, opts.intervallMs)));
  for (let i = 0; i < versuche; i++) {
    if (opts.abgebrochen()) return { ergebnis: 'abgebrochen' };
    if (jetzt() >= frist) return { ergebnis: 'abgelaufen' };
    let a: StartAntwort | null = null;
    try {
      a = await start();
    } catch {
      a = null;
    }
    if (opts.abgebrochen()) return { ergebnis: 'abgebrochen' };
    if (a?.status === 'bereit') return { ergebnis: 'bereit', gueltig_sekunden: a.gueltig_sekunden };
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
  | 'nicht_registriert' | 'schon_registriert' | 'schon_zugestimmt' | 'consent_outdated';

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
    case 'consent_outdated': return 'zwZustimmungEinwilligung';
    case 'einwilligung_fehlt': return 'zwAConsentPflicht';
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
    case 'gruppe_unvollstaendig': return 'zwErgebnisGruppeUnvollstaendig';
    case 'aufnahme_abgelaufen': return 'zwErgebnisAufnahmeAbgelaufen';
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

export type GruppenBild = 'ok' | 'zu_wenige' | 'zu_viele' | 'ueberlappen';

export interface Rahmen { x: number; y: number; width: number; height: number }

/** Die Vorpruefung auf dem Geraet: genau `soll` Gesichter, nebeneinander und
 *  ohne Ueberlappung. Die eigentliche Pruefung (getrennt, lebendig, Aufgabe)
 *  macht jeder Vergleichsdienst selbst. */
export function gruppenBildStatus(rahmen: readonly Rahmen[], soll: number): GruppenBild {
  if (!istGesichterZahl(soll) || rahmen.length < soll) return 'zu_wenige';
  if (rahmen.length > soll) return 'zu_viele';
  const sortiert = [...rahmen].sort((a, b) => a.x - b.x);
  for (let i = 1; i < sortiert.length; i++) {
    const links = sortiert[i - 1];
    if (!(links.x + links.width <= sortiert[i].x)) return 'ueberlappen';
  }
  return 'ok';
}

export interface AblaufEreignis extends PlanEreignis {
  /** Oval in der Vorschau (0 = links auf dem Bildschirm) und die Seite aus
   *  Sicht der Person -- fuer Anzeige und Ansage. */
  oval: number;
  seite: Seite;
}

/** Der ganze Ablauf der gemeinsamen Aufnahme: Dauer und, an den Grenzen der
 *  Abschnitte ausgerichtet, wer wann dran ist (in der Reihenfolge der Folge)
 *  und der Countdown. Anzeige und Ansage lesen nur hieraus. */
export function zwillingAblauf(a: ZwillingAufgabe): { dauerMs: number; ereignisse: AblaufEreignis[] } {
  const plan = zwillingAufnahmePlan(a.gesichter);
  const vorschau = folgeInVorschau(a);
  return {
    dauerMs: plan.dauerMs,
    ereignisse: zwillingPlanEreignisse(plan).map((e) => ({ ...e, ...vorschau[e.schritt] })),
  };
}

// ---------------------------------------------------------------------------
// Was jedes Oval waehrend der Folge zeigt
//
// Nach dem eigenen Schritt bleibt eine Person GEDREHT stehen, bis die
// Aufnahme endet (Vergleichsdienst 7d95e93): der Dienst nimmt die Ruhelage
// jedes Gesichts am Beginn jedes Abschnitts -- wer zur Mitte zurueckkehrt,
// bewegt sich im Abschnitt des Naechsten und wird als nicht_still
// abgewiesen. Darum gibt es nur diese drei Zustaende, und ein Oval geht nie
// von "gedreht" zurueck zu "wartet".
// ---------------------------------------------------------------------------

export type OvalZustand =
  | { zustand: 'dran'; seite: Seite } // dreht jetzt (Pfeil)
  | { zustand: 'gedreht'; seite: Seite } // war dran: gedreht halten
  | { zustand: 'wartet'; seite: null }; // noch nicht dran: geradeaus, still

/** Je Oval der Vorschau (0 = links) sein Zustand, wenn Schritt `aktiv` der
 *  Folge laeuft (null: noch keiner). */
export function ovalZustaende(a: ZwillingAufgabe, aktiv: number | null): OvalZustand[] {
  const out: OvalZustand[] = Array.from({ length: a.gesichter }, () => ({ zustand: 'wartet', seite: null }));
  if (aktiv === null) return out;
  folgeInVorschau(a).forEach((v, i) => {
    if (i < aktiv) out[v.oval] = { zustand: 'gedreht', seite: v.seite };
    else if (i === aktiv) out[v.oval] = { zustand: 'dran', seite: v.seite };
  });
  return out;
}

/** Der Text unter einem Oval (lib/i18n, identity) -- 'dran' zeigt den Pfeil. */
export const OVAL_TEXT = { gedreht: 'zwGedrehtHalten', wartet: 'zwAlleStill' } as const;
