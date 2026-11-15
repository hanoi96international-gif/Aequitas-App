// PQ-Schluessel eines Pruefer-Dienstes in die Kette eintragen (Audit B2).
//
// Die Kette (aequitas-chain, pruefer_dienst_pq.go) verlangt ab pq_ab_unix zu
// jedem Schluessel, der eine Bescheinigung bindet oder bezeugt, eine
// ML-DSA-65-Unterschrift. Fuer die Dienste von Pruefern (Coordinator,
// Vergleichsdienst) traegt der Pruefer deren ML-DSA-Schluessel selbst ein:
//
//   1. Der Dienst gibt seinen Ed25519- und ML-DSA-Schluessel heraus, dazu den
//      Besitznachweis -- nur fuer die Wallet seines Betreibers
//      (/besitznachweis, aequitas-biometric-beta).
//   2. Die App prueft den Besitznachweis selbst und gibt den Schluessel mit
//      dem ML-DSA-Schluessel des Menschen frei (Tresor, aus der Seed-Phrase;
//      sein Hash ist die PQ-Zusage der Wallet).
//   3. Sie reicht beides bei /api/verifier/dienst-pq ein; jeder Knoten prueft
//      es selbst.
//
// Saetze byte-gleich mit der Kette; Antworten werden nur in Form gebracht.

import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { ethers } from 'ethers';
import { API_BASE } from './config';
import { coordinatorAdresse } from './coordinatorBindung';
import { pqStand } from './pq';
import { seedLaden, tresorSchluessel } from './tresor';

const KETTE = 1926;
const ADRESSE = /^0x[0-9a-f]{40}$/;
const ED = /^[0-9a-f]{64}$/;
const PUB = /^[0-9a-f]{3904}$/;
const SIG = /^[0-9a-f]{6618}$/;
const HASH = /^[0-9a-f]{64}$/;
/** Antwort des Dienstes: zwei Schluessel, zwei Unterschriften -- ~11 KB. */
const ANTWORT_MAX = 16384;

export function dienstBesitzNachricht(mensch: string, ed: string): string {
  return `aequitas-pruefer-dienst-besitz-v1|chain:${KETTE}|${mensch.trim().toLowerCase()}|${ed.trim().toLowerCase()}`;
}

export function dienstFreigabeNachricht(mensch: string, ed: string, pubHash: string, zeit: number): string {
  return `aequitas-pruefer-dienst-pq-v1|chain:${KETTE}|${mensch.trim().toLowerCase()}|${ed.trim().toLowerCase()}|${pubHash}|${zeit}`;
}

export type DienstPQFehler =
  | 'adresse'
  | 'nicht_erreichbar'
  | 'antwort_ungueltig'
  | 'kein_pq'
  | 'andere_wallet'
  | 'besitz_ungueltig'
  | 'kein_tresor'
  | 'keine_zusage'
  | 'andere_zusage'
  | 'abgelehnt';

export interface DienstPQErgebnis {
  ok: boolean;
  fehler?: DienstPQFehler;
  meldung?: string;
  /** Ab dann zaehlt der Schluessel (issued_at + Frist der Kette). */
  wirktAb?: number;
  ed?: string;
}

interface DienstNachweis {
  ed: string;
  pub: string;
  besitzSig: string;
}

