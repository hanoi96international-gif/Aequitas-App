/**
 * components/UmzugKarten.tsx, UmzugHinweis auf Home: ein Mensch ohne
 * hinterlegten Wiederherstellungscode sieht ab dem Stichtag eine Karte
 * "Code einrichten" -- wer sich vor dem Stichtag registriert hat, konnte noch
 * keinen anlegen. Nicht vor dem Stichtag, nicht fuer Nicht-Menschen, nicht mit
 * Code; ein offener Umzug (Warnung an die alte Wallet) geht immer vor.
 */
import React from 'react';
const TestRenderer: any = require('react-test-renderer');
const { act } = TestRenderer;

const mockIch = '0x' + 'a'.repeat(40);
const NEU = '0x' + 'b'.repeat(40);
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
  umzugStand: async () => mockStand,
  widerrufen: jest.fn(),
}));

import { UmzugHinweis } from '../../components/UmzugKarten';

const jetzt = () => Math.floor(Date.now() / 1000);

const offen: any[] = [];
async function zeichne() {
  let r: any;
  await act(async () => { r = TestRenderer.create(<UmzugHinweis />); });
  await act(async () => {});
  offen.push(r);
  return r;
}
afterEach(() => { while (offen.length) act(() => offen.pop().unmount()); });
const karte = (r: any) => r.root.findAllByProps({ testID: 'umzug-code-fehlt' });

describe('Home: Wiederherstellungscode fehlt', () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockBalance = { is_human: true };
    mockStand = { aktivAb: jetzt() - 60, codeSeit: 0, offen: null };
  });

  it('Mensch ohne Code nach dem Stichtag: Karte mit Weg zum Code', async () => {
    const r = await zeichne();
    expect(karte(r).length).toBeGreaterThan(0);
    await act(async () => { r.root.findByProps({ accessibilityRole: 'button' }).props.onPress(); });
    expect(mockPush).toHaveBeenCalledWith('/wiederherstellungscode');
  });

  it('vor dem Stichtag: nichts', async () => {
    mockStand.aktivAb = jetzt() + 3600;
    expect(karte(await zeichne())).toHaveLength(0);
  });

  it('Stand unbekannt (Knoten antwortet nicht): nichts', async () => {
    mockStand = null;
    expect(karte(await zeichne())).toHaveLength(0);
  });

  it('Code schon hinterlegt: nichts', async () => {
    mockStand.codeSeit = jetzt() - 10;
    expect(karte(await zeichne())).toHaveLength(0);
  });

  it('kein Mensch (oder Kontostand unbekannt): nichts', async () => {
    for (const b of [{ is_human: false }, { is_human: 'true' }, null]) {
      mockBalance = b;
      expect(karte(await zeichne())).toHaveLength(0);
    }
  });

  it('offener Umzug weg von dieser Wallet: die Warnung geht vor', async () => {
    mockStand.offen = { nullifier: '7', alt: mockIch, neu: NEU, angekuendigt: jetzt(), freiAb: jetzt() + 86400, fest: false };
    const r = await zeichne();
    expect(karte(r)).toHaveLength(0);
    expect(r.root.findAllByProps({ children: 'umzug.warnTitel' }).length).toBeGreaterThan(0);
  });
});
