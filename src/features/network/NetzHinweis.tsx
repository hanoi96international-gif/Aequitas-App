import React from 'react';

import { useI18n } from '@/src/i18n';
import { Banner } from '@/src/ui';
import { useNetz } from './NetzProvider';

/** Hinweis, wenn das Netz neu gestartet wurde oder der Knoten nicht passt. Sonst nichts. */
export function NetzHinweis() {
  const { befund, bestaetigeWechsel } = useNetz();
  const { t } = useI18n();
  if (!befund) return null;
  switch (befund.art) {
    case 'gewechselt':
      return (
        <Banner
          tone="warning"
          title={t('errors.netzGewechselt.title')}
          message={t('errors.netzGewechselt.message')}
          action={{ label: t('overview.netzGewechseltAction'), onPress: () => void bestaetigeWechsel().catch(() => {}) }}
        />
      );
    case 'fremdeKette':
      return <Banner tone="negative" title={t('overview.netzFremdTitle')} message={t('overview.netzFremdMessage')} />;
    case 'ungueltig':
      return <Banner tone="negative" title={t('overview.netzUngueltigTitle')} message={t('overview.netzUngueltigMessage')} />;
    default:
      return null;
  }
}
