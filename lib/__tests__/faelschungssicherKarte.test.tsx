/**
 * components/FaelschungssicherKarte.tsx: Markenzeichen auf der Startseite --
 * Leitsatz, drei Punkte, Weg zur Quantengeld-Seite und zur Website. Die
 * Website-Adresse ist fest (https, aequitas.digital), kein Wert aus Eingaben.
 */
import React from 'react';
const TestRenderer: any = require('react-test-renderer');
const { act } = TestRenderer;

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: any[]) => mockPush(...a) } }));
jest.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (k: string) => k }) }));

import FaelschungssicherKarte, { QUANTEN_SEITE } from '../../components/FaelschungssicherKarte';
const RN = require('react-native');

test('zeigt Leitsatz und drei Punkte und fuehrt zu Quantengeld und Website', async () => {
  const open = jest.spyOn(RN.Linking, 'openURL').mockResolvedValue(true as any);
  let r: any;
  await act(async () => { r = TestRenderer.create(<FaelschungssicherKarte />); });
  const texte = r.root.findAllByType(RN.Text).map((x: any) => String(x.props.children));
  for (const k of ['marke.titel', 'marke.leitsatz', 'marke.quantengeld', 'marke.mehr']) expect(texte).toContain(k);
  for (const k of ['marke.p1', 'marke.p2', 'marke.p3']) expect(texte.some((x: string) => x.endsWith(k))).toBe(true);
  await act(async () => { r.root.findByProps({ testID: 'marke-quantengeld' }).props.onPress(); });
  expect(mockPush).toHaveBeenCalledWith('/quantengeld');
  await act(async () => { r.root.findByProps({ testID: 'marke-mehr' }).props.onPress(); });
  expect(open).toHaveBeenCalledWith(QUANTEN_SEITE);
  expect(QUANTEN_SEITE).toBe('https://aequitas.digital/quanten');
});
