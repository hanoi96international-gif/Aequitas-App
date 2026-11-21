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
const mockAnnehmen = jest.fn();
const mockValidatorKennung = jest.fn();

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
  standardUmgebung: () => {
    const m = new Map<string, string>();
    return {
      speicher: { lesen: async (k: string) => m.get(k) ?? null, schreiben: async (k: string, v: string) => void m.set(k, v), loeschen: async () => {} },
      zufall: (n: number) => new Uint8Array(n).fill(9),
    };
  },
  zustandAnzeigen: (...a: any[]) => mockZustand(...a),
  neu: (...a: any[]) => mockNeu(...a),
  abholen: (...a: any[]) => mockAbholen(...a),
  einloesen: (...a: any[]) => mockEinloesen(...a),
  bestellungAnzeigen: (...a: any[]) => mockBestellung(...a),
  vergessen: jest.fn(),
}));

jest.mock('@/lib/quantenSStelle', () => ({
  ...jest.requireActual('@/lib/quantenSStelle'),
  annehmenAlsStelle: (...a: any[]) => mockAnnehmen(...a),
  validatorKennung: (...a: any[]) => mockValidatorKennung(...a),
}));
const mockWalletDa = jest.fn(async () => true);
jest.mock('@/lib/wallet', () => ({ unlockWallet: async () => ({ privateKey: '0x' + '81'.repeat(32) }), hasStoredWallet: () => mockWalletDa() }));
const mockNachweis = jest.fn();
jest.mock('@/lib/quantenSNachweis', () => ({ nachweisAbwarten: (...a: any[]) => mockNachweis(...a) }));
jest.mock('@/components/QrScanner', () => ({ QrScanner: (p: any) => require('react').createElement('Scanner', p) }));

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


