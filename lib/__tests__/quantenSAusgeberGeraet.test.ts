// Der Ausgeber im Gerät (lib/quantenSAusgeberGeraet.ts): die eingefügte Bestellung
// der Inhaberin streng nach Größe und Form, der Briefkasten ohne IBM-Zugang lehnt
// Aufträge ab statt ungemessen zu antworten.
const mockSecure = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'nur',
  getItemAsync: async (k: string) => mockSecure.get(k) ?? null,
  setItemAsync: async (k: string, w: string) => void mockSecure.set(k, w),
  deleteItemAsync: async (k: string) => void mockSecure.delete(k),
}));
jest.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => new Uint8Array(n) }));
jest.mock('expo-file-system', () => ({ Directory: class {}, File: class {}, Paths: {} }));
jest.mock('../config', () => ({ API_BASE: 'https://knoten.test/api', API_FALLBACKS: [] }));
const mockRunde = jest.fn(async (..._a: any[]) => ({ briefe: 0 }));
jest.mock('../quantenSPraepAblauf', () => ({ runde: (...a: any[]) => mockRunde(...a) }));

import { ausgeberBriefkasten, BESTELLUNG_TEXT_MAX, bestellungAusText } from '../quantenSAusgeberGeraet';
import { praepUmgebung, ibmZugangSetzen } from '../quantenSPraepGeraet';

const GUT = { n: 2822, basen_verschluesselt: ['aa', 'bb'], inhaberin: '0x' + '1'.repeat(40), inhaberin_schluessel: '02' + '3'.repeat(64), stellen: [{ adresse: 'a', schluessel: 'b' }, { adresse: 'c', schluessel: 'd' }] };
const CRN = 'crn:v1:bluemix:public:quantum-computing:us-east:a/' + 'b'.repeat(32) + ':' + 'c'.repeat(8) + '-' + 'd'.repeat(4) + '-' + 'e'.repeat(4) + '-' + 'f'.repeat(4) + '-' + '0'.repeat(12) + '::';
const wallet = { entsperren: async () => ({ privateKey: '0x' + '11'.repeat(32) }) };

describe('Bestellung der Inhaberin als Text', () => {
  test('gut: wird gelesen (auch mit Leerraum)', () => {
    expect(bestellungAusText('  ' + JSON.stringify(GUT) + '\n')).toEqual(GUT);
  });
  test('zu groß: abgewiesen, bevor geparst wird', () => {
    const parse = jest.spyOn(JSON, 'parse');
    expect(() => bestellungAusText(' '.repeat(BESTELLUNG_TEXT_MAX + 1))).toThrow('zu groß');
    expect(parse).not.toHaveBeenCalled();
    parse.mockRestore();
  });
  test.each([
    ['kein JSON', '{n:1', 'kein JSON'],
    ['Liste', '[]', 'Form'],
    ['null', 'null', 'Form'],
    ['Weg A (Basen im Klartext)', JSON.stringify({ ...GUT, basen: ['x'] }), 'Weg B'],
    ['fremdes Feld', JSON.stringify({ ...GUT, rueckgabe: 'https://boese' }), 'Weg B'],
    ['ohne Chiffrate', JSON.stringify({ ...GUT, basen_verschluesselt: undefined }), 'Form'],
    ['Chiffrat keine Zeichenkette', JSON.stringify({ ...GUT, basen_verschluesselt: [1] }), 'Form'],
    ['eine Stelle', JSON.stringify({ ...GUT, stellen: [GUT.stellen[0]] }), 'Annahmestellen'],
  ])('%s: abgewiesen', (_n, text, grund) => {
    expect(() => bestellungAusText(text)).toThrow(grund);
  });
});

describe('Briefkasten als Ausgeber', () => {
  beforeEach(() => {
    mockSecure.clear();
    mockRunde.mockClear();
  });
  test('ohne IBM-Zugang: die Runde läuft (Antworten, Bestätigungen), Aufträge werden abgelehnt statt ungemessen beantwortet', async () => {
    await ausgeberBriefkasten(wallet);
    expect(mockRunde).toHaveBeenCalledTimes(1);
    const messer = mockRunde.mock.calls[0][2];
    await expect(messer.messen([0], [0], [0])).rejects.toThrow('kein IBM-Zugang');
  });
  test('mit IBM-Zugang: dieselbe Runde misst mit dem eigenen Zugang', async () => {
    await ibmZugangSetzen({ apiKey: 'a'.repeat(44), crn: CRN }, praepUmgebung());
    await ausgeberBriefkasten(wallet);
    const messer = mockRunde.mock.calls[0][2];
    let netz = 0;
    const u = { ...praepUmgebung(), fetchFn: (async () => { netz++; throw new Error('netz aus'); }) as unknown as typeof fetch };
    mockRunde.mockClear();
    await ausgeberBriefkasten(wallet, u, ['https://knoten.test/api'], async () => {});
    const m2 = mockRunde.mock.calls[0][2];
    await expect(m2.messen([0], [0], [0])).rejects.toThrow();
    expect(netz).toBeGreaterThan(0); // fragt IBM, statt "kein IBM-Zugang"
    expect(messer).toBeDefined();
  });
});
