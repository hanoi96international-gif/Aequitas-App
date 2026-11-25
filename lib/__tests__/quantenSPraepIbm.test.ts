// Der IBM-Messer der Präparatorin (lib/quantenSPraepIbm.ts) gegen eine
// nachgebaute IBM-Schnittstelle (IAM, Geräte, Aufträge, Status, Ergebnis).
jest.mock('expo-secure-store', () => ({}));
jest.mock('expo-crypto', () => ({ getRandomBytes: () => new Uint8Array(0) }));
jest.mock('../config', () => ({ API_BASE: 'https://knoten.test/api' }));
import { IAM_URL, IbmFehler } from '../ibmQuantum';
import type { Speicher } from '../quantenSInhaberin';
import { IBM_ZUGANG, ibmMesser, ibmZugangLesen, ibmZugangSpeichern } from '../quantenSPraepIbm';

const CRN = 'crn:v1:bluemix:public:quantum-computing:us-east:a/' + 'ab'.repeat(16) + ':' + '01234567-89ab-cdef-0123-456789abcdef::';
const ZUGANG = { apiKey: 'A'.repeat(44), crn: CRN };
const BASIS = 'https://quantum.cloud.ibm.com/api/v1';

function speicher(): Speicher & { daten: Map<string, string>; geheimGeschrieben: string[] } {
  const daten = new Map<string, string>();
  const geheimGeschrieben: string[] = [];
  return {
    daten, geheimGeschrieben,
    lesen: async (k) => daten.get(k) ?? null,
    schreiben: async (k, v, g) => { daten.set(k, v); if (g) geheimGeschrieben.push(k); },
    loeschen: async (k) => void daten.delete(k),
  };
}

interface Ibm {
  f: typeof fetch;
  auftraege: { backend: string; kreise: number; crn: string }[];
  statusAbfragen: number;
}

/** IBM im Speicher. Die Ergebnisse sind die idealer Hardware für die gegebenen u, t, y. */
function ibm(u: number[], t: number[], y: number[], opt: { status?: string[]; geraete?: unknown[]; iam?: number } = {}): Ibm {
  const st: Ibm = { f: null as unknown as typeof fetch, auftraege: [], statusAbfragen: 0 };
  const statusFolge = opt.status ?? ['QUEUED', 'RUNNING', 'COMPLETED'];
  let kreisStart = 0;
  const antworten = (s: number, o: unknown) => ({ status: s, text: async () => JSON.stringify(o) }) as unknown as Response;
  st.f = (async (url: string, init: RequestInit) => {
    const h = (init.headers ?? {}) as Record<string, string>;
    if (url === IAM_URL) return antworten(opt.iam ?? 200, { access_token: 'tok'.repeat(10), expires_in: 3600 });
    if (url === `${BASIS}/backends`) {
      return antworten(200, { devices: opt.geraete ?? [
        { name: 'ibm_lang', status: { name: 'online' }, queue_length: 50, qubits: 156 },
        { name: 'ibm_klein', status: { name: 'online' }, queue_length: 0, qubits: 5 },
        { name: 'ibm_frei', status: { name: 'online' }, queue_length: 3, qubits: 133 },
      ] });
    }
    if (url === `${BASIS}/jobs` && init.method === 'POST') {
      const k = JSON.parse(init.body as string);
      st.auftraege.push({ backend: k.backend, kreise: k.params.pubs.length, crn: h['Service-CRN'] });
      return antworten(201, { id: `job${st.auftraege.length}abcdef` });
    }
    const m = /\/jobs\/(job(\d+)abcdef)(\/results)?$/.exec(url);
    if (m && !m[3]) {
      const s = statusFolge[Math.min(st.statusAbfragen++, statusFolge.length - 1)];
      return antworten(200, { state: { status: s } });
    }
    if (m && m[3]) {
      const a = st.auftraege[Number(m[2]) - 1];
      const results = [];
      for (let j = 0; j < a.kreise; j++) {
        const von = (kreisStart + j) * 16;
        let v = 0n;
        for (let i = von; i < Math.min(von + 16, u.length); i++) if ((u[i] === y[i] ? t[i] : 0) === 1) v |= 1n << BigInt(i - von);
        results.push({ data: { c: { samples: Array(5).fill('0x' + v.toString(16)) } } });
      }
      kreisStart += a.kreise;
      return antworten(200, { results });
    }
    throw new Error('unbekannt ' + url);
  }) as unknown as typeof fetch;
  return st;
}

