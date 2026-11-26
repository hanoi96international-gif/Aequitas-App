// Prüfung vom 26.11.2026: Die App versprach „niemand kann sie kopieren, auch
// nicht, wer sie prägt“. Für die S-Token, die laufen, stimmt das nicht: Nach
// der Ausgabe hält die Inhaberin gewöhnliche Daten, und wer einen Abschnitt
// präpariert (samt Quantenrechner-Anbieter), kennt ihn. Gegen Fälschung
// schützt die Schwelle t von v. Dieser Test hält die ehrliche Aussage fest.
import { LOCALES, RESOURCES } from '../i18n';
import de from '../i18n/locales/de';
import en from '../i18n/locales/en';

describe('Quantengeld: die App verspricht nicht mehr, als das Verfahren hält', () => {
  it('kein Kopierverbot mehr, stattdessen gewöhnliche Daten und die Schwelle', () => {
    expect(de.node.qKarte).not.toMatch(/niemand kann sie kopieren/i);
    expect(de.node.qKarte).toMatch(/gewöhnliche Daten/);
    expect(de.node.qKarte).toMatch(/weniger als t der v/);
    expect(en.node.qKarte).not.toMatch(/nobody can copy/i);
    expect(en.node.qKarte).toMatch(/ordinary data/);
    expect(en.node.qKarte).toMatch(/fewer than t of the v/);
  });

  it('die Inhaberin erfährt, wer ihren Abschnitt kennt', () => {
    expect(de.node.qtText).toMatch(/kennt aber diesen Abschnitt/);
    expect(en.node.qtText).toMatch(/knows that section/);
  });

  it('jede Sprache hat die neuen Aussagen eigens übersetzt (nicht der englische Ersatz)', () => {
    for (const l of LOCALES) {
      if (l === 'en') continue;
      const node = (RESOURCES[l] as unknown as { node: Record<string, string> }).node;
      for (const k of ['qKarte', 'qtText', 'qaLosGroesse', 'qaLosZuKlein', 'qaLosUnbekannt']) {
        expect([l, k, node[k] === (en.node as unknown as Record<string, string>)[k]]).toEqual([l, k, false]);
      }
      expect(node.qaLosZuKlein).toContain('{noetig}');
      expect(node.qaLosGroesse).toContain('{n}');
    }
  });
});
