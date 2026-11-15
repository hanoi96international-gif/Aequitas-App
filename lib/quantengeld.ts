// Dezentrales Quantengeld: Stand ansehen und -- als Pruefer -- ueber die
// Freischaltung eines Parametersatzes abstimmen.
//
// Die Kette (aequitas, quanten_geld.go, quanten_sammeln.go) schaltet einen
// Satz frei, wenn zwei Drittel der Pruefer zustimmen. Jede Stimme
// unterschreibt der Coordinator des Pruefers mit seinem Ed25519-Schluessel,
// nur im Auftrag der Wallet seines Betreibers (aequitas-biometric-beta,
// pruefer_stimme.quanten_stimme_ausstellen). Dazu der quantensichere Teil aus
// dem Tresor (ML-DSA-65), wie bei jeder Pruefer-Stimme. Der Knoten sammelt und
// reicht selbst ein; jeder Knoten prueft die Freischaltung beim Nachspielen.
//
// Die Stimme bezeugt zweierlei, das keine Kette messen kann: es gibt Hardware,
// die Noten dieses Satzes laenger haelt als eine Zahlung dauert, und das
// externe Gutachten (docs/QUANTENGELD_PRUEFAUFTRAG.md) liegt ohne offene
// kritische Punkte vor.
//
// Saetze werden hier gebaut, nie vom Netz uebernommen; Antworten des Netzes
// werden streng in Form gebracht.
import { ethers } from 'ethers';
import { API_BASE } from './config';
import { coordinatorAdresse, coordinatorFreigabeNachricht, holeBesitznachweis, COORDINATOR_BINDUNG_CHAIN_ID } from './coordinatorBindung';
import type { AequitasSigner } from './signer';
import { prueferPQTeil, type PrueferPQTeil } from './tresor';

const ADRESSE = /^0x[0-9a-f]{40}$/;
const SCHLUESSEL = /^[0-9a-f]{64}$/;
const ED25519_SIG = /^[0-9a-f]{128}$/;
const EIP191_SIG = /^0x[0-9a-f]{130}$/;
const SATZ = /^[a-z0-9-]{1,32}$/;
const ORDNUNG = /^[1-9][0-9]{0,2499}$/;
const ORDNUNG_MIN = BigInt(2) ** BigInt(256);
const ORDNUNG_MAX = BigInt(2) ** BigInt(8192);
/** Wie quantenFreischaltungVorlauf der Kette. */
export const QUANTEN_VORLAUF_S = 30 * 86400;
/** Hoechstens so viele offene Vorschlaege fuehrt der Knoten (quantenSammlungenHoechstens). */
const ABSTIMMUNGEN_MAX = 4;
const SAETZE_MAX = 64;
const ANTWORT_MAX = 16384;

export const QUANTEN_DOMAENE_FREISCHALTUNG = 'aequitas-quanten-freischaltung-v1';

// ------------------------------------------------------------------ Saetze

/** Der Satz der Kette (quantenFreischaltungNachricht), den der Coordinator unterschreibt. */
export function quantenStimmSatz(satz: string, ordnung: string, ab: number, zeit: number): string {
  return `${QUANTEN_DOMAENE_FREISCHALTUNG}|chain:${COORDINATOR_BINDUNG_CHAIN_ID}|${satz}|${ordnung}|${ab}|${zeit}`;
}

/** SHA-256 der Ordnung (Hex, ohne 0x) -- wie quanten_ordnung_kurz im Coordinator. */
export function ordnungKurz(ordnung: string): string {
  return ethers.sha256(ethers.toUtf8Bytes(ordnung)).slice(2);
}

/** Was die Wallet fuer eine Quantengeld-Stimme unterschreibt (quanten_auftrag_nachricht). */
export function quantenAuftragNachricht(satz: string, ordnung: string, ab: number, zeit: number): string {
  return `Aequitas: quantum money vote set ${satz} order-sha256 ${ordnungKurz(ordnung)} ab ${ab} chain:${COORDINATOR_BINDUNG_CHAIN_ID} ts:${zeit}`;
}

/** Form eines Vorschlags wie die Kette: Satzname, N >= 2^256, ab mit Vorlauf. */
export function vorschlagGueltig(satz: string, ordnung: string, ab: number, jetztS: number): boolean {
  if (!SATZ.test(satz) || satz.startsWith('labor') || satz.startsWith('test')) return false;
  if (!ORDNUNG.test(ordnung)) return false;
  const n = BigInt(ordnung);
  if (n < ORDNUNG_MIN || n > ORDNUNG_MAX) return false;
  return Number.isSafeInteger(ab) && ab >= jetztS + QUANTEN_VORLAUF_S;
}

