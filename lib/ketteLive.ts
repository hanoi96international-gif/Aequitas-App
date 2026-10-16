// Die Chain-ID zum Signieren -- live vom Knoten, fail-closed.
//
// Vor JEDER kettengebundenen Unterschrift (Ueberweisung, EIP-712 der
// V8-Registrierung, V7-Registrierung, Zahlungslink) fragt die App zwei
// Quellen:
//   - /api/status: chain_evm_id und chain_id_wechsel_ab (lib/api.ts, mit
//     Ausweichknoten und Zeitgrenze);
//   - /rpc eth_chainId (dieselbe Leitung, ueber die eine Ueberweisung geht).
// Beide muessen dieselbe ID aus AEQUITAS_CHAIN_IDS melden. Unerreichbar,
// unlesbar, nicht in der Liste oder uneinig -> es wird NICHT signiert. Es
// gibt keinen Rueckfall auf eine eingebaute Zahl: der wuerde nach dem
// Stichtag still mit 1926 signieren.
//
// Kein Zwischenspeicher: rund um den Stichtag muss jede Unterschrift den
// Stand von jetzt sehen.

import { getStatus } from './api';
import { RPC_FALLBACKS, RPC_URL } from './config';
import { fetchMitFrist } from './frist';
import { chainIdAusHex, inWechselPause, kettenStandAusStatus } from './kette';

export const KETTE_NICHT_BESTAETIGT =
  'Aequitas-Netz nicht bestätigt (Chain-ID vom Knoten fehlt oder ist unbekannt) — nichts unterschrieben. Bitte gleich erneut versuchen.';

export const WECHSEL_PAUSE_MELDUNG =
  'Das Aequitas-Netz wechselt gerade seine Chain-ID. Überweisungen sind für einige Minuten pausiert — bitte danach erneut versuchen.';

/** Hoechstens so viele RPC-Knoten je Abfrage (RPC_URL + Ausweichknoten). */
const MAX_RPC_KNOTEN = 4;
/** Eine eth_chainId-Antwort ist winzig; mehr wird nicht gelesen. */
const MAX_RPC_ANTWORT = 4096;

/** eth_chainId des ersten antwortenden RPC-Knotens, geprueft; sonst null. */
export async function rpcChainId(urls: readonly string[] = [RPC_URL, ...RPC_FALLBACKS]): Promise<number | null> {
  for (const url of urls.slice(0, MAX_RPC_KNOTEN)) {
    let text: string;
    try {
      const res = await fetchMitFrist(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      });
      if (!res.ok) return null; // eine Antwort, aber keine brauchbare
      text = await res.text();
    } catch {
      continue; // keine Antwort: naechster Knoten
    }
    if (text.length > MAX_RPC_ANTWORT) return null;
    try {
      const j = JSON.parse(text);
      return chainIdAusHex(j?.result);
    } catch {
      return null;
    }
  }
  return null;
}

export type Quellen = {
  status?: () => Promise<unknown>;
  rpc?: () => Promise<number | null>;
  jetztS?: () => number;
};

/**
 * Die Chain-ID, mit der jetzt signiert werden darf. Wirft, wenn sie nicht
 * sicher feststeht. `ueberweisung`: zusaetzlich die Pause vor dem Stichtag
 * beachten (dann nimmt der Knoten keine Ueberweisung an).
 */
export async function signierChainId(o: { ueberweisung?: boolean } & Quellen = {}): Promise<number> {
  const statusLesen = o.status ?? getStatus;
  const rpcLesen = o.rpc ?? (() => rpcChainId());
  let status: unknown;
  let rpc: number | null;
  try {
    [status, rpc] = await Promise.all([statusLesen(), rpcLesen()]);
  } catch {
    throw new Error(KETTE_NICHT_BESTAETIGT);
  }
  const stand = kettenStandAusStatus(status);
  if (!stand || rpc === null || rpc !== stand.chainId) throw new Error(KETTE_NICHT_BESTAETIGT);
  const jetzt = (o.jetztS ?? (() => Math.floor(Date.now() / 1000)))();
  if (o.ueberweisung && inWechselPause(stand, jetzt)) throw new Error(WECHSEL_PAUSE_MELDUNG);
  return stand.chainId;
}
