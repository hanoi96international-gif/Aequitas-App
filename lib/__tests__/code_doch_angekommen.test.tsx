/**
 * app/wiederherstellungscode.tsx: kam eine Fehlermeldung oder lief die Zeit
 * ab, der Code steht aber auf der Kette (code_seit neuer als vorher), zeigt
 * die App "gespeichert" -- sonst legt der Mensch einen zweiten an (so am
 * 08.11.2026 geschehen). Steht er nicht dort, bleibt der Fehler.
 */
import React from 'react';
const TestRenderer: any = require('react-test-renderer');
const { act } = TestRenderer;

const mockIch = '0x' + 'a'.repeat(40);
let mockSeit = 0;
let mockHinterlegen: () => Promise<any> = async () => ({ ok: false, meldung: 'HTTP 502' });

jest.mock('expo-router', () => {
  const R = require('react');
  return { router: { back: jest.fn() }, useFocusEffect: (f: any) => R.useEffect(f, [f]) };
});
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: any) => children }));
jest.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (k: string) => k }) }));
jest.mock('@/contexts/WalletContext', () => ({ useWallet: () => ({ signer: { address: mockIch } }) }));
jest.mock('@/lib/signer', () => ({ withTimeout: (p: Promise<any>) => p }));
jest.mock('@/lib/umzug', () => ({
  ...jest.requireActual('@/lib/umzug'),
  codeErzeugen: () => 'ABCDEFGHJKMNPQRSTVWXYZ01',
  codeHinterlegen: () => mockHinterlegen(),
  umzugStand: async () => ({ aktivAb: 1, codeSeit: mockSeit, offen: null }),
}));

import Wiederherstellungscode from '../../app/wiederherstellungscode';

// Das erste Rendern des ganzen Bildschirms laedt react-native kalt; im CI
// dauerte das ueber 5 s (lokal 0,7 s) -- mehr Zeit, dieselben Erwartungen.
jest.setTimeout(30_000);

async function durchlauf() {
  let r: any;
  await act(async () => { r = TestRenderer.create(<Wiederherstellungscode />); });
  await act(async () => {});
  const eins = (id: string) => r.root.findAll((n: any) => n.props.testID === id)[0];
  await act(async () => { eins('code-erzeugen').props.onPress(); });
  await act(async () => { eins('code-eingabe').props.onChangeText('ABCD-EFGH-JKMN-PQRS-TVWX-YZ01'); });
  await act(async () => { eins('code-hinterlegen').props.onPress(); });
  await act(async () => {});
  const texte = r.root.findAllByType(require('react-native').Text).map((x: any) => x.props.children).flat();
  act(() => r.unmount());
  return texte;
}

describe('Code doch angekommen', () => {
  beforeEach(() => { mockSeit = 0; });

  it('Fehlermeldung, aber auf der Kette: gespeichert', async () => {
    mockHinterlegen = async () => { mockSeit = 1794163745; return { ok: false, meldung: 'HTTP 502' }; };
    const texte = await durchlauf();
    expect(texte).toContain('umzug.codeFertig');
  });

  it('Zeit abgelaufen (Ausnahme), aber auf der Kette: gespeichert', async () => {
    mockHinterlegen = async () => { mockSeit = 1794163745; throw new Error('timeout'); };
    expect(await durchlauf()).toContain('umzug.codeFertig');
  });

  it('nicht auf der Kette: der Fehler bleibt', async () => {
    mockHinterlegen = async () => ({ ok: false, meldung: 'HTTP 502' });
    const texte = await durchlauf();
    expect(texte).not.toContain('umzug.codeFertig');
    expect(texte).toContain('umzug.codeFehler');
  });
});
