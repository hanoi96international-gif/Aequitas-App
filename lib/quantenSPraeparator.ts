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
//
// Schlüssel (B4b-4b): Jeder Eintrag trägt den öffentlichen secp256k1-Schlüssel
// der Präparatorin (pub, 04 || X || Y, Hex), den der Knoten aus ihrer
// EIP-191-Meldung wiederherstellt. Ausgeber und Inhaberin verschlüsseln den
// Auftrag daran (ECIES). Die App prüft selbst, dass er genau die Adresse des
// Kontos ergibt -- ein Knoten, der einen fremden Schlüssel einsetzt, würde
// sonst die geheimen Basen lesen.

import { ethers } from 'ethers';
import { API_BASE } from './config';
import { CHAIN_ID, QuantenSFehler, kanonisch, unterschriftVon } from './quantenS';
import { schluesselPruefen } from './quantenSPraeparieren';

const DOM_K = 'aequitas-quanten-s-praep-k-v1';
const DOM_MELDEN = 'aequitas-quanten-s-praep-melden-v1';
const DOM_ABMELDEN = 'aequitas-quanten-s-praep-abmelden-v1';

/** Größte Antwort des Registers: 256 Einträge à < 200 Byte und die Bestellungen. */
export const REGISTER_MAX = 128 * 1024;
export const EINTRAEGE_MAX = 256;
const FRIST_MS = 15_000;
const ADRESSE = /^0x[0-9a-f]{40}$/;

/**
 * Ergibt pub genau die Adresse konto (schluesselPruefen) UND steht er schon in
 * der kanonischen Form des Knotens (04…, klein, ohne 0x)? Sonst false.
 */
export function pubPasst(pub: unknown, konto: string): pub is string {
  if (typeof pub !== 'string') return false;
  try {
    return schluesselPruefen(pub, konto) === pub;
  } catch {
    return false;
  }
}

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
  /** secp256k1, unkomprimiert, Hex ohne 0x (130 Zeichen). */
  pub: string;
  gemeldet: number;
  imLosAb: number;
  abgemeldet?: number;
  /** P2 (Knoten quanten_s_pfaender.go): Pfand im Pfandtopf, Mikro-AEQ; fehlt = keins. */
  pfand?: number;
  /** Ab wann das Pfand frühestens zurück kann (nur abgemeldet mit Pfand). */
  pfandZurueckAb?: number;
}

/** 10 AEQ je Präparatorin (Knoten quantenSPraepPfand), in Mikro-AEQ. */
export const PRAEP_PFAND_MIKRO = 10_000_000;

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
    if (typeof p.konto !== 'string' || !ADRESSE.test(p.konto) || !pubPasst(p.pub, p.konto) || !ganz(p.gemeldet) || !ganz(p.im_los_ab) || p.im_los_ab < p.gemeldet) return null;
    if (p.abgemeldet !== undefined && (!ganz(p.abgemeldet) || p.abgemeldet < p.gemeldet)) return null;
    // P2: Pfand 1..10 AEQ (der Nachweis einer Fälschung belastet die Gelosten
    // nicht mehr, Prüfung 26.11.2026; streng bleibt die Obergrenze); die
    // Rückgabezeit nur bei Abgemeldeten mit Pfand.
    if (p.pfand !== undefined && (!ganz(p.pfand) || p.pfand <= 0 || p.pfand > PRAEP_PFAND_MIKRO)) return null;
    if (p.pfand_zurueck_ab !== undefined && (!ganz(p.pfand_zurueck_ab) || p.pfand === undefined || p.abgemeldet === undefined || p.pfand_zurueck_ab < (p.abgemeldet as number))) return null;
    eintraege.push({
      konto: p.konto,
      pub: p.pub as string,
      gemeldet: p.gemeldet,
      imLosAb: p.im_los_ab,
      ...(p.abgemeldet !== undefined ? { abgemeldet: p.abgemeldet as number } : {}),
      ...(p.pfand !== undefined ? { pfand: p.pfand as number } : {}),
      ...(p.pfand_zurueck_ab !== undefined ? { pfandZurueckAb: p.pfand_zurueck_ab as number } : {}),
    });
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
  | { art: 'abgemeldet'; neuAb: number }
  // P2, nur wenn die Pfänder gelten (pfaenderAktiv):
  | { art: 'nachlegen' } // gemeldet ohne Pfand: nicht im Los, bis es liegt
  | { art: 'pfand_wartet'; zurueckAb: number } // abgemeldet, Pfand liegt noch
  | { art: 'pfand_zurueck'; pfand: number }; // abgemeldet, Rückgabe möglich (sofern nicht gebunden)

