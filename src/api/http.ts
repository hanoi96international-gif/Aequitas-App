import { API_BASE, API_FALLBACKS } from '@/lib/config';

import { ApiError, kindForStatus, parseRetryAfter } from './errors';

// HTTP-Client des Neubaus (docs/NEUBAU_ANALYSE.md 3.2/3.4).
//
// Uebernommen aus lib/api.ts (dort ueber viele Audits gehaertet):
//   - Knotenwahl: API_BASE zuerst, dann API_FALLBACKS; die Wahl bleibt
//     15 Minuten bestehen und wechselt nur bei einem NETZfehler.
//   - Bindung: ein Aufruf mit `node` geht genau an diesen Knoten (prove ->
//     register, prove_provenance.go); bei einem Netzfehler wird dort EINMAL
//     wiederholt statt gewechselt.
// Neu:
//   - Timeout je Aufruf (AbortController).
//   - Fehler als ApiError mit kind, Status, Retry-After und Kettencode.
//   - 429/503 werden nach Retry-After (hoechstens 3x) wiederholt -- aber nur
//     fuer idempotente Aufrufe. Signierte Auftraege (POST mit Nonce) nie: sie
//     werden nach Bestaetigung neu signiert, nicht blind erneut geschickt.
//   - Fachliche Ablehnung ({success:false, message}) wird zu 'rejected'.

const STICKY_MS = 15 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 3;
const FALLBACK_WAITS_MS = [4000, 8000, 12000];

let active: { base: string; since: number } | null = null;
let candidatesOverride: string[] | null = null;

export function candidatesFrom(base: string | undefined, fallbacks: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [base, ...fallbacks]) {
    const b = (raw ?? '').trim().replace(/\/+$/, '');
    if (b && !seen.has(b)) {
      seen.add(b);
      out.push(b);
    }
  }
  return out;
}

export function candidates(): string[] {
  return candidatesOverride ?? candidatesFrom(API_BASE, API_FALLBACKS);
}

/** Nur Tests. */
export function _setCandidatesForTest(list: string[] | null): void {
  candidatesOverride = list;
  active = null;
}

export function currentNode(): string {
  const c = candidates();
  if (active && Date.now() - active.since < STICKY_MS && c.includes(active.base)) return active.base;
  active = { base: c[0] ?? API_BASE, since: Date.now() };
  return active.base;
}

function switchFrom(broken: string): string | null {
  const next = candidates().find((b) => b !== broken);
  if (!next) return null;
  active = { base: next, since: Date.now() };
  return next;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  /** An genau diesen Knoten binden (prove -> register). */
  node?: string | null;
  timeoutMs?: number;
  /** Nur fuer idempotente Aufrufe true (Standard: GET ja, POST nein). */
  retry?: boolean;
  signal?: AbortSignal;
  /** Test-Haken: wartet statt setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

export interface ApiResponse<T> {
  data: T;
  node: string;
  /** Serverzeit aus dem Date-Kopf (fuer den Uhrabgleich). */
  serverTime?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, outer?: AbortSignal): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onOuter = () => ctrl.abort();
  outer?.addEventListener('abort', onOuter);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    if (ctrl.signal.aborted && !outer?.aborted) throw new ApiError('timeout', `timeout after ${timeoutMs} ms`);
    throw new ApiError('network', e instanceof Error ? e.message : String(e));
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onOuter);
  }
}

/** Ein Versuch gegen einen Knoten; Netzfehler wechseln (ungebunden) oder wiederholen (gebunden) einmal. */
async function attempt(path: string, init: RequestInit, opts: RequestOptions): Promise<{ res: Response; node: string }> {
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const node = opts.node ?? currentNode();
  try {
    return { res: await fetchWithTimeout(node + path, init, timeout, opts.signal), node };
  } catch (e) {
    if (!(e instanceof ApiError) || e.kind !== 'network') throw e;
    if (opts.node) {
      return { res: await fetchWithTimeout(node + path, init, timeout, opts.signal), node };
    }
    const next = switchFrom(node);
    if (!next) throw e;
    return { res: await fetchWithTimeout(next + path, init, timeout, opts.signal), node: next };
  }
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function rejectionFrom(body: unknown): { message: string; code?: string } | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (b.success === false || typeof b.error === 'string') {
    const message = String(b.message ?? b.error ?? 'rejected');
    const code = typeof b.code === 'string' ? b.code : undefined;
    return { message, code };
  }
  return null;
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<ApiResponse<T>> {
  const method = opts.method ?? 'GET';
  const retry = opts.retry ?? method === 'GET';
  const sleep = opts.sleep ?? defaultSleep;
  const init: RequestInit = {
    method,
    headers: opts.body !== undefined ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  };

  let lastErr: ApiError | undefined;
  const boundNode = opts.node ?? null;
  for (let i = 0; i <= (retry ? MAX_RETRIES : 0); i++) {
    const { res, node } = await attempt(path, init, { ...opts, node: boundNode });
    const body = await readJson(res);
    const date = res.headers.get('date');
    const serverTime = date ? Date.parse(date) : undefined;

    if (res.ok) {
      const rej = rejectionFrom(body);
      if (rej) throw new ApiError('rejected', rej.message, { status: res.status, code: rej.code });
      if (body === undefined) throw new ApiError('invalidResponse', `HTTP ${res.status} without JSON body`, { status: res.status });
      return { data: body as T, node, serverTime: Number.isNaN(serverTime) ? undefined : serverTime };
    }

    const kind = kindForStatus(res.status);
    const rej = rejectionFrom(body);
    const retryAfterMs = parseRetryAfter(res.headers.get('retry-after'));
    lastErr = new ApiError(kind, rej?.message ?? `HTTP ${res.status}`, { status: res.status, retryAfterMs, code: rej?.code });
    if (!retry || !lastErr.transient || i === MAX_RETRIES) throw lastErr;
    await sleep(retryAfterMs ?? FALLBACK_WAITS_MS[Math.min(i, FALLBACK_WAITS_MS.length - 1)]);
  }
  throw lastErr ?? new ApiError('network', 'unreachable');
}

export const api = {
  get: <T>(path: string, opts?: Omit<RequestOptions, 'method' | 'body'>) => request<T>(path, { ...opts, method: 'GET' }),
  post: <T>(path: string, body: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'POST', body }),
};
