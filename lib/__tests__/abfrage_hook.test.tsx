/**
 * hooks/use-abfrage.ts: im Hintergrund keine Abfragen, beim Zurueckkehren
 * sofort eine; und die Bildschirme fragen nicht mehr mit setInterval ab.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer: any = require('react-test-renderer');
const { act } = TestRenderer;

const mockHoerer = new Set<(s: string) => void>();
const mockAppState = { currentState: 'active' as string };
jest.mock('react-native', () => ({
  AppState: {
    get currentState() {
      return mockAppState.currentState;
    },
    addEventListener: (_: string, h: (s: string) => void) => {
      mockHoerer.add(h);
      return { remove: () => mockHoerer.delete(h) };
    },
  },
}));
jest.mock('expo-router', () => ({ useFocusEffect: () => undefined }));

import { useAbfrageImVordergrund } from '../../hooks/use-abfrage';

function wechsel(s: string) {
  mockAppState.currentState = s;
  mockHoerer.forEach((h) => h(s));
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('useAbfrageImVordergrund', () => {
  it('ruht im Hintergrund und fragt beim Zurueckkehren sofort ab', async () => {
    const lade = jest.fn(async () => true);
    function Probe() {
      useAbfrageImVordergrund(lade, 10_000);
      return null;
    }
    let r: any;
    await act(async () => {
      r = TestRenderer.create(<Probe />);
    });
    expect(lade).toHaveBeenCalledTimes(1);
    await act(async () => wechsel('background'));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(30 * 60 * 1000);
    });
    expect(lade).toHaveBeenCalledTimes(1);
    await act(async () => wechsel('active'));
    expect(lade).toHaveBeenCalledTimes(2);
    await act(async () => r.unmount());
    expect(mockHoerer.size).toBe(0);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000);
    });
    expect(lade).toHaveBeenCalledTimes(2);
  });

  it('ohne Ladefunktion keine Abfrage und kein Hoerer', async () => {
    function Probe() {
      useAbfrageImVordergrund(null, 10_000);
      return null;
    }
    await act(async () => {
      TestRenderer.create(<Probe />);
    });
    expect(mockHoerer.size).toBe(0);
  });
});

describe('Bildschirme', () => {
  const lesen = (p: string) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8');
  it('fragen den Knoten nicht mehr mit setInterval ab', () => {
    expect(lesen('app/(tabs)/index.tsx')).not.toMatch(/setInterval\(loadBlocks/);
    const trade = lesen('app/(tabs)/trade.tsx');
    expect(trade).not.toMatch(/setInterval\(load/);
    expect(lesen('contexts/WalletContext.tsx')).not.toMatch(/setInterval\(refreshBalance/);
    expect(trade).toMatch(/useAbfrage\(loadPool/);
  });

  // Eine spaete Antwort fuer eine fruehere Adresse ueberschreibt den Stand
  // der aktuellen nicht (Pruefung von #33).
  it('verwerfen spaete Antworten fuer eine fruehere Adresse', () => {
    const wallet = lesen('contexts/WalletContext.tsx');
    expect(wallet).toMatch(/if \(adresseRef\.current !== address\) return true;\s*setBalance\(b\)/);
    expect(lesen('app/(tabs)/trade.tsx')).toMatch(/if \(adresseRef\.current === address\) setLpPosition\(lp\)/);
  });
});
