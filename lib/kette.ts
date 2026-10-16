// Die EVM-Chain-ID der Aequitas-Kette -- reine Pruefungen, kein Netz.
//
// Die Kette wechselt zu einem Stichtag von 1926 (0x786) auf 19260930
// (0x125E602), Chain-Repo docs/CHAIN_ID_WECHSEL.md und
// x/humanity/keeper/chain_id_wechsel.go. Davor nimmt der Knoten nur 1926 an,
// ab dem Stichtag nur 19260930; 600 s vor dem Stichtag nimmt er keine
// Ueberweisungen an (Pause).
//
// Die App signiert deshalb nie mit einer fest eingebauten Zahl, sondern mit
// der ID, die der Knoten live meldet (lib/ketteLive.ts). Der Knoten ist
// feindlich, bis seine Antwort geprueft ist: angenommen wird nur genau eine
// ID aus AEQUITAS_CHAIN_IDS, jede andere Antwort heisst "nicht signieren".
//
// EINGEFROREN und NICHT hier: die 1926 in der Netzkennung
// "aequitas-1926-<genesis>" (NETZ_KENNUNG_CHAIN_ID, src/api/netz.ts) und in
// den Coordinator-/Bescheinigungssaetzen ("chain:1926"). Die aendern sich
// beim Wechsel nicht.

import { AEQUITAS_CHAIN_IDS, CHAIN_ID_ALT, CHAIN_ID_NEU, NATIVE_CURRENCY, RPC_URL, WEBAPP } from './config';

export { AEQUITAS_CHAIN_IDS, CHAIN_ID_ALT, CHAIN_ID_NEU };

/** So lange vor dem Stichtag nimmt der Knoten keine Ueberweisungen an (chainIDWechselPause). */
export const WECHSEL_PAUSE_S = 600;

/** Genau eine der beiden Aequitas-IDs, als Zahl (kein Text, kein bigint). */
export function istAequitasChainId(x: unknown): x is number {
  return typeof x === 'number' && Number.isSafeInteger(x) && AEQUITAS_CHAIN_IDS.includes(x);
}

/** "0x786" / "0x125e602" (eth_chainId) -> Zahl, nur aus der Liste; sonst null. */
export function chainIdAusHex(x: unknown): number | null {
  if (typeof x !== 'string' || !/^0x[0-9a-fA-F]{1,8}$/.test(x)) return null;
  const n = parseInt(x.slice(2), 16);
  return istAequitasChainId(n) ? n : null;
}

export function chainIdHex(id: number): string {
  if (!istAequitasChainId(id)) throw new Error('Chain-ID nicht im Aequitas-Netz');
  return '0x' + id.toString(16);
}

/** CAIP-2 (WalletConnect): "eip155:<id>". */
export function chainCaip(id: number): string {
  if (!istAequitasChainId(id)) throw new Error('Chain-ID nicht im Aequitas-Netz');
  return `eip155:${id}`;
}

/** Beide CAIP-Kennungen des Netzes -- vor und nach dem Wechsel. */
export const AEQUITAS_CAIPS: readonly string[] = Object.freeze(AEQUITAS_CHAIN_IDS.map((id) => `eip155:${id}`));

export function istAequitasCaip(k: unknown): boolean {
  return typeof k === 'string' && AEQUITAS_CAIPS.includes(k);
}

/** "0x..." aus wallet_addEthereumChain/-switch -> CAIP, nur aus der Liste; sonst null. */
export function caipAusHex(x: unknown): string | null {
  const id = chainIdAusHex(x);
  return id === null ? null : chainCaip(id);
}

export type KettenStand = {
  /** Die ID, die der Knoten jetzt meldet (chain_evm_id). */
  chainId: number;
  /** Stichtag als Unix-Zeit (chain_id_wechsel_ab); 0 = kein Wechsel geplant. */
  wechselAb: number;
};

/**
 * Liest chain_evm_id und chain_id_wechsel_ab aus /api/status. null = nicht
 * signieren:
 *   - chain_evm_id fehlt oder steht nicht in der Liste;
 *   - chain_id_wechsel_ab ist da, aber keine ganze Zahl >= 0;
 *   - der Knoten meldet die neue ID, aber keinen Stichtag (widerspruechlich).
 * Fehlt chain_id_wechsel_ab ganz (Knoten vor dem Wechsel-PR), gilt 0.
 */
export function kettenStandAusStatus(status: unknown): KettenStand | null {
  if (!status || typeof status !== 'object' || Array.isArray(status)) return null;
  const s = status as Record<string, unknown>;
  if (!istAequitasChainId(s.chain_evm_id)) return null;
  const roh = s.chain_id_wechsel_ab;
  let wechselAb = 0;
  if (roh !== undefined && roh !== null) {
    if (typeof roh !== 'number' || !Number.isSafeInteger(roh) || roh < 0) return null;
    wechselAb = roh;
  }
  if (s.chain_evm_id === CHAIN_ID_NEU && wechselAb === 0) return null;
  return { chainId: s.chain_evm_id, wechselAb };
}

/**
 * Pause vor dem Stichtag (nach der Uhr des Geraets): der Knoten nimmt keine
 * Ueberweisung mit 1926 mehr an, die neue ID gilt noch nicht. Sie blockiert
 * nur zusaetzlich -- verbindlich prueft der Knoten selbst.
 */
export function inWechselPause(stand: KettenStand, jetztS: number): boolean {
  return stand.chainId === CHAIN_ID_ALT && stand.wechselAb > 0 && jetztS >= stand.wechselAb - WECHSEL_PAUSE_S;
}

/** Spielraum der Geraeteuhr gegen den Stichtag (s). */
export const UHR_TOLERANZ_S = 300;

/**
 * Passt die gemeldete ID zur Uhr des Geraets? Fuer JEDE Unterschrift:
 *   - 1926 nicht mehr, wenn der Stichtag mehr als UHR_TOLERANZ_S vorbei ist;
 *   - 19260930 nicht, solange der Stichtag mehr als UHR_TOLERANZ_S entfernt ist.
 * Ein Knoten mit veralteter Antwort (Zwischenspeicher, falsche Uhr) oder
 * eine gefaelschte Meldung fuehrt so nicht zu einer Unterschrift, die der
 * Knoten zu ihrer Zeit nicht annehmen duerfte.
 */
export function passtZurUhr(stand: KettenStand, jetztS: number): boolean {
  if (!Number.isFinite(jetztS)) return false;
  if (stand.chainId === CHAIN_ID_ALT) return !(stand.wechselAb > 0 && jetztS >= stand.wechselAb + UHR_TOLERANZ_S);
  if (stand.chainId === CHAIN_ID_NEU) return stand.wechselAb > 0 && jetztS >= stand.wechselAb - UHR_TOLERANZ_S;
  return false;
}

/** Angaben fuer wallet_addEthereumChain -- immer fuer genau eine ID der Liste. */
export function kettenAngabenFuer(id: number) {
  return {
    chainId: chainIdHex(id),
    chainName: 'Aequitas Chain',
    nativeCurrency: NATIVE_CURRENCY,
    rpcUrls: [RPC_URL],
    blockExplorerUrls: [WEBAPP],
  };
}

/** Steht eine EIP-712-Domaene fuer genau diese ID? (Zahl, Text oder bigint) */
export function domaeneTraegt(domainChainId: unknown, id: number): boolean {
  if (domainChainId === undefined || domainChainId === null) return false;
  try {
    return BigInt(domainChainId as any) === BigInt(id);
  } catch {
    return false;
  }
}
