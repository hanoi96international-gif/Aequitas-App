import type { Translations, PartialTranslations } from './types';
import type { Locale } from './languages';
import en from './locales/en';
import de from './locales/de';
import es from './locales/es';
import fr from './locales/fr';
import pt from './locales/pt';
import ru from './locales/ru';
import zh from './locales/zh';
import ar from './locales/ar';
import hi from './locales/hi';
import id from './locales/id';
import it from './locales/it';
import tr from './locales/tr';

/**
 * Englisch als Grundlage, die jeweilige Sprache darüber.
 *
 * Nur zwei Ebenen tief, weil die Übersetzungstabelle genau zwei Ebenen tief
 * ist (Bereich → Schlüssel). Eine allgemeine rekursive Verschmelzung wäre
 * mehr Code, der genau denselben Fall behandelt.
 *
 * Der Grund für die Verschmelzung überhaupt: ohne sie lieferte ein in einer
 * Sprache noch fehlender Schlüssel den rohen Pfad auf den Bildschirm
 * ("bio.palmHint"). Englischer Text an dieser Stelle ist sichtbar
 * unübersetzt, aber immerhin lesbar.
 */
function withFallback(partial: PartialTranslations): Translations {
  const out = {} as Record<string, Record<string, string>>;
  for (const section of Object.keys(en) as (keyof Translations)[]) {
    out[section] = { ...(en[section] as Record<string, string>), ...(partial[section] ?? {}) };
  }
  return out as unknown as Translations;
}

export const RESOURCES: Record<Locale, Translations> = {
  en,
  de: withFallback(de),
  es: withFallback(es),
  fr: withFallback(fr),
  pt: withFallback(pt),
  ru: withFallback(ru),
  zh: withFallback(zh),
  ar: withFallback(ar),
  hi: withFallback(hi),
  id: withFallback(id),
  it: withFallback(it),
  tr: withFallback(tr),
};

export type { Translations };
export * from './languages';
