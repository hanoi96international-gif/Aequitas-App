import React, { useState } from 'react';

import { revealPhrase } from '@/src/crypto/vault';
import { NoScreenCapture } from '@/src/features/security/components/NoScreenCapture';
import { PhraseCheck } from '@/src/features/security/components/PhraseCheck';
import { PhraseGrid } from '@/src/features/security/components/PhraseGrid';
import { VaultAccess } from '@/src/features/security/components/VaultAccess';
import { useSession } from '@/src/features/security/SessionProvider';
import { vaultErrorText } from '@/src/features/security/vaultErrors';
import { useI18n } from '@/src/i18n';
import { Banner, Button, Screen, Text } from '@/src/ui';

// Phrase erneut ansehen (die alte App konnte das nicht, sie speicherte nur
// den Schluessel) und die Sicherung pruefen. Jedes Ansehen fragt den Tresor
// neu; die Phrase lebt nur, solange dieser Bildschirm offen ist -- sperrt
// die App, verschwindet er mitsamt Phrase.

export default function Backup() {
  const { t } = useI18n();
  const { meta, markBackedUp } = useSession();
  const [phrase, setPhrase] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!meta) return null;

  if (!phrase) {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        <Text tone="secondary">{t('backup.lead')}</Text>
        <VaultAccess
          protection={meta.protection}
          label={t('backup.reveal')}
          onSubmit={async (pin) => setPhrase(await revealPhrase(t('backup.prompt'), { pin }))}
        />
      </Screen>
    );
  }

  const passed = async () => {
    setBusy(true);
    setError(null);
    try {
      await markBackedUp();
      setChecking(false);
    } catch (e) {
      setError(vaultErrorText(t, e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <NoScreenCapture />
      {error ? <Banner tone="negative" title={error} /> : null}
      {checking ? (
        <PhraseCheck phrase={phrase} onPassed={() => void passed()} busy={busy} />
      ) : (
        <>
          <PhraseGrid phrase={phrase} />
          {meta.backedUp ? (
            <Banner tone="positive" title={t('backup.checked')} />
          ) : (
            <Button label={t('backup.check')} onPress={() => setChecking(true)} />
          )}
        </>
      )}
    </Screen>
  );
}
