import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import React from 'react';

import { useI18n } from '@/src/i18n';
import { Card, Divider, Heading, ListRow, Screen, SectionHeader, Text, useTheme, type ThemePreference } from '@/src/ui';

const APPEARANCE: { pref: ThemePreference; key: 'more.appearanceSystem' | 'more.appearanceLight' | 'more.appearanceDark' }[] = [
  { pref: 'system', key: 'more.appearanceSystem' },
  { pref: 'light', key: 'more.appearanceLight' },
  { pref: 'dark', key: 'more.appearanceDark' },
];

export default function More() {
  const { t, locale, languageName } = useI18n();
  const { preference, setPreference } = useTheme();
  const router = useRouter();

  return (
    <Screen>
      <Heading>{t('tabs.more')}</Heading>

      <SectionHeader title={t('more.account')} />
      <Card padded={false}>
        <ListRow title={t('more.security')} onPress={() => router.push('/security')} />
      </Card>

      <SectionHeader title={t('more.settings')} />
      <Card padded={false}>
        <ListRow title={t('more.language')} value={languageName(locale)} onPress={() => router.push('/settings/language')} />
      </Card>

      <SectionHeader title={t('more.appearance')} />
      <Card padded={false}>
        {APPEARANCE.map(({ pref, key }, i) => (
          <React.Fragment key={pref}>
            {i > 0 ? <Divider inset={16} /> : null}
            <ListRow
              title={t(key)}
              trailing={preference === pref ? <Text tone="accent">✓</Text> : <Text> </Text>}
              onPress={() => setPreference(pref)}
            />
          </React.Fragment>
        ))}
      </Card>

      <SectionHeader title={t('more.about')} />
      <Card padded={false}>
        <ListRow title={t('more.version')} value={Constants.expoConfig?.version ?? '–'} />
      </Card>
    </Screen>
  );
}
