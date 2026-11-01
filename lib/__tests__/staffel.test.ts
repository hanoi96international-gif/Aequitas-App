/**
 * Staffel ab 1.13.1: der Rest ist spaetestens an Tag 30 frei (aequitas-chain,
 * grant_staffel.go), und ein Einspruch zweier Betreiber haelt ihn hoechstens
 * bis Tag 180 an -- eine Zweitpruefung NACH dem Einspruch beendet ihn
 * (staffelErneuertGueltig). Die App zeigt das Datum und bietet die
 * Zweitpruefung nach einem Einspruch wieder an.
 */
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn() }));
jest.mock('expo-crypto', () => ({ getRandomBytesAsync: jest.fn() }));
jest.mock('../wallet', () => ({ signMessage: jest.fn(), signTypedData: jest.fn(), sendAEQ: jest.fn() }));

import { staffelEingesprochen, staffelFreiAb, staffelZweitpruefungFaellig, type Staffel } from '../api';

const TAG = 86400;
const REG = 1_800_000_000;
const basis: Staffel = { rest_aeq: 800, laeuft: false, erneuert_am: 0, bis: REG + 30 * TAG, tagesrate_aeq: 26.666667 };

describe('Staffel', () => {
  it('nennt den Tag, an dem der Rest spaetestens frei ist', () => {
    expect(staffelFreiAb(basis)).toBe(REG + 30 * TAG); // aelterer Knoten: bis
    expect(staffelFreiAb({ ...basis, frei_ab: REG + 180 * TAG })).toBe(REG + 180 * TAG);
    expect(staffelFreiAb({ ...basis, bis: 0 })).toBe(0);
  });

  it('ein Einspruch haelt an, bis eine Zweitpruefung NACH ihm kommt', () => {
    expect(staffelEingesprochen(basis)).toBe(false);
    const ein = { ...basis, einspruch_am: REG + 20 * TAG };
    expect(staffelEingesprochen(ein)).toBe(true);
    expect(staffelEingesprochen({ ...ein, erneuert_am: REG + 10 * TAG })).toBe(true); // vorher: zaehlt nicht
    expect(staffelEingesprochen({ ...ein, erneuert_am: REG + 20 * TAG })).toBe(true); // gleichzeitig: zaehlt nicht
    expect(staffelEingesprochen({ ...ein, erneuert_am: REG + 21 * TAG })).toBe(false);
  });

  it('die Zweitpruefung ist ab Tag 7 faellig, nach einem Einspruch wieder', () => {
    expect(staffelZweitpruefungFaellig(basis, REG + 6 * TAG)).toBe(false);
    expect(staffelZweitpruefungFaellig(basis, REG + 7 * TAG)).toBe(true);
    const erneuert = { ...basis, erneuert_am: REG + 8 * TAG, laeuft: true };
    expect(staffelZweitpruefungFaellig(erneuert, REG + 9 * TAG)).toBe(false);
    // Einspruch nach der Zweitpruefung: sie laeuft nicht mehr, eine neue beendet ihn.
    const ein = { ...basis, erneuert_am: REG + 8 * TAG, einspruch_am: REG + 12 * TAG, frei_ab: REG + 180 * TAG };
    expect(staffelZweitpruefungFaellig(ein, REG + 13 * TAG)).toBe(true);
    // Unbekannter Tag 7 (bis fehlt): nie faellig -- eine Aufnahme zaehlte nicht.
    expect(staffelZweitpruefungFaellig({ ...basis, bis: 0 }, REG + 40 * TAG)).toBe(false);
  });
});
