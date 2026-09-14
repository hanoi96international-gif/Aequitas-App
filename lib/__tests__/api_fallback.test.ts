/**
 * Ausweichknoten: ein Netzfehler beim aktiven Knoten wechselt einmal zum
 * naechsten und wiederholt dieselbe Anfrage dort; eine HTTP-Antwort (auch ein
 * Fehler) ist KEIN Grund zu wechseln -- prove und register muessen denselben
 * Knoten treffen (prove_provenance.go).
 */
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn() }), { virtual: true });

describe('api fallback', () => {
  const OLD = { ...process.env };
  afterEach(() => { process.env = { ...OLD }; jest.resetModules(); (global as any).fetch = undefined; });

  it('wechselt bei einem Netzfehler einmal und bleibt dann dort', async () => {
    const calls: string[] = [];
    (global as any).fetch = jest.fn(async (url: string) => {
      calls.push(url);
      if (url.startsWith('https://a.example')) throw new TypeError('Network request failed');
      return { ok: true, status: 200, json: async () => ({ ok: true, url }) } as any;
    });
    await jest.isolateModules(async () => {
      const api = require('../api');
      expect(api.apiCandidatesFrom('https://a.example/api/', [' https://b.example/api ', 'https://a.example/api'])).toEqual(['https://a.example/api', 'https://b.example/api']);
      api._setApiCandidatesForTest(['https://a.example/api', 'https://b.example/api']);
      const { getBalance } = api;
      const b = await getBalance('0x00');
      expect(b.url).toBe('https://b.example/api/balance?wallet=0x00');
      const b2 = await getBalance('0x01');
      expect(b2.url).toBe('https://b.example/api/balance?wallet=0x01');
    });
    // a einmal versucht, danach nur noch b
    expect(calls.filter((u) => u.startsWith('https://a.example')).length).toBe(1);
  });

  it('eine HTTP-Antwort ist kein Wechselgrund', async () => {
    const calls: string[] = [];
    (global as any).fetch = jest.fn(async (url: string) => {
      calls.push(url);
      return { ok: false, status: 500, statusText: 'boom', json: async () => ({}) } as any;
    });
    await jest.isolateModules(async () => {
      const api = require('../api');
      api._setApiCandidatesForTest(['https://a.example/api', 'https://b.example/api']);
      await expect(api.getBalance('0x00')).rejects.toThrow();
    });
    expect(calls.every((u) => u.startsWith('https://a.example'))).toBe(true);
  });
});
