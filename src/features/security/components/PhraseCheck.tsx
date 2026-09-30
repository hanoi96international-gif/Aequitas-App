import React, { useState } from 'react';

import { pickCheckPositions } from '@/src/crypto/mnemonic';
import { useI18n } from '@/src/i18n';
import { Button, Stack, TextField } from '@/src/ui';

/**
 * Sicherungspruefung: drei zufaellige Woerter der Phrase abfragen. Die alte
 * App hatte nur eine Checkbox ("habe ich aufgeschrieben").
 */
export function PhraseCheck({ phrase, onPassed, busy }: { phrase: string; onPassed: () => void; busy?: boolean }) {
  const { t } = useI18n();
  const words = phrase.split(' ');
  const [positions] = useState(() => pickCheckPositions(words.length));
  const [answers, setAnswers] = useState<string[]>(() => positions.map(() => ''));
  const [wrong, setWrong] = useState(false);

  const submit = () => {
    const ok = positions.every((p, i) => answers[i].trim().toLowerCase() === words[p]);
    setWrong(!ok);
    if (ok) onPassed();
  };

  return (
    <Stack gap="lg">
      {positions.map((p, i) => (
        <TextField
          key={p}
          label={t('onboarding.create.wordLabel', { n: p + 1 })}
          value={answers[i]}
          onChangeText={(v) => {
            setWrong(false);
            setAnswers((a) => a.map((x, j) => (j === i ? v : x)));
          }}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          importantForAutofill="no"
          spellCheck={false}
          // Android: keine Lernfunktion/Vorschlagsleiste der Tastatur.
          keyboardType="visible-password"
          returnKeyType={i === positions.length - 1 ? 'done' : 'next'}
          error={wrong && answers[i].trim().toLowerCase() !== words[p] ? t('onboarding.create.wrongWords') : null}
        />
      ))}
      <Button label={t('common.confirm')} onPress={submit} loading={busy} disabled={answers.some((a) => !a.trim())} />
    </Stack>
  );
}
