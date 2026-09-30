import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';

import { NetzHinweis } from '@/src/features/network/NetzHinweis';
import { useSession } from '@/src/features/security/SessionProvider';
import { useI18n } from '@/src/i18n';
import { Banner, Button, Card, Heading, Screen, SectionHeader, Stack, Text } from '@/src/ui';

// Uebersicht. Guthaben, Grundeinkommen und letzte Buchungen kommen mit
// Etappe 3 (Wallet); bis dahin: Konto, Sicherheits- und Netzhinweise.

export default function Overview() {
  const { t } = useI18n();
  const { meta } = useSession();
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  if (!meta) return null;

  const copy = async () => {
    await Clipboard.setStringAsync(meta.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Screen>
      <Heading>{t('tabs.overview')}</Heading>
      <NetzHinweis />
      {meta.kind === 'privateKey' ? (
        <Banner tone="warning" title={t('overview.noPhraseTitle')} message={t('overview.noPhraseMessage')} />
      ) : !meta.backedUp ? (
        <Banner
          tone="warning"
          title={t('overview.backupTitle')}
          message={t('overview.backupMessage')}
          action={{ label: t('overview.backupAction'), onPress: () => router.push('/backup') }}
        />
      ) : null}
      <SectionHeader title={t('overview.account')} />
      <Card>
        <Stack gap="md">
          <Text variant="callout" tabular selectable accessibilityLabel={meta.address}>
            {meta.address}
          </Text>
          <Button
            label={copied ? t('common.copied') : t('common.copy')}
            variant="secondary"
            fullWidth={false}
            onPress={() => void copy().catch(() => {})}
          />
        </Stack>
      </Card>
      <Text tone="tertiary" variant="footnote">
        {t('common.soon')}
      </Text>
    </Screen>
  );
}
