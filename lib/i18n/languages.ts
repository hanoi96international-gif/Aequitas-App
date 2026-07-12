export type Locale = 'en' | 'de' | 'es' | 'fr' | 'pt' | 'ru' | 'zh' | 'ar' | 'hi' | 'id' | 'it' | 'tr';

export const LOCALES: Locale[] = ['en', 'de', 'es', 'fr', 'pt', 'ru', 'zh', 'ar', 'hi', 'id', 'it', 'tr'];

export const LANGUAGE_NAMES: Record<Locale, string> = {
  en: 'English',
  de: 'Deutsch',
  es: 'Español',
  fr: 'Français',
  pt: 'Português',
  ru: 'Русский',
  zh: '中文',
  ar: 'العربية',
  hi: 'हिन्दी',
  id: 'Indonesia',
  it: 'Italiano',
  tr: 'Türkçe',
};

export const RTL_LOCALES: Locale[] = ['ar'];

// Node Operator Guide PDFs only exist for these locales (matches the chain
// server's registered /download/node-guide-<lg>.pdf routes) — everything
// else falls back to the English PDF.
export const PDF_LOCALES: Locale[] = ['en', 'de', 'es', 'fr', 'id', 'it', 'pt', 'tr'];

export function pdfLocaleFor(lang: Locale): Locale {
  return PDF_LOCALES.includes(lang) ? lang : 'en';
}