/** Bitlaenge einer dezimalen Ordnung (zur Anzeige). */
export function ordnungBits(ordnung: string): number {
  return ORDNUNG.test(ordnung) ? BigInt(ordnung).toString(2).length : 0;
}

// ------------------------------------------------------------------- Stand

export interface QuantenSatz {
  name: string;
  ordnungBits: number;
  ab: number;
  beschlossen: number;
}

export interface QuantenStand {
  aktiv: boolean;
  topf: string;
  saetze: QuantenSatz[];
  noten: number;
  gedecktAeq: number;
  mindestDeckung: number;
}

export interface QuantenAbstimmung {
  satz: string;
  ordnung: string;
  ab: number;
  stimmen: number;
  noetig: number;
}

function ganz(x: unknown): number | null {
  return typeof x === 'number' && Number.isSafeInteger(x) && x >= 0 ? x : null;
}

function betrag(x: unknown): number | null {
  return typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : null;
}

async function jsonHolen(url: string, fetchFn: typeof fetch): Promise<any | null> {
  try {
    const r = await fetchFn(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) return null;
    const text = (await r.text()).slice(0, ANTWORT_MAX + 1);
    if (text.length > ANTWORT_MAX) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function leseQuantenStand(j: any): QuantenStand | null {
  if (!j || typeof j.aktiv !== 'boolean' || typeof j.topf !== 'string' || !ADRESSE.test(j.topf)) return null;
  const noten = ganz(j.noten);
  const gedeckt = betrag(j.gedeckt_aeq);
  const mindest = betrag(j.mindest_deckung);
  if (noten === null || gedeckt === null || mindest === null || !Array.isArray(j.saetze) || j.saetze.length > SAETZE_MAX) return null;
  const saetze: QuantenSatz[] = [];
  for (const s of j.saetze) {
    const bits = ganz(s?.ordnung_bits);
    const ab = ganz(s?.ab);
    const seit = ganz(s?.beschlossen);
    if (typeof s?.name !== 'string' || !SATZ.test(s.name) || bits === null || ab === null || seit === null) return null;
    saetze.push({ name: s.name, ordnungBits: bits, ab, beschlossen: seit });
  }
  return { aktiv: j.aktiv, topf: j.topf, saetze, noten, gedecktAeq: gedeckt, mindestDeckung: mindest };
}

export function leseQuantenAbstimmungen(j: any): QuantenAbstimmung[] | null {
  if (!j || !Array.isArray(j.abstimmungen) || j.abstimmungen.length > ABSTIMMUNGEN_MAX) return null;
  const out: QuantenAbstimmung[] = [];
  for (const a of j.abstimmungen) {
    const ab = ganz(a?.ab);
    const stimmen = ganz(a?.stimmen);
    const noetig = ganz(a?.noetig);
    if (typeof a?.satz !== 'string' || !SATZ.test(a.satz) || typeof a?.ordnung !== 'string' || !ORDNUNG.test(a.ordnung)) return null;
    if (ab === null || stimmen === null || noetig === null) return null;
    out.push({ satz: a.satz, ordnung: a.ordnung, ab, stimmen, noetig });
  }
  return out;
}

export async function holeQuantenStand(fetchFn: typeof fetch = fetch): Promise<QuantenStand | null> {
  return leseQuantenStand(await jsonHolen(`${API_BASE}/quanten/stand`, fetchFn));
}

export async function holeQuantenAbstimmungen(fetchFn: typeof fetch = fetch): Promise<QuantenAbstimmung[] | null> {
  return leseQuantenAbstimmungen(await jsonHolen(`${API_BASE}/quanten/abstimmungen`, fetchFn));
}

// --------------------------------------------------------------- Abstimmen

export type QuantenStimmFehler = 'eingabe' | 'coordinator' | 'unterschrift_ungueltig' | 'stimme_ungueltig' | 'kein_pq' | 'abgelehnt';

export interface QuantenStimmErgebnis {
  ok: boolean;
  fehler?: QuantenStimmFehler;
  meldung?: string;
  eingereicht?: boolean;
  stimmen?: number;
  noetig?: number;
}

function kanonisch(sig: string): string {
  return ethers.Signature.from(sig).serialized.toLowerCase();
}

async function eigeneUnterschrift(signer: AequitasSigner, text: string): Promise<string | null> {
  const roh = await signer.signMessage(text);
  try {
    const sig = kanonisch(roh);
    return ethers.verifyMessage(text, sig).toLowerCase() === signer.address.toLowerCase() ? sig : null;
  } catch {
    return null;
  }
}

async function fehlerText(r: Response): Promise<string> {
  try {
    const j = await r.json();
    const t = typeof j?.error === 'string' ? j.error : typeof j?.detail === 'string' ? j.detail : '';
    if (t) return t.slice(0, 200);
  } catch {
    /* Statuscode reicht */
  }
  return `HTTP ${r.status}`;
}

/**
 * Fuer einen Vorschlag (Satz, Ordnung, ab) stimmen. coordinatorUrl ist der
 * EIGENE Coordinator. Ohne quantensicheren Teil aus dem Tresor wird nicht
 * eingereicht: seit dem Stichtag (Audit B2) verlangt die Kette ihn ohnehin.
 */
export async function quantenAbstimmen(
  signer: AequitasSigner,
  coordinatorUrl: string,
  satz: string,
  ordnung: string,
  ab: number,
  fetchFn: typeof fetch = fetch,
  jetztS: () => number = () => Math.floor(Date.now() / 1000),
  pqTeil: (wallet: string, satz: string, fetchFn: typeof fetch) => Promise<PrueferPQTeil | null> = prueferPQTeil,
): Promise<QuantenStimmErgebnis> {
  const wallet = signer.address.toLowerCase();
  const url = coordinatorAdresse(coordinatorUrl);
  const zeit = jetztS();
  if (!url || !ADRESSE.test(wallet) || !vorschlagGueltig(satz, ordnung, ab, zeit)) return { ok: false, fehler: 'eingabe' };

  const n = await holeBesitznachweis(url, wallet, fetchFn);
  if (!n.ok) return { ok: false, fehler: 'coordinator', meldung: n.meldung ?? n.fehler };
  const pub = n.nachweis.schluessel;

  // Den PQ-Teil zuerst: fehlt der Tresor, braucht die Wallet gar nicht erst zu unterschreiben.
  const pq = await pqTeil(wallet, quantenStimmSatz(satz, ordnung, ab, zeit), fetchFn).catch(() => null);
  if (!pq) return { ok: false, fehler: 'kein_pq' };

  const auftrag = await eigeneUnterschrift(signer, quantenAuftragNachricht(satz, ordnung, ab, zeit));
  if (!auftrag) return { ok: false, fehler: 'unterschrift_ungueltig' };
  const freigabe = await eigeneUnterschrift(signer, coordinatorFreigabeNachricht(pub));
  if (!freigabe) return { ok: false, fehler: 'unterschrift_ungueltig' };

  let stimme: any;
  try {
    const r = await fetchFn(`${url}/pruefer/quanten-stimme`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ satz, ordnung, ab, zeit, auftrag, freigabe }),
    });
    if (!r.ok) return { ok: false, fehler: 'coordinator', meldung: await fehlerText(r) };
    const text = (await r.text()).slice(0, 4097);
    if (text.length > 4096) return { ok: false, fehler: 'stimme_ungueltig' };
    stimme = JSON.parse(text);
  } catch (e: any) {
    return { ok: false, fehler: 'coordinator', meldung: String(e?.message ?? e).slice(0, 200) };
  }
  const b = stimme?.bescheinigung;
  if (
    stimme?.zeit !== zeit ||
    !b ||
    b.public_key !== pub ||
    b.mensch !== wallet ||
    b.mensch_sig !== freigabe ||
    typeof b.signature !== 'string' || !ED25519_SIG.test(b.signature) ||
    typeof b.schluessel_sig !== 'string' || !ED25519_SIG.test(b.schluessel_sig) ||
    !SCHLUESSEL.test(b.public_key) || !EIP191_SIG.test(b.mensch_sig)
  ) {
    return { ok: false, fehler: 'stimme_ungueltig' };
  }
  const sauber = {
    zeit,
    bescheinigung: { public_key: pub, signature: b.signature, mensch: wallet, mensch_sig: freigabe, schluessel_sig: b.schluessel_sig },
    pq: { pub: pq.pub, sig: pq.sig },
  };
  try {
    const r = await fetchFn(`${API_BASE}/quanten/stimme`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ satz, ordnung, ab, stimme: sauber }),
    });
    if (!r.ok) return { ok: false, fehler: 'abgelehnt', meldung: await fehlerText(r) };
    const j: any = await r.json();
    return {
      ok: true,
      eingereicht: j?.eingereicht === true,
      stimmen: ganz(j?.stimmen) ?? undefined,
      noetig: ganz(j?.noetig) ?? undefined,
    };
  } catch (e: any) {
    return { ok: false, fehler: 'abgelehnt', meldung: String(e?.message ?? e).slice(0, 200) };
  }
}
