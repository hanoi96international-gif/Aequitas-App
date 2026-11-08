/**
 * Regeln vom 08.11.2026 (Kette: umzug.go): ein Wiederherstellungscode je
 * Wallet, nicht aenderbar, gilt sofort; ein neuer nur nach einem Umzug.
 *   - Home: mit Code still (keine Aufforderung mehr).
 *   - Identitaet: mit Code kein Knopf fuer einen zweiten.
 *   - Die Ablehnung der Kette (umzug_code_fest) wird erkannt.
 */
import React from 'react';
const TestRenderer: any = require('react-test-renderer');
const { act } = TestRenderer;

const mockIch = '0x' + 'a'.repeat(40);
let mockBalance: any = null;
let mockStand: any = null;

jest.mock('expo-router', () => {
  const R = require('react');
  return { router: { push: jest.fn() }, useFocusEffect: (f: any) => R.useEffect(f, [f]) };
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
import { codeSchonDa } from '../../lib/umzug';

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
const knoepfe = (r: any) => r.root.findAllByProps({ accessibilityRole: 'button' }).length;

describe('ein Code je Wallet', () => {
  beforeEach(() => {
    mockBalance = { is_human: true };
    mockStand = { aktivAb: jetzt() - 60, codeSeit: jetzt() - 86400, offen: null };
  });

  it('Home: mit Code still', async () => {
    const r = await zeichne(<UmzugHinweis />);
    expect(r.toJSON()).toBeNull();
  });

  it('Identitaet: mit Code kein Knopf fuer einen zweiten', async () => {
    expect(knoepfe(await zeichne(<UmzugIdentitaet istMensch />))).toBe(0);
  });

  it('Identitaet: ohne Code der Knopf zum Einrichten', async () => {
    mockStand.codeSeit = 0;
    expect(knoepfe(await zeichne(<UmzugIdentitaet istMensch />))).toBeGreaterThan(0);
  });
});

describe('Ablehnung der Kette', () => {
  it('umzug_code_fest wird erkannt, anderes nicht', () => {
    expect(codeSchonDa('rejected: umzug_code_fest: 0xabcd: hat schon einen Wiederherstellungscode')).toBe(true);
    expect(codeSchonDa('rejected: umzug_code_festX')).toBe(false);
    expect(codeSchonDa('rejected: umzug_code_alt: …')).toBe(false);
    expect(codeSchonDa(undefined)).toBe(false);
  });
});
