import type { Translations } from './types';
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

export const RESOURCES: Record<Locale, Translations> = { en, de, es, fr, pt, ru, zh, ar, hi, id, it, tr };

export type { Translations };
export * from './languages';
