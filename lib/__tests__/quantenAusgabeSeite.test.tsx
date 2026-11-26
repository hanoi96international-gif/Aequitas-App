/**
 * app/quanten-ausgabe.tsx: die App als Ausgeber in Weg B. Bestellen und Ausgeben
 * erst nach Bestätigung; die Bestellung der Inhaberin wird streng gelesen, bevor
 * beauftragt wird; je Stand nur die passenden Schritte.
 */
import React from 'react';
const TestRenderer: any = require('react-test-renderer');
const { act } = TestRenderer;

jest.mock('expo-router', () => {
  const R = require('react');
  return { useFocusEffect: (f: any) => R.useEffect(f, [f]) };
});
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: any) => children }));
jest.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (k: string) => k, lang: 'de' }) }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true), getStringAsync: async () => '' }));
jest.mock('@/lib/wallet', () => ({ unlockWallet: async () => ({ privateKey: '0x' + '11'.repeat(32) }) }));
jest.mock('@/lib/quantenSPraepGeraet', () => ({ praepUmgebung: () => ({}) }));
jest.mock('@/contexts/WalletContext', () => ({ useWallet: () => ({ signer: { address: '0x' + '9'.repeat(40) } }) }));

let mockZ: any = null;
// Wie viele im Los wären (Prüfung 26.11.: die Kette verlangt 3 · v); null = Register nicht lesbar.
let mockImLos: number | null = 30;
const mockLosGroesseHolen = jest.fn(async (..._a: any[]) => mockImLos);
const mockBestellen = jest.fn(async (..._a: any[]) => {});
const mockBeauftragen = jest.fn(async (..._a: any[]) => ({ gesendet: [1, 2, 3, 4, 5, 6, 7] }));
const mockAusgeben = jest.fn(async (..._a: any[]) => ({ stand: 'ausgegeben' }));
const mockPaket = jest.fn(async (..._a: any[]) => ({ briefe: 9 }));
const mockBriefkasten = jest.fn(async (..._a: any[]) => ({ briefe: 2, abgewiesen: [], beantwortet: [], bestaetigt: [], geoeffnet: [], wiederholt: [], abgelehnt: [], antworten: [{ k: 'k', x: 1, fertig: false }], bestaetigungen: [], offen: 0, quittiertBis: 2 }));
jest.mock('@/lib/quantenSAusgeber', () => ({
  bestellen: (...a: any[]) => mockBestellen(...a),
  bestellPfand: (d: number) => d / 10,
  losGroesseHolen: (...a: any[]) => mockLosGroesseHolen(...a),
  losNoetig: (v: number) => 3 * v,
  losStand: async () => ({ stand: 'warten', ab: 1_900_000_000, zustand: mockZ }),
  vergessen: async () => { mockZ = null; },
  zustandLesen: async () => mockZ,
}));
jest.mock('@/lib/quantenSAusgeberRunde', () => ({
  antwortenStand: async () => ({ fehlen: [3, 5] }),
  auftraegeSenden: async () => ({ gesendet: [3, 5] }),
  ausgeben: (...a: any[]) => mockAusgeben(...a),
  beauftragen: (...a: any[]) => mockBeauftragen(...a),
  bestaetigungenAnfordern: async () => ({ gesendet: [] }),
  bestaetigungenStand: async () => ({ fehlen: [] }),
  paketSenden: (...a: any[]) => mockPaket(...a),
}));
jest.mock('@/lib/quantenSAusgeberGeraet', () => ({
  ...jest.requireActual('@/lib/quantenSAusgeberGeraet'),
  ausgeberBriefkasten: (...a: any[]) => mockBriefkasten(...a),
}));

import QuantenAusgabe from '../../app/quanten-ausgabe';
const RN = require('react-native');

const K = 'ab'.repeat(32);
const Z = (stand: string, mehr: object = {}) => ({ k: K, ausgeber: '0x' + '9'.repeat(40), v: 7, t: 4, deckung: 1_000_000, zeit: 1, stand, buchzeit: 2, runde: 3, frist: 4_000_000_000, ...mehr });

async function rendern() {
  let r: any;
  await act(async () => { r = TestRenderer.create(<QuantenAusgabe />); });
  await act(async () => {});
  return r;
}
const texteIn = (n: any) => n.findAllByType(RN.Text).map((x: any) => x.props.children).flat().map(String);
const knopf = (r: any, text: string) => r.root.findAllByType(RN.TouchableOpacity).find((k: any) => texteIn(k).includes(text));

