import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { systemPromptOpen } from '@/src/crypto/promptGuard';
import { shortAddress } from '@/src/domain/address';
import { VaultAccess } from '@/src/features/security/components/VaultAccess';
import { useSession } from '@/src/features/security/SessionProvider';
import { useI18n } from '@/src/i18n';
import { Button, ErrorState, Heading, Screen, Stack, Text } from '@/src/ui';

// Sperrbildschirm. Bietet nur Entsperren und die Neueinrichtung mit Phrase
// an -- bewusst KEIN "Wallet entfernen": das darf nur, wer entsperrt hat.

export default function LockScreen() {
  const { status, meta, unlock, retryLoad } = useSession();
  const { t } = useI18n();
  const router = useRouter();

  const systemUnlock = useCallback(() => unlock(t('lock.prompt')).catch(() => {}), [unlock, t]);

  // Biometrie/Geraete-PIN: von selbst fragen -- aber hoechstens EINMAL je
  // Rueckkehr in den Vordergrund. iOS meldet auch das Ende der Face-ID-
  // Abfrage als 'inactive' -> 'active'; ohne diese Grenze fuehrte ein
  // Abbruch sofort zur naechsten Abfrage. Erst 'background' gibt wieder frei.
  const asked = useRef(false);
  const auto = !!meta && meta.protection !== 'pin' && status === 'locked';
  useEffect(() => {
    if (!auto) return;
    const maybeAsk = () => {
      if (asked.current || AppState.currentState !== 'active' || systemPromptOpen()) return;
      asked.current = true;
      systemUnlock();
    };
    maybeAsk();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background') asked.current = false;
      if (next === 'active') maybeAsk();
    });
    return () => sub.remove();
  }, [auto, systemUnlock]);

  if (status === 'unavailable' || !meta) {
    return (
      <Screen scroll={false} contentStyle={{ justifyContent: 'center' }}>
        <ErrorState title={t('lock.unavailableTitle')} message={t('lock.unavailableMessage')} retryLabel={t('common.retry')} onRetry={retryLoad} />
      </Screen>
    );
  }

  return (
    <Screen scroll={false} contentStyle={{ justifyContent: 'center' }}>
      <Stack gap="xl">
        <Stack gap="sm">
          <Heading align="center">{t('lock.title')}</Heading>
          <Text tone="secondary" align="center" variant="footnote" tabular>
            {shortAddress(meta.address)}
          </Text>
        </Stack>
        <VaultAccess protection={meta.protection} label={t('lock.unlock')} onSubmit={(pin) => unlock(t('lock.prompt'), pin)} />
        <Button variant="tertiary" label={t('lock.lostAccess')} onPress={() => router.push('/recover')} />
      </Stack>
    </Screen>
  );
}
