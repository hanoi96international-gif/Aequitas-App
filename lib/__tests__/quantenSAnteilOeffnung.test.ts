// Oeffnung aus t Anteilen (R9, lib/quantenSStelle.ts) gegen den Pruefvektor des
// Knotens (x/humanity/keeper/quanten_s_anteil_oeffnung_vektor_test.go): Pakete
// lesen, aus t zusammensetzen, gegen Blatt und Stellen-Bit pruefen -- wie
// quantenSAusAnteilenLaden. Dazu der Weg ueber das Netz mit einem
// ausgefallenen Praeparator und die Angriffe.
jest.mock('expo-secure-store', () => ({}));
jest.mock('expo-crypto', () => ({ getRandomBytes: () => new Uint8Array(0) }));
jest.mock('../config', () => ({ API_BASE: 'https://knoten.test/api' }));

import vektor from './vektoren/quanten_s_anteil_oeffnung_vektor.json';
import type { Umgebung } from '../quantenSInhaberin';
import { anteilPaketLesen, ausAnteilenLaden, ausAnteilenZusammensetzen, pruefsumme, zusammensetzen, type AnteilPaket } from '../quantenSStelle';

const V = vektor as any;
const SCHL = V.stelle_schluessel_nur_test;
const lesen = (j: number, c: string = V.pakete[String(j)]) => anteilPaketLesen(SCHL, c, V.k, V.b, V.praeparator, j, V.von, V.bis);
const blaetter: string[] = Array.from({ length: V.n }, (_, i) => V.blaetter[String(i)] ?? '00'.repeat(32));
const pruefen = (werte: Map<number, bigint>) => {
  for (const [i, w] of werte) {
    if (pruefsumme(V.k, i, w) !== blaetter[i] || Number((w >> 2n) & 1n) !== V.b) throw new (require('../quantenS').QuantenSFehler)(`Stelle ${i}`);
  }
};
const soll = new Map<number, bigint>(Object.entries(V.werte).map(([i, h]) => [Number(i), BigInt('0x' + (h as string))]));

describe('Oeffnung aus t Anteilen: Rechnung wie der Knoten', () => {
  it('Pakete lesen: Anteile genau der Stellen dieser Stelle, mit Salz', () => {
    for (const j of [1, 3, 4]) {
      const p = lesen(j);
      expect(p.salz).toBe(V.salz);
      expect([...p.anteile.keys()].sort((a, b) => a - b)).toEqual([...soll.keys()].sort((a, b) => a - b));
    }
  });

  it('aus drei Paketen genau die Werte des Knotens; jeder passt zu seinem Blatt', () => {
    const r = ausAnteilenZusammensetzen([lesen(1), lesen(3), lesen(4)], V.t, pruefen);
    expect(r.salz).toBe(V.salz);
    expect(r.werte).toEqual(soll);
  });

  it('Lagrange wie quantenWZusammensetzen (Probe mit einem festen Polynom)', () => {
    // f(x) = 7 + 3x + 5x^2 mod P
    const f = (x: number) => 7n + 3n * BigInt(x) + 5n * BigInt(x) * BigInt(x);
    expect(zusammensetzen([1, 3, 4].map((x) => ({ x, y: f(x) })))).toBe(7n);
  });

  it('Angriffe beim Lesen werden abgewiesen', () => {
    expect(() => lesen(3, V.paket_andere_stelle)).toThrow();
    expect(() => lesen(3, V.paket_anteil_zu_gross)).toThrow('Anteil an Stelle');
    expect(() => anteilPaketLesen(SCHL, V.pakete['1'], V.k, 1 - V.b, V.praeparator, 1, V.von, V.bis)).toThrow('passt nicht');
    expect(() => anteilPaketLesen(SCHL, V.pakete['1'], V.k, V.b, 1, 1, V.von, V.bis)).toThrow('passt nicht');
    expect(() => anteilPaketLesen(SCHL, V.pakete['1'], V.k, V.b, V.praeparator, 3, V.von, V.bis)).toThrow('passt nicht');
    expect(() => anteilPaketLesen(SCHL, V.pakete['1'], 'ab'.repeat(32), V.b, V.praeparator, 1, V.von, V.bis)).toThrow('passt nicht');
    expect(() => anteilPaketLesen(SCHL, V.pakete['1'], V.k, V.b, V.praeparator, 1, V.von + 1, V.bis)).toThrow('passt nicht');
    expect(() => anteilPaketLesen(SCHL, V.pakete['1'].toUpperCase(), V.k, V.b, V.praeparator, 1, V.von, V.bis)).toThrow('Form');
    expect(() => anteilPaketLesen(SCHL, 'a'.repeat(2 * (16384 * 44 + 4096) + 2), V.k, V.b, V.praeparator, 1, V.von, V.bis)).toThrow('Form');
  });

  it('ein falscher Anteil: die Teilmenge ergibt die Blaetter nicht; mit einem vierten ehrlichen Paket doch', () => {
    const falsch = lesen(4, V.paket_falscher_anteil);
    expect(() => ausAnteilenZusammensetzen([lesen(1), lesen(3), falsch], V.t, pruefen)).toThrow('keine Teilmenge');
    // Ein viertes, ehrliches Paket (von 4 selbst geht nicht doppelt): aus dem Vektor nachgebaut.
    const ehrlich4: AnteilPaket = { ...lesen(4), j: 4 };
    expect(() => ausAnteilenZusammensetzen([lesen(1), ehrlich4, falsch], V.t, pruefen)).toThrow('doppelt');
  });

  it('zu wenige Pakete, anderes Salz oder andere Stellen werden abgewiesen', () => {
    expect(() => ausAnteilenZusammensetzen([lesen(1), lesen(3)], V.t, pruefen)).toThrow('verlangt 3');
    const salz = { ...lesen(4), salz: '00'.repeat(32) };
    expect(() => ausAnteilenZusammensetzen([lesen(1), lesen(3), salz], V.t, () => {})).toThrow();
    const stellen = lesen(4);
    stellen.anteile = new Map([...stellen.anteile].slice(1));
    expect(() => ausAnteilenZusammensetzen([lesen(1), lesen(3), stellen], V.t, () => {})).toThrow();
  });
});

