/**
 * components/Verlauf.tsx: Grundeinkommen und Umlaufabgabe derselben Runde
 * stehen als eine Netto-Zeile -- und nichts ist versteckt: Antippen zeigt
 * beide Buchungen mit Blockhoehe und Transaktion sowie den Rechenweg.
 */
import React from 'react';
const TestRenderer: any = require('react-test-renderer');
const { act } = TestRenderer;

const mockVerlauf = jest.fn();
jest.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({
    t: (k: string, p?: Record<string, string>) => (p ? k + JSON.stringify(p) : k),
    lang: 'de',
  }),
}));
jest.mock('@/lib/api', () => ({ getVerlauf: (...a: any[]) => mockVerlauf(...a) }));
const mockRunde = jest.fn();
jest.mock('@/lib/wirtschaftRunde', () => ({ holeRunde: (...a: any[]) => mockRunde(...a) }));

import { Verlauf } from '../../components/Verlauf';
const RN = require('react-native');

const texte = (r: any): string =>
  r.root.findAllByType(RN.Text).map((x: any) => [x.props.children].flat(Infinity).join('')).join('\n');

beforeEach(() => mockRunde.mockReset());

it('zeigt eine Netto-Zeile und klappt die beiden Buchungen mit Block und Transaktion auf', async () => {
  mockRunde.mockResolvedValue({
    zeit: 1795377600, von: 7362, bis: 7362, vollstaendig: true,
    abgabenKonten: 3, abgabenSumme: 0.168, menschen: 1, grundeinkommenSumme: 0.166,
    jeMenschKleinster: 0.166, jeMenschGroesster: 0.166, probeGleich: true,
    restNach: 0.002, topfVorAuszahlung: 0.168, restVorrunde: 0.001, andereZufluesse: -0.001,
  });
  mockVerlauf.mockResolvedValue({
    adresse: '0x' + 'a'.repeat(40),
    eintraege: [
      { hoehe: 7362, tx_index: 4, richtung: 'ein', art: 'ubi_distribution', betrag: 0.166, zeit: 1795377600, tx_hash: '0xabc1' },
      { hoehe: 7362, tx_index: 2, richtung: 'aus', art: 'umlauf', betrag: 0.166, zeit: 1795377600, tx_hash: '0xdef2' },
    ],
  });
  let r: any;
  await act(async () => {
    r = TestRenderer.create(<Verlauf address={'0x' + 'a'.repeat(40)} neuLaden={1} />);
  });
  await act(async () => {});
  let t = texte(r);
  expect(t).toContain('history.art_tagesrunde');
  expect(t).toContain('±0');
  expect(t).not.toContain('0xabc1'); // zugeklappt
  expect(t).not.toContain('history.tagesrundeErklaerung');

  const knopf = r.root.findAll((n: any) => n.props.accessibilityRole === 'button' && n.props.accessibilityState)[0];
  expect(knopf.props.accessibilityState).toEqual({ expanded: false });
  await act(async () => {
    knopf.props.onPress();
  });
  t = texte(r);
  expect(t).toContain('history.art_ubi_distribution +0.166');
  expect(t).toContain('history.art_umlauf −0.166');
  expect(t).toContain('history.block{"h":"7362"}');
  expect(t).toContain('0xabc1');
  expect(t).toContain('0xdef2');
  expect(t).toContain('history.tagesrundeErklaerung');
  // Die Zahlen der Runde: ueber die Blockhoehe, einmal geladen.
  await act(async () => {});
  t = texte(r);
  expect(mockRunde).toHaveBeenCalledTimes(1);
  expect(mockRunde.mock.calls[0][0]).toBe(7362);
  expect(t).toContain('history.rundeAnteil{"menschen":"1","je":"0.166","summe":"0.166"}');
  expect(t).toContain('history.rundeAbgaben{"summe":"0.168","konten":"3"}');
  expect(t).toContain('history.rundeTopf{"topf":"0.168"}');
  expect(t).toContain('history.rundeTopfZerlegt{"vor":"0.001","ab":"0.168","andere":"−0.001"}');
  expect(t).toContain('history.rundeRest{"rest":"0.002"}');
  expect(t).toContain('history.rundeBloecke{"von":"7362","bis":"7362"}');
  expect(t).not.toContain('history.rundeUnvollstaendig');
  // Zu- und wieder aufklappen laedt nicht noch einmal.
  const k2 = () => r.root.findAll((n: any) => n.props.accessibilityRole === 'button' && n.props.accessibilityState)[0];
  await act(async () => { k2().props.onPress(); });
  await act(async () => { k2().props.onPress(); });
  expect(mockRunde).toHaveBeenCalledTimes(1);
});

it('sagt ehrlich, wenn der Knoten keine Zahlen der Runde hat', async () => {
  mockRunde.mockResolvedValue(null);
  mockVerlauf.mockResolvedValue({
    adresse: '0x' + 'a'.repeat(40),
    eintraege: [
      { hoehe: 9, tx_index: 1, richtung: 'ein', art: 'ubi_distribution', betrag: 0.1, zeit: 50 },
      { hoehe: 9, tx_index: 0, richtung: 'aus', art: 'umlauf', betrag: 0.1, zeit: 50 },
    ],
  });
  let r: any;
  await act(async () => {
    r = TestRenderer.create(<Verlauf address={'0x' + 'a'.repeat(40)} neuLaden={2} />);
  });
  await act(async () => {});
  const knopf = r.root.findAll((n: any) => n.props.accessibilityRole === 'button' && n.props.accessibilityState)[0];
  await act(async () => { knopf.props.onPress(); });
  await act(async () => {});
  const t = texte(r);
  expect(t).toContain('history.rundeFehlt');
  expect(t).not.toContain('history.rundeAnteil');
});
