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

// ---------------------------------------------------------------- Kette
//
// VALIDATOR-REGISTER AUF DER KETTE (seit 25.10.2026 in derselben Bestaetigung).
// Die Bindung oben gilt nur beim Knoten. Ins Register auf der Kette kommt ein
// Knoten mit einer eigenen Transaktion (keeper/validator_register.go): Knoten
// UND Mensch unterschreiben denselben Satz mit Zeitpunkt. Der Knoten liefert
// seine Unterschrift mit der Bindungsanfrage (bindung_zeit,
// bindung_signatur_knoten); die App prueft sie hier selbst, baut den Satz
// selbst (nie vom Netz uebernommen) und reicht beides bei
// /api/validator-bindung ein. Vorher ging das nur ueber die Browserseite
// /node-binding -- wer der Ein-Schritt-Anleitung folgte, stand nie im
// Register.

/** Eingefroren wie im Knoten (eingefroreneChainID, chain_id_wechsel.go). */
export const KETTENBINDUNG_CHAIN_ID = 1926;
/** Die Annahme nimmt den Nachweis bis 10 min alt; eine Minute Puffer. */
export const KETTENNACHWEIS_HOECHSTENS_ALT_S = 9 * 60;
/** Wie nachweisHoechstensVoraus im Knoten. */
export const KETTENNACHWEIS_HOECHSTENS_VORAUS_S = 5 * 60;

export interface Kettennachweis {
  /** Unix-Sekunden, die der Knoten unterschrieben hat. */
  zeit: number;
  /** Unterschrift der Signieradresse ueber kettenbindungsNachricht(...). */
  signaturKnoten: string;
}

export function kettenbindungsNachricht(adresse: string, wallet: string, zeit: number): string {
  return `Aequitas: bind validator ${adresse.toLowerCase()} to operator ${wallet.toLowerCase()} chain:${KETTENBINDUNG_CHAIN_ID} ts:${zeit}`;
}

/** Stammt der Kettennachweis vom Schluessel der Signieradresse, fuer genau diese Wallet? */
export function kettennachweisGueltig(b: Knotenbindung, k: Kettennachweis): boolean {
  if (!Number.isSafeInteger(k.zeit) || k.zeit <= 0 || !SIGNATUR.test(k.signaturKnoten)) return false;
  try {
    return ethers.verifyMessage(kettenbindungsNachricht(b.adresse, b.wallet, k.zeit), k.signaturKnoten).toLowerCase() === b.adresse;
  } catch {
    return false;
  }
}

/** Nimmt die Annahme den Nachweis jetzt noch? */
export function kettennachweisFrisch(k: Kettennachweis, jetztS: number): boolean {
  return k.zeit >= jetztS - KETTENNACHWEIS_HOECHSTENS_ALT_S && k.zeit <= jetztS + KETTENNACHWEIS_HOECHSTENS_VORAUS_S;
}

/** Kanonische Schreibweise (klein, v = 27/28), wie die Kette sie verlangt (kanonischeSignatur). */
function kanonisch(sig: string): string {
  return ethers.Signature.from(sig).serialized.toLowerCase();
}

export type BindungsFehler = 'andere_wallet' | 'nachweis_ungueltig' | 'unterschrift_ungueltig' | 'abgelehnt';

/** eingetragen: im Ausgang des Leiters, mit dem naechsten Block auf der Kette. */
export type KettenErgebnis = 'eingetragen' | 'nicht_angeboten' | 'fehlgeschlagen';

export interface BindungsErgebnis {
  ok: boolean;
  fehler?: BindungsFehler;
  /** Meldung des Knotens bei 'abgelehnt' (nur zur Anzeige). */
  meldung?: string;
  /** Nur bei ok: was mit dem Eintrag im Register auf der Kette geschah. */
  kette?: KettenErgebnis;
  /** Meldung bei kette = 'fehlgeschlagen' (nur zur Anzeige). */
  ketteMeldung?: string;
}

async function meldungAus(antwort: Response): Promise<string> {
  let meldung = `HTTP ${antwort.status}`;
  try {
    const j = await antwort.json();
    if (j && typeof j.error === 'string') meldung = j.error.slice(0, 200);
  } catch {
    /* Meldung bleibt der Statuscode */
  }
  return meldung;
}

/**
 * Der frischeste Kettennachweis des Servers fuer diese Bindung -- unmittelbar
 * vor dem Unterschreiben neu geholt (der Server meldet alle 3 Minuten neu).
 * undefined, wenn keiner da, ungueltig oder zu alt ist.
 */
async function frischerKettennachweis(b: Knotenbindung, fetchFn: typeof fetch, jetztS: number): Promise<Kettennachweis | undefined> {
  const liste = await holeBindungsanfragen(b.wallet, fetchFn);
  const a = liste.find((e) => e.adresse === b.adresse && e.kette);
  if (!a?.kette || !kettennachweisFrisch(a.kette, jetztS)) return undefined;
  return a.kette;
}

