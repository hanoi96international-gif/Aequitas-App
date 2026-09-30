import React, { useState } from 'react';

import { checkPhrase, secretFromInput } from '@/src/crypto/mnemonic';
import { shortAddress } from '@/src/domain/address';
import { PhraseInput } from '@/src/features/security/components/PhraseInput';
import { PinSetup } from '@/src/features/security/components/PinSetup';
import { useProtection } from '@/src/features/security/hooks/useProtection';
import { useSession } from '@/src/features/security/SessionProvider';
import { vaultErrorText } from '@/src/features/security/vaultErrors';
import { useI18n } from '@/src/i18n';
import { Button, Heading, Screen, Stack, Text } from '@/src/ui';

// Neu einrichten, wenn der Tresor sich nicht mehr oeffnen laesst (PIN
// vergessen, Biometrie neu eingerichtet). Der Tresor ersetzt sich nur, wenn
// das Geheimnis zur gespeicherten Adresse gehoert (vault.recoverVault).

export default function RecoverScreen() {
  const { meta, recover } = useSession();
  const { t } = useI18n();
  const protection = useProtection();
  const [input, setInput] = useState('');
  const [step, setStep] = useState<'enter' | 'pin'>('enter');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (pin?: string) => {
    setBusy(true);
    setError(null);
    try {
      await recover(secretFromInput(input), pin);
    } catch (e) {
      setError(vaultErrorText(t, e));
      setStep('enter');
    } finally {
      setBusy(false);
    }
  };

  const next = () => {
    const secret = secretFromInput(input);
    if ('phrase' in secret) {
      const problem = checkPhrase(secret.phrase);
      if (problem) {
        setError(
          problem.problem === 'unknownWord'
            ? t('onboarding.restore.unknownWord', { word: problem.word ?? '' })
            : t(`onboarding.restore.${problem.problem}`),
        );
        return;
      }
    }
    setError(null);
    if (protection === 'pin') setStep('pin');
    else save();
  };

  if (step === 'pin') {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        <PinSetup submitLabel={t('recover.submit')} busy={busy} onDone={save} />
      </Screen>
    );
  }

  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <Stack gap="lg">
        <Heading>{t('recover.title')}</Heading>
        <Text tone="secondary">{t('recover.lead', { address: meta ? shortAddress(meta.address) : '' })}</Text>
        <PhraseInput
          label={t('recover.label')}
          value={input}
          onChange={(v) => {
            setInput(v);
            setError(null);
          }}
          error={error}
        />
        <Button label={t('recover.submit')} loading={busy} disabled={!input.trim() || protection === null} onPress={next} />
      </Stack>
    </Screen>
  );
}
