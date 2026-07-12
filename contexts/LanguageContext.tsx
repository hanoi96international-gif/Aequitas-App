import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { RESOURCES, LOCALES, type Locale, type Translations } from '@/lib/i18n';

const LANG_KEY = 'aequitas_language';
const DEFAULT_LOCALE: Locale = 'de';

type Path<T> = T extends string
  ? never
  : { [K in keyof T & string]: T[K] extends string ? K : `${K}.${Path<T[K]>}` }[keyof T & string];

type TranslationKey = Path<Translations>;

function resolve(obj: any, path: string): string {
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj) ?? path;
}

interface LanguageContextValue {
  lang: Locale;
  setLang: (l: Locale) => void;
  t: (key: TranslationKey, params?: Record<string, string>) => string;
  ready: boolean;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Locale>(DEFAULT_LOCALE);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const stored = await SecureStore.getItemAsync(LANG_KEY);
        if (stored && LOCALES.includes(stored as Locale)) {
          setLangState(stored as Locale);
        }
      } catch {
        // no stored preference — stays on DEFAULT_LOCALE
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const setLang = useCallback((l: Locale) => {
    setLangState(l);
    SecureStore.setItemAsync(LANG_KEY, l).catch(() => {});
  }, []);

  const t = useCallback(
    (key: TranslationKey, params?: Record<string, string>) => {
      let str = resolve(RESOURCES[lang], key);
      if (params) {
        for (const [k, v] of Object.entries(params)) str = str.replace(`{${k}}`, v);
      }
      return str;
    },
    [lang]
  );

  const value = useMemo(() => ({ lang, setLang, t, ready }), [lang, setLang, t, ready]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within a LanguageProvider');
  return ctx;
}
