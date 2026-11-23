// Quantengeld Weg B (B4a): die App als Präparatorin -- melden und abmelden.
//
// Der Knoten (Aequitas x/humanity/keeper/quanten_s_praeparatoren.go) führt das
// Register der Präparatoren: nur Konten, die ein registrierter Mensch sind,
// je Konto ein Eintrag, unterschrieben mit der MENSCHEN-Wallet (EIP-191).
// Schlüssel K und Nachricht bildet die App genau wie der Knoten; der
// Prüfvektor (lib/__tests__/vektoren/quanten_s_praep_vektor.json, aus
// testdata/quanten_s_praep_vektor.json im Knoten) hält das fest.
//
// Fail-closed: Die Antwort des Registers wird streng gelesen (Größe, Formen,
// Anzahl); eine Unterschrift, die nicht zur eigenen Adresse passt oder nicht
// kanonisch ist, wird nie eingereicht. Solange Weg B im Knoten schläft,
// meldet das Register aktiv = false und die App bietet nichts an.

import { ethers } from 'ethers';
import { API_BASE } from './config';
import { CHAIN_ID, QuantenSFehler, kanonisch, unterschriftVon } from './quantenS';

const DOM_K = 'aequitas-quanten-s-praep-k-v1';
const DOM_MELDEN = 'aequitas-quanten-s-praep-melden-v1';
const DOM_ABMELDEN = 'aequitas-quanten-s-praep-abmelden-v1';

/** Größte Antwort des Registers: 256 Einträge à < 200 Byte und die Bestellungen. */
export const REGISTER_MAX = 128 * 1024;
export const EINTRAEGE_MAX = 256;
const FRIST_MS = 15_000;
const ADRESSE = /^0x[0-9a-f]{40}$/;

export type Art = 'melden' | 'abmelden';

/** quantenSPraepK: Schlüssel eines Eintrags, fest aus dem Konto. */
export function praepK(konto: string): string {
  return ethers.sha256(ethers.toUtf8Bytes(`${DOM_K}|${konto.toLowerCase()}`)).slice(2);
}

/** quantenSPraepNachricht: was die Menschen-Wallet unterschreibt. */
export function praepNachricht(art: Art, wallet: string, K: string, zeit: number): string {
  const dom = art === 'melden' ? DOM_MELDEN : DOM_ABMELDEN;
  return `${dom}|chain:${CHAIN_ID}|${wallet.toLowerCase()}|${K}|${zeit}`;
}

export interface Eintrag {
  konto: string;
  gemeldet: number;
  imLosAb: number;
  abgemeldet?: number;
}

export interface Register {
  aktiv: boolean;
  vorlauf: number;
  nachlauf: number;
  eintraege: Eintrag[];
}

function ganz(x: unknown): x is number {
  return typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;
}

/** Die Antwort von GET /api/quanten-w/praeparatoren, streng gelesen (sonst null). */
export function registerLesen(roh: unknown): Register | null {
  if (!roh || typeof roh !== 'object' || Array.isArray(roh)) return null;
  const o = roh as Record<string, unknown>;
  if (typeof o.aktiv !== 'boolean' || !ganz(o.vorlauf) || !ganz(o.nachlauf) || !Array.isArray(o.praeparatoren)) return null;
  if (o.praeparatoren.length > EINTRAEGE_MAX) return null;
  const eintraege: Eintrag[] = [];
  for (const e of o.praeparatoren) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) return null;
    const p = e as Record<string, unknown>;
    if (typeof p.konto !== 'string' || !ADRESSE.test(p.konto) || !ganz(p.gemeldet) || !ganz(p.im_los_ab) || p.im_los_ab < p.gemeldet) return null;
    if (p.abgemeldet !== undefined && (!ganz(p.abgemeldet) || p.abgemeldet < p.gemeldet)) return null;
    eintraege.push({ konto: p.konto, gemeldet: p.gemeldet, imLosAb: p.im_los_ab, ...(p.abgemeldet !== undefined ? { abgemeldet: p.abgemeldet as number } : {}) });
  }
  return { aktiv: o.aktiv, vorlauf: o.vorlauf, nachlauf: o.nachlauf, eintraege };
}

