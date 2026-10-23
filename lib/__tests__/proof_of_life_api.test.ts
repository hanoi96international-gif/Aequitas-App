/**
 * /api/proof-of-life: eine 5xx der Kette (z. B. 503 waehrend die Annahme vor
 * der Grundeinkommensrunde kurz angehalten ist, Aequitas#412) ist ein Fehler
 * -- die App zeigt "nicht erreichbar" und bietet erneutes Senden derselben
 * Bescheinigung an. Eine 4xx bleibt eine Antwort (abgelehnt).
 */
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn() }));

const NACHWEIS = { wallet: '0x' + 'a'.repeat(40), issued_at: 1_800_000_000, signature: 'ab', public_key: 'cd' };

function antwort(status: number, body: unknown) {
  (global as any).fetch = jest.fn(async () => ({
    ok: status < 400, status, statusText: String(status), json: async () => body,
  }) as any);
}

describe('submitProofOfLife', () => {
  afterEach(() => { jest.resetModules(); (global as any).fetch = undefined; });

  async function senden() {
    let ergebnis: Promise<unknown> = Promise.resolve();
    await jest.isolateModulesAsync(async () => {
      const api = require('../api');
      api._setApiCandidatesForTest(['https://a.example/api']);
      ergebnis = api.submitProofOfLife(NACHWEIS);
    });
    return ergebnis;
  }

  it('503 (Annahme kurz angehalten) wirft -- erneut senden statt abgelehnt', async () => {
    antwort(503, { error: 'daily distribution is about to run -- please resend this proof of life in a minute' });
    await expect(senden()).rejects.toThrow('daily distribution');
  });

  it('500 ohne lesbaren Text wirft ebenfalls', async () => {
    (global as any).fetch = jest.fn(async () => ({ ok: false, status: 502, json: async () => { throw new SyntaxError('x'); } }) as any);
    await expect(senden()).rejects.toThrow('HTTP 502');
  });

  it('403 bleibt eine Antwort (abgelehnt), 200 ebenso', async () => {
    antwort(403, { error: 'invalid proof-of-life attestation' });
    await expect(senden()).resolves.toEqual({ error: 'invalid proof-of-life attestation' });
    antwort(200, { ok: true, wallet: NACHWEIS.wallet });
    await expect(senden()).resolves.toEqual({ ok: true, wallet: NACHWEIS.wallet });
  });

  it('die Deutung: geworfen -> nicht_erreichbar mit Knopf, Antwort mit error -> abgelehnt', async () => {
    jest.resetModules();
    jest.doMock('../api', () => ({ submitProofOfLife: jest.fn(async () => { throw new Error('daily distribution'); }) }));
    jest.doMock('expo-crypto', () => ({ randomUUID: () => 'x' }));
    jest.doMock('expo-file-system/legacy', () => ({ deleteAsync: jest.fn() }), { virtual: true });
    jest.doMock('../attestation', () => ({ attestierungAnhaengen: async () => undefined }));
    const { lebensnachweisAnKette } = require('../biometricIdentity');
    const k = await lebensnachweisAnKette(NACHWEIS);
    expect(k.kette).toBe('nicht_erreichbar');
    jest.dontMock('../api');
  });
});