describe('Oeffnung aus t Anteilen ueber das Netz', () => {
  const validatoren = [1, 2, 3, 4].map((j) => ({ adresse: '0x' + String(j).repeat(40), api: `https://v${j}.test/api` }));
  const umgebung = (pakete: Record<string, string>, abgefragt: string[]): Umgebung => ({
    fetchFn: (async (url: string) => {
      abgefragt.push(url);
      const m = url.match(/^https:\/\/v(\d)\.test\/api\/quanten-w\/validator\/anteil-oeffnung\?k=([0-9a-f]+)&x=(\d)&b=(\d)$/);
      const j = m?.[1];
      if (m && m[2] === V.k && Number(m[3]) === V.praeparator && Number(m[4]) === V.b && j && pakete[j]) {
        return { status: 200, ok: true, text: async () => JSON.stringify({ paket: pakete[j] }) };
      }
      return { status: 409, ok: false, text: async () => '{"error":"nein"}' };
    }) as any,
    speicher: { lesen: async () => null, schreiben: async () => {}, loeschen: async () => {} },
    zufall: () => new Uint8Array(0),
    apiBasis: 'https://knoten.test/api',
    warten: async () => {},
    jetzt: () => 0,
  });

  it('Praeparator 2 weg: die Werte aus den Paketen von 1, 3 und 4; Validator 2 wird nicht gefragt', async () => {
    const abgefragt: string[] = [];
    const r = await ausAnteilenLaden(umgebung(V.pakete, abgefragt), validatoren, SCHL, V.k, V.b, V.praeparator, V.t, V.von, V.bis, blaetter);
    expect(r.werte).toEqual(soll);
    expect(abgefragt.some((u) => u.startsWith('https://v2.test'))).toBe(false);
  });

  it('nur t - 1 echte Pakete (eines fuer die andere Stelle): kein Laden', async () => {
    await expect(
      ausAnteilenLaden(umgebung({ ...V.pakete, '3': V.paket_andere_stelle }, []), validatoren, SCHL, V.k, V.b, V.praeparator, V.t, V.von, V.bis, blaetter),
    ).rejects.toThrow('verlangt 3');
  });

  it('ein falscher Anteil: kein Laden', async () => {
    await expect(
      ausAnteilenLaden(umgebung({ ...V.pakete, '4': V.paket_falscher_anteil }, []), validatoren, SCHL, V.k, V.b, V.praeparator, V.t, V.von, V.bis, blaetter),
    ).rejects.toThrow('keine Teilmenge');
  });

  it('ein falsches Blatt: kein Laden', async () => {
    const bl = [...blaetter];
    bl[[...soll.keys()][0]] = 'ab'.repeat(32);
    await expect(ausAnteilenLaden(umgebung(V.pakete, []), validatoren, SCHL, V.k, V.b, V.praeparator, V.t, V.von, V.bis, bl)).rejects.toThrow();
  });

  it('bei v - 1 < t gar nicht erst gefragt', async () => {
    const abgefragt: string[] = [];
    await expect(ausAnteilenLaden(umgebung(V.pakete, abgefragt), validatoren.slice(0, 3), SCHL, V.k, V.b, V.praeparator, V.t, V.von, V.bis, blaetter)).rejects.toThrow('Schwelle');
    expect(abgefragt).toEqual([]);
  });
});
