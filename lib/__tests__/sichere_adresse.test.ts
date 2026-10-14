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
