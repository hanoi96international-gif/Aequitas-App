import React from 'react';

import { useI18n } from '@/src/i18n';
import { EmptyState, Heading, Screen } from '@/src/ui';

// Senden, Empfangen, Verlauf: Etappe 3 (docs/NEUBAU_ANALYSE.md 5).
export default function Pay() {
  const { t } = useI18n();
  return (
    <Screen>
      <Heading>{t('tabs.pay')}</Heading>
      <EmptyState title={t('tabs.pay')} message={t('common.soon')} />
    </Screen>
  );
}
