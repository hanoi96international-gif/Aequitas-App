import { useRouter } from 'expo-router';
import React from 'react';

import { LanguageList } from '@/src/features/settings/LanguageList';
import { Screen } from '@/src/ui';

export default function SettingsLanguage() {
  const router = useRouter();
  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <LanguageList onSelected={() => router.back()} />
    </Screen>
  );
}
