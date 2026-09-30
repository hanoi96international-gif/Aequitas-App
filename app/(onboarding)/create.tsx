import React, { useState } from 'react';

import { newPhrase } from '@/src/crypto/mnemonic';
import { NoScreenCapture } from '@/src/features/security/components/NoScreenCapture';
import { PhraseCheck } from '@/src/features/security/components/PhraseCheck';
import { PhraseGrid } from '@/src/features/security/components/PhraseGrid';
import { PinSetup } from '@/src/features/security/components/PinSetup';
import { useProtection } from '@/src/features/security/hooks/useProtection';
import { useSession } from '@/src/features/security/SessionProvider';
import { vaultErrorText } from '@/src/features/security/vaultErrors';
import { useI18n } from '@/src/i18n';
import { Banner, Button, Card, Heading, Screen, Stack, Text } from '@/src/ui';

// Konto anlegen: Erklaerung -> Phrase (ohne Bildschirmfotos) -> drei Woerter
// pruefen -> ggf. App-PIN -> Tresor. Die Phrase lebt bis dahin nur im
// Zustand dieses Bildschirms; gespeichert wird erst nach bestandener Pruefung.

type Step = 'intro' | 'show' | 'check' | 'pin';

export default function CreateAccount() {
  const { t } = useI18n();
  const { createAccount } = useSession();
  const protection = useProtection();
  const [phrase] = useState(newPhrase);
  const [step, setStep] = useState<Step>('intro');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (pin?: string) => {
    setBusy(true);
    setError(null);
    try {
      await createAccount({ phrase }, { pin, backedUp: true });
    } catch (e) {
      setError(vaultErrorText(t, e));
    } finally {
      setBusy(false);
    }
  };

  const errorBanner = error ? <Banner tone="negative" title={error} /> : null;

  if (step === 'intro') {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        <Heading>{t('onboarding.create.introTitle')}</Heading>
        <Card>
          <Stack gap="md">
            {(['introPoint1', 'introPoint2', 'introPoint3'] as const).map((k, i) => (
              <Text key={k}>
                {i + 1}. {t(`onboarding.create.${k}`)}
              </Text>
            ))}
          </Stack>
        </Card>
        <Button label={t('onboarding.create.reveal')} onPress={() => setStep('show')} />
      </Screen>
    );
  }

  if (step === 'show') {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        <NoScreenCapture />
        <Heading>{t('onboarding.create.showTitle')}</Heading>
        <Text tone="secondary">{t('onboarding.create.showLead')}</Text>
        <PhraseGrid phrase={phrase} />
        <Button label={t('onboarding.create.written')} onPress={() => setStep('check')} />
      </Screen>
    );
  }

  if (step === 'check') {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        <NoScreenCapture />
        <Heading>{t('onboarding.create.checkTitle')}</Heading>
        <Text tone="secondary">{t('onboarding.create.checkLead')}</Text>
        {errorBanner}
        <PhraseCheck
          phrase={phrase}
          busy={busy || protection === null}
          onPassed={() => (protection === 'pin' ? setStep('pin') : save())}
        />
        <Button variant="tertiary" label={t('onboarding.create.showAgain')} onPress={() => setStep('show')} />
      </Screen>
    );
  }

  return (
    <Screen edges={['left', 'right', 'bottom']}>
      {errorBanner}
      <PinSetup submitLabel={t('common.continue')} busy={busy} onDone={save} />
    </Screen>
  );
}
