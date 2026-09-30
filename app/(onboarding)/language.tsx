import { useRouter } from 'expo-router';
import React from 'react';

import { LanguageList } from '@/src/features/settings/LanguageList';
import { useI18n } from '@/src/i18n';
import { Heading, Screen } from '@/src/ui';

export default function OnboardingLanguage() {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <Heading>{t('onboarding.welcome.language')}</Heading>
      <LanguageList onSelected={() => router.back()} />
    </Screen>
  );
}
