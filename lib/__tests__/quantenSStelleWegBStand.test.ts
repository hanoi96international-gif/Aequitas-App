// Seite der Annahmestelle in Weg B (4c-3d): der Stand der laufenden Annahme wird
// streng gelesen (eine veränderte Annahme im Gerät fällt auf), eine Vorlage ist
// nur mit der Liste der Gelosten eine aus Weg B; der Stand der Inhaberin nennt Weg B.
jest.mock('expo-secure-store', () => ({}));
jest.mock('expo-crypto', () => ({ getRandomBytes: () => new Uint8Array(0) }));
jest.mock('../config', () => ({ API_BASE: 'https://knoten.test/api' }));

import { ANNAHME, annahmeWegBStand, istWegBVorlage } from '../quantenSStelleWegB';
import type { Umgebung } from '../quantenSInhaberin';

const K = 'c7'.repeat(32);
const LOS = Array.from({ length: 7 }, (_, i) => '0x' + (i + 1).toString(16).repeat(40));
const vorlage = (mit: boolean, los = LOS) => JSON.stringify({ k: K, b: 1, x: '0101', vorlage: '0xab', ...(mit ? { validatoren: los } : {}) });

function umgebung(): Umgebung & { daten: Map<string, string> } {
  const daten = new Map<string, string>();
  const ablage = { lesen: async (k: string) => daten.get(k) ?? null, schreiben: async (k: string, v: string) => void daten.set(k, v), loeschen: async (k: string) => void daten.delete(k) };
  return { daten, fetchFn: fetch, speicher: ablage, ablage, zufall: (n) => new Uint8Array(n), apiBasis: 'https://knoten.test/api', warten: async () => {}, jetzt: () => 0 };
}

describe('Annahme in Weg B: Stand', () => {
  test('ohne Ablage oder ohne Annahme: null', async () => {
    expect(await annahmeWegBStand({ ...umgebung(), ablage: undefined })).toBeNull();
    expect(await annahmeWegBStand(umgebung())).toBeNull();
  });
  test('gesichert: k, b und Zahl der Gelosten', async () => {
    const u = umgebung();
    u.daten.set(ANNAHME, JSON.stringify({ k: K, b: 1, validatoren: LOS, vorlage: vorlage(true) }));
    expect(await annahmeWegBStand(u)).toEqual({ k: K, b: 1, v: 7 });
  });
  test.each([
    ['andere Gelosten als in der Vorlage', { k: K, b: 1, validatoren: [...LOS].reverse(), vorlage: vorlage(true) }],
    ['andere Stelle als in der Vorlage', { k: K, b: 0, validatoren: LOS, vorlage: vorlage(true) }],
    ['anderes K als in der Vorlage', { k: 'd8'.repeat(32), b: 1, validatoren: LOS, vorlage: vorlage(true) }],
    ['Vorlage ohne Gelosten', { k: K, b: 1, validatoren: LOS, vorlage: vorlage(false) }],
  ])('verändert (%s): fällt auf', async (_n, a) => {
    const u = umgebung();
    u.daten.set(ANNAHME, JSON.stringify(a));
    await expect(annahmeWegBStand(u)).rejects.toThrow();
  });
  test('unlesbar: fällt auf', async () => {
    const u = umgebung();
    u.daten.set(ANNAHME, '{kaputt');
    await expect(annahmeWegBStand(u)).rejects.toThrow('unlesbar');
  });
});

describe('Vorlage aus Weg B?', () => {
  test('mit Gelosten ja, ohne nein', () => {
    expect(istWegBVorlage(vorlage(true))).toBe(true);
    expect(istWegBVorlage(vorlage(false))).toBe(false);
  });
  test('unlesbar oder mit kaputter Liste: wirft', () => {
    expect(() => istWegBVorlage('x')).toThrow();
    expect(() => istWegBVorlage(vorlage(true, [LOS[0], LOS[0]]))).toThrow('Gelosten');
    expect(() => istWegBVorlage(vorlage(true, []))).toThrow('Gelosten');
  });
});
