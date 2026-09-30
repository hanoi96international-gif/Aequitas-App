import React, { useState } from 'react';

import { validPin } from '@/src/crypto/vault';
import { useI18n } from '@/src/i18n';
import { Banner, Button, Heading, Stack, Text, TextField } from '@/src/ui';

/** App-PIN festlegen (nur Geraete ohne Bildschirmsperre, vault.ts 'pin'). */
export function PinSetup({ onDone, busy, submitLabel }: { onDone: (pin: string) => void; busy?: boolean; submitLabel: string }) {
  const { t } = useI18n();
  const [pin, setPin] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    if (!validPin(pin)) return setError(t('onboarding.protect.weak'));
    if (pin !== repeat) return setError(t('onboarding.protect.mismatch'));
    setError(null);
    onDone(pin);
  };

  return (
    <Stack gap="lg">
      <Heading>{t('onboarding.protect.title')}</Heading>
      <Text tone="secondary">{t('onboarding.protect.lead')}</Text>
      <TextField
        label={t('onboarding.protect.pinLabel')}
        hint={t('onboarding.protect.pinHint')}
        value={pin}
        onChangeText={(v) => setPin(v.replace(/\D/g, ''))}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={12}
        textContentType="none"
        autoComplete="off"
        importantForAutofill="no"
      />
      <TextField
        label={t('onboarding.protect.repeatLabel')}
        value={repeat}
        onChangeText={(v) => setRepeat(v.replace(/\D/g, ''))}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={12}
        textContentType="none"
        autoComplete="off"
        importantForAutofill="no"
        error={error}
      />
      <Banner tone="warning" title={t('onboarding.protect.forgotten')} />
      <Button label={submitLabel} onPress={submit} loading={busy} disabled={!pin || !repeat} />
    </Stack>
  );
}
