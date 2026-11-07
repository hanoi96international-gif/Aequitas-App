// Pruefer-Register: bewerben, abstimmen, austreten -- aus der App.
//
// Die Kette (aequitas, verifier_register.go) nimmt einen Pruefer auf, wenn
// zwei Drittel der Pruefer zustimmen. Jede Stimme unterschreibt der
// Coordinator des Pruefers mit seinem Ed25519-Schluessel -- aber nur im
// Auftrag der Wallet seines Betreibers (aequitas-biometric-beta,
// pruefer_stimme.py). Der Knoten sammelt die Stimmen und reicht selbst ein,
// sobald es genug sind (verifier_sammeln.go).
//
// Ablauf einer Stimme:
//   1. Schluessel des eigenen Coordinators holen (/besitznachweis, nur fuer
//      diese Wallet).
//   2. Die Wallet unterschreibt den Auftrag
//        "Aequitas: verifier vote <art> <betroffener> chain:1926 ts:<zeit>"
//      und die Freigabe des Schluessels (coordinatorBindung.ts).
//   3. Der Coordinator stellt die Stimme aus (/pruefer/stimme).
//   4. Die App prueft, dass die Stimme zu Wallet, Schluessel und Zeit passt,
//      und reicht sie beim Knoten ein (/api/verifier/stimme).
//
// Saetze werden hier gebaut, nie vom Netz uebernommen. Antworten des Netzes
// werden nur in Form gebracht und angezeigt; gezaehlt wird in der Kette.
import { ethers } from 'ethers';
import { API_BASE } from './config';
import { coordinatorAdresse, coordinatorFreigabeNachricht, holeBesitznachweis, COORDINATOR_BINDUNG_CHAIN_ID } from './coordinatorBindung';
import type { AequitasSigner } from './signer';

export type PrueferArt = 'aufnahme' | 'austritt' | 'entzug';
const ARTEN: readonly PrueferArt[] = ['aufnahme', 'austritt', 'entzug'];
const ADRESSE = /^0x[0-9a-f]{40}$/;
const SCHLUESSEL = /^[0-9a-f]{64}$/;
const ED25519_SIG = /^[0-9a-f]{128}$/;
const EIP191_SIG = /^0x[0-9a-f]{130}$/;
/** Hoechstens so viele Eintraege je Liste werden gelesen (der Knoten hat 64). */
const LISTE_MAX = 64;
const STIMMEN_MAX = 256;

export function auftragNachricht(art: PrueferArt, betroffener: string, zeit: number): string {
  return `Aequitas: verifier vote ${art} ${betroffener.toLowerCase()} chain:${COORDINATOR_BINDUNG_CHAIN_ID} ts:${zeit}`;
}

