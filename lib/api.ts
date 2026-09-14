import { API_BASE, API_FALLBACKS } from './config';

// ---------------------------------------------------------------------------
// Which node. API_BASE first, then API_FALLBACKS. The choice is STICKY for a
// quarter hour: the node only accepts a registration whose proof came from
// ITS OWN /api/prove (x/humanity/keeper/prove_provenance.go, 15 min), so
// prove and register must reach the same node. A base is dropped only when a
// request to it fails at the network level (no answer at all) -- an HTTP
// error is an answer, and the node that gave it is the one to keep talking to.
// ---------------------------------------------------------------------------
const API_STICKY_MS = 15 * 60 * 1000;
let activeApi: { base: string; since: number } | null = null;

export function apiCandidatesFrom(base: string | undefined, fallbacks: readonly string[]): string[] {
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

// Tests only: EXPO_PUBLIC_* is inlined at transform time, so a test cannot
// steer the candidates through process.env (learned the hard way, 2026-09-13).
let candidateOverride: string[] | null = null;
export function _setApiCandidatesForTest(list: string[] | null): void {
  candidateOverride = list;
  activeApi = null;
}

export function apiCandidates(): string[] {
  return candidateOverride ?? apiCandidatesFrom(API_BASE, API_FALLBACKS);
}

function apiBase(): string {
  const c = apiCandidates();
  if (c.length === 0) return API_BASE;
  if (activeApi && Date.now() - activeApi.since < API_STICKY_MS && c.includes(activeApi.base)) {
    return activeApi.base;
  }
  activeApi = { base: c[0], since: Date.now() };
  return c[0];
}

function apiWechsel(kaputt: string): string | null {
  const c = apiCandidates();
  const next = c.find((b) => b !== kaputt);
  if (!next) return null;
  activeApi = { base: next, since: Date.now() };
  return next;
}

/** fetch against the active node; on a NETWORK failure (no response) switch
 * to the next node once and retry the same request there. */
async function fetchApi(path: string, init?: RequestInit): Promise<Response> {
  const base = apiBase();
  try {
    return await fetch(base + path, init);
  } catch (e) {
    const next = apiWechsel(base);
    if (!next) throw e;
    return fetch(next + path, init);
  }
}

async function apiGet<T>(path: string): Promise<T> {
  const r = await fetchApi(path);
  if (!r.ok) throw new Error(r.statusText);
  return r.json();
}

// A 429 from the node is "wait a moment", not "you failed". The node limits
// bursts per ADDRESS (x/humanity/keeper/ip_burst.go), and a group behind one
// address -- a phone carrier's CGNAT, one WiFi at a table -- shares that
// budget. Retrying here, after the wait the node asks for, turns a collision
// into a few seconds of patience instead of a redone face capture.
const RETRY_WAITS_MS = [4000, 8000, 12000];

async function fetchMitWartezeit(path: string, init: RequestInit): Promise<Response> {
  let r = await fetchApi(path, init);
  for (const wait of RETRY_WAITS_MS) {
    if (r.status !== 429) break;
    await new Promise((res) => setTimeout(res, wait));
    r = await fetchApi(path, init);
  }
  return r;
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const r = await fetchMitWartezeit(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  // FIX (Monster Audit follow-up, 2026-07-12, P2): unlike apiGet, this never
  // checked anything before parsing — deliberately NOT an r.ok check, since
  // the chain server's own business-logic failures are well-formed JSON on
  // HTTP 200 ({success:false, message}) or 429 (rate limiting, same shape),
  // both already handled by every caller's own `if (!d.success) throw ...`.
  // The actual gap was purely infra-layer failures in front of the app
  // server (proxy/CDN 502/504/413, a WAF block page) returning a non-JSON
  // body — r.json() would throw a raw, confusing SyntaxError instead of a
  // message a user-facing catch block can display sensibly.
  try {
    return await r.json();
  } catch {
    throw new Error(`Request failed (HTTP ${r.status})`);
  }
}

export interface ChainStatus {
  height: number;
  total_humans: number;
  total_supply: string;
  index: number;
  gini: number;
  velocity: number;
  growth: number;
  pool_ubi: string;
  pool_treasury: string;
  pool_validators: string;
  pool_lp?: string;
  phase: number;
  ubi_next_payout_secs: number;
  block_time?: number;
  latest_hash?: string;
}

export interface CanonicalBlock {
  height: number;
  timestamp: number;
  hash: string;
  proposer: string;
  humans: number;
  blue_score: number;
  blues?: string[];
  parent_hashes?: string[];
}

export function getCanonicalBlocks(limit = 12) {
  return apiGet<CanonicalBlock[]>('/blocks/canonical?limit=' + limit);
}

export interface BalanceResponse {
  balance: number;
  tusd_balance: number;
  demurrage_active: boolean;
  is_human: boolean;
}

export interface PricePoint {
  t: number;
  p: number;
}

export interface PoolResponse {
  reserve_aeq: string;
  reserve_tusd: string;
  price_aeq_in_tusd: number;
}

export function getStatus() {
  return apiGet<ChainStatus>('/status');
}

export function getBalance(wallet: string) {
  return apiGet<BalanceResponse>('/balance?wallet=' + wallet);
}

export async function getPriceHistory(): Promise<PricePoint[]> {
  const d = await apiGet<any>('/price-history');
  const raw = Array.isArray(d) ? d : d?.history ?? [];
  return raw.map((p: any) => ({ t: p.t ?? p.timestamp ?? 0, p: p.p ?? p.price ?? 0 }));
}

export function getPool() {
  return apiGet<PoolResponse>('/pool');
}

export async function getNonce(wallet: string): Promise<number> {
  const d = await apiGet<{ nonce: number }>('/nonce?wallet=' + wallet);
  return d.nonce;
}

export interface SwapResult {
  success: boolean;
  message?: string;
}

export function postSwap(params: {
  wallet: string;
  direction: 'aeq_to_tusd' | 'tusd_to_aeq';
  amount: number;
  nonce: number;
  timestamp: number;
  signature: string;
  min_amount_out: number;
}) {
  return apiPost<SwapResult>('/swap', params);
}

export function postFaucet(params: { wallet: string; timestamp: number; signature: string }) {
  return apiPost<SwapResult>('/faucet', params);
}

export interface LPPosition {
  shares: number;
  total_shares: number;
  pool_share_pct: number;
  withdrawable_aeq: number;
  withdrawable_tusd: number;
}

export function getLPPosition(wallet: string) {
  return apiGet<LPPosition>('/lp-position?wallet=' + wallet);
}

export interface LiquidityResult {
  success: boolean;
  message?: string;
  amount_aeq?: number;
  amount_tusd?: number;
}

export function postAddLiquidity(params: {
  wallet: string;
  amount_aeq: number;
  amount_tusd: number;
  nonce: number;
  timestamp: number;
  signature: string;
}) {
  return apiPost<LiquidityResult>('/add-liquidity', params);
}

export function postRemoveLiquidity(params: {
  wallet: string;
  shares: number;
  nonce: number;
  timestamp: number;
  signature: string;
}) {
  return apiPost<LiquidityResult>('/remove-liquidity', params);
}

export interface ProveResponse {
  pA: any;
  pB: any;
  pC: any;
  pubSignals: string[];
  zkNullifier: string;
  circuitVersion: number;
  bioHashKey?: string;
}

export async function requestProof(params: {
  bio: string;
  salt: string;
  wallet: string;
  // Passed straight through from the coordinator's /register response. The
  // proof server rebuilds `domain|bio|wallet|issuedAt` and checks the
  // signature against COORDINATOR_PUBLIC_KEYS, so both values must arrive
  // exactly as issued -- re-deriving issuedAt here would invalidate every
  // signature.
  //
  // Omitted for the device-secret identity flow, which has no coordinator
  // and therefore no attestation. That path keeps working as long as the
  // proof server runs in BIO_ATTESTATION_MODE=off or optional; switching it
  // to required retires the device-secret flow, which is a product decision,
  // not a deployment detail.
  bioAttestation?: string | null;
  bioAttestationIssuedAt?: number | null;
  // WP 2 (staged grant): the coordinator's signed grant class, forwarded
  // verbatim. The proof server verifies the signature; the chain reads the
  // class from its own /prove provenance note -- never from the app.
  grantClass?: string | null;
  grantClassSignature?: string | null;
}): Promise<ProveResponse> {
  // Goes through the chain server's authenticated proxy (/api/prove), never
  // directly to the proof server — the proof server's own /prove requires a
  // CHAIN_SERVICE_TOKEN the app must not hold (see api.go's handleProveProxy).
  // The proxy forwards the body verbatim (it only peeks at `wallet` for its
  // own per-wallet throttle), so these two fields reach the proof server
  // without any chain-side change.
  const r = await fetchMitWartezeit('/prove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error || r.statusText);
  }
  return r.json();
}

export interface RegisterResult {
  success: boolean;
  message?: string;
  wallet?: string;
  balance?: number;
}

export function postRegister(params: {
  wallet: string;
  pA: any;
  pB: any;
  pC: any;
  pubSignals: string[];
  signature: string;
  bioHash: string;
  bioHashKey: string;
  nullifier: string;
  circuitVersion: number;
  zkNullifier: string;
}) {
  return apiPost<RegisterResult>('/register', params);
}

export interface RegistrationCheckResult {
  registered: boolean;
  is_human?: boolean;
  wallet?: string;
  balance?: number;
  biometric_in_use?: boolean;
}

export function checkRegistrationByBioHash(bioHash: string) {
  return apiPost<RegistrationCheckResult>('/check-registration-by-biohash', { bioHash });
}