export async function holeRegister(fetchFn: typeof fetch = fetch, api: string = API_BASE): Promise<Register | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FRIST_MS);
  try {
    const r = await fetchFn(`${api}/quanten-w/praeparatoren`, { headers: { Accept: 'application/json' }, signal: ctrl.signal, redirect: 'error' } as RequestInit);
    if (!r.ok) return null;
    const text = await r.text();
    if (text.length > REGISTER_MAX) return null;
    return registerLesen(JSON.parse(text));
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export type MeinStand =
  | { art: 'nicht_gemeldet' }
  | { art: 'wartet'; imLosAb: number }
  | { art: 'im_los'; seit: number }
  | { art: 'abgemeldet'; neuAb: number };

/** Der eigene Stand im Register zur Zeit jetzt (Sekunden). */
export function meinStand(reg: Register, adresse: string, jetzt: number): MeinStand {
  const e = reg.eintraege.find((x) => x.konto === adresse.toLowerCase());
  if (!e) return { art: 'nicht_gemeldet' };
  if (e.abgemeldet !== undefined) return { art: 'abgemeldet', neuAb: e.abgemeldet + reg.nachlauf };
  if (jetzt < e.imLosAb) return { art: 'wartet', imLosAb: e.imLosAb };
  return { art: 'im_los', seit: e.imLosAb };
}

/** Wallet-Unterschrift in die Form, die der Knoten verlangt (klein, v = 1b/1c). */
export function sigNormal(sig: string): string {
  let s = sig.toLowerCase();
  if (/^0x[0-9a-f]{130}$/.test(s)) {
    const v = s.slice(130);
    if (v === '00') s = s.slice(0, 130) + '1b';
    else if (v === '01') s = s.slice(0, 130) + '1c';
  }
  return s;
}

export interface Unterzeichner {
  signMessage(nachricht: string): Promise<string>;
}

/**
 * Melden oder abmelden: unterschreiben mit der Menschen-Wallet, selbst prüfen,
 * einreichen. Wirft QuantenSFehler mit lesbarem Grund.
 */
export async function praepEinreichen(
  art: Art,
  adresse: string,
  signer: Unterzeichner,
  jetztSek: number,
  fetchFn: typeof fetch = fetch,
  api: string = API_BASE,
): Promise<void> {
  const wallet = adresse.toLowerCase();
  if (!ADRESSE.test(wallet)) throw new QuantenSFehler('Wallet-Adresse');
  const K = praepK(wallet);
  const nachricht = praepNachricht(art, wallet, K, jetztSek);
  const sig = sigNormal(await signer.signMessage(nachricht));
  if (!kanonisch(sig) || !unterschriftVon(nachricht, sig, wallet)) throw new QuantenSFehler('Unterschrift passt nicht zur Wallet');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FRIST_MS);
  try {
    const r = await fetchFn(`${api}/quanten-w/s_praep_${art}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ wallet, zeit: jetztSek, quanten_w: { k: K, wallet_sig: sig } }),
      signal: ctrl.signal,
      redirect: 'error',
    } as RequestInit);
    if (!r.ok) {
      let grund = '';
      try {
        const j = JSON.parse((await r.text()).slice(0, 2000)) as { error?: unknown };
        if (typeof j.error === 'string') grund = j.error.slice(0, 200);
      } catch {
        // kein JSON
      }
      throw new QuantenSFehler(`HTTP ${r.status}${grund ? `: ${grund}` : ''}`);
    }
  } catch (e) {
    if (e instanceof QuantenSFehler) throw e;
    throw new QuantenSFehler('Netz');
  } finally {
    clearTimeout(t);
  }
}
