/**
 * Regeln vom 08.11.2026 (Kette: umzug.go): ein Wiederherstellungscode je
 * Wallet, nicht aenderbar, gueltig 14 Tage nach dem Hinterlegen.
 *   - Home: ein noch nicht gueltiger Code zeigt Datum und "warst du das
 *     nicht?" -- ein fremder Code (Dieb mit den 12 Woertern) faellt auf.
 *   - Identitaet: mit Code kein Knopf fuer einen zweiten.
 *   - Meldungen der Kette (umzug_code_unreif, umzug_code_fest) werden erkannt.
 */
import React from 'react';
const TestRenderer: any = require('react-test-renderer');
const { act } = TestRenderer;

const mockIch = '0x' + 'a'.repeat(40);
let mockBalance: any = null;
let mockStand: any = null;
const mockPush = jest.fn();

jest.mock('expo-router', () => {
  const R = require('react');
  return { router: { push: (...a: any[]) => mockPush(...a) }, useFocusEffect: (f: any) => R.useEffect(f, [f]) };
});
jest.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (k: string) => k }) }));
jest.mock('@/contexts/WalletContext', () => ({
  useWallet: () => ({ signer: { address: mockIch }, balance: mockBalance }),
}));
jest.mock('@/lib/umzug', () => ({
  ...jest.requireActual('@/lib/umzug'),
  umzugStand: async () => mockStand,
  widerrufen: jest.fn(),
}));

import { UmzugHinweis, UmzugIdentitaet } from '../../components/UmzugKarten';
import { codeSchonDa, codeUnreifAb } from '../../lib/umzug';

const jetzt = () => Math.floor(Date.now() / 1000);
const offen: any[] = [];
async function zeichne(el: any) {
  let r: any;
  await act(async () => { r = TestRenderer.create(el); });
  await act(async () => {});
  offen.push(r);
  return r;
}
afterEach(() => { while (offen.length) act(() => offen.pop().unmount()); });
const mit = (r: any, id: string) => r.root.findAllByProps({ testID: id }).length > 0;
const knoepfe = (r: any) => r.root.findAllByProps({ accessibilityRole: 'button' }).length;

describe('Code noch nicht gueltig', () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockBalance = { is_human: true };
    mockStand = { aktivAb: jetzt() - 60, codeSeit: jetzt() - 86400, codeGueltigAb: jetzt() + 13 * 86400, offen: null };
  });

  it('Home warnt mit Datum, solange er nicht gilt', async () => {
    const r = await zeichne(<UmzugHinweis />);
    expect(mit(r, 'umzug-code-unreif')).toBe(true);
    expect(mit(r, 'umzug-code-fehlt')).toBe(false);
  });

  it('gilt er, ist Home still', async () => {
    mockStand.codeGueltigAb = jetzt() - 1;
    const r = await zeichne(<UmzugHinweis />);
    expect(mit(r, 'umzug-code-unreif')).toBe(false);
    expect(mit(r, 'umzug-code-fehlt')).toBe(false);
  });

  it('Knoten ohne code_gueltig_ab (aelterer Stand): keine Warnung, keine Aufforderung', async () => {
    mockStand.codeGueltigAb = 0;
    const r = await zeichne(<UmzugHinweis />);
    expect(mit(r, 'umzug-code-unreif')).toBe(false);
    expect(mit(r, 'umzug-code-fehlt')).toBe(false);
  });

  it('kein Mensch: nichts', async () => {
    mockBalance = { is_human: false };
    expect(mit(await zeichne(<UmzugHinweis />), 'umzug-code-unreif')).toBe(false);
  });

  it('Identitaet: mit Code kein Knopf fuer einen zweiten', async () => {
    const r = await zeichne(<UmzugIdentitaet istMensch />);
    expect(knoepfe(r)).toBe(0);
  });

  it('Identitaet: ohne Code der Knopf zum Einrichten', async () => {
    mockStand.codeSeit = 0;
    mockStand.codeGueltigAb = 0;
    const r = await zeichne(<UmzugIdentitaet istMensch />);
    expect(knoepfe(r)).toBeGreaterThan(0);
  });
});

describe('Meldungen der Kette', () => {
  it('umzug_code_unreif mit Datum', () => {
    expect(codeUnreifAb('rejected: umzug_code_unreif: 0xabcd…1234: Wiederherstellungscode gilt erst ab 1795370400')).toBe(1795370400);
  });
  it.each([undefined, '', 'rejected: umzug_code: passt nicht', 'umzug_code_unreif ohne Zahl', 'x umzug_code_unreifX 1795370400'])(
    'sonst 0: %s',
    (m) => {
      expect(codeUnreifAb(m as any)).toBe(0);
    },
  );
  it('umzug_code_fest', () => {
    expect(codeSchonDa('rejected: umzug_code_fest: 0xabcd: hat schon einen Wiederherstellungscode')).toBe(true);
    expect(codeSchonDa('rejected: umzug_code_alt: …')).toBe(false);
    expect(codeSchonDa(undefined)).toBe(false);
  });
});
