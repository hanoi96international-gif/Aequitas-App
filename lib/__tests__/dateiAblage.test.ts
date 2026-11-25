// Ablage in Dateien (lib/dateiAblage.ts) gegen ein nachgebautes expo-file-system
// (File/Directory/Paths im Speicher): Schlüssel ohne Pfad, Schreiben über
// `.neu` und Verschieben, nichts Geheimes.
const mockDateien = new Map<string, string>();
const mockOrdner = new Set<string>();
jest.mock('expo-file-system', () => {
  const pfad = (...t: any[]) => t.map((x) => (typeof x === 'string' ? x : x.uri)).join('/');
  class Directory {
    uri: string;
    constructor(...t: any[]) {
      this.uri = pfad(...t);
    }
    get exists() {
      return mockOrdner.has(this.uri);
    }
    create() {
      mockOrdner.add(this.uri);
    }
  }
  class File {
    uri: string;
    constructor(...t: any[]) {
      this.uri = pfad(...t);
    }
    get exists() {
      return mockDateien.has(this.uri);
    }
    create() {
      if (mockDateien.has(this.uri)) throw new Error('existiert');
      mockDateien.set(this.uri, '');
    }
    write(w: string) {
      if (!mockDateien.has(this.uri)) throw new Error('fehlt');
      mockDateien.set(this.uri, w);
    }
    async text() {
      return mockDateien.get(this.uri)!;
    }
    delete() {
      mockDateien.delete(this.uri);
    }
    move(ziel: File) {
      if (mockDateien.has(ziel.uri)) throw new Error('Ziel existiert');
      mockDateien.set(ziel.uri, mockDateien.get(this.uri)!);
      mockDateien.delete(this.uri);
      this.uri = ziel.uri;
    }
  }
  return { Directory, File, Paths: { document: { uri: 'doc' } } };
});
jest.mock('expo-secure-store', () => ({}));
jest.mock('expo-crypto', () => ({ getRandomBytes: () => new Uint8Array(0) }));
jest.mock('../config', () => ({ API_BASE: 'https://knoten.test/api' }));

import { dateiAblage } from '../dateiAblage';

describe('Ablage in Dateien', () => {
  beforeEach(() => {
    mockDateien.clear();
    mockOrdner.clear();
  });

  test('schreiben, lesen, überschreiben, löschen; der Ordner entsteht beim ersten Gebrauch', async () => {
    const a = dateiAblage();
    expect(await a.lesen('aequitas.quantenS.ausgeber.antwort.1')).toBeNull();
    await a.schreiben('aequitas.quantenS.ausgeber.antwort.1', 'eins', false);
    expect(mockOrdner.has('doc/quantenS')).toBe(true);
    expect(await a.lesen('aequitas.quantenS.ausgeber.antwort.1')).toBe('eins');
    await a.schreiben('aequitas.quantenS.ausgeber.antwort.1', 'zwei'.repeat(100000), false);
    expect((await a.lesen('aequitas.quantenS.ausgeber.antwort.1'))!.length).toBe(400000);
    expect([...mockDateien.keys()]).toEqual(['doc/quantenS/aequitas.quantenS.ausgeber.antwort.1']); // keine .neu-Reste
    await a.loeschen('aequitas.quantenS.ausgeber.antwort.1');
    expect(await a.lesen('aequitas.quantenS.ausgeber.antwort.1')).toBeNull();
    await a.loeschen('gibt-es-nicht');
  });

  test('ein Rest von einem Abbruch (.neu) stört nicht und wird ersetzt', async () => {
    const a = dateiAblage();
    await a.schreiben('k', 'alt', false);
    mockDateien.set('doc/quantenS/k.neu', 'halb');
    expect(await a.lesen('k')).toBe('alt'); // die alte Datei gilt
    await a.schreiben('k', 'neu', false);
    expect(await a.lesen('k')).toBe('neu');
    expect(mockDateien.has('doc/quantenS/k.neu')).toBe(false);
  });

  test('Missbrauch: Pfade, .. und .neu als Schlüssel; nichts Geheimes; fremder Ordnername', async () => {
    const a = dateiAblage();
    for (const k of ['../geheim', 'a/b', '', 'x'.repeat(121), 'k.neu', '..', 'ä']) {
      await expect(a.lesen(k)).rejects.toThrow('Schlüssel');
      await expect(a.schreiben(k, 'w', false)).rejects.toThrow('Schlüssel');
    }
    await expect(a.schreiben('k', 'w', true)).rejects.toThrow('nichts Geheimes');
    expect(() => dateiAblage('../x')).toThrow('Ordner');
    expect(mockDateien.size).toBe(0);
  });
});
