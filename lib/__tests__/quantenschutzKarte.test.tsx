/**
 * components/QuantenschutzKarte.tsx: Quantenschutz ab Werk. Ein Mensch ohne
 * Zusage bekommt sie, ohne etwas zu tun; ein fremder Hash wird gemeldet;
 * fuer Nicht-Menschen und vor dem Stichtag passiert nichts.
 */
import React from 'react';
const TestRenderer: any = require('react-test-renderer');
const { act } = TestRenderer;

const mockAdresse = '0x' + 'a'.repeat(40);
// Stabil wie der Zustand im WalletContext (ein neues Objekt je Render liesse
// den Effekt bei jedem Render neu laufen).
const mockWallet = { signer: { address: mockAdresse, kind: 'local' } };
const mockAuto = jest.fn();
let mockStaende: any[] = [];

jest.mock('expo-router', () => {
  const R = require('react');
  return { useFocusEffect: (f: any) => R.useEffect(f, [f]), router: { push: jest.fn() } };
});
jest.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (k: string) => k }) }));
jest.mock('@/contexts/WalletContext', () => ({ useWallet: () => mockWallet }));
jest.mock('@/lib/pq', () => ({
  pqStand: jest.fn(async () => mockStaende.shift() ?? null),
  quantenschutzAutomatisch: (...a: any[]) => mockAuto(...a),
}));

import { QuantenschutzKarte } from '../../components/QuantenschutzKarte';
const RN = require('react-native');

const AB = 1700000000;
const texte = (r: any) => r.root.findAllByType(RN.Text).map((x: any) => String(x.props.children));
const ids = (r: any) => r.root.findAll((n: any) => typeof n.props?.testID === 'string').map((n: any) => n.props.testID);

async function rendern(istMensch: boolean) {
  let r: any;
  await act(async () => {
    r = TestRenderer.create(<QuantenschutzKarte istMensch={istMensch} />);
  });
  await act(async () => {});
  return r;
}

describe('Quantenschutz-Karte ab Werk', () => {
  beforeEach(() => {
    mockAuto.mockReset();
  });

  it('richtet den Schutz selbst ein und zeigt ihn danach als aktiv', async () => {
    mockStaende = [{ ab: AB, seit: 0, hash: '' }, { ab: AB, seit: AB + 5, hash: 'ab'.repeat(32) }];
    mockAuto.mockResolvedValue('eingerichtet');
    const r = await rendern(true);
    expect(mockAuto).toHaveBeenCalledTimes(1);
    expect(mockAuto.mock.calls[0][1]).toBe(true);
    expect(ids(r)).toContain('pq-aktiv');
    act(() => r.unmount());
  });

  it('meldet einen fremden Hash deutlich', async () => {
    mockStaende = [{ ab: AB, seit: 0, hash: '' }];
    mockAuto.mockResolvedValue('fremd');
    const r = await rendern(true);
    expect(ids(r)).toContain('pq-fremd');
    expect(texte(r)).toContain('pq.fremd');
    act(() => r.unmount());
  });

  it('ohne gemerkten Hash bleibt der Weg ueber die Phrase', async () => {
    mockStaende = [{ ab: AB, seit: 0, hash: '' }];
    mockAuto.mockResolvedValue('kein_hash');
    const r = await rendern(true);
    expect(ids(r)).toContain('pq-fehlt');
    expect(texte(r)).toContain('pq.karteLink');
    act(() => r.unmount());
  });

  it('fuer Nicht-Menschen, vor dem Stichtag und mit Zusage: kein Versuch', async () => {
    mockStaende = [{ ab: AB, seit: 0, hash: '' }];
    let r = await rendern(false);
    expect(ids(r)).toEqual([]);
    act(() => r.unmount());
    mockStaende = [{ ab: 4102444800, seit: 0, hash: '' }];
    r = await rendern(true);
    act(() => r.unmount());
    mockStaende = [{ ab: AB, seit: AB + 5, hash: 'ab'.repeat(32) }];
    r = await rendern(true);
    expect(ids(r)).toContain('pq-aktiv');
    act(() => r.unmount());
    expect(mockAuto).not.toHaveBeenCalled();
  });
});