describe('Annahmestelle', () => {
  const ich = stelle(0x81);
  const C1 = { stelle: stelle(0x61), validator: '0x' + 'c1'.repeat(20) + '=https://knoten.test/api' };

  test('Bestellung: C1 und das eigene Konto als Stellen eintragen', async () => {
    mockZustand.mockResolvedValue(null);
    mockValidatorKennung.mockResolvedValue(C1);
    mockNeu.mockResolvedValue({ n: 1104, basen: [], inhaberin: '0x', inhaberin_schluessel: '04', stellen: [] });
    const r = await zeigen();
    const [c1Stelle] = knoepfe(r, 'node.qtC1');
    await act(async () => c1Stelle.props.onPress());
    await act(async () => knopf(r, 'node.qtMeinKonto').props.onPress());
    await act(async () => knopf(r, 'node.qtAnlegen').props.onPress());
    const [, , , stellen] = mockNeu.mock.calls[0];
    expect(stellen[0]).toEqual({ adresse: C1.stelle.split('=')[0], schluessel: C1.stelle.split('=')[1] });
    expect(stellen[1]).toEqual({ adresse: ich.split('=')[0], schluessel: ich.split('=')[1] });
  });

  test('ohne eigene Wallet: Mein Konto nimmt einen Schluessel des Geraets und sagt es', async () => {
    mockZustand.mockResolvedValue(null);
    mockWalletDa.mockResolvedValueOnce(false);
    const r = await zeigen();
    await act(async () => knopf(r, 'node.qtMeinKonto').props.onPress());
    expect(texte(r).join(' ')).toContain('node.qtGeraeteStelle');
    const w = new ethers.Wallet('0x' + '09'.repeat(32)); // Zufall des Geraets im Test: lauter 0x09
    const geraet = w.address.toLowerCase() + '=' + w.signingKey.publicKey.slice(2);
    const eingaben = r.findAllByType(RN.TextInput).map((x: any) => x.props.value);
    expect(eingaben).toContain(geraet);
  });

  test('Fehler beim Eintragen: als Fenster, nicht nur unten auf der Seite', async () => {
    mockZustand.mockResolvedValue(null);
    mockValidatorKennung.mockRejectedValueOnce(new Error('Validator-Dienst: keine Antwort'));
    const alert = jest.spyOn(RN.Alert, 'alert').mockImplementation(() => {});
    const r = await zeigen();
    await act(async () => knoepfe(r, 'node.qtC1')[0].props.onPress());
    expect(alert).toHaveBeenCalledWith('node.qtFehler', 'Validator-Dienst: keine Antwort');
    alert.mockRestore();
  });

  test('eigene Kennung zeigen: QR mit adresse=schluessel (nichts Geheimes)', async () => {
    mockZustand.mockResolvedValue(null);
    const r = await zeigen();
    await act(async () => knopf(r, 'node.qtKennung').props.onPress());
    const qrs = r.findAllByType('QR' as any).map((q: any) => q.props.value);
    expect(qrs).toContain(ich);
    expect(qrs.join()).not.toContain('81'.repeat(32));
  });

  test('Vorlage scannen: erst mit Validatoren; der gescannte Text geht unveraendert an die Annahme', async () => {
    mockZustand.mockResolvedValue(null);
    mockValidatorKennung.mockResolvedValue(C1);
    mockAnnehmen.mockResolvedValue({ k: 'ab'.repeat(32), stelle_nummer: 1, stelle: ich.split('=')[0], inhaberin: '0x', stichprobe: 552, treffer: 290, fehler: 2, vorab: 'besteht', urteil: 'eingeloest',
      wurzel: 'cd'.repeat(32), proben: ['ee'.repeat(32), 'ff'.repeat(32)] });
    const r = await zeigen();
    expect(knopf(r, 'node.qtScannen').props.disabled).toBe(true);
    const c1Knoepfe = knoepfe(r, 'node.qtC1');
    await act(async () => c1Knoepfe[c1Knoepfe.length - 1].props.onPress()); // Validatoren der Annahmestelle
    expect(knopf(r, 'node.qtScannen').props.disabled).toBe(false);
    await act(async () => knopf(r, 'node.qtScannen').props.onPress());
    const scanner = r.findByType('Scanner' as any);
    expect(scanner.props.visible).toBe(true);
    await act(async () => scanner.props.onScanned('{"k":"…"}'));
    const [, schluessel, text, validatoren] = mockAnnehmen.mock.calls[0];
    expect(schluessel).toBe('81'.repeat(32));
    expect(text).toBe('{"k":"…"}');
    expect(validatoren).toEqual([{ adresse: '0x' + 'c1'.repeat(20), api: 'https://knoten.test/api' }]);
    expect(texte(r).join(' ')).toContain('node.qtAErgebnis');
    expect(r.findByType('Scanner' as any).props.visible).toBe(false);
    // Nach dem Einloesen: Nachweis pruefen -- gegen Wurzel und Proben aus der Annahme.
    mockNachweis.mockResolvedValue({ n: 1104, fehler: 5, treffer: 580, fehler_stelle: 2, treffer_stelle: 290 });
    await act(async () => knopf(r, 'node.qtNachweis').props.onPress());
    const [, k, vs, wurzel, proben] = mockNachweis.mock.calls[0];
    expect([k, wurzel, proben]).toEqual(['ab'.repeat(32), 'cd'.repeat(32), ['ee'.repeat(32), 'ff'.repeat(32)]]);
    expect(vs).toEqual([{ adresse: '0x' + 'c1'.repeat(20), api: 'https://knoten.test/api' }]);
    expect(texte(r).join(' ')).toContain('node.qtNachweisOk');
  });

  test('Annahme abgebrochen (z. B. Vorlage fuer die andere Stelle): Fehler steht da', async () => {
    mockZustand.mockResolvedValue(null);
    mockValidatorKennung.mockResolvedValue(C1);
    mockAnnehmen.mockRejectedValue(new Error('die Vorlage ist fuer Stelle 0, das ist nicht dieses Konto'));
    const r = await zeigen();
    const c1Knoepfe = knoepfe(r, 'node.qtC1');
    await act(async () => c1Knoepfe[c1Knoepfe.length - 1].props.onPress());
    await act(async () => knopf(r, 'node.qtScannen').props.onPress());
    await act(async () => r.findByType('Scanner' as any).props.onScanned('x'));
    expect(texte(r).join(' ')).toContain('nicht dieses Konto');
  });
});