/**
 * Der eigene Stand im Register zur Zeit jetzt (Sekunden). pfaenderAktiv: der
 * Stichtag der Pfänder ist erreicht (holePfaenderAb) -- dann kommt ins Los nur,
 * wer ein Pfand hat.
 */
export function meinStand(reg: Register, adresse: string, jetzt: number, pfaenderAktiv = false): MeinStand {
  const e = reg.eintraege.find((x) => x.konto === adresse.toLowerCase());
  if (!e) return { art: 'nicht_gemeldet' };
  if (e.abgemeldet !== undefined) {
    if (e.pfand !== undefined) {
      const ab = e.pfandZurueckAb ?? Number.MAX_SAFE_INTEGER;
      return jetzt < ab ? { art: 'pfand_wartet', zurueckAb: ab } : { art: 'pfand_zurueck', pfand: e.pfand };
    }
    return { art: 'abgemeldet', neuAb: e.abgemeldet + reg.nachlauf };
  }
  if (pfaenderAktiv && e.pfand === undefined) return { art: 'nachlegen' };
  if (jetzt < e.imLosAb) return { art: 'wartet', imLosAb: e.imLosAb };
  return { art: 'im_los', seit: e.imLosAb };
}

/**
 * Stichtag der Pfänder (GET /api/status, quanten_w.pfaender_ab); null =
 * schlafend oder nicht lesbar. Der Knoten prüft selbst -- hier geht es nur
 * darum, dass die App das Pfand VOR dem Melden nennt.
 */
export async function holePfaenderAb(fetchFn: typeof fetch = fetch, api: string = API_BASE): Promise<number | null> {
  return statusAb('pfaender_ab', fetchFn, api);
}

/**
 * Stichtag des Pfands je Präparatorin (quanten_w.praep_pfand_ab). Seit dem
 * Befund vom 26.11. hat es einen eigenen Stichtag (schlafend): der Stichtag der
 * Pfänder schaltet es nicht ein -- die Karte der Präparatorin richtet sich nur
 * nach diesem.
 */
export async function holePraepPfandAb(fetchFn: typeof fetch = fetch, api: string = API_BASE): Promise<number | null> {
  return statusAb('praep_pfand_ab', fetchFn, api);
}

async function statusAb(feld: 'pfaender_ab' | 'praep_pfand_ab', fetchFn: typeof fetch, api: string): Promise<number | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FRIST_MS);
  try {
    const r = await fetchFn(`${api}/status`, { headers: { Accept: 'application/json' }, signal: ctrl.signal, redirect: 'error' } as RequestInit);
    if (!r.ok) return null;
    const text = await r.text();
    if (text.length > REGISTER_MAX) return null;
    const ab = (JSON.parse(text) as { quanten_w?: Record<string, unknown> })?.quanten_w?.[feld];
    return ganz(ab) ? ab : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Pfand zurückholen (quanten_w_s_pfand_zurueck): ohne Unterschrift, auslösen
 * darf jeder; das Geld geht an die Wallet des Menschen, die der Knoten selbst
 * bestimmt. Wirft QuantenSFehler mit dem Grund des Knotens (etwa "gebunden").
 */
export async function pfandZurueckEinreichen(adresse: string, fetchFn: typeof fetch = fetch, api: string = API_BASE): Promise<void> {
  const wallet = adresse.toLowerCase();
  if (!ADRESSE.test(wallet)) throw new QuantenSFehler('Wallet-Adresse');
  await senden(fetchFn, `${api}/quanten-w/s_pfand_zurueck`, { wallet: '', zeit: 0, quanten_w: { k: praepK(wallet) } });
}

async function senden(fetchFn: typeof fetch, url: string, koerper: unknown): Promise<void> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FRIST_MS);
  try {
    const r = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(koerper),
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
  await senden(fetchFn, `${api}/quanten-w/s_praep_${art}`, { wallet, zeit: jetztSek, quanten_w: { k: K, wallet_sig: sig } });
}
