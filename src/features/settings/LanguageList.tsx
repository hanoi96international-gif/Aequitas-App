import React from 'react';

import { LOCALES, useI18n, type Locale } from '@/src/i18n';
import { Card, Divider, ListRow, Text } from '@/src/ui';

/** Sprachauswahl (Onboarding und Einstellungen). */
export function LanguageList({ onSelected }: { onSelected?: (l: Locale) => void }) {
  const { locale, setLocale, languageName } = useI18n();
  return (
    <Card padded={false}>
      {LOCALES.map((l, i) => (
        <React.Fragment key={l}>
          {i > 0 ? <Divider inset={16} /> : null}
          <ListRow
            title={languageName(l)}
            trailing={l === locale ? <Text tone="accent">✓</Text> : <Text> </Text>}
            onPress={() => {
              setLocale(l);
              onSelected?.(l);
            }}
          />
        </React.Fragment>
      ))}
    </Card>
  );
}
