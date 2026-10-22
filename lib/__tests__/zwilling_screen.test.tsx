/**
 * app/zwilling.tsx: ist der Zwillingsweg beim Coordinator abgeschaltet
 * (/zwilling/anfrage -> 503 zwilling_nicht_aktiv), verschwindet der Einstieg
 * -- kein Code, keine Auswahl, eine ruhige Meldung; der Widerspruch bleibt.
 */
import React from 'react';
const TestRenderer: any = require('react-test-renderer');
const { act } = TestRenderer;

jest.mock('expo-router', () => ({ router: { back: jest.fn(), replace: jest.fn(), canGoBack: () => true } }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: any) => children }));
jest.mock('react-native-qrcode-svg', () => () => null);
jest.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (k: string) => k }),
}));
jest.mock('@/contexts/WalletContext', () => ({ useWallet: () => ({ address: '0x' + '2'.repeat(40) }) }));
let mockAbgeschaltet = false;
const mockAnlegen = jest.fn();
jest.mock('@/lib/biometricIdentity', () => {
  class ZwillingNichtAktiv extends Error {}
  return {
    zwillingAnfrageAnlegen: (...a: any[]) => (mockAnlegen as any)(...a),
    ZwillingNichtAktiv,
    zwillingStart: jest.fn(),
    zwillingWegAbgeschaltet: () => mockAbgeschaltet,
  };
});

import Zwilling from '../../app/zwilling';

describe('Zwillingsweg abgeschaltet', () => {
  beforeEach(() => {
    mockAbgeschaltet = false;
    mockAnlegen.mockReset();
    mockAnlegen.mockImplementation(async () => {
      mockAbgeschaltet = true;
      const { ZwillingNichtAktiv } = require('@/lib/biometricIdentity');
      throw new ZwillingNichtAktiv('zwilling_nicht_aktiv');
    });
  });

  it('nach 503 zwilling_nicht_aktiv: Meldung statt Knopf und Auswahl', async () => {
    let r: any;
    await act(async () => { r = TestRenderer.create(<Zwilling />); });
    await act(async () => { r.root.findByProps({ testID: 'zwilling-code-erstellen' }).props.onPress(); });
    expect(mockAnlegen).toHaveBeenCalledTimes(1);
    expect(r.root.findAllByProps({ testID: 'zwilling-code-erstellen' })).toHaveLength(0);
    expect(r.root.findAllByProps({ testID: 'zwilling-anzahl-1' })).toHaveLength(0);
    expect(r.root.findAllByProps({ testID: 'zwilling-nicht-aktiv' }).length).toBeGreaterThan(0);
  });

  it('schon bekannt abgeschaltet: der Einstieg erscheint gar nicht erst, ohne Anfrage', async () => {
    mockAbgeschaltet = true;
    let r: any;
    await act(async () => { r = TestRenderer.create(<Zwilling />); });
    expect(r.root.findAllByProps({ testID: 'zwilling-code-erstellen' })).toHaveLength(0);
    expect(r.root.findAllByProps({ testID: 'zwilling-nicht-aktiv' }).length).toBeGreaterThan(0);
    expect(mockAnlegen).not.toHaveBeenCalled();
  });
});
