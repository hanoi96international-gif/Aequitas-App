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

import { Verlauf } from '../../components/Verlauf';
const RN = require('react-native');

const texte = (r: any): string =>
  r.root.findAllByType(RN.Text).map((x: any) => [x.props.children].flat(Infinity).join('')).join('\n');

it('zeigt eine Netto-Zeile und klappt die beiden Buchungen mit Block und Transaktion auf', async () => {
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
});