async function holeDienstNachweis(
  url: string,
  wallet: string,
  fetchFn: typeof fetch,
): Promise<{ ok: true; n: DienstNachweis } | { ok: false; fehler: DienstPQFehler; meldung?: string }> {
  let antwort: Response;
  try {
    antwort = await fetchFn(`${url}/besitznachweis?wallet=${encodeURIComponent(wallet)}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
  } catch (e: any) {
    return { ok: false, fehler: 'nicht_erreichbar', meldung: String(e?.message ?? e).slice(0, 200) };
  }
  let j: any;
  try {
    const text = (await antwort.text()).slice(0, ANTWORT_MAX + 1);
    if (text.length > ANTWORT_MAX) return { ok: false, fehler: 'antwort_ungueltig' };
    j = JSON.parse(text);
  } catch {
    return { ok: false, fehler: antwort.ok ? 'antwort_ungueltig' : 'nicht_erreichbar' };
  }
  if (!antwort.ok) {
    return { ok: false, fehler: 'nicht_erreichbar', meldung: typeof j?.detail === 'string' ? j.detail.slice(0, 200) : `HTTP ${antwort.status}` };
  }
  const klein = (x: unknown) => (typeof x === 'string' ? x.trim().toLowerCase() : '');
  if (klein(j?.human_wallet) !== wallet) return { ok: false, fehler: 'andere_wallet' };
  const ed = klein(j?.public_key);
  if (!ED.test(ed)) return { ok: false, fehler: 'antwort_ungueltig' };
  if (j?.pq_public_key === undefined) return { ok: false, fehler: 'kein_pq' };
  const pub = klein(j?.pq_public_key);
  const besitzSig = klein(j?.pq_besitz_sig);
  if (!PUB.test(pub) || !SIG.test(besitzSig)) return { ok: false, fehler: 'antwort_ungueltig' };
  return { ok: true, n: { ed, pub, besitzSig } };
}

/**
 * Den ML-DSA-Schluessel des Dienstes unter dienstUrl fuer diese Wallet
 * eintragen. seed/zusageHash nur fuer Tests von aussen.
 */
export async function dienstPQEintragen(
  walletRoh: string,
  dienstUrl: string,
  fetchFn: typeof fetch = fetch,
  opts: { seed?: Uint8Array; zusageHash?: string; jetztS?: () => number } = {},
): Promise<DienstPQErgebnis> {
  const wallet = String(walletRoh ?? '').trim().toLowerCase();
  const url = coordinatorAdresse(dienstUrl);
  if (!url || !ADRESSE.test(wallet)) return { ok: false, fehler: 'adresse' };

  const h = await holeDienstNachweis(url, wallet, fetchFn);
  if (!h.ok) return { ok: false, fehler: h.fehler, meldung: h.meldung };
  const { ed, pub, besitzSig } = h.n;
  // Den Besitznachweis selbst pruefen, bevor der Mensch etwas freigibt.
  let besitzOk = false;
  try {
    besitzOk = ml_dsa65.verify(ethers.getBytes('0x' + besitzSig), ethers.toUtf8Bytes(dienstBesitzNachricht(wallet, ed)), ethers.getBytes('0x' + pub));
  } catch {
    besitzOk = false;
  }
  if (!besitzOk) return { ok: false, fehler: 'besitz_ungueltig' };

  const zusage = opts.zusageHash ?? (await pqStand(wallet, fetchFn))?.hash ?? '';
  if (!HASH.test(zusage)) return { ok: false, fehler: 'keine_zusage' };
  const seed = opts.seed ?? (await seedLaden().catch(() => null));
  if (!seed) return { ok: false, fehler: 'kein_tresor' };
  const { publicKey, secretKey } = tresorSchluessel(seed);
  if (ethers.sha256(publicKey).slice(2) !== zusage) return { ok: false, fehler: 'andere_zusage' };

  const zeit = (opts.jetztS ?? (() => Math.floor(Date.now() / 1000)))();
  const pubHash = ethers.sha256('0x' + pub).slice(2);
  const text = ethers.toUtf8Bytes(dienstFreigabeNachricht(wallet, ed, pubHash, zeit));
  const menschSig = ml_dsa65.sign(text, secretKey, { extraEntropy: false });
  if (!ml_dsa65.verify(menschSig, text, publicKey)) return { ok: false, fehler: 'abgelehnt', meldung: 'unterschrift' };

  try {
    const r = await fetchFn(`${API_BASE}/verifier/dienst-pq`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mensch: wallet,
        zeit,
        ed,
        pub,
        besitz_sig: besitzSig,
        mensch_pub: ethers.hexlify(publicKey).slice(2),
        mensch_sig: ethers.hexlify(menschSig).slice(2),
      }),
    });
    let j: any = null;
    try {
      j = await r.json();
    } catch {
      /* Statuscode reicht */
    }
    if (!r.ok) {
      const m = typeof j?.error === 'string' ? j.error : `HTTP ${r.status}`;
      return { ok: false, fehler: 'abgelehnt', meldung: m.slice(0, 200) };
    }
    return { ok: true, ed, wirktAb: typeof j?.wirkt_ab === 'number' ? j.wirkt_ab : undefined };
  } catch (e: any) {
    return { ok: false, fehler: 'abgelehnt', meldung: String(e?.message ?? e).slice(0, 200) };
  }
}
