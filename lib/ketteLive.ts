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
import { FRIST_MS, fetchMitFrist } from './frist';
import { chainIdAusHex, inWechselPause, kettenStandAusStatus, passtZurUhr } from './kette';

export const KETTE_NICHT_BESTAETIGT =
  'Aequitas-Netz nicht bestätigt (Chain-ID vom Knoten fehlt oder ist unbekannt) — nichts unterschrieben. Bitte gleich erneut versuchen.';

export const WECHSEL_PAUSE_MELDUNG =
  'Das Aequitas-Netz wechselt gerade seine Chain-ID. Überweisungen sind für einige Minuten pausiert — bitte danach erneut versuchen.';

/** Hoechstens so viele RPC-Knoten je Abfrage (RPC_URL + Ausweichknoten). */
const MAX_RPC_KNOTEN = 4;
/** Eine eth_chainId-Antwort ist winzig; mehr wird nicht gelesen. */
const MAX_RPC_ANTWORT = 4096;

/** Die Zeitgrenze gilt fuer Anfrage UND Lesen des Bodys (fetchMitFrist
 * endet mit den Kopfzeilen). Laeuft sie ab: abbrechen und ablehnen. */
function mitFrist<T>(p: Promise<T>, ms: number, ctrl: AbortController): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      ctrl.abort();
      reject(new Error('Zeitgrenze'));
    }, ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

/**
 * Liest hoechstens `max` Byte. content-length wird vorab geprueft; liefert
 * die Laufzeit einen Strom (res.body.getReader), wird beim Ueberschreiten
 * abgebrochen. React Native liefert oft keinen Strom -- dann bleibt nur
 * text() mit der Grenze danach; die Zeitgrenze (mitFrist) begrenzt auch das.
 * Nur ASCII (eine eth_chainId-Antwort ist ASCII); sonst null.
 */
export async function leseBegrenzt(res: Response, max: number): Promise<string | null> {
  const cl = (res as any).headers?.get?.('content-length');
  if (cl !== null && cl !== undefined && cl !== '') {
    const n = Number(cl);
    if (!Number.isSafeInteger(n) || n < 0 || n > max) return null;
  }
  const body: any = (res as any).body;
  if (body && typeof body.getReader === 'function') {
    const leser = body.getReader();
    let text = '';
    let n = 0;
    for (;;) {
      const { done, value } = await leser.read();
      if (done) break;
      const teil: Uint8Array = value instanceof Uint8Array ? value : new Uint8Array(0);
      n += teil.length;
      if (n > max) {
        leser.cancel?.().catch?.(() => {});
        return null;
      }
      for (let i = 0; i < teil.length; i++) {
        if (teil[i] > 0x7f) {
          leser.cancel?.().catch?.(() => {});
          return null;
        }
        text += String.fromCharCode(teil[i]);
      }
    }
    return text;
  }
  const text = await res.text();
  return typeof text === 'string' && text.length <= max ? text : null;
}

/** eth_chainId des ersten antwortenden RPC-Knotens, geprueft; sonst null. */
export async function rpcChainId(
  urls: readonly string[] = [RPC_URL, ...RPC_FALLBACKS],
  fristMs: number = FRIST_MS,
): Promise<number | null> {
  for (const url of urls.slice(0, MAX_RPC_KNOTEN)) {
    const ctrl = new AbortController();
    let res: Response;
    try {
      res = await mitFrist(
        fetchMitFrist(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
          signal: ctrl.signal,
        }, fristMs),
        fristMs,
        ctrl,
      );
    } catch {
      continue; // keine Antwort: naechster Knoten
    }
    if (!res.ok) return null; // eine Antwort, aber keine brauchbare
    let text: string | null;
    try {
      text = await mitFrist(leseBegrenzt(res, MAX_RPC_ANTWORT), fristMs, ctrl);
    } catch {
      return null; // Body haengt oder bricht ab: nicht signieren
    }
    if (text === null) return null;
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
  /** Gesamtgrenze fuer beide Abfragen (auch fuer das Lesen der Antworten). */
  fristMs?: number;
};

/** Hoechstens so lange darf die ganze Feststellung der Chain-ID dauern. */
export const SIGNIER_CHAIN_ID_FRIST_MS = 30_000;

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
    [status, rpc] = await mitFrist(Promise.all([statusLesen(), rpcLesen()]), o.fristMs ?? SIGNIER_CHAIN_ID_FRIST_MS, new AbortController());
  } catch {
    throw new Error(KETTE_NICHT_BESTAETIGT);
  }
  const stand = kettenStandAusStatus(status);
  if (!stand || rpc === null || rpc !== stand.chainId) throw new Error(KETTE_NICHT_BESTAETIGT);
  const jetzt = (o.jetztS ?? (() => Math.floor(Date.now() / 1000)))();
  // Gegen die Geraeteuhr: 1926 deutlich nach dem Stichtag oder 19260930
  // deutlich davor ist eine veraltete oder gefaelschte Meldung.
  if (!passtZurUhr(stand, jetzt)) throw new Error(KETTE_NICHT_BESTAETIGT);
  if (o.ueberweisung && inWechselPause(stand, jetzt)) throw new Error(WECHSEL_PAUSE_MELDUNG);
  return stand.chainId;
}
