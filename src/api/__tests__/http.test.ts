import { ApiError, parseRetryAfter } from '../errors';
import { _setCandidatesForTest, request } from '../http';

type Antwort = { status: number; body?: unknown; headers?: Record<string, string> } | 'netz';

function fetchFolge(antworten: Antwort[]) {
  const aufrufe: string[] = [];
  global.fetch = jest.fn(async (url: RequestInfo | URL) => {
    aufrufe.push(String(url));
    const a = antworten.shift();
    if (!a || a === 'netz') throw new TypeError('Network request failed');
    return new Response(a.body === undefined ? '' : JSON.stringify(a.body), {
      status: a.status,
      headers: a.headers,
    });
  }) as unknown as typeof fetch;
  return aufrufe;
}

const schlafen: number[] = [];
const sleep = async (ms: number) => {
  schlafen.push(ms);
};

beforeEach(() => {
  _setCandidatesForTest(['https://a.test/api', 'https://b.test/api']);
  schlafen.length = 0;
});

describe('Retry-After', () => {
  it('Sekunden und Datum, gedeckelt auf 5 min', () => {
    expect(parseRetryAfter('10')).toBe(10_000);
    expect(parseRetryAfter('99999')).toBe(300_000);
    expect(parseRetryAfter(new Date(1_000_000 + 7_000).toUTCString(), 1_000_000)).toBe(7_000);
    expect(parseRetryAfter('quatsch')).toBeUndefined();
  });

  it('GET wartet nach Retry-After und versucht es erneut', async () => {
    fetchFolge([{ status: 429, headers: { 'retry-after': '3' } }, { status: 200, body: { ok: 1 } }]);
    const r = await request<{ ok: number }>('/status', { sleep });
    expect(r.data.ok).toBe(1);
    expect(schlafen).toEqual([3000]);
  });

  it('gibt nach hoechstens 3 Wiederholungen mit rateLimited auf', async () => {
    fetchFolge(Array(5).fill({ status: 429, headers: { 'retry-after': '1' } }));
    await expect(request('/status', { sleep })).rejects.toMatchObject({ kind: 'rateLimited', retryAfterMs: 1000 });
    expect(schlafen).toHaveLength(3);
  });
});

describe('signierte Auftraege', () => {
  it('POST wird bei 503 NICHT automatisch wiederholt', async () => {
    const aufrufe = fetchFolge([{ status: 503, headers: { 'retry-after': '5' } }, { status: 200, body: {} }]);
    await expect(request('/swap', { method: 'POST', body: { x: 1 }, sleep })).rejects.toMatchObject({
      kind: 'unavailable',
      retryAfterMs: 5000,
    });
    expect(aufrufe).toHaveLength(1);
  });
});

describe('Knotenwahl und Bindung', () => {
  it('wechselt bei einem Netzfehler auf den naechsten Knoten', async () => {
    const aufrufe = fetchFolge(['netz', { status: 200, body: { h: 1 } }]);
    const r = await request('/status');
    expect(aufrufe).toEqual(['https://a.test/api/status', 'https://b.test/api/status']);
    expect(r.node).toBe('https://b.test/api');
  });

  it('gebunden (prove -> register): wiederholt EINMAL am selben Knoten statt zu wechseln', async () => {
    const aufrufe = fetchFolge(['netz', { status: 200, body: { success: true } }]);
    await request('/register', { method: 'POST', body: {}, node: 'https://b.test/api' });
    expect(aufrufe).toEqual(['https://b.test/api/register', 'https://b.test/api/register']);
  });
});

describe('Fehlerarten', () => {
  it('fachliche Ablehnung mit HTTP 200 wird rejected, mit Code', async () => {
    fetchFolge([{ status: 200, body: { success: false, message: 'insufficient AEQ balance', code: 'deckung' } }]);
    await expect(request('/swap', { method: 'POST', body: {} })).rejects.toMatchObject({
      kind: 'rejected',
      message: 'insufficient AEQ balance',
      code: 'deckung',
    });
  });

  it('Antwort ohne JSON ist invalidResponse, nicht ein roher SyntaxError', async () => {
    global.fetch = jest.fn(async () => new Response('<html>502</html>', { status: 200 })) as unknown as typeof fetch;
    await expect(request('/status', { retry: false })).rejects.toBeInstanceOf(ApiError);
    await expect(request('/status', { retry: false })).rejects.toMatchObject({ kind: 'invalidResponse' });
  });

  it('Timeout wird als timeout gemeldet', async () => {
    global.fetch = jest.fn(
      (_u: RequestInfo | URL, init?: RequestInit) =>
        new Promise((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('aborted')))),
    ) as unknown as typeof fetch;
    await expect(request('/status', { timeoutMs: 20, retry: false })).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('liest die Serverzeit aus dem Date-Kopf', async () => {
    fetchFolge([{ status: 200, body: {}, headers: { date: 'Wed, 30 Sep 2026 12:00:00 GMT' } }]);
    const r = await request('/status');
    expect(r.serverTime).toBe(Date.parse('2026-09-30T12:00:00Z'));
  });
});
