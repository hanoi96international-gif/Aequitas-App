/**
 * contexts/BindungsanfragenContext: Startseite und Tab-Leiste sehen eine
 * wartende Bindungsanfrage, ohne dass der Node-Tab offen ist -- und nur fuer
 * die aktuelle Wallet.
 */
import React from 'react';
const TestRenderer: any = require('react-test-renderer');
const { act } = TestRenderer;

const W1 = '0x' + '1'.repeat(40);
const W2 = '0x' + '2'.repeat(40);

let mockWallet: string | null = W1;
jest.mock('@/contexts/WalletContext', () => ({ useWallet: () => ({ address: mockWallet }) }));

const mockHole = jest.fn();
jest.mock('@/lib/knotenBindung', () => ({ holeBindungsanfragen: (w: string) => mockHole(w) }));

import { BindungsanfragenProvider, BINDUNGSANFRAGEN_INTERVALL_MS, useBindungsanfragen } from '@/contexts/BindungsanfragenContext';

const anfrage = (adresse: string, w: string) => ({ adresse, wallet: w, beweis: 'b', ip: '188.172.229.121', zeit: '' });

let gesehen: any[] = [];
function Leser() {
  gesehen = useBindungsanfragen().anfragen;
  return null;
}

async function rendern() {
  let r: any;
  await act(async () => {
    r = TestRenderer.create(<BindungsanfragenProvider><Leser /></BindungsanfragenProvider>);
  });
  return r;
}

beforeEach(() => {
  jest.useFakeTimers();
  mockHole.mockReset();
  mockWallet = W1;
  gesehen = [];
});
afterEach(() => jest.useRealTimers());

test('eine wartende Anfrage ist app-weit sichtbar und wird nachgeladen', async () => {
  mockHole.mockResolvedValueOnce([]).mockResolvedValue([anfrage('0xa', W1)]);
  const r = await rendern();
  expect(gesehen).toHaveLength(0);
  await act(async () => { jest.advanceTimersByTime(BINDUNGSANFRAGEN_INTERVALL_MS); });
  expect(gesehen).toHaveLength(1);
  expect(mockHole).toHaveBeenCalledWith(W1);
  r.unmount();
});

test('ohne Wallet wird nichts gefragt', async () => {
  mockWallet = null;
  mockHole.mockResolvedValue([anfrage('0xa', W1)]);
  const r = await rendern();
  await act(async () => { jest.advanceTimersByTime(BINDUNGSANFRAGEN_INTERVALL_MS * 2); });
  expect(mockHole).not.toHaveBeenCalled();
  expect(gesehen).toHaveLength(0);
  r.unmount();
});

test('Missbrauch: eine spaete Antwort fuer die vorige Wallet wird verworfen', async () => {
  let spaet: (v: any) => void = () => {};
  mockHole.mockImplementationOnce(() => new Promise((res) => { spaet = res; })).mockResolvedValue([]);
  const r = await rendern();
  mockWallet = W2;
  await act(async () => { r.update(<BindungsanfragenProvider><Leser /></BindungsanfragenProvider>); });
  await act(async () => { spaet([anfrage('0xa', W1)]); });
  expect(gesehen).toHaveLength(0);
  r.unmount();
});
