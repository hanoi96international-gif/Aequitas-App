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

// Welcher Knoten den letzten erfolgreichen /api/prove beantwortet hat.
//
// Die Klebrigkeit oben reicht dafuer NICHT. Sie sorgt dafuer, dass Aufrufe in
// der Regel denselben Knoten treffen -- aber ein Netzfehler in einem
// BELIEBIGEN anderen Aufruf (ein Kontostand, der im Hintergrund nachlaedt)
// wechselt den aktiven Knoten, und die Registrierung ginge dann an einen
// Knoten, der den Beweis nie gesehen hat. Die Kette lehnt sie ab, und der
// Mensch darf die Gesichtsaufnahme wiederholen.
//
// Der Beweis ist an den Knoten gebunden, der ihn ausgestellt hat
// (prove_provenance.go, nur im Arbeitsspeicher, 15 Minuten). Also wird er
// hier festgehalten und die Registrierung genau dorthin geschickt.
let proveKnoten: { base: string; since: number } | null = null;

// Etwas kuerzer als die 15 Minuten der Kette: laeuft die Notiz dort ab,
// waehrend wir noch auf sie zeigen, wuerde die Registrierung an einem Knoten
// scheitern, den wir bewusst festgehalten haben. Nach Ablauf gilt wieder die
// normale Auswahl -- der Beweis ist dann ohnehin wertlos.
const PROVE_BINDUNG_MS = 14 * 60 * 1000;

function proveKnotenGebunden(): string | null {
  if (!proveKnoten) return null;
  if (Date.now() - proveKnoten.since > PROVE_BINDUNG_MS) {
    proveKnoten = null;
    return null;
  }
  return proveKnoten.base;
}

/** Tests only. */
export function _proveKnotenFuerTest(): string | null {
  return proveKnoten?.base ?? null;
}

/** fetch against the active node; on a NETWORK failure (no response) switch
 * to the next node once and retry the same request there.
 *
 * `fest` bindet die Anfrage an einen Knoten. Dann wird bei einem Netzfehler
 * EINMAL auf demselben Knoten wiederholt statt zu wechseln: fuer eine
 * Registrierung ist der Wechsel kein Ausweg, sondern genau der Fehler --
 * der andere Knoten kennt den Beweis nicht. Eine Wiederholung am selben
 * Knoten ist dagegen die Rettung, die der Blip verlangt.
 *
 * Gibt auch zurueck, WELCHER Knoten geantwortet hat -- der Aufrufer von
 * /prove muss sich das merken. */
async function fetchApi(
  path: string,
  init?: RequestInit,
  fest?: string | null,
): Promise<{ res: Response; base: string }> {
  const base = fest ?? apiBase();
  try {
    return { res: await fetch(base + path, init), base };
  } catch (e) {
    if (fest) {
      return { res: await fetch(base + path, init), base };
    }
    const next = apiWechsel(base);
    if (!next) throw e;
    return { res: await fetch(next + path, init), base: next };
  }
}

async function apiGet<T>(path: string): Promise<T> {
  const { res } = await fetchApi(path);
  if (!res.ok) throw new Error(res.statusText);
  return res.json();
}

// A 429 from the node is "wait a moment", not "you failed". The node limits
// bursts per ADDRESS (x/humanity/keeper/ip_burst.go), and a group behind one
// address -- a phone carrier's CGNAT, one WiFi at a table -- shares that
// budget. Retrying here, after the wait the node asks for, turns a collision
// into a few seconds of patience instead of a redone face capture.
const RETRY_WAITS_MS = [4000, 8000, 12000];

async function fetchMitWartezeit(
  path: string,
  init: RequestInit,
  fest?: string | null,
): Promise<{ res: Response; base: string }> {
  let r = await fetchApi(path, init, fest);
  for (const wait of RETRY_WAITS_MS) {
    if (r.res.status !== 429) break;
    await new Promise((res) => setTimeout(res, wait));
    r = await fetchApi(path, init, fest ?? r.base);
  }
  return r;
}

async function apiPost<T>(path: string, body: unknown, fest?: string | null): Promise<T> {
  const { res: r } = await fetchMitWartezeit(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, fest);
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
  // Gestaffelter Zuschuss (grant_staffel.go in aequitas-chain). Fehlt, wenn
  // das Konto keine Staffel hat -- also fast immer.
  staffel?: Staffel | null;
}

export interface Staffel {
  rest_aeq: number;
  laeuft: boolean;
  erneuert_am: number;
  bis: number;
  tagesrate_aeq: number;
}

// Was der Coordinator nach bestandener Zweitpruefung bescheinigt
// (/erneuern -> erneuerung) -- unveraendert an die Kette weiterzureichen.
export interface LivenessRenewal {
  wallet: string;
  issued_at: number;
  signature: string;
  public_key: string;
}

export interface LivenessRenewalResponse {
  ok?: boolean;
  error?: string;
  frueh_ab?: number;
}

export function submitLivenessRenewal(renewal: LivenessRenewal) {
  return apiPost<LivenessRenewalResponse>('/liveness-renewal', renewal);
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
  const { res: r, base } = await fetchMitWartezeit('/prove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error || r.statusText);
  }
  // Ab hier ist die Registrierung an DIESEN Knoten gebunden -- er ist der
  // einzige, der weiss, dass dieser Nullifier durch die Gesichtspruefung kam.
  proveKnoten = { base, since: Date.now() };
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
  // An den Knoten, der den Beweis ausgestellt hat. Kein Ausweichknoten:
  // siehe proveKnoten.
  return apiPost<RegisterResult>('/register', params, proveKnotenGebunden());
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
