// Einen Validator-Knoten mit der eigenen Wallet verbinden -- per QR-Code.
//
// deploy/validator/einrichten.sh (Aequitas-Repo) zeigt am Ende einen QR-Code:
//
//   aequitasapp://knoten-binden?adresse=<Signieradresse>&wallet=<Wallet>&beweis=<Signatur>
//
// `beweis` ist die Signatur des KNOTENS ueber
// "Aequitas: validator key linked to human <wallet>" -- der Knoten zeigt
// damit, dass er den Schluessel zur Signieradresse wirklich hat
// (/api/validator-selfproof). Die App unterschreibt dann mit der Wallet des
// Menschen "Aequitas: authorize validator <Signieradresse>" und reicht beides
// bei /api/register-validator-key ein. Der Knoten dort prueft beides selbst
// und legt die Bindung ab; das Skript holt sie sich und traegt sie ein.
//
// Vorher wird hier fail-closed geprueft, bevor irgendetwas unterschrieben
// wird: Format, dass der Code DIESE Wallet nennt, und dass der Nachweis des
// Knotens zur genannten Signieradresse passt. Nichts davon ist geheim; die
// Unterschrift bewegt kein Geld.
import { ethers } from 'ethers';
import { API_BASE } from './config';
import type { AequitasSigner } from './signer';

export interface Knotenbindung {
  /** Signieradresse des Knotens, klein geschrieben. */
  adresse: string;
  /** Wallet, fuer die der Knoten eingerichtet wurde, klein geschrieben. */
  wallet: string;
  /** Signatur des Knotens ueber knotenNachweisNachricht(wallet). */
  beweis: string;
}

const ADRESSE = /^0x[0-9a-fA-F]{40}$/;
const SIGNATUR = /^0x[0-9a-fA-F]{130}$/;

export function knotenNachweisNachricht(wallet: string): string {
  return 'Aequitas: validator key linked to human ' + wallet.toLowerCase();
}

export function bindungsNachricht(adresse: string): string {
  return 'Aequitas: authorize validator ' + adresse.toLowerCase();
}

/** Liest den QR-Inhalt. null, wenn es kein gueltiger Bindungscode ist. */
export function leseKnotenbindung(roh: string): Knotenbindung | null {
  const text = String(roh ?? '').trim();
  const m = /^aequitasapp:\/\/knoten-binden\?(.+)$/.exec(text);
  if (!m) return null;
  const p = new URLSearchParams(m[1]);
  return ausParametern(p.get('adresse'), p.get('wallet'), p.get('beweis'));
}

/** Dieselbe Pruefung fuer Parameter, die ueber einen Deep Link kommen. */
export function ausParametern(adresse: unknown, wallet: unknown, beweis: unknown): Knotenbindung | null {
  if (typeof adresse !== 'string' || typeof wallet !== 'string' || typeof beweis !== 'string') return null;
  if (!ADRESSE.test(adresse) || !ADRESSE.test(wallet) || !SIGNATUR.test(beweis)) return null;
  return { adresse: adresse.toLowerCase(), wallet: wallet.toLowerCase(), beweis };
}

/** Stammt der Nachweis wirklich vom Schluessel der genannten Signieradresse? */
export function knotenNachweisGueltig(b: Knotenbindung): boolean {
  try {
    return ethers.verifyMessage(knotenNachweisNachricht(b.wallet), b.beweis).toLowerCase() === b.adresse;
  } catch {
    return false;
  }
}

export type BindungsFehler = 'andere_wallet' | 'nachweis_ungueltig' | 'unterschrift_ungueltig' | 'abgelehnt';

export interface BindungsErgebnis {
  ok: boolean;
  fehler?: BindungsFehler;
  /** Meldung des Knotens bei 'abgelehnt' (nur zur Anzeige). */
  meldung?: string;
}

/**
 * Unterschreibt die Bindung und reicht sie ein. Prueft vorher, dass der Code
 * zur verbundenen Wallet gehoert und der Knotennachweis stimmt; prueft
 * nachher die eigene Unterschrift (eine fremde Wallet ueber WalletConnect
 * koennte mit einer anderen Adresse unterschreiben).
 */
export async function knotenBinden(
  signer: AequitasSigner,
  b: Knotenbindung,
  fetchFn: typeof fetch = fetch,
): Promise<BindungsErgebnis> {
  if (signer.address.toLowerCase() !== b.wallet) return { ok: false, fehler: 'andere_wallet' };
  if (!knotenNachweisGueltig(b)) return { ok: false, fehler: 'nachweis_ungueltig' };

  const nachricht = bindungsNachricht(b.adresse);
  const unterschrift = await signer.signMessage(nachricht);
  let unterzeichner = '';
  try {
    unterzeichner = ethers.verifyMessage(nachricht, unterschrift).toLowerCase();
  } catch {
    unterzeichner = '';
  }
  if (unterzeichner !== b.wallet) return { ok: false, fehler: 'unterschrift_ungueltig' };

  const antwort = await fetchFn(`${API_BASE}/register-validator-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      signing_address: b.adresse,
      human_wallet: b.wallet,
      human_signature: unterschrift,
      signing_key_signature: b.beweis,
    }),
  });
  if (!antwort.ok) {
    let meldung = `HTTP ${antwort.status}`;
    try {
      const j = await antwort.json();
      if (j && typeof j.error === 'string') meldung = j.error.slice(0, 200);
    } catch {
      /* Meldung bleibt der Statuscode */
    }
    return { ok: false, fehler: 'abgelehnt', meldung };
  }
  return { ok: true };
}
