import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { I18nManager } from 'react-native';

import { LANGUAGE_NAMES, LOCALES, RTL_LOCALES, type Locale } from '@/lib/i18n/languages';
import de, { type Catalog } from './locales/de';
import en from './locales/en';

// i18n des Neubaus (docs/NEUBAU_ANALYSE.md 3.5).
//
// Gegenueber dem alten LanguageContext:
//   - Start in der Geraetesprache (falls unterstuetzt), nicht fest Deutsch.
//   - Platzhalter werden ALLE ersetzt (replaceAll), nicht nur der erste.
//   - Plural ueber Intl.PluralRules: ein Schluessel mit {one, other, ...}.
//   - RTL fuer Arabisch ueber I18nManager (wirkt nach Neustart der App).
//   - Fehlende Uebersetzung: erst Englisch, dann Deutsch -- nie der rohe Schluessel.
//
// Deutsch ist die Quelle (Catalog-Typ); Englisch muss vollstaendig sein
// (Typpruefung), die uebrigen Sprachen duerfen luecken haben und werden
// nachgezogen.

type PartialDeep<T> = { [K in keyof T]?: T[K] extends string ? string : PartialDeep<T[K]> };

const CATALOGS: Partial<Record<Locale, PartialDeep<Catalog>>> = { de, en };

export type PluralForms = { one: string; other: string; zero?: string; two?: string; few?: string; many?: string };

type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string
    ? `${P}${K}`
    : T[K] extends PluralForms
      ? `${P}${K}`
      : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

export type I18nKey = Leaves<Catalog>;
export type I18nParams = Record<string, string | number>;

const PREF_KEY = 'aequitas.locale';

function lookup(catalog: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((acc, k) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined), catalog);
}

export function translate(locale: Locale, key: string, params?: I18nParams): string {
  const chain: Locale[] = [locale, 'en', 'de'];
  let entry: unknown;
  for (const l of chain) {
    entry = lookup(CATALOGS[l], key);
    if (entry !== undefined) break;
  }
  let text: string;
  if (typeof entry === 'string') {
    text = entry;
  } else if (entry && typeof entry === 'object' && 'other' in entry) {
    const forms = entry as PluralForms;
    const count = Number(params?.count ?? 0);
    const rule = new Intl.PluralRules(locale).select(count) as keyof PluralForms;
    text = (count === 0 && forms.zero) || forms[rule] || forms.other;
  } else {
    // Auffaellig statt still: ein fehlender Schluessel ist ein Fehler im Build.
    return `⟦${key}⟧`;
  }
  if (params) {
    for (const [k, v] of Object.entries(params)) text = text.replaceAll(`{${k}}`, String(v));
  }
  return text;
}

export function deviceLocale(): Locale {
  try {
    for (const l of getLocales()) {
      const code = (l.languageCode ?? '').toLowerCase() as Locale;
      if (LOCALES.includes(code)) return code;
    }
  } catch {
    // getLocales ist in Tests/Web nicht immer verfuegbar
  }
  return 'en';
}

interface I18nValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: I18nKey, params?: I18nParams) => string;
  languageName: (l: Locale) => string;
  rtl: boolean;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(deviceLocale);

  useEffect(() => {
    AsyncStorage.getItem(PREF_KEY)
      .then((v) => {
        if (v && LOCALES.includes(v as Locale)) setLocaleState(v as Locale);
      })
      .catch(() => {});
  }, []);

  const rtl = RTL_LOCALES.includes(locale);
  useEffect(() => {
    if (I18nManager.isRTL !== rtl) {
      I18nManager.allowRTL(rtl);
      I18nManager.forceRTL(rtl);
    }
  }, [rtl]);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    AsyncStorage.setItem(PREF_KEY, l).catch(() => {});
  }, []);

  const value = useMemo<I18nValue>(
    () => ({
      locale,
      setLocale,
      t: (key, params) => translate(locale, key, params),
      languageName: (l) => LANGUAGE_NAMES[l],
      rtl,
    }),
    [locale, setLocale, rtl],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n muss innerhalb von I18nProvider aufgerufen werden');
  return ctx;
}

export { LOCALES, type Locale };
