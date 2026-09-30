import React from 'react';

import { useI18n } from '@/src/i18n';
import { EmptyState, Heading, Screen } from '@/src/ui';

// Tausch und Liquiditaet: Etappe 5 (docs/NEUBAU_ANALYSE.md 5).
export default function Exchange() {
  const { t } = useI18n();
  return (
    <Screen>
      <Heading>{t('tabs.exchange')}</Heading>
      <EmptyState title={t('tabs.exchange')} message={t('common.soon')} />
    </Screen>
  );
}
