// Prüfung des IBM-Zugangs VOR dem Speichern (lib/quantenSPraepIbm.ts
// ibmZugangTesten, lib/quantenSPraepGeraet.ts ibmZugangPruefenUndSetzen):
// Anmeldung und Geräteliste gegen eine nachgebaute IBM. Gespeichert wird nur
// nach Erfolg; jede Ablehnung nennt ihren Grund; der Schlüssel steht in keiner
// Meldung.
jest.mock('expo-secure-store', () => ({}));
jest.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => new Uint8Array(n) }));
jest.mock('expo-file-system', () => ({ Directory: class {}, File: class {}, Paths: {} }));
jest.mock('../config', () => ({ API_BASE: 'https://knoten.test/api', API_FALLBACKS: [] }));

import { IAM_URL } from '../ibmQuantum';
import type { Speicher } from '../quantenSInhaberin';
import { ibmZugangPruefenUndSetzen } from '../quantenSPraepGeraet';
import { IBM_ZUGANG, IbmTestFehler, ibmZugangLesen, ibmZugangTesten } from '../quantenSPraepIbm';

const CRN = 'crn:v1:bluemix:public:quantum-computing:us-east:a/' + 'ab'.repeat(16) + ':' + '01234567-89ab-cdef-0123-456789abcdef::';
const SCHLUESSEL = 'GeheimerSchluessel_' + 'Z'.repeat(25);
const ZUGANG = { apiKey: SCHLUESSEL, crn: CRN };
const BACKENDS = 'https://quantum.cloud.ibm.com/api/v1/backends';
const GROSS = { name: 'ibm_gross', status: { name: 'online' }, queue_length: 4, qubits: 133 };
const KLEIN = { name: 'ibm_klein', status: { name: 'online' }, queue_length: 0, qubits: 5 };

interface Opt { iam?: number; backends?: number; geraete?: unknown[]; netzBei?: 'iam' | 'backends' }

function ibm(o: Opt = {}) {
  const aufrufe: { url: string; method?: string; body?: string }[] = [];
  const antwort = (s: number, x: unknown) => ({ status: s, text: async () => JSON.stringify(x) }) as unknown as Response;
  const f = (async (url: string, init: RequestInit = {}) => {
    aufrufe.push({ url, method: init.method, body: init.body as string | undefined });
    if (url === IAM_URL) {
      if (o.netzBei === 'iam') throw new TypeError('Network request failed');
      return antwort(o.iam ?? 200, { access_token: 'tok'.repeat(10), expires_in: 3600 });
    }
    if (url === BACKENDS) {
      if (o.netzBei === 'backends') throw new TypeError('Network request failed');
      return antwort(o.backends ?? 200, { devices: o.geraete ?? [KLEIN, GROSS] });
    }
    throw new Error('unerwartete Anfrage ' + url);
  }) as unknown as typeof fetch;
  return { f, aufrufe };
}

function speicher(): Speicher & { daten: Map<string, string> } {
  const daten = new Map<string, string>();
  return {
    daten,
    lesen: async (k) => daten.get(k) ?? null,
    schreiben: async (k, v) => void daten.set(k, v),
    loeschen: async (k) => void daten.delete(k),
  };
}

const umg = (f: typeof fetch, geheim = speicher()) => ({ fetchFn: f, jetzt: () => 1_000, geheim });

async function grund(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(IbmTestFehler);
    expect(String((e as Error).message)).not.toContain(SCHLUESSEL);
    return (e as IbmTestFehler).grund;
  }
  throw new Error('kein Fehler');
}

