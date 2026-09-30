import { useRouter } from 'expo-router';
import React from 'react';

import { useSession } from '@/src/features/security/SessionProvider';
import { useI18n } from '@/src/i18n';
import { Card, Divider, ListRow, Screen, SectionHeader, Text } from '@/src/ui';

export default function Security() {
  const { t } = useI18n();
  const { meta, lock } = useSession();
  const router = useRouter();
  if (!meta) return null;

  const protection = {
    biometric: t('security.protectionBiometric'),
    device: t('security.protectionDevice'),
    pin: t('security.protectionPin'),
  }[meta.protection];
  const backup = meta.kind !== 'phrase' ? t('security.backupNone') : meta.backedUp ? t('security.backupDone') : t('security.backupMissing');

  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <Card padded={false}>
        <ListRow title={t('security.protection')} value={protection} />
        <Divider inset={16} />
        <ListRow title={t('security.backup')} value={backup} />
      </Card>

      {meta.kind === 'phrase' ? (
        <Card padded={false}>
          <ListRow title={t('security.showBackup')} onPress={() => router.push('/backup')} />
        </Card>
      ) : null}

      <Card padded={false}>
        <ListRow title={t('security.lockNow')} onPress={lock} />
      </Card>
      <Text variant="footnote" tone="tertiary">
        {t('security.autoLock')}
      </Text>

      <SectionHeader title={t('remove.title')} />
      <Card padded={false}>
        <ListRow title={t('security.remove')} destructive onPress={() => router.push('/remove')} />
      </Card>
    </Screen>
  );
}
