/**
 * app/quantengeld.tsx: nur Pruefer sehen "Zustimmen"; jede Stimme erst nach
 * Bestaetigung. Unter der Mindestzahl an Pruefern mit dem Hinweis, dass
 * nichts freischaltet; knapp darueber mit der Warnung, dass wenige Stimmen
 * freischalten; bei vielen Pruefern ohne Zusatz.
 */
import React from 'react';
const TestRenderer: any = require('react-test-renderer');
const { act } = TestRenderer;

const mockIch = '0x' + 'a'.repeat(40);
let mockPruefer: string[] = [];
const mockAbstimmen = jest.fn(async () => ({ ok: true, stimmen: 1, noetig: 1, eingereicht: true }));

jest.mock('expo-router', () => {
  const R = require('react');
  return { useFocusEffect: (f: any) => R.useEffect(f, [f]) };
});
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: any) => children }));
jest.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (k: string) => k, lang: 'de' }) }));
jest.mock('@/contexts/WalletContext', () => ({ useWallet: () => ({ signer: { address: mockIch } }) }));
jest.mock('@/lib/signer', () => ({ withTimeout: (p: Promise<any>) => p }));
jest.mock('@/lib/prueferRegister', () => ({
  holeRegisterStand: async () => ({ aktiv: true, pruefer: mockPruefer, antraege: [], abstimmungen: [] }),
}));
jest.mock('@/lib/quantengeld', () => ({
  ...jest.requireActual('@/lib/quantengeld'),
  holeQuantenStand: async () => ({ aktiv: true, topf: '0x' + '9'.repeat(40), saetze: [], noten: 0, gedecktAeq: 0, mindestDeckung: 1 }),
  holeQuantenAbstimmungen: async () => [{ satz: 'csidh-8192', ordnung: (BigInt(2) ** BigInt(256) + BigInt(297)).toString(), ab: 1_900_000_000, stimmen: 0, noetig: 1 }],
  quantenAbstimmen: (...a: any[]) => (mockAbstimmen as any)(...a),
}));

import Quantengeld from '../../app/quantengeld';
const RN = require('react-native');

jest.setTimeout(30_000);

async function rendern() {
  let r: any;
  await act(async () => { r = TestRenderer.create(<Quantengeld />); });
  await act(async () => {});
  return r;
}

const texteIn = (n: any) => n.findAllByType(RN.Text).map((x: any) => x.props.children).flat().map(String);
const texte = (r: any) => texteIn(r.root);

describe('Quantengeld-Seite', () => {
  it('a non-verifier sees status and votes, but no vote button', async () => {
    mockPruefer = ['0x' + 'b'.repeat(40)];
    const r = await rendern();
    const t = texte(r);
    expect(t).toContain('node.qKeinSatz');
    expect(t).toContain('node.qNurPruefer');
    expect(t).not.toContain('node.qZustimmen');
    act(() => r.unmount());
  });

  async function bestaetigungsText(pruefer: string[]): Promise<{ text: string; knoepfe: any[] }> {
    mockPruefer = pruefer;
    const alert = jest.spyOn(RN.Alert, 'alert').mockImplementation(() => {});
    const r = await rendern();
    const knopf = r.root.findAllByType(RN.TouchableOpacity).find((k: any) => texteIn(k).includes('node.qZustimmen'));
    expect(knopf).toBeTruthy();
    await act(async () => { knopf.props.onPress(); });
    expect(mockAbstimmen).not.toHaveBeenCalled();
    const [titel, text, knoepfe] = alert.mock.calls[0] as any[];
    expect(titel).toBe('node.qBestaetigenTitel');
    alert.mockRestore();
    act(() => r.unmount());
    return { text, knoepfe };
  }
  const andere = (n: number) => Array.from({ length: n }, (_, i) => '0x' + String(i + 1).repeat(40).slice(0, 40));

  it('a verifier must confirm; below the minimum it says nothing gets enabled yet', async () => {
    mockAbstimmen.mockClear();
    const { text, knoepfe } = await bestaetigungsText([mockIch]);
    expect(text).toContain('node.qZuWenigePruefer');
    expect(text).not.toContain('node.qWenigePruefer');
    await act(async () => { knoepfe[1].onPress(); });
    expect(mockAbstimmen).toHaveBeenCalledTimes(1);
  });

  it('just above the minimum it warns that few votes enable a set', async () => {
    mockAbstimmen.mockClear();
    const { text } = await bestaetigungsText([mockIch, ...andere(4)]);
    expect(text).toContain('node.qWenigePruefer');
    expect(text).not.toContain('node.qZuWenigePruefer');
  });

  it('with many verifiers there is no extra warning', async () => {
    mockAbstimmen.mockClear();
    const { text } = await bestaetigungsText([mockIch, ...andere(8)]);
    expect(text).not.toContain('node.qWenigePruefer');
    expect(text).not.toContain('node.qZuWenigePruefer');
  });
});
