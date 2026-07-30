import { RESOURCES, LOCALES } from '../i18n';
import en from '../i18n/locales/en';

describe('translation resources', () => {
  // Das eigentliche Risiko der Teilübersetzungen: ein in einer Sprache
  // fehlender Schlüssel darf nicht als roher Pfad ("bio.palmHint") auf dem
  // Bildschirm landen. Genau dafür gibt es die Verschmelzung mit Englisch in
  // index.ts — ohne diesen Test würde ihr Ausfall erst auffallen, wenn ein
  // Nutzer den Schlüsselpfad vor sich sieht.
  it('resolves every key in every locale, filling gaps from English', () => {
    for (const locale of LOCALES) {
      const table = RESOURCES[locale] as unknown as Record<string, Record<string, string>>;
      for (const [section, keys] of Object.entries(en as unknown as Record<string, Record<string, string>>)) {
        for (const key of Object.keys(keys)) {
          expect(typeof table[section]?.[key]).toBe('string');
          expect(table[section][key].length).toBeGreaterThan(0);
        }
      }
    }
  });

  /** Zeichenketten, die auf Deutsch bewusst englisch bleiben: eine Formel,
   *  ein Fachbegriff, die Marken-Zeile und der Name eines Dokuments, das
   *  selbst nur auf Englisch existiert. Sie zu übersetzen wäre nicht
   *  hilfreicher, sondern verwirrender. */
  const DELIBERATELY_ENGLISH = new Set([
    'onboarding.subtitle',
    'trade.ammTitle',
    'trade.ammFormula',
    'node.pdfGuideBtn',
  ]);

  // Deutsch ist die Standardsprache der App. Dort auf englischen Text
  // zurückzufallen wäre kein Randfall, sondern das, was die meisten Nutzer
  // zu sehen bekämen.
  it('has German text for every key, not English fallbacks', () => {
    const de = RESOURCES.de as unknown as Record<string, Record<string, string>>;
    const enTable = en as unknown as Record<string, Record<string, string>>;
    const identical: string[] = [];
    for (const [section, keys] of Object.entries(enTable)) {
      for (const [key, value] of Object.entries(keys)) {
        // Zeichenketten, die in beiden Sprachen gleich lauten dürfen (Namen,
        // Einheiten, Formeln), sind kurz; ein ganzer Satz nicht.
        const path = `${section}.${key}`;
        if (DELIBERATELY_ENGLISH.has(path)) continue;
        if (de[section]?.[key] === value && value.length > 24) {
          identical.push(path);
        }
      }
    }
    expect(identical).toEqual([]);
  });
});