export function antragNachricht(wallet: string, zeit: number): string {
  return `Aequitas: apply as verifier ${wallet.toLowerCase()} chain:${COORDINATOR_BINDUNG_CHAIN_ID} ts:${zeit}`;
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

export interface Abstimmung {
  art: PrueferArt;
  wallet: string;
  stimmen: { mensch: string; zeit: number }[];
  noetig: number;
}

export interface RegisterStand {
  aktiv: boolean;
  pruefer: string[];
  antraege: { wallet: string; zeit: number }[];
  abstimmungen: Abstimmung[];
}

/** Stand des Registers beim Knoten, streng in Form gebracht. null bei Fehler. */
export async function holeRegisterStand(fetchFn: typeof fetch = fetch): Promise<RegisterStand | null> {
  try {
    const r = await fetchFn(`${API_BASE}/verifier/antraege`);
    if (!r.ok) return null;
    const j: any = await r.json();
    const adr = (x: unknown) => (typeof x === 'string' && ADRESSE.test(x) ? x : null);
    const zahl = (x: unknown) => (typeof x === 'number' && Number.isSafeInteger(x) ? x : 0);
    const pruefer = (Array.isArray(j?.pruefer) ? j.pruefer : []).slice(0, 256).map(adr).filter(Boolean) as string[];
    const antraege = (Array.isArray(j?.antraege) ? j.antraege : []).slice(0, LISTE_MAX)
      .map((a: any) => ({ wallet: adr(a?.wallet), zeit: zahl(a?.zeit) }))
      .filter((a: any) => a.wallet) as { wallet: string; zeit: number }[];
    const abstimmungen = (Array.isArray(j?.abstimmungen) ? j.abstimmungen : []).slice(0, LISTE_MAX)
      .map((a: any) => ({
        art: ARTEN.includes(a?.art) ? a.art : null,
        wallet: adr(a?.wallet),
        stimmen: (Array.isArray(a?.stimmen) ? a.stimmen : []).slice(0, STIMMEN_MAX)
          .map((s: any) => ({ mensch: adr(s?.mensch), zeit: zahl(s?.zeit) }))
          .filter((s: any) => s.mensch),
        noetig: zahl(a?.noetig),
      }))
      .filter((a: any) => a.art && a.wallet) as Abstimmung[];
    return { aktiv: j?.aktiv === true, pruefer, antraege, abstimmungen };
  } catch {
    return null;
  }
}

export type PrueferFehler =
  | 'unterschrift_ungueltig'
  | 'coordinator'
  | 'stimme_ungueltig'
  | 'abgelehnt'
  | 'eingabe';

export interface StimmErgebnis {
  ok: boolean;
  fehler?: PrueferFehler;
  meldung?: string;
  eingereicht?: boolean;
  stimmen?: number;
  noetig?: number;
}

/**
 * Eine Stimme abgeben. coordinatorUrl ist der EIGENE Coordinator: nur er
 * stellt fuer diese Wallet aus. Die Stimme wird vor dem Einreichen geprueft:
 * Mensch = diese Wallet, Schluessel = der eben geholte, Zeit = die des
 * Auftrags, Formate streng.
 */
export async function abstimmen(
  signer: AequitasSigner,
  coordinatorUrl: string,
  art: PrueferArt,
  betroffenerRoh: string,
  fetchFn: typeof fetch = fetch,
  jetztS: () => number = () => Math.floor(Date.now() / 1000),
): Promise<StimmErgebnis> {
  const wallet = signer.address.toLowerCase();
  const betroffener = String(betroffenerRoh ?? '').trim().toLowerCase();
  const url = coordinatorAdresse(coordinatorUrl);
  if (!ARTEN.includes(art) || !ADRESSE.test(betroffener) || !url) return { ok: false, fehler: 'eingabe' };
  if (art === 'austritt' ? betroffener !== wallet : betroffener === wallet) return { ok: false, fehler: 'eingabe' };

  const n = await holeBesitznachweis(url, wallet, fetchFn);
  if (!n.ok) return { ok: false, fehler: 'coordinator', meldung: n.meldung ?? n.fehler };
  const pub = n.nachweis.schluessel;

  const zeit = jetztS();
  const auftrag = await eigeneUnterschrift(signer, auftragNachricht(art, betroffener, zeit));
  if (!auftrag) return { ok: false, fehler: 'unterschrift_ungueltig' };
  const freigabe = await eigeneUnterschrift(signer, coordinatorFreigabeNachricht(pub));
  if (!freigabe) return { ok: false, fehler: 'unterschrift_ungueltig' };

  let stimme: any;
  try {
    const r = await fetchFn(`${url}/pruefer/stimme`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ art, betroffener, zeit, auftrag, freigabe }),
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
    bescheinigung: {
      public_key: pub,
      signature: b.signature,
      mensch: wallet,
      mensch_sig: freigabe,
      schluessel_sig: b.schluessel_sig,
    },
  };
  try {
    const r = await fetchFn(`${API_BASE}/verifier/stimme`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ art, wallet: betroffener, stimme: sauber }),
    });
    if (!r.ok) return { ok: false, fehler: 'abgelehnt', meldung: await fehlerText(r) };
    const j: any = await r.json();
    return {
      ok: true,
      eingereicht: j?.eingereicht === true,
      stimmen: typeof j?.stimmen === 'number' ? j.stimmen : undefined,
      noetig: typeof j?.noetig === 'number' ? j.noetig : undefined,
    };
  } catch (e: any) {
    return { ok: false, fehler: 'abgelehnt', meldung: String(e?.message ?? e).slice(0, 200) };
  }
}

/** Als Pruefer bewerben (nur Anzeige fuer die Pruefer; aufgenommen wird per Abstimmung). */
export async function bewerben(
  signer: AequitasSigner,
  fetchFn: typeof fetch = fetch,
  jetztS: () => number = () => Math.floor(Date.now() / 1000),
): Promise<StimmErgebnis> {
  const wallet = signer.address.toLowerCase();
  const zeit = jetztS();
  const signatur = await eigeneUnterschrift(signer, antragNachricht(wallet, zeit));
  if (!signatur) return { ok: false, fehler: 'unterschrift_ungueltig' };
  try {
    const r = await fetchFn(`${API_BASE}/verifier/antrag`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet, zeit, signatur }),
    });
    if (!r.ok) return { ok: false, fehler: 'abgelehnt', meldung: await fehlerText(r) };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, fehler: 'abgelehnt', meldung: String(e?.message ?? e).slice(0, 200) };
  }
}
