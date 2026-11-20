/**
 * app/quanten-token.tsx: die App als Inhaberin. Ohne Bestellung nur
 * "Bestellen"; mit Bestellung "Abholen"; mit Token "Einloesen" und danach die
 * Vorlage als QR. Fehler aus lib/quantenSInhaberin stehen sichtbar da; die
 * Seite prueft nichts selbst, sie reicht durch.
 */
import React from 'react';
const TestRenderer: any = require('react-test-renderer');
const { act } = TestRenderer;

const mockZustand = jest.fn();
const mockNeu = jest.fn();
const mockAbholen = jest.fn();
const mockEinloesen = jest.fn();
const mockBestellung = jest.fn();

jest.mock('expo-router', () => {
  const R = require('react');
  return { useFocusEffect: (f: any) => R.useEffect(f, [f]) };
});
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('react-native-qrcode-svg', () => (p: any) => require('react').createElement('QR', p));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: any) => children }));
jest.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (k: string) => k, lang: 'de' }) }));
jest.mock('@/lib/quantenSInhaberin', () => ({
  ...jest.requireActual('@/lib/quantenSInhaberin'),
  standardUmgebung: () => ({}),
  zustandAnzeigen: (...a: any[]) => mockZustand(...a),
  neu: (...a: any[]) => mockNeu(...a),
  abholen: (...a: any[]) => mockAbholen(...a),
  einloesen: (...a: any[]) => mockEinloesen(...a),
  bestellungAnzeigen: (...a: any[]) => mockBestellung(...a),
  vergessen: jest.fn(),
}));

import QuantenToken from '../../app/quanten-token';
const RN = require('react-native');
const { ethers } = require('ethers');

const texte = (n: any) => n.findAllByType(RN.Text).map((x: any) => x.props.children).flat().map(String);
// Nur echte Knoepfe (TouchableOpacity), nicht ihre inneren Knoten.
const knoepfe = (n: any, text: string) => n.findAllByType(RN.TouchableOpacity).filter((x: any) => texte(x).includes(text));
const knopf = (n: any, text: string) => knoepfe(n, text)[0];
const stelle = (s: number) => {
  const w = new ethers.Wallet('0x' + s.toString(16).repeat(64).slice(0, 64));
  return w.address.toLowerCase() + '=' + w.signingKey.publicKey.slice(2);
};

async function zeigen() {
  let r: any;
  await act(async () => {
    r = TestRenderer.create(<QuantenToken />);
  });
  return r.root;
}

beforeEach(() => jest.clearAllMocks());

test('ohne Bestellung: nur Bestellen; die Bestellung geht mit den gelesenen Stellen an neu', async () => {
  mockZustand.mockResolvedValue(null);
  mockNeu.mockResolvedValue({ n: 1104, basen: ['0'], inhaberin: '0x' + 'b'.repeat(40), inhaberin_schluessel: '04', stellen: [] });
  const root = await zeigen();
  expect(texte(root)).toContain('node.qtKeiner');
  expect(texte(root)).not.toContain('node.qtSchritt3');
  const eingaben = root.findAllByType(RN.TextInput);
  await act(async () => {
    eingaben[2].props.onChangeText(stelle(3));
    eingaben[3].props.onChangeText(stelle(5));
  });
  await act(async () => knopf(root, 'node.qtAnlegen').props.onPress());
  expect(mockNeu).toHaveBeenCalledTimes(1);
  const [, n, v, st] = mockNeu.mock.calls[0];
  expect([n, v, st.length]).toEqual([1104, 1, 2]);
  expect(texte(root)).toContain('node.qtAngelegt');
});

test('offene Bestellung: kein zweites Bestellen; die Bestellung wird gezeigt (QR), Abholen moeglich', async () => {
  const best = { n: 10, basen: ['01010', '10101'], inhaberin: '0x' + 'b'.repeat(40), inhaberin_schluessel: '04', stellen: [] };
  mockZustand.mockResolvedValue({ n: 10, v: 2, stellen: ['0x1', '0x2'], gebunden: false });
  mockBestellung.mockResolvedValue(best);
  const root = await zeigen();
  expect(knoepfe(root, 'node.qtAnlegen').length).toBe(0);
  expect(JSON.parse(root.findByType('QR' as any).props.value)).toEqual(best);
  expect(texte(root)).toContain('node.qtSchritt2');
});

test('eine Stelle ohne passenden Schluessel: sichtbarer Fehler, kein Aufruf', async () => {
  mockZustand.mockResolvedValue(null);
  const root = await zeigen();
  const eingaben = root.findAllByType(RN.TextInput);
  await act(async () => {
    eingaben[2].props.onChangeText(stelle(3).split('=')[0] + '=' + stelle(5).split('=')[1]);
    eingaben[3].props.onChangeText(stelle(5));
  });
  await act(async () => knopf(root, 'node.qtAnlegen').props.onPress());
  expect(mockNeu).not.toHaveBeenCalled();
  expect(texte(root).join(' ')).toContain('gehoert nicht zur Adresse');
});

test('mit Token: Einloesen fuer Stelle 1, danach die Vorlage als QR', async () => {
  mockZustand.mockResolvedValue({ n: 10, v: 2, k: 'ab'.repeat(32), stellen: ['0x1', '0x2'], gebunden: false });
  const vl = { k: 'ab'.repeat(32), b: 1, x: '1011001011', vorlage: '0x' + '1'.repeat(130) };
  mockEinloesen.mockImplementation(async (_u: any, _b: number, f: any) => {
    f('binden');
    f('waehlen');
    f('vorlage');
    return vl;
  });
  const root = await zeigen();
  expect(texte(root)).toContain('node.qtSchritt3');
  expect(texte(root)).not.toContain('node.qtSchritt1');
  const stelle1 = knoepfe(root, 'node.qtStelle')[1];
  await act(async () => stelle1.props.onPress());
  expect(mockEinloesen.mock.calls[0][1]).toBe(1);
  const qr = root.findByType('QR' as any);
  expect(JSON.parse(qr.props.value)).toEqual(vl);
  expect(texte(root)).toContain('node.qtVorlageFertig');
  // Die Vorlage wirkt bei der Stelle wie Bargeld: kein Kopieren in die Zwischenablage.
  expect(knoepfe(root, 'node.qtKopieren').length).toBe(0);
});

test('Fehler beim Abholen steht da, die Seite bleibt bedienbar', async () => {
  mockZustand.mockResolvedValue({ n: 10, v: 2, stellen: ['0x1', '0x2'], gebunden: false });
  mockBestellung.mockResolvedValue(null);
  mockAbholen.mockRejectedValue(new Error('Abschnitt 1 ist nicht von Validator 1 unterschrieben'));
  const root = await zeigen();
  const eingaben = root.findAllByType(RN.TextInput);
  await act(async () => {
    eingaben[0].props.onChangeText('ab'.repeat(32));
    eingaben[1].props.onChangeText('0x' + 'c'.repeat(40) + '=https://v.test/api');
  });
  await act(async () => knopf(root, 'node.qtAbholen').props.onPress());
  expect(mockAbholen).toHaveBeenCalledTimes(1);
  expect(texte(root).join(' ')).toContain('node.qtFehler Abschnitt 1 ist nicht von Validator 1 unterschrieben');
  expect(knopf(root, 'node.qtAbholen').props.disabled).toBe(false);
});
