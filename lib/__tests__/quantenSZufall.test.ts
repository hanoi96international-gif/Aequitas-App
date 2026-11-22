// expo-crypto: getRandomBytes(n) wirft fuer n > 1024 (Fehler aus der App:
// "getRandomBytes(1104) expected a valid number from range 0...1024").
// Die Bestellung zieht n Byte fuer die Basen; n kann groesser als 1024 sein.
const mockEchteGrenze = (n: number) => {
  if (!Number.isInteger(n) || n < 0 || n > 1024) {
    throw new Error(`getRandomBytes(${n}) expected a valid number from range 0...1024`);
  }
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = (i * 7 + n) & 0xff;
  return b;
};
const mockGetRandomBytes = jest.fn(mockEchteGrenze);
jest.mock('expo-secure-store', () => ({}));
jest.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => mockGetRandomBytes(n) }));
jest.mock('../config', () => ({ API_BASE: 'https://knoten.test/api' }));

import { standardUmgebung, zufallInStuecken, ZUFALL_STUECK } from '../quantenSInhaberin';

beforeEach(() => mockGetRandomBytes.mockClear());

describe('Zufall in Stuecken (expo-crypto hoechstens 1024 Byte je Aufruf)', () => {
  test('die Grenze der Quelle ist echt: 1104 auf einmal wirft', () => {
    expect(() => mockEchteGrenze(1104)).toThrow('0...1024');
  });

  test.each([0, 1, 32, 1023, 1024, 1025, 1104, 2048, 2049, 5000])('n = %i: Laenge stimmt, kein Aufruf ueber 1024', (n) => {
    const b = standardUmgebung().zufall(n);
    expect(b).toBeInstanceOf(Uint8Array);
    expect(b.length).toBe(n);
    for (const [m] of mockGetRandomBytes.mock.calls) expect(m).toBeLessThanOrEqual(ZUFALL_STUECK);
    expect(mockGetRandomBytes.mock.calls.reduce((s, [m]) => s + m, 0)).toBe(n);
  });

  test('1104 Byte: zwei Stuecke, Inhalt in der richtigen Reihenfolge', () => {
    const b = standardUmgebung().zufall(1104);
    expect(mockGetRandomBytes.mock.calls.map(([m]) => m)).toEqual([1024, 80]);
    expect(Array.from(b.slice(0, 1024))).toEqual(Array.from(mockEchteGrenze(1024)));
    expect(Array.from(b.slice(1024))).toEqual(Array.from(mockEchteGrenze(80)));
  });

  test('Missbrauch: Quelle liefert ein kuerzeres Stueck -> Abbruch, nie mit Nullen aufgefuellt', () => {
    expect(() => zufallInStuecken(1104, (m) => new Uint8Array(m === 80 ? 79 : m))).toThrow('Zufall');
    expect(() => zufallInStuecken(10, () => new Uint8Array(11))).toThrow('Zufall');
    expect(() => zufallInStuecken(10, () => undefined as unknown as Uint8Array)).toThrow('Zufall');
  });

  test('Missbrauch: ungueltiges n -> Abbruch ohne Aufruf der Quelle', () => {
    const q = jest.fn((m: number) => new Uint8Array(m));
    for (const n of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => zufallInStuecken(n, q)).toThrow('Zufall');
    }
    expect(q).not.toHaveBeenCalled();
  });

  test('Fehler der Quelle wird nicht verschluckt', () => {
    expect(() => zufallInStuecken(2000, () => { throw new Error('kein Zufall'); })).toThrow('kein Zufall');
  });
});
