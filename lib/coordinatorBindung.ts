// Den Schluessel des eigenen Coordinators mit der Wallet freigeben (Pruefer).
//
// WOZU
//
// Ein Pruefer (Pruefer-Register, keeper/verifier_register.go) stimmt mit dem
// Ed25519-Schluessel seines Coordinators ab und bescheinigt damit. Jede
// Stimme traegt die Bindung dieses Schluessels an den Menschen:
//
//   - Besitznachweis, Ed25519 vom Coordinator selbst:
//       "Aequitas: coordinator key for human <wallet> chain:1926"
//   - Freigabe, EIP-191 von der Wallet des Menschen:
//       "Aequitas: authorize coordinator <schluessel> chain:1926"
//
// Den Besitznachweis stellt der Coordinator unter /besitznachweis aus, nur
// fuer die Wallet seines Betreibers (COORDINATOR_BETREIBER_WALLET). Die
// Freigabe konnte bisher nur eine Browser-Wallet geben -- die Wallet der
// Pruefer liegt aber in dieser App. Ohne diesen Weg konnte niemand
// abstimmen, auch der Gruender nicht.
//
// ABLAUF
//
// 1. Adresse des eigenen Coordinators (Vorgabe: der Coordinator dieser App).
// 2. Nachweis dort holen: Schluessel und Unterschrift, fuer GENAU diese
//    Wallet. Nichts davon ist geheim.
// 3. Anzeigen: Adresse und Schluessel (Kurzform). Der Mensch vergleicht ihn
//    mit seinem Server (/coordinator/inventory, attestation_public_key) --
//    erst dann unterschreiben.
// 4. Die Wallet unterschreibt die Freigabe; die App prueft, dass die
//    Unterschrift von dieser Wallet stammt, und reicht beides beim Knoten
//    ein (/api/register-coordinator-key). Der Knoten prueft BEIDE
//    Unterschriften selbst (Ed25519 streng, EIP-191) und reicht an die
//    anderen Knoten weiter.
//
// WAS DIE UNTERSCHRIFT BEDEUTET
//
// "Dieser Schluessel spricht fuer mich." Wer einen fremden Schluessel
// freigibt, laesst dessen Halter in seinem Namen bescheinigen und abstimmen
// (solange er Pruefer ist). Darum: nur fuer den EIGENEN Server, mit
// sichtbarem Schluessel, und der Satz wird hier gebaut, nie vom Netz uebernommen.
// Geld bewegt die Unterschrift nicht.
import { ethers } from 'ethers';
import { API_BASE, sichereAdresse } from './config';
import type { AequitasSigner } from './signer';

/** Eingefroren wie im Knoten (eingefroreneChainID, coordinator_nachrichten.go). */
export const COORDINATOR_BINDUNG_CHAIN_ID = 1926;

const SCHLUESSEL = /^[0-9a-f]{64}$/;
const ED25519_SIG = /^[0-9a-f]{128}$/;
const ADRESSE = /^0x[0-9a-f]{40}$/;
/** Laenger ist keine Coordinator-Adresse, sondern Muell. */
const URL_MAX = 200;
/** Die Antwort ist ein kleines JSON; mehr wird nicht gelesen. */
const ANTWORT_MAX = 4096;

export function coordinatorFreigabeNachricht(schluessel: string): string {
  return `Aequitas: authorize coordinator ${schluessel.toLowerCase()} chain:${COORDINATOR_BINDUNG_CHAIN_ID}`;
}

export function coordinatorBesitzNachricht(wallet: string): string {
  return `Aequitas: coordinator key for human ${wallet.toLowerCase()} chain:${COORDINATOR_BINDUNG_CHAIN_ID}`;
}

/**
 * Die Adresse eines Coordinators, wie sie hier benutzt wird: nur https, kein
 * abgeschalteter Server, keine IP-Adresse, kein Benutzerteil, kein Query,
 * ohne Schraegstrich am Ende. null, wenn sie nicht taugt.
 */
export function coordinatorAdresse(roh: unknown): string | null {
  if (typeof roh !== 'string') return null;
  const v = roh.trim().replace(/\/+$/, '');
  if (v.length === 0 || v.length > URL_MAX) return null;
  if (sichereAdresse(v, false) === null) return null;
  const m = /^https:\/\/([a-z0-9.-]+)(\/[A-Za-z0-9._~\/-]*)?$/i.exec(v);
  if (!m) return null;
  const host = m[1].toLowerCase();
  if (!host.includes('.') || /^[0-9.]+$/.test(host) || host.startsWith('.') || host.endsWith('.')) return null;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return null;
  return 'https://' + host + (m[2] ?? '');
}

export interface Besitznachweis {
  /** Adresse des Coordinators, normalisiert. */
  url: string;
  /** Ed25519-Schluessel, 64 Hex klein. */
  schluessel: string;
  /** Ed25519-Unterschrift ueber coordinatorBesitzNachricht(wallet), 128 Hex klein. */
  unterschrift: string;
  wallet: string;
}

export type NachweisFehler = 'adresse' | 'nicht_erreichbar' | 'kein_nachweis' | 'antwort_ungueltig' | 'andere_wallet';

/**
 * Holt den Besitznachweis beim Coordinator. Die Antwort wird nicht geglaubt,
 * nur in Form gebracht: Schluessel und Unterschrift in ihrer einen
 * Schreibweise, fuer GENAU diese Wallet. Ob die Unterschrift stimmt, prueft der
 * Knoten (Ed25519 streng) -- und weist sonst ab.
 */
