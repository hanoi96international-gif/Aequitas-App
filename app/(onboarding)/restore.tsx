import React, { useState } from 'react';

import { checkPhrase } from '@/src/crypto/mnemonic';
import { PhraseInput } from '@/src/features/security/components/PhraseInput';
import { PinSetup } from '@/src/features/security/components/PinSetup';
import { useProtection } from '@/src/features/security/hooks/useProtection';
import { useSession } from '@/src/features/security/SessionProvider';
import { vaultErrorText } from '@/src/features/security/vaultErrors';
import { useI18n } from '@/src/i18n';
import { Banner, Button, Heading, Screen, Text } from '@/src/ui';

// Wiederherstellen mit der Phrase. Einen rohen privaten Schluessel nimmt
// dieser Weg bewusst nicht an (docs/NEUBAU_ANALYSE.md: hoechstens im
// Expertenmodus); die alte App-Wallet kommt ueber 'legacy'.

export default function Restore() {
  const { t } = useI18n();
  const { createAccount } = useSession();
  const protection = useProtection();
  const [input, setInput] = useState('');
  const [step, setStep] = useState<'enter' | 'pin'>('enter');
  const [inputError, setInputError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (pin?: string) => {
    setBusy(true);
    setError(null);
    try {
      // Wer die Phrase eingeben kann, hat sie gesichert.
      await createAccount({ phrase: input }, { pin, backedUp: true });
    } catch (e) {
      setError(vaultErrorText(t, e));
    } finally {
      setBusy(false);
    }
  };

  const next = () => {
    const problem = checkPhrase(input);
    if (problem) {
      setInputError(
        problem.problem === 'unknownWord'
          ? t('onboarding.restore.unknownWord', { word: problem.word ?? '' })
          : t(`onboarding.restore.${problem.problem}`),
      );
      return;
    }
    setInputError(null);
    if (protection === 'pin') setStep('pin');
    else save();
  };

  if (step === 'pin') {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        {error ? <Banner tone="negative" title={error} /> : null}
        <PinSetup submitLabel={t('onboarding.restore.submit')} busy={busy} onDone={save} />
      </Screen>
    );
  }

  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <Heading>{t('onboarding.restore.title')}</Heading>
      <Text tone="secondary">{t('onboarding.restore.lead')}</Text>
      {error ? <Banner tone="negative" title={error} /> : null}
      <PhraseInput
        label={t('onboarding.restore.label')}
        hint={t('onboarding.restore.hint')}
        value={input}
        onChange={(v) => {
          setInput(v);
          setInputError(null);
        }}
        error={inputError}
      />
      <Button label={t('onboarding.restore.submit')} onPress={next} loading={busy} disabled={!input.trim() || protection === null} />
    </Screen>
  );
}
