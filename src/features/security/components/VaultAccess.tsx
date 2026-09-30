import React, { useState } from 'react';

import type { Protection } from '@/src/crypto/vault';
import { useI18n } from '@/src/i18n';
import { Button, Stack, Text, TextField } from '@/src/ui';
import { vaultErrorText } from '../vaultErrors';

/**
 * Zugang zum Tresor bestaetigen: App-PIN-Feld oder ein Knopf, der Biometrie
 * bzw. Geraete-PIN des Systems oeffnet. Die eigentliche Pruefung macht der
 * Tresor in onSubmit -- dieser Baustein zeigt nur Eingabe, Warten und Fehler.
 */
export function VaultAccess({
  protection,
  label,
  onSubmit,
  destructive,
  disabled,
}: {
  protection: Protection;
  label: string;
  onSubmit: (pin?: string) => Promise<void>;
  destructive?: boolean;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit(protection === 'pin' ? pin : undefined);
    } catch (e) {
      setError(vaultErrorText(t, e));
    } finally {
      setPin('');
      setBusy(false);
    }
  };

  return (
    <Stack gap="md">
      {protection === 'pin' ? (
        <TextField
          label={t('lock.pinLabel')}
          value={pin}
          onChangeText={(v) => setPin(v.replace(/\D/g, ''))}
          keyboardType="number-pad"
          secureTextEntry
          maxLength={12}
          textContentType="none"
          autoComplete="off"
          importantForAutofill="no"
          onSubmitEditing={disabled ? undefined : submit}
          error={error}
        />
      ) : error ? (
        <Text variant="footnote" tone="negative" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      <Button
        label={label}
        variant={destructive ? 'destructive' : 'primary'}
        onPress={submit}
        loading={busy}
        disabled={disabled || (protection === 'pin' && pin.length === 0)}
      />
    </Stack>
  );
}