/** Unterschreibt den Satz der Kettenbindung und reicht ihn ein. */
async function ketteBinden(
  signer: AequitasSigner,
  b: Knotenbindung,
  k: Kettennachweis,
  fetchFn: typeof fetch,
): Promise<Pick<BindungsErgebnis, 'kette' | 'ketteMeldung'>> {
  const nachricht = kettenbindungsNachricht(b.adresse, b.wallet, k.zeit);
  let unterschrift = '';
  try {
    unterschrift = kanonisch(await signer.signMessage(nachricht));
    if (ethers.verifyMessage(nachricht, unterschrift).toLowerCase() !== b.wallet) {
      return { kette: 'fehlgeschlagen', ketteMeldung: 'signature is not from this wallet' };
    }
  } catch (e: any) {
    return { kette: 'fehlgeschlagen', ketteMeldung: String(e?.message ?? e).slice(0, 200) };
  }
  try {
    const antwort = await fetchFn(`${API_BASE}/validator-bindung`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operator: b.wallet,
        signing: b.adresse,
        ts: k.zeit,
        operator_signature: unterschrift,
        signing_signature: kanonisch(k.signaturKnoten),
      }),
    });
    if (!antwort.ok) return { kette: 'fehlgeschlagen', ketteMeldung: await meldungAus(antwort) };
  } catch (e: any) {
    return { kette: 'fehlgeschlagen', ketteMeldung: String(e?.message ?? e).slice(0, 200) };
  }
  return { kette: 'eingetragen' };
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
  jetztS: () => number = () => Math.floor(Date.now() / 1000),
): Promise<BindungsErgebnis> {
  if (signer.address.toLowerCase() !== b.wallet) return { ok: false, fehler: 'andere_wallet' };
  if (!knotenNachweisGueltig(b)) return { ok: false, fehler: 'nachweis_ungueltig' };

  // Vor dem ersten Unterschreiben holen: nach der Bindung beim Knoten raeumt
  // das Netz die Anfrage weg (bindungsAnfragen.erledigt).
  const kette = await frischerKettennachweis(b, fetchFn, jetztS());

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
    return { ok: false, fehler: 'abgelehnt', meldung: await meldungAus(antwort) };
  }
  if (!kette) return { ok: true, kette: 'nicht_angeboten' };
  return { ok: true, ...(await ketteBinden(signer, b, kette, fetchFn)) };
}

/** Eine offene Anfrage eines Servers (keeper/bindungsanfrage.go). */
export interface Bindungsanfrage extends Knotenbindung {
  /** IP, von der der Server die Anfrage geschickt hat. */
  ip: string;
  zeit: string;
  /** Nachweis fuer das Register auf der Kette, nur wenn er gueltig ist. */
  kette?: Kettennachweis;
}

/**
 * Offene Anfragen fuer diese Wallet. Nur, was formal stimmt und dessen
 * Knotennachweis zur genannten Signieradresse passt, wird angezeigt -- die
 * Antwort des Netzes wird nicht ungeprueft geglaubt. Fehler: leere Liste.
 */
export async function holeBindungsanfragen(wallet: string, fetchFn: typeof fetch = fetch): Promise<Bindungsanfrage[]> {
  try {
    const r = await fetchFn(`${API_BASE}/bindungsanfragen?wallet=${encodeURIComponent(wallet.toLowerCase())}`);
    if (!r.ok) return [];
    const j = await r.json();
    const roh: unknown[] = Array.isArray(j?.anfragen) ? j.anfragen.slice(0, 10) : [];
    const out: Bindungsanfrage[] = [];
    for (const e of roh as any[]) {
      const b = ausParametern(e?.signing_address, e?.wallet, e?.beweis);
      if (!b || b.wallet !== wallet.toLowerCase() || !knotenNachweisGueltig(b)) continue;
      const ip = typeof e?.ip === 'string' && /^[0-9a-fA-F:.]{2,45}$/.test(e.ip) ? e.ip : '?';
      const anfrage: Bindungsanfrage = { ...b, ip, zeit: typeof e?.zeit === 'string' ? e.zeit : '' };
      // Kettennachweis nur, wenn er selbst geprueft zu genau dieser Bindung passt.
      const k = { zeit: e?.bindung_zeit, signaturKnoten: e?.bindung_signatur_knoten } as Kettennachweis;
      if (typeof k.zeit === 'number' && typeof k.signaturKnoten === 'string' && kettennachweisGueltig(b, k)) {
        anfrage.kette = { zeit: k.zeit, signaturKnoten: k.signaturKnoten };
      }
      out.push(anfrage);
    }
    return out;
  } catch {
    return [];
  }
}

export function ablehnungsNachricht(adresse: string): string {
  return 'Aequitas: reject validator ' + adresse.toLowerCase();
}

/** Lehnt eine Anfrage ab (unterschrieben, damit niemand fremde wegraeumt). */
export async function bindungsanfrageAblehnen(
  signer: AequitasSigner,
  adresse: string,
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  const sig = await signer.signMessage(ablehnungsNachricht(adresse));
  const q = new URLSearchParams({ wallet: signer.address.toLowerCase(), signing_address: adresse.toLowerCase(), signatur: sig });
  try {
    const r = await fetchFn(`${API_BASE}/bindungsanfragen?${q.toString()}`, { method: 'DELETE' });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Kontrollzahl wie beim Bluetooth-Koppeln: dieselbe Rechnung wie in
 * deploy/validator/einrichten.sh (Aequitas-Repo). SHA-256 der klein
 * geschriebenen Signieradresse, erste 4 Byte, modulo 1.000.000, als
 * "123 456". Wird hier selbst gerechnet, nie vom Netz uebernommen.
 */
export function kontrollzahl(adresse: string): string {
  const h = ethers.getBytes(ethers.sha256(ethers.toUtf8Bytes(adresse.toLowerCase())));
  const n = (((h[0] << 24) >>> 0) + (h[1] << 16) + (h[2] << 8) + h[3]) % 1000000;
  const s = n.toString().padStart(6, '0');
  return s.slice(0, 3) + ' ' + s.slice(3);
}
