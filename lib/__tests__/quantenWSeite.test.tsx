/**
 * app/quantengeld.tsx, Abschnitt "Note oder Token nachsehen": erst mit einer
 * gueltigen Kennung fragbar; zeigt W-Note, S-Token, tote Note, unbekannt und
 * Netzfehler so, wie lib/quantenW.ts sie liefert; "noch nicht freigeschaltet",
 * solange der Knoten aktiv = false meldet.
 */
import React from 'react';
const TestRenderer: any = require('react-test-renderer');
const { act } = TestRenderer;

const mockHole = jest.fn();

jest.mock('expo-router', () => {
  const R = require('react');
  return { useFocusEffect: (f: any) => R.useEffect(f, [f]) };
});
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: any) => children }));
jest.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (k: string) => k, lang: 'de' }) }));
jest.mock('@/contexts/WalletContext', () => ({ useWallet: () => ({ signer: { address: '0x' + 'a'.repeat(40) } }) }));
jest.mock('@/lib/signer', () => ({ withTimeout: (p: Promise<any>) => p }));
jest.mock('@/lib/prueferRegister', () => ({
  holeRegisterStand: async () => ({ aktiv: true, pruefer: [], antraege: [], abstimmungen: [] }),
}));
jest.mock('@/lib/quantengeld', () => ({
  ...jest.requireActual('@/lib/quantengeld'),
  holeQuantenStand: async () => ({ aktiv: false, topf: '0x' + '9'.repeat(40), saetze: [], noten: 0, gedecktAeq: 0, mindestDeckung: 1 }),
  holeQuantenAbstimmungen: async () => [],
}));
jest.mock('@/lib/quantenW', () => ({
  ...jest.requireActual('@/lib/quantenW'),
  holeQuantenWStand: (...a: any[]) => mockHole(...a),
}));

import Quantengeld from '../../app/quantengeld';
const RN = require('react-native');

jest.setTimeout(30_000);

const K = 'ab'.repeat(32);
const texteIn = (n: any) => n.findAllByType(RN.Text).map((x: any) => x.props.children).flat().map(String);

async function seite() {
  let r: any;
  await act(async () => { r = TestRenderer.create(<Quantengeld />); });
  await act(async () => {});
  const eingabe = r.root.findAllByType(RN.TextInput).find((x: any) => x.props.placeholder === 'K');
  const knopf = () => r.root.findAllByType(RN.TouchableOpacity).find((k: any) => texteIn(k).includes('node.qwAnzeigen'));
  return { r, eingabe, knopf };
}

async function zeige(stand: any) {
  mockHole.mockReset();
  mockHole.mockResolvedValue(stand);
  const { r, eingabe, knopf } = await seite();
  await act(async () => { eingabe.props.onChangeText(K); });
  expect(knopf().props.disabled).toBe(false);
  await act(async () => { knopf().props.onPress(); });
  await act(async () => {});
  expect(mockHole).toHaveBeenCalledWith(K);
  const t = texteIn(r.root);
  act(() => r.unmount());
  return t;
}

