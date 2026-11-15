/**
 * components/ValidatorKarte.tsx: zeigt, ob die Wallet eingetragener Validator
 * ist, und die Bloecke heute und insgesamt. Ist der Stand nicht lesbar, steht
 * das da -- nie "nicht eingetragen".
 */
import React from 'react';
const TestRenderer: any = require('react-test-renderer');
const { act } = TestRenderer;

let mockErgebnis: any = { ok: false, fehler: 'nicht_lesbar' };

jest.mock('expo-router', () => {
  const R = require('react');
  return { useFocusEffect: (f: any) => R.useEffect(f, [f]) };
});
jest.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (k: string) => k, lang: 'de' }) }));
jest.mock('@/lib/validatorStand', () => ({
  ...jest.requireActual('@/lib/validatorStand'),
  holeValidatorStand: async () => mockErgebnis,
}));

import { ValidatorKarte } from '../../components/ValidatorKarte';

jest.setTimeout(30_000);

const W = '0x0be8b961cbf6564bd1931b0803d35c0659e0d016';
const K = '0x3066639af1653325100c1074a9696612dbdc42dc';

async function texte(): Promise<string[]> {
  let r: any;
  await act(async () => { r = TestRenderer.create(<ValidatorKarte wallet={W} />); });
  await act(async () => {});
  const t = r.root.findAllByType(require('react-native').Text).map((x: any) => x.props.children).flat().map(String);
  act(() => r.unmount());
  return t;
}

function stand(over: Record<string, unknown> = {}) {
  return {
    ok: true,
    stand: {
      wallet: W, eingetragen: true, erzeuger: true, tagBeginn: 1794697200,
      schluessel: [{ adresse: K, kette: true, ueberholt: false, knoten: true, erzeuger: true, bloeckeHeute: 3600, bloeckeGesamt: 6000, letzterBlock: 1794771000 }],
      bloeckeHeute: 3600, bloeckeGesamt: 6000, letzterBlock: 1794771000, ...over,
    },
  };
}

describe('ValidatorKarte', () => {
  it('shows a registered producer with blocks today and total', async () => {
    mockErgebnis = stand();
    const t = await texte();
    expect(t).toContain('node.valStatusErzeuger');
    expect(t).toContain((3600).toLocaleString());
    expect(t).toContain((6000).toLocaleString());
    expect(t).toContain('0x3066…42dc');
  });

  it('shows "registered, not yet a producer"', async () => {
    mockErgebnis = stand({ erzeuger: false });
    expect(await texte()).toContain('node.valStatusEingetragen');
  });

  it('shows "not registered" only when the node says so', async () => {
    mockErgebnis = stand({ eingetragen: false, erzeuger: false, schluessel: [], bloeckeHeute: 0, bloeckeGesamt: 0, letzterBlock: 0 });
    const t = await texte();
    expect(t).toContain('node.valStatusNein');
    expect(t).not.toContain('node.valHeute');
  });

  it('a read failure says "not readable", never "not registered"', async () => {
    mockErgebnis = { ok: false, fehler: 'nicht_lesbar' };
    const t = await texte();
    expect(t).toContain('node.valNichtLesbar');
    expect(t).not.toContain('node.valStatusNein');
  });
});