export async function holeBesitznachweis(
  urlRoh: string,
  wallet: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: true; nachweis: Besitznachweis } | { ok: false; fehler: NachweisFehler; meldung?: string }> {
  const url = coordinatorAdresse(urlRoh);
  if (!url) return { ok: false, fehler: 'adresse' };
  const w = String(wallet ?? '').toLowerCase();
  if (!ADRESSE.test(w)) return { ok: false, fehler: 'andere_wallet' };
  let antwort: Response;
  try {
    antwort = await fetchFn(`${url}/besitznachweis?wallet=${encodeURIComponent(w)}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
  } catch (e: any) {
    return { ok: false, fehler: 'nicht_erreichbar', meldung: String(e?.message ?? e).slice(0, 200) };
  }
  let text = '';
  try {
    text = (await antwort.text()).slice(0, ANTWORT_MAX + 1);
  } catch {
    return { ok: false, fehler: 'antwort_ungueltig' };
  }
  if (text.length > ANTWORT_MAX) return { ok: false, fehler: 'antwort_ungueltig' };
  let j: any;
  try {
    j = JSON.parse(text);
  } catch {
    return { ok: false, fehler: antwort.ok ? 'antwort_ungueltig' : 'nicht_erreichbar', meldung: `HTTP ${antwort.status}` };
  }
  if (!antwort.ok) {
    const d = typeof j?.detail === 'string' ? j.detail.slice(0, 200) : `HTTP ${antwort.status}`;
    return { ok: false, fehler: 'kein_nachweis', meldung: d };
  }
  const schluessel = typeof j?.public_key === 'string' ? j.public_key.trim().toLowerCase() : '';
  const unterschrift = typeof j?.key_signature === 'string' ? j.key_signature.trim().toLowerCase().replace(/^0x/, '') : '';
  const fuer = typeof j?.human_wallet === 'string' ? j.human_wallet.trim().toLowerCase() : '';
  if (!SCHLUESSEL.test(schluessel) || !ED25519_SIG.test(unterschrift)) return { ok: false, fehler: 'antwort_ungueltig' };
  if (fuer !== w) return { ok: false, fehler: 'andere_wallet' };
  return { ok: true, nachweis: { url, schluessel, unterschrift, wallet: w } };
}

/** Kurzform zur Anzeige: die ersten und letzten 8 Zeichen des Schluessels.
 * Derselbe Schluessel steht beim Coordinator unter /inventory
 * (attestation_public_key). */
export function schluesselKurz(schluessel: string): string {
  const k = schluessel.toLowerCase();
  return k.length <= 16 ? k : k.slice(0, 8) + '…' + k.slice(-8);
}

export type FreigabeFehler = 'andere_wallet' | 'unterschrift_ungueltig' | 'abgelehnt';

export interface FreigabeErgebnis {
  ok: boolean;
  fehler?: FreigabeFehler;
  meldung?: string;
  /** Der Knoten haelt die Bindung fuer Bescheinigungen und Stimmen tauglich (v2). */
  tauglich?: boolean;
}

/**
 * Unterschreibt die Freigabe und reicht sie ein. Prueft vorher, dass der
 * Nachweis fuer die verbundene Wallet ausgestellt ist, und nachher, dass die
 * Unterschrift wirklich von ihr stammt (eine Wallet ueber WalletConnect
 * koennte mit einer anderen Adresse unterschreiben).
 */
export async function coordinatorFreigeben(
  signer: AequitasSigner,
  n: Besitznachweis,
  fetchFn: typeof fetch = fetch,
): Promise<FreigabeErgebnis> {
  const wallet = signer.address.toLowerCase();
  if (wallet !== n.wallet) return { ok: false, fehler: 'andere_wallet' };
  if (!SCHLUESSEL.test(n.schluessel) || !ED25519_SIG.test(n.unterschrift) || !coordinatorAdresse(n.url)) {
    return { ok: false, fehler: 'abgelehnt', meldung: 'invalid proof' };
  }
  const nachricht = coordinatorFreigabeNachricht(n.schluessel);
  const roh = await signer.signMessage(nachricht);
  let unterschrift = '';
  try {
    unterschrift = ethers.Signature.from(roh).serialized.toLowerCase();
    if (ethers.verifyMessage(nachricht, unterschrift).toLowerCase() !== wallet) {
      return { ok: false, fehler: 'unterschrift_ungueltig' };
    }
  } catch {
    return { ok: false, fehler: 'unterschrift_ungueltig' };
  }
  let antwort: Response;
  try {
    antwort = await fetchFn(`${API_BASE}/register-coordinator-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        public_key: n.schluessel,
        human_wallet: wallet,
        human_signature: unterschrift,
        key_signature: n.unterschrift,
        url: n.url,
      }),
    });
  } catch (e: any) {
    return { ok: false, fehler: 'abgelehnt', meldung: String(e?.message ?? e).slice(0, 200) };
  }
  let j: any = null;
  try {
    j = await antwort.json();
  } catch {
    j = null;
  }
  if (!antwort.ok || j?.success !== true) {
    const m = typeof j?.error === 'string' ? j.error.slice(0, 200) : `HTTP ${antwort.status}`;
    return { ok: false, fehler: 'abgelehnt', meldung: m };
  }
  return { ok: true, tauglich: j?.bescheinigungstauglich === true };
}