describe('Ausgabe-Seite (Weg B)', () => {
  let alert: jest.SpyInstance;
  beforeEach(() => {
    alert = jest.spyOn(RN.Alert, 'alert').mockImplementation(() => {});
    [mockBestellen, mockBeauftragen, mockAusgeben, mockPaket, mockBriefkasten].forEach((m) => m.mockClear());
  });
  afterEach(() => alert.mockRestore());

  it('ohne Bestellung: bestellen erst nach Bestätigung, mit Deckung und Pfand im Text', async () => {
    mockZ = null;
    const r = await rendern();
    expect(knopf(r, 'node.qaBeauftragen')).toBeUndefined();
    await act(async () => { knopf(r, 'node.qaBestellen').props.onPress(); });
    expect(mockBestellen).not.toHaveBeenCalled();
    const [titel, text, knoepfe] = alert.mock.calls[0] as any[];
    expect(titel).toBe('node.qpBestaetigenTitel');
    expect(text).toBe('node.qaBestellenFrage'); // t() der Attrappe ohne Platzhalter
    await act(async () => { knoepfe[1].onPress(); });
    await act(async () => {});
    expect(mockBestellen).toHaveBeenCalledTimes(1);
    expect(mockBestellen.mock.calls[0].slice(2)).toEqual([7, 4, 1_000_000]);
    act(() => r.unmount());
  });

  it('zu wenige im Los (Kettenregel 3 · v): Hinweis, Bestellen gesperrt; mit kleinerem v wieder frei', async () => {
    mockZ = null;
    mockImLos = 20;
    const r = await rendern();
    expect(mockLosGroesseHolen.mock.calls.at(-1)?.[1]).toBe('0x' + '9'.repeat(40));
    expect(texteIn(r.root)).toContain('node.qaLosZuKlein');
    expect(knopf(r, 'node.qaBestellen').props.disabled).toBe(true);
    const vFeld = r.root.findAllByType(RN.TextInput)[0];
    await act(async () => { vFeld.props.onChangeText('6'); });
    expect(texteIn(r.root)).toContain('node.qaLosGroesse');
    expect(knopf(r, 'node.qaBestellen').props.disabled).toBe(false);
    act(() => r.unmount());
    mockImLos = null;
    const r2 = await rendern();
    expect(texteIn(r2.root)).toContain('node.qaLosUnbekannt');
    expect(knopf(r2, 'node.qaBestellen').props.disabled).toBe(false); // die Kette prüft dann selbst
    act(() => r2.unmount());
    mockImLos = 30;
  });

  it('gelost: eine kaputte Bestellung der Inhaberin wird nie beauftragt; eine gute schon', async () => {
    mockZ = Z('gelost', { los: Array.from({ length: 7 }, (_, i) => '0x' + String(i + 1).repeat(40)) });
    const r = await rendern();
    expect(knopf(r, 'node.qaBestellen')).toBeUndefined();
    const feld = () => r.root.findAllByType(RN.TextInput).find((f: any) => f.props.multiline);
    await act(async () => { feld().props.onChangeText(JSON.stringify({ n: 1, basen: ['x'], basen_verschluesselt: [], stellen: [{}, {}] })); });
    await act(async () => { knopf(r, 'node.qaBeauftragen').props.onPress(); });
    await act(async () => {});
    expect(mockBeauftragen).not.toHaveBeenCalled();
    expect(String((alert.mock.calls[0] as any[])[1])).toContain('Weg B');
    const gut = { n: 2822, basen_verschluesselt: ['aa'], inhaberin: 'i', inhaberin_schluessel: 's', stellen: [{ adresse: 'a', schluessel: 'b' }, { adresse: 'c', schluessel: 'd' }] };
    await act(async () => { feld().props.onChangeText(JSON.stringify(gut)); });
    await act(async () => { knopf(r, 'node.qaBeauftragen').props.onPress(); });
    await act(async () => {});
    expect(mockBeauftragen).toHaveBeenCalledTimes(1);
    expect(mockBeauftragen.mock.calls[0][2]).toEqual(gut);
    expect(mockBeauftragen.mock.calls[0][3]).toBe(2);
    act(() => r.unmount());
  });

  it('beauftragt: fehlende Antworten sichtbar, Briefkasten zeigt den Bericht', async () => {
    mockZ = Z('beauftragt', { los: [] });
    const r = await rendern();
    expect(texteIn(r.root)).toContain('node.qaFehlenAntworten');
    await act(async () => { knopf(r, 'node.qaBriefkasten').props.onPress(); });
    await act(async () => {});
    expect(mockBriefkasten).toHaveBeenCalledTimes(1);
    expect(texteIn(r.root)).toContain('node.qaAntworten');
    expect(knopf(r, 'node.qaAusgeben')).toBeUndefined();
    act(() => r.unmount());
  });

  it('bestätigt: ausgeben erst nach Bestätigung; ausgegeben: Paket senden', async () => {
    mockZ = Z('bestaetigt');
    let r = await rendern();
    await act(async () => { knopf(r, 'node.qaAusgeben').props.onPress(); });
    expect(mockAusgeben).not.toHaveBeenCalled();
    await act(async () => { (alert.mock.calls[0] as any[])[2][1].onPress(); });
    await act(async () => {});
    expect(mockAusgeben).toHaveBeenCalledTimes(1);
    act(() => r.unmount());

    mockZ = Z('ausgegeben');
    r = await rendern();
    expect(knopf(r, 'node.qaAusgeben')).toBeUndefined();
    await act(async () => { knopf(r, 'node.qaPaket').props.onPress(); });
    await act(async () => {});
    expect(mockPaket).toHaveBeenCalledTimes(1);
    expect(knopf(r, 'node.qaVergessen')).toBeUndefined(); // Frist noch nicht vorbei
    act(() => r.unmount());
  });
});