const bits = (n: number, f: (i: number) => number) => Array.from({ length: n }, (_, i) => f(i));
const umg = (f: typeof fetch, uhr = { t: 0 }) => ({ fetchFn: f, jetzt: () => uhr.t, warten: async (ms: number) => void (uhr.t += ms) });

describe('IBM-Messer', () => {
  it('misst einen Abschnitt auf dem freien Gerät der eigenen Instanz (ideale Hardware)', async () => {
    const n = 40;
    const u = bits(n, (i) => i % 2), t = bits(n, (i) => (i * 3) % 2), y = bits(n, (i) => (i % 3 === 0 ? 1 : 0));
    const st = ibm(u, t, y);
    const x = await ibmMesser(ZUGANG, umg(st.f)).messen(u, t, y);
    expect(x).toEqual(u.map((ui, i) => (ui === y[i] ? t[i] : 0)));
    expect(st.auftraege).toEqual([{ backend: 'ibm_frei', kreise: 3, crn: CRN }]); // ibm_klein hat zu wenige Qubits
  });

  it('teilt große Abschnitte auf mehrere Aufträge auf (höchstens 64 Schaltkreise)', async () => {
    const n = 64 * 16 + 20;
    const u = bits(n, (i) => (i >> 1) % 2), t = bits(n, (i) => i % 2), y = bits(n, (i) => (i >> 1) % 2);
    const st = ibm(u, t, y, { status: ['COMPLETED'] });
    const x = await ibmMesser(ZUGANG, umg(st.f)).messen(u, t, y);
    expect(st.auftraege.map((a) => a.kreise)).toEqual([64, 2]);
    expect(x).toEqual(t); // Basis passt überall
  });

  it.each([['FAILED'], ['CANCELLED']])('bricht ab bei %s', async (s) => {
    const st = ibm([1], [1], [1], { status: ['QUEUED', s] });
    await expect(ibmMesser(ZUGANG, umg(st.f)).messen([1], [1], [1])).rejects.toThrow(s);
  });

  it('bricht nach der Frist ab, statt endlos zu warten', async () => {
    const st = ibm([1], [1], [1], { status: ['QUEUED'] });
    const uhr = { t: 0 };
    await expect(ibmMesser(ZUGANG, umg(st.f, uhr), { fristMs: 60_000, taktMs: 15_000 }).messen([1], [1], [1])).rejects.toThrow('Frist');
    expect(st.statusAbfragen).toBeLessThanOrEqual(6);
  });

  it('nimmt kein Gerät mit zu wenigen Qubits', async () => {
    const st = ibm([1], [1], [1], { geraete: [{ name: 'ibm_klein', status: { name: 'online' }, queue_length: 0, qubits: 5 }] });
    await expect(ibmMesser(ZUGANG, umg(st.f)).messen(bits(16, () => 1), bits(16, () => 1), bits(16, () => 1))).rejects.toThrow('kein freies Gerät');
    expect(st.auftraege).toHaveLength(0);
  });

  it('bricht ab, wenn IBM die Anmeldung verweigert', async () => {
    const st = ibm([1], [1], [1], { iam: 401 });
    await expect(ibmMesser(ZUGANG, umg(st.f)).messen([1], [1], [1])).rejects.toThrow('Anmeldung');
  });

  it('weist falsche Längen und gerade Schusszahl ab', async () => {
    const st = ibm([1], [1], [1]);
    let aufrufe = 0;
    const zaehlend = (async (...a: Parameters<typeof fetch>) => (aufrufe++, st.f(...a))) as typeof fetch;
    await expect(ibmMesser(ZUGANG, umg(zaehlend)).messen([1, 0], [1], [1])).rejects.toThrow('Längen');
    expect(aufrufe).toBe(0); // kein Weg zu IBM mit falschen Längen
    expect(() => ibmMesser(ZUGANG, umg(st.f), { schuesse: 4 })).toThrow('ungerade');
  });
});

