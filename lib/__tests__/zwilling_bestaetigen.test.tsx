/**
 * app/zwilling-bestaetigen.tsx (Pruefung 21.10.2026, MEDIUM-2 und LOW-1):
 * A signiert erst, nachdem er der eigenen Einwilligung fuer die gemeinsame
 * Aufnahme zugestimmt hat, und sieht B's VOLLE Adresse in Gruppen.
 */
import React from 'react';
const TestRenderer: any = require('react-test-renderer');
const { act } = TestRenderer;

const B = '0x83279fae0994aa1a563377e889cc2a1d96adb3b1';
const A = '0xfa17c5b66a985f44bc249c8e8fabd64767f414b1';
const ANFRAGE = 'ab'.repeat(16);
const C1 = 'https://proof1.aequitas.example';

jest.mock('expo-router', () => ({ router: { back: jest.fn(), replace: jest.fn(), canGoBack: () => true } }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: any) => children }));
jest.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (k: string, p?: Record<string, string>) => (p ? `${k}:${JSON.stringify(p)}` : k) }),
}));
const mockSigner = { signMessage: jest.fn(async () => '0xsig') };
jest.mock('@/contexts/WalletContext', () => ({ useWallet: () => ({ address: A, signer: mockSigner }) }));
let mockOnScanned: ((d: string) => void) | null = null;
jest.mock('@/components/QrScanner', () => ({
  QrScanner: (p: any) => { mockOnScanned = p.onScanned; return null; },
}));
const mockZustimmen = jest.fn(async () => ({ status: 'zugestimmt' }));
jest.mock('@/lib/biometricIdentity', () => ({
  coordinatorCandidates: () => [C1],
  zwillingZustimmen: (...a: any[]) => (mockZustimmen as any)(...a),
}));

import ZwillingBestaetigen from '../../app/zwilling-bestaetigen';

async function rendern() {
  let r: any;
  await act(async () => { r = TestRenderer.create(<ZwillingBestaetigen />); });
  await act(async () => { mockOnScanned!(`aequitas-zwilling:${ANFRAGE}:${B}:proof1.aequitas.example`); });
  return r;
}

const texte = (r: any): string[] =>
  r.root.findAll((n: any) => n.type === 'Text' || (n.type as any)?.displayName === 'Text')
    .map((n: any) => [].concat(n.props.children).join(''));

describe('Zwilling bestaetigen', () => {
  beforeEach(() => { mockZustimmen.mockClear(); mockSigner.signMessage.mockClear(); });

  it('ohne Haken keine Signatur -- der Knopf ist aus, und auch ein Druck darauf tut nichts', async () => {
    const r = await rendern();
    const knopf = r.root.findByProps({ testID: 'zwilling-bestaetigen' });
    expect(knopf.props.disabled).toBe(true);
    await act(async () => { knopf.props.onPress(); });
    expect(mockZustimmen).not.toHaveBeenCalled();
    expect(mockSigner.signMessage).not.toHaveBeenCalled();
  });

  it('mit Haken: Zustimmung mit der Einwilligung', async () => {
    const r = await rendern();
    await act(async () => { r.root.findByProps({ testID: 'zwilling-einwilligung' }).props.onPress(); });
    const knopf = r.root.findByProps({ testID: 'zwilling-bestaetigen' });
    expect(knopf.props.disabled).toBe(false);
    await act(async () => { knopf.props.onPress(); });
    expect(mockZustimmen).toHaveBeenCalledTimes(1);
    const [qr, wallet, signer, einw] = (mockZustimmen.mock.calls[0] as any[]);
    expect(qr).toEqual({ anfrage: ANFRAGE, walletB: B, base: C1 });
    expect(wallet).toBe(A);
    expect(signer).toBe(mockSigner);
    expect(einw).toEqual({ zugestimmt: true });
  });

  it('Haken wieder weg: wieder keine Signatur', async () => {
    const r = await rendern();
    const box = r.root.findByProps({ testID: 'zwilling-einwilligung' });
    await act(async () => { box.props.onPress(); });
    await act(async () => { r.root.findByProps({ testID: 'zwilling-einwilligung' }).props.onPress(); });
    expect(r.root.findByProps({ testID: 'zwilling-bestaetigen' }).props.disabled).toBe(true);
  });

  it('zeigt B\'s volle Adresse in Gruppen und den Einwilligungstext', async () => {
    const r = await rendern();
    const alle = texte(r);
    expect(alle).toContain('0x8327 9fae 0994 aa1a 5633 77e8 89cc 2a1d 96ad b3b1');
    expect(alle).toContain('identity.zwAConsentText');
    expect(alle).toContain('identity.zwAConsentCheckbox');
  });
});
