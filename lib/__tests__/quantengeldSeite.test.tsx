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

let mockUeberblick: any = null;
jest.mock('@/lib/quantenW', () => ({
  ...jest.requireActual('@/lib/quantenW'),
  holeQuantenWUeberblick: async () => mockUeberblick,
}));

// Weg B (lib/quantenSPraeparator.ts): Register als Attrappe, Einreichen gezaehlt.
let mockRegister: any = null;
const mockEinreichen = jest.fn(async () => {});
jest.mock('@/lib/quantenSPraeparator', () => ({
  ...jest.requireActual('@/lib/quantenSPraeparator'),
  holeRegister: async () => mockRegister,
  praepEinreichen: (...a: any[]) => (mockEinreichen as any)(...a),
}));

// Weg B, Runde der Praeparatorin (lib/quantenSPraepGeraet.ts): als Attrappe.
let mockZugangDa = false;
const mockZugangSetzen = jest.fn(async (_z: any) => { mockZugangDa = true; });
const mockRunde = jest.fn(async (_w: any) => ({ briefe: 3, abgewiesen: [], beantwortet: ['k'], bestaetigt: [], geoeffnet: [], wiederholt: [], abgelehnt: [], antworten: [], bestaetigungen: [], offen: 0, quittiertBis: 3 }));
jest.mock('@/lib/quantenSPraepGeraet', () => ({
  ibmZugangDa: async () => mockZugangDa,
  ibmZugangSetzen: (z: any) => mockZugangSetzen(z),
  ibmZugangLoeschen: async () => { mockZugangDa = false; },
  praepRundeJetzt: (w: any) => mockRunde(w),
}));
jest.mock('@/lib/wallet', () => ({ unlockWallet: async () => ({ privateKey: '0x' + '11'.repeat(32) }) }));

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

  it('shows the W/S overview with the chain verdict only when the node reports it', async () => {
    mockPruefer = [];
    mockUeberblick = null;
    let r = await rendern();
    expect(texte(r)).not.toContain('node.qwuTitel');
    act(() => r.unmount());
    mockUeberblick = {
      aktiv: true, notenW: 0, tokenS: 0, beendet: 1, eingeloest: 1, tot: 0, urteilOffen: 0, topfMikro: 0, stand: 1795370000,
      zuletzt: [{ k: 'ff'.repeat(32), urteil: 'eingeloest', ende: 1795369000 }],
    };
    r = await rendern();
    const t = texte(r);
    expect(t).toContain('node.qwuTitel');
    expect(t).toContain('node.qwTotEingeloest');
    expect(t).not.toContain('node.qwuKeine');
    act(() => r.unmount());
    mockUeberblick = null;
  });

  it('Weg B: no card without a register, no button while asleep, register only after confirming', async () => {
    mockPruefer = [];
    mockRegister = null;
    let r = await rendern();
    expect(texte(r)).not.toContain('node.qpTitel');
    act(() => r.unmount());

    mockRegister = { aktiv: false, vorlauf: 86400, nachlauf: 695160, eintraege: [] };
    r = await rendern();
    let t = texte(r);
    expect(t).toContain('node.qpTitel');
    expect(t).toContain('node.qpSchlafend');
    expect(t).not.toContain('node.qpMelden');
    act(() => r.unmount());

    mockEinreichen.mockClear();
    mockRegister = { aktiv: true, vorlauf: 86400, nachlauf: 695160, eintraege: [] };
    const alert = jest.spyOn(RN.Alert, 'alert').mockImplementation(() => {});
    r = await rendern();
    t = texte(r);
    expect(t).toContain('node.qpNicht');
    const knopf = r.root.findAllByType(RN.TouchableOpacity).find((k: any) => texteIn(k).includes('node.qpMelden'));
    expect(knopf).toBeTruthy();
    await act(async () => { knopf.props.onPress(); });
    expect(mockEinreichen).not.toHaveBeenCalled();
    const [titel, text, knoepfe] = alert.mock.calls[0] as any[];
    expect(titel).toBe('node.qpBestaetigenTitel');
    expect(text).toBe('node.qpBestaetigenMelden');
    await act(async () => { knoepfe[1].onPress(); });
    expect(mockEinreichen).toHaveBeenCalledTimes(1);
    expect((mockEinreichen.mock.calls[0] as any[])[0]).toBe('melden');
    expect((mockEinreichen.mock.calls[0] as any[])[1]).toBe(mockIch);
    alert.mockRestore();
    act(() => r.unmount());

    // Gemeldet und im Los: nur Abmelden wird angeboten.
    mockRegister = { aktiv: true, vorlauf: 86400, nachlauf: 695160, eintraege: [{ konto: mockIch, gemeldet: 1000, imLosAb: 87400 }] };
    r = await rendern();
    t = texte(r);
    expect(t).toContain('node.qpImLos');
    expect(t).toContain('node.qpAbmelden');
    expect(t).not.toContain('node.qpMelden');
    act(() => r.unmount());
    mockRegister = null;
  });

  it('Weg B: the IBM access is saved, never shown again; the round runs and reports', async () => {
    mockPruefer = [];
    mockZugangDa = false;
    mockRunde.mockClear();
    mockZugangSetzen.mockClear();
    // Nicht gemeldet: keine Runde, kein Feld.
    mockRegister = { aktiv: true, vorlauf: 86400, nachlauf: 695160, eintraege: [] };
    let r = await rendern();
    expect(texte(r)).not.toContain('node.qrTitel');
    act(() => r.unmount());

    mockRegister = { aktiv: true, vorlauf: 86400, nachlauf: 695160, eintraege: [{ konto: mockIch, gemeldet: 1000, imLosAb: 87400 }] };
    r = await rendern();
    expect(texte(r)).toContain('node.qrTitel');
    expect(texte(r)).not.toContain('node.qrRunde'); // ohne Zugang keine Runde
    const praepFelder = () => r.root.findAllByType(RN.TextInput).filter((f: any) => f.props.secureTextEntry || String(f.props.placeholder ?? '').startsWith('crn:'));
    const felder = praepFelder();
    expect(felder).toHaveLength(2);
    expect(felder[0].props.secureTextEntry).toBe(true);
    expect(felder[1].props.secureTextEntry).toBeFalsy();
    const SCHLUESSEL = 'S'.repeat(44);
    await act(async () => { felder[0].props.onChangeText(SCHLUESSEL); felder[1].props.onChangeText('crn:x'); });
    const sichern = r.root.findAllByType(RN.TouchableOpacity).find((k: any) => texteIn(k).includes('node.qrSpeichern'));
    await act(async () => { sichern.props.onPress(); });
    expect(mockZugangSetzen).toHaveBeenCalledWith({ apiKey: SCHLUESSEL, crn: 'crn:x' });
    // Gesichert: Felder weg, Schluessel nirgends mehr auf der Seite.
    expect(praepFelder()).toHaveLength(0);
    expect(r.root.findAllByType(RN.TextInput).some((f: any) => f.props.value === SCHLUESSEL)).toBe(false);
    expect(JSON.stringify(texte(r))).not.toContain(SCHLUESSEL);
    expect(texte(r)).toContain('node.qrZugangDa');
    const runde = r.root.findAllByType(RN.TouchableOpacity).find((k: any) => texteIn(k).includes('node.qrRunde'));
    await act(async () => { runde.props.onPress(); });
    expect(mockRunde).toHaveBeenCalledTimes(1);
    expect(texte(r)).toContain('node.qrBeantwortet');
    act(() => r.unmount());
    mockRegister = null;
  });
});
