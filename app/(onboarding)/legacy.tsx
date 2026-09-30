import React, { useState } from 'react';

import { PinSetup } from '@/src/features/security/components/PinSetup';
import { useProtection } from '@/src/features/security/hooks/useProtection';
import { useSession } from '@/src/features/security/SessionProvider';
import { vaultErrorText } from '@/src/features/security/vaultErrors';
import { useI18n } from '@/src/i18n';
import { Banner, Button, Heading, Screen, Text } from '@/src/ui';

// Wallet der alten App uebernehmen (vault.importLegacy): nur nach Biometrie
// bzw. Geraete-PIN, auf Geraeten ohne Sperre mit neuer App-PIN.

export default function Legacy() {
  const { t } = useI18n();
  const { takeOverLegacy } = useSession();
  const protection = useProtection();
  const [step, setStep] = useState<'explain' | 'pin'>('explain');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (pin?: string) => {
    setBusy(true);
    setError(null);
    try {
      await takeOverLegacy(t('onboarding.legacy.prompt'), pin);
    } catch (e) {
      setError(vaultErrorText(t, e));
    } finally {
      setBusy(false);
    }
  };

  const errorBanner = error ? <Banner tone="negative" title={error} /> : null;

  if (step === 'pin') {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        {errorBanner}
        <PinSetup submitLabel={t('onboarding.legacy.submit')} busy={busy} onDone={save} />
      </Screen>
    );
  }

  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <Heading>{t('onboarding.legacy.title')}</Heading>
      <Text tone="secondary">{t('onboarding.legacy.lead')}</Text>
      <Banner tone="warning" title={t('onboarding.legacy.noBackup')} />
      {errorBanner}
      <Button
        label={t('onboarding.legacy.submit')}
        loading={busy}
        disabled={protection === null}
        onPress={() => (protection === 'pin' ? setStep('pin') : save())}
      />
    </Screen>
  );
}
