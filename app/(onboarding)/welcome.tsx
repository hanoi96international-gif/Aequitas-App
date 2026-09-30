import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';

import { legacyAddress } from '@/src/crypto/vault';
import { shortAddress } from '@/src/domain/address';
import { useI18n } from '@/src/i18n';
import { Banner, Button, Card, Heading, ListRow, Screen, Stack, Text } from '@/src/ui';

export default function Welcome() {
  const { t, locale, languageName } = useI18n();
  const router = useRouter();
  const [legacy, setLegacy] = useState<string | null>(null);

  useEffect(() => {
    legacyAddress()
      .then(setLegacy)
      .catch(() => setLegacy(null));
  }, []);

  return (
    <Screen contentStyle={{ flexGrow: 1, justifyContent: 'space-between' }}>
      <Stack gap="lg">
        <Text variant="caption" tone="accent">
          {t('common.appName').toUpperCase()}
        </Text>
        <Heading>{t('onboarding.welcome.title')}</Heading>
        <Text tone="secondary">{t('onboarding.welcome.lead')}</Text>
        {legacy ? (
          <Banner
            tone="info"
            title={t('onboarding.legacy.bannerTitle')}
            message={t('onboarding.legacy.bannerMessage', { address: shortAddress(legacy) })}
            action={{ label: t('onboarding.legacy.bannerAction'), onPress: () => router.push('/legacy') }}
          />
        ) : null}
      </Stack>
      <Stack gap="md">
        <Card padded={false}>
          <ListRow title={t('onboarding.welcome.language')} value={languageName(locale)} onPress={() => router.push('/language')} />
        </Card>
        <Button label={t('onboarding.welcome.create')} onPress={() => router.push('/create')} />
        <Button label={t('onboarding.welcome.restore')} variant="secondary" onPress={() => router.push('/restore')} />
      </Stack>
    </Screen>
  );
}
