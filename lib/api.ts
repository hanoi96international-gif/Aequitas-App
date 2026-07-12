import { API_BASE } from './config';

async function apiGet<T>(path: string): Promise<T> {
  const r = await fetch(API_BASE + path);
  if (!r.ok) throw new Error(r.statusText);
  return r.json();
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(API_BASE + path, {
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

export async function requestProof(params: { bio: string; salt: string; wallet: string }): Promise<ProveResponse> {
  // Goes through the chain server's authenticated proxy (/api/prove), never
  // directly to the proof server — the proof server's own /prove requires a
  // CHAIN_SERVICE_TOKEN the app must not hold (see api.go's handleProveProxy).
  const r = await fetch(API_BASE + '/prove', {
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