describe('Note oder Token nachsehen', () => {
  it('ohne gueltige Kennung kein Abruf; fremde Zeichen werden nicht angenommen', async () => {
    mockHole.mockReset();
    const { r, eingabe, knopf } = await seite();
    expect(knopf().props.disabled).toBe(true);
    await act(async () => { eingabe.props.onChangeText('xyz!' + 'ab'.repeat(5)); });
    const feld = r.root.findAllByType(RN.TextInput).find((x: any) => x.props.placeholder === 'K');
    expect(feld.props.value).toBe('ab'.repeat(5));
    expect(knopf().props.disabled).toBe(true);
    expect(texteIn(r.root)).toContain('node.qwUngueltig');
    expect(mockHole).not.toHaveBeenCalled();
    act(() => r.unmount());
  });

  it('Note W mit laufender Einloesung, noch nicht freigeschaltet', async () => {
    const t = await zeige({ ok: true, stand: { art: 'w', k: K, aktiv: false, n: 400, t: 3, v: 4, tol: 4, kNote: 160, frei: 380, fehl: 1, gesperrt: true, wertMikro: 10_000_000, anfrage: { k: 160, offen: 64, einloesen: true } } });
    expect(t).toEqual(expect.arrayContaining(['node.qwSchlafend', 'node.qwNote', '10.0000 AEQ', 'node.qwStellen', 'node.qwPruefung', 'node.qwFehl', 'node.qwGesperrt', 'node.qwEinloesung']));
    expect(t).not.toContain('node.qwLaeuft');
    expect(t).not.toContain('node.qwEinValidator');
  });

  it('Note W mit einem einzigen Validator: Hinweis, dass er das ganze Geheimnis kennt', async () => {
    const t = await zeige({ ok: true, stand: { art: 'w', k: K, aktiv: true, n: 400, t: 1, v: 1, tol: 4, kNote: 160, frei: 400, fehl: 0, gesperrt: false, wertMikro: 1_000_000, anfrage: null } });
    expect(t).toEqual(expect.arrayContaining(['node.qwNote', 'node.qwPruefung', 'node.qwEinValidator']));
  });

  it('Token S, freigeschaltet: kein Hinweis "schlafend"', async () => {
    const t = await zeige({ ok: true, stand: { art: 's', k: K, aktiv: true, n: 64, t: 3, v: 4, tol: 4, inhaber: '0x' + '7'.repeat(40), gebunden: false, gewaehlt: false, fehl: 0, wertMikro: 5_000_000, anmeldung: null, stichprobeNachBindung: false } });
    expect(t).toEqual(expect.arrayContaining(['node.qwToken', '5.0000 AEQ', 'node.qwInhaber', 'node.qwGeheimnisS', 'node.qwNichtGebunden']));
    expect(t).not.toContain('node.qwSchlafend');
    expect(t).not.toContain('node.qwEinloesung');
    expect(t).not.toContain('node.qwEinValidator');
  });

  it('Token S mit einem einzigen Validator: Hinweis; ohne v vom Knoten: keine Zeile dazu', async () => {
    const eins = await zeige({ ok: true, stand: { art: 's', k: K, aktiv: true, n: 64, t: 1, v: 1, tol: 4, inhaber: '0x' + '7'.repeat(40), gebunden: true, gewaehlt: true, fehl: 0, wertMikro: 1_000_000, anmeldung: null, stichprobeNachBindung: false } });
    expect(eins).toEqual(expect.arrayContaining(['node.qwGeheimnisS', 'node.qwEinValidator']));
    const alt = await zeige({ ok: true, stand: { art: 's', k: K, aktiv: true, n: 64, t: 1, v: null, tol: 4, inhaber: '0x' + '7'.repeat(40), gebunden: true, gewaehlt: true, fehl: 0, wertMikro: 1_000_000, anmeldung: null, stichprobeNachBindung: false } });
    expect(alt).not.toContain('node.qwGeheimnisS');
    expect(alt).not.toContain('node.qwEinValidator');
    expect(eins).not.toContain('node.qwStichprobeV2');
  });

  it('Token S mit Stichprobe v2: Hinweis "erst nach der Bindung"', async () => {
    const t = await zeige({ ok: true, stand: { art: 's', k: K, aktiv: true, n: 1104, t: 1, v: 1, tol: 2, inhaber: '0x' + '7'.repeat(40), gebunden: true, gewaehlt: true, fehl: 1, wertMikro: 1_000_000, anmeldung: null, stichprobeNachBindung: true } });
    expect(t).toEqual(expect.arrayContaining(['node.qwToken', 'node.qwStichprobeV2', 'node.qwEinValidator', 'node.qwGebunden']));
  });

  it('tote Note, unbekannt, Netzfehler', async () => {
    expect(await zeige({ ok: true, stand: { art: 'tot', k: K, aktiv: true } })).toContain('node.qwTot');
    expect(await zeige({ ok: false, grund: 'unbekannt' })).toContain('node.qwUnbekannt');
    expect(await zeige({ ok: false, grund: 'netz' })).toContain('node.qwFehler');
  });
});
