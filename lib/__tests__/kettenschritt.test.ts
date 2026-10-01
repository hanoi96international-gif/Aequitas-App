/**
 * Offener Kettenschritt: nur fuer die eigene Wallet, nur solange die
 * Bescheinigung gilt, und ein manipulierter Eintrag wird verworfen.
 */
const speicher: Record<string, string> = {};
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => speicher[k] ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => { speicher[k] = v; }),
  deleteItemAsync: jest.fn(async (k: string) => { delete speicher[k]; }),
}), { virtual: true });
jest.mock('expo-crypto', () => ({ getRandomBytesAsync: jest.fn() }), { virtual: true });

import { merkeKettenschritt, offenerKettenschritt, KETTENSCHRITT_GUELTIG_S } from '../biometricIdentity';

const WALLET = '0x' + 'ab'.repeat(20);
const FREMD = '0x' + 'cd'.repeat(20);
const JETZT = 1_800_000_000;
const EINTRAG = { bioHash: '12345', wallet: WALLET, signature: 'sig', issuedAt: JETZT - 60, grantClass: null, grantClassSignature: null };

beforeEach(() => { for (const k of Object.keys(speicher)) delete speicher[k]; });

it('gibt den Eintrag fuer dieselbe Wallet zurueck', async () => {
  await merkeKettenschritt(EINTRAG);
  expect(await offenerKettenschritt(WALLET.toUpperCase().replace('0X', '0x'), JETZT)).toEqual(EINTRAG);
});

it('gibt ihn einer fremden Wallet nicht heraus, verwirft ihn aber nicht', async () => {
  await merkeKettenschritt(EINTRAG);
  expect(await offenerKettenschritt(FREMD, JETZT)).toBeNull();
  expect(await offenerKettenschritt(WALLET, JETZT)).not.toBeNull();
});

it('verwirft eine abgelaufene Bescheinigung', async () => {
  await merkeKettenschritt({ ...EINTRAG, issuedAt: JETZT - KETTENSCHRITT_GUELTIG_S - 1 });
  expect(await offenerKettenschritt(WALLET, JETZT)).toBeNull();
  expect(Object.keys(speicher)).toHaveLength(0);
});

it('verwirft eine Bescheinigung aus der Zukunft', async () => {
  await merkeKettenschritt({ ...EINTRAG, issuedAt: JETZT + 600 });
  expect(await offenerKettenschritt(WALLET, JETZT)).toBeNull();
});

it('verwirft manipulierte Eintraege (keine Dezimalkennung, kaputtes JSON)', async () => {
  await merkeKettenschritt({ ...EINTRAG, bioHash: '0xdeadbeef' });
  expect(await offenerKettenschritt(WALLET, JETZT)).toBeNull();
  speicher['aequitas_offener_kettenschritt_v1'] = '{kaputt';
  expect(await offenerKettenschritt(WALLET, JETZT)).toBeNull();
});