describe('IBM-Messer: Fortsetzung (4c-4)', () => {
  const n = 40;
  const u = bits(n, (i) => i % 2), t = bits(n, (i) => (i * 3) % 2), y = bits(n, (i) => (i % 3 === 0 ? 1 : 0));
  const soll = u.map((ui, i) => (ui === y[i] ? t[i] : 0));

  it('merkt den IBM-Auftrag VOR dem Warten; nach Abbruch (Frist) setzt eine neue Runde ihn fort, ohne neu einzureichen', async () => {
    const folge = ['QUEUED'];
    const st = ibm(u, t, y, { status: folge });
    let gemerkt: (string | null)[] = [];
    let statusBeimMerken = -1;
    const fort = { jobs: [] as (string | null)[], merken: async (j: (string | null)[]) => { gemerkt = j; statusBeimMerken = st.statusAbfragen; } };
    const uhr = { t: 0 };
    await expect(ibmMesser(ZUGANG, umg(st.f, uhr), { fristMs: 60_000 }).messen(u, t, y, fort)).rejects.toThrow('Frist');
    expect(gemerkt).toEqual(['job1abcdef']);
    expect(statusBeimMerken).toBe(0); // gemerkt, bevor auch nur einmal gefragt wurde
    // Neue Runde (neuer Messer): derselbe Auftrag, IBM ist inzwischen fertig.
    folge.push('COMPLETED');
    let geraeteFragen = 0;
    const zaehlend = (async (url: string, init: RequestInit) => (url.endsWith('/backends') && geraeteFragen++, st.f(url, init))) as unknown as typeof fetch;
    const x = await ibmMesser(ZUGANG, umg(zaehlend, { t: 0 })).messen(u, t, y, { jobs: gemerkt, merken: async (j) => void (gemerkt = j) });
    expect(x).toEqual(soll);
    expect(st.auftraege).toHaveLength(1); // nichts neu eingereicht
    expect(geraeteFragen).toBe(0); // fortgesetzt braucht kein freies Gerät
  });

  it.each([['FAILED'], ['CANCELLED']])('%s: der Auftrag wird vergessen, die nächste Runde reicht neu ein', async (s) => {
    const folge = ['QUEUED', s];
    const st = ibm(u, t, y, { status: folge });
    let gemerkt: (string | null)[] = [];
    await expect(ibmMesser(ZUGANG, umg(st.f)).messen(u, t, y, { jobs: [], merken: async (j) => void (gemerkt = j) })).rejects.toThrow(s);
    expect(gemerkt).toEqual([null]);
    folge.push('COMPLETED');
    st.statusAbfragen = 2;
    const x = await ibmMesser(ZUGANG, umg(st.f)).messen(u, t, y, { jobs: gemerkt, merken: async (j) => void (gemerkt = j) });
    expect(st.auftraege).toHaveLength(2);
    expect(gemerkt).toEqual(['job2abcdef']);
    expect(x.length).toBe(n);
  });

  it('weist eine Fortsetzung mit mehr Aufträgen ab, als die Messung Teile hat', async () => {
    const st = ibm(u, t, y);
    await expect(ibmMesser(ZUGANG, umg(st.f)).messen(u, t, y, { jobs: ['job1abcdef', 'job2abcdef'], merken: async () => {} })).rejects.toThrow('Fortsetzung');
    expect(st.auftraege).toHaveLength(0);
  });

  it('eine unlesbare Kennung aus der Fortsetzung geht nie an IBM', async () => {
    const st = ibm(u, t, y);
    let netz = 0;
    const zaehlend = (async (url: string, init: RequestInit) => (url.includes('/jobs/') && netz++, st.f(url, init))) as unknown as typeof fetch;
    await expect(ibmMesser(ZUGANG, umg(zaehlend)).messen(u, t, y, { jobs: ['../boese'], merken: async () => {} })).rejects.toThrow('Kennung');
    expect(netz).toBe(0);
  });
});

describe('IBM-Zugang im Gerät', () => {
  it('speichert geheim und liest streng', async () => {
    const s = speicher();
    expect(await ibmZugangLesen(s)).toBeNull();
    await ibmZugangSpeichern(s, { apiKey: ' ' + ZUGANG.apiKey + ' ', crn: CRN });
    expect(s.geheimGeschrieben).toEqual([IBM_ZUGANG]);
    expect(await ibmZugangLesen(s)).toEqual(ZUGANG);
  });
  it('weist falsche Formen ab', async () => {
    const s = speicher();
    await expect(ibmZugangSpeichern(s, { apiKey: 'kurz', crn: CRN })).rejects.toThrow(IbmFehler);
    await expect(ibmZugangSpeichern(s, { apiKey: ZUGANG.apiKey, crn: 'crn:falsch' })).rejects.toThrow(IbmFehler);
    s.daten.set(IBM_ZUGANG, '{"apiKey":"x"}');
    await expect(ibmZugangLesen(s)).rejects.toThrow('beschädigt');
    s.daten.set(IBM_ZUGANG, JSON.stringify({ ...ZUGANG, extra: 1 }));
    await expect(ibmZugangLesen(s)).rejects.toThrow('beschädigt');
  });
});