describe('IBM-Zugang prüfen, bevor er gespeichert wird', () => {
  test('guter Zugang: Anmeldung und Geräteliste, kein Auftrag (keine Rechenzeit), dann gespeichert', async () => {
    const i = ibm();
    const u = umg(i.f);
    expect(await ibmZugangPruefenUndSetzen(ZUGANG, u)).toEqual({ geraete: 1, bestes: 'ibm_gross' });
    expect(await ibmZugangLesen(u.geheim)).toEqual(ZUGANG);
    expect(i.aufrufe.map((a) => a.url)).toEqual([IAM_URL, BACKENDS]);
    expect(i.aufrufe.some((a) => a.method === 'POST' && a.url !== IAM_URL)).toBe(false);
  });

  test('Leerzeichen vom Kopieren stören nicht', async () => {
    const u = umg(ibm().f);
    await ibmZugangPruefenUndSetzen({ apiKey: ' ' + SCHLUESSEL + '\n', crn: ' ' + CRN }, u);
    expect(await ibmZugangLesen(u.geheim)).toEqual(ZUGANG);
  });

  test.each([
    ['IBM lehnt den Schlüssel ab (400)', { iam: 400 }, 'schluessel'],
    ['IBM lehnt den Schlüssel ab (401)', { iam: 401 }, 'schluessel'],
    ['IBM gestört bei der Anmeldung (503)', { iam: 503 }, 'netz'],
    ['kein Netz bei der Anmeldung', { netzBei: 'iam' }, 'netz'],
    ['Instanz gehört nicht zum Schlüssel (403)', { backends: 403 }, 'instanz'],
    ['Instanz unbekannt (404)', { backends: 404 }, 'instanz'],
    ['IBM gestört bei der Geräteliste (500)', { backends: 500 }, 'netz'],
    ['kein Netz bei der Geräteliste', { netzBei: 'backends' }, 'netz'],
    ['nur zu kleine Rechner', { geraete: [KLEIN] }, 'kein_geraet'],
    ['kein Rechner online', { geraete: [{ ...GROSS, status: { name: 'paused' } }] }, 'kein_geraet'],
    ['nur Nachbauten (Simulator)', { geraete: [] }, 'kein_geraet'],
  ] as [string, Opt, string][])('%s: richtiger Grund, nichts gespeichert', async (_n, o, erwartet) => {
    const u = umg(ibm(o).f);
    expect(await grund(ibmZugangPruefenUndSetzen(ZUGANG, u))).toBe(erwartet);
    expect(u.geheim.daten.has(IBM_ZUGANG)).toBe(false);
  });

  test('falsche Form: geht gar nicht erst an IBM, nichts gespeichert', async () => {
    const i = ibm();
    const u = umg(i.f);
    expect(await grund(ibmZugangPruefenUndSetzen({ apiKey: 'kurz', crn: CRN }, u))).toBe('form');
    expect(await grund(ibmZugangPruefenUndSetzen({ apiKey: SCHLUESSEL, crn: 'crn:v1:fremd' }, u))).toBe('form');
    expect(await grund(ibmZugangTesten({ apiKey: SCHLUESSEL + '"}', crn: CRN }, i.f, 0))).toBe('form');
    expect(i.aufrufe).toHaveLength(0);
    expect(u.geheim.daten.size).toBe(0);
  });

  test('ein alter Zugang bleibt, wenn ein neuer die Prüfung nicht besteht', async () => {
    const geheim = speicher();
    await ibmZugangPruefenUndSetzen(ZUGANG, umg(ibm().f, geheim));
    const anderer = { apiKey: 'B'.repeat(44), crn: CRN };
    expect(await grund(ibmZugangPruefenUndSetzen(anderer, umg(ibm({ iam: 400 }).f, geheim)))).toBe('schluessel');
    expect(await ibmZugangLesen(geheim)).toEqual(ZUGANG);
  });

  test('der Schlüssel geht nur an die Anmeldung von IBM, nie an die Geräteliste', async () => {
    const i = ibm();
    await ibmZugangTesten(ZUGANG, i.f, 0);
    expect(i.aufrufe[0].url).toBe(IAM_URL);
    expect(i.aufrufe[0].body).toContain(SCHLUESSEL);
    expect(i.aufrufe.slice(1).every((a) => !(a.body ?? '').includes(SCHLUESSEL))).toBe(true);
  });
});
