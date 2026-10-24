import { sichereAdresse } from '../config';
import { fetchMitFrist } from '../frist';

// Missbrauch (Beta-Pruefung 14.10.2026): eine Umgebungsvariable mit http://
// darf in einem Release-Build keinen Klartext-Endpunkt setzen.
describe('sichereAdresse', () => {
  it('nimmt https', () => {
    expect(sichereAdresse('https://aequitas.digital/api', false)).toBe('https://aequitas.digital/api');
  });
  it('weist http im Release ab, auch lokal', () => {
    expect(sichereAdresse('http://173.249.37.118:8080/api', false)).toBeNull();
    expect(sichereAdresse('http://localhost:8080', false)).toBeNull();
  });
  it('erlaubt http nur lokal und nur im Entwicklungsbuild', () => {
    expect(sichereAdresse('http://10.0.2.2:8080/api', true)).toBe('http://10.0.2.2:8080/api');
    expect(sichereAdresse('http://evil.example/api', true)).toBeNull();
    expect(sichereAdresse('http://localhost.evil.example', true)).toBeNull();
  });
  it('weist Unsinn und Leeres ab', () => {
    for (const v of ['', '   ', 'ftp://x', 'https://', 'javascript:alert(1)', undefined]) {
      expect(sichereAdresse(v as string | undefined, true)).toBeNull();
    }
  });

  // Missbrauch (24.10.2026): v1.12.3 wich auf proof2 aus (C2, IP neu
  // vergeben) -- mit Gesichtsaufnahmen. Abgeschaltete Server zaehlen nie,
  // in keiner Schreibweise.
  it('weist abgeschaltete Server ab, in jeder Schreibweise', () => {
    for (const v of [
      'https://proof2.aequitas.digital/coordinator',
      'https://proof2.aequitas.digital/api',
      'https://proof2.aequitas.digital/rpc',
      'https://PROOF2.Aequitas.Digital/api',
      'https://proof2.aequitas.digital./api',
      'https://proof2.aequitas.digital:443/api',
      'https://nutzer@proof2.aequitas.digital/api',
      'https://proof1.aequitas.digital@proof2.aequitas.digital/api',
      'https://x.proof2.aequitas.digital/api',
      'https://194.163.188.71/api',
      'https://173.249.37.118:8443/api',
      // Schreibweisen, die der URL-Parser von fetch auf denselben Host abbildet
      'https://proof2.aequitas.digital\\api',
      'https://proof2%2Eaequitas.digital/api',
      'https://ｐroof2.aequitas.digital/api',
      'https://3265510471/api',
      'https://0xc2a3bc47/api',
      'https://0xc2.163.188.71/api',
      'https://0194.163.188.71/api',
      'https://194.163.48199/api',
      'https://[::ffff:c2a3:bc47]/api',
    ]) {
      expect(sichereAdresse(v, false)).toBeNull();
      expect(sichereAdresse(v, true)).toBeNull();
    }
  });
  it('laesst die laufenden Server und aehnliche Namen durch', () => {
    for (const v of [
      'https://proof1.aequitas.digital/coordinator',
      'https://aequitas.digital/api',
      'https://proof2.aequitas.digital.example/api',
      'https://notproof2.aequitas.digital/api',
      'https://example.org/?r=proof2.aequitas.digital',
      'https://203.0.113.7/api',
      'https://proof1.aequitas.digital:8443/api',
    ]) {
      expect(sichereAdresse(v, false)).toBe(v);
    }
  });
});

describe('Ausweichlisten ohne abgeschaltete Server', () => {
  const ORIGINAL_ENV = process.env;
  beforeEach(() => { jest.resetModules(); process.env = { ...ORIGINAL_ENV }; });
  afterAll(() => { process.env = ORIGINAL_ENV; });

  it('nimmt proof2 aus allen drei Ausweichlisten, auch wenn die Bauvariablen es nennen', () => {
    process.env.EXPO_PUBLIC_COORDINATOR_FALLBACKS = 'https://proof2.aequitas.digital/coordinator';
    process.env.EXPO_PUBLIC_API_FALLBACKS = 'https://proof2.aequitas.digital/api, https://proof1.aequitas.digital/api';
    process.env.EXPO_PUBLIC_RPC_FALLBACKS = 'https://proof2.aequitas.digital/rpc';
    process.env.EXPO_PUBLIC_COORDINATOR_BASE = 'https://proof2.aequitas.digital/coordinator';
    const config = require('../config');
    expect(config.COORDINATOR_FALLBACKS).toEqual([]);
    expect(config.API_FALLBACKS).toEqual(['https://proof1.aequitas.digital/api']);
    expect(config.RPC_FALLBACKS).toEqual([]);
    expect(config.COORDINATOR_BASE).toBe('');
  });
});

describe('fetchMitFrist', () => {
  const echt = global.fetch;
  afterEach(() => { global.fetch = echt; jest.useRealTimers(); });

  it('bricht eine haengende Anfrage nach der Frist ab', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn((_u: unknown, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('abgebrochen')));
    })) as unknown as typeof fetch;
    const p = fetchMitFrist('https://x.test/a', {}, 1000);
    jest.advanceTimersByTime(1001);
    await expect(p).rejects.toThrow('abgebrochen');
  });

  it('reicht ein Signal des Aufrufers durch', async () => {
    let gesehen: AbortSignal | undefined;
    global.fetch = jest.fn((_u: unknown, init?: RequestInit) => {
      gesehen = init?.signal ?? undefined;
      return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('weg'))));
    }) as unknown as typeof fetch;
    const c = new AbortController();
    const p = fetchMitFrist('https://x.test/b', { signal: c.signal }, 60_000);
    c.abort();
    await expect(p).rejects.toThrow('weg');
    expect(gesehen?.aborted).toBe(true);
  });
});
