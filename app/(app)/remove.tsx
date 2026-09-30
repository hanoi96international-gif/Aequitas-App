import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useSession } from '@/src/features/security/SessionProvider';
import { VaultAccess } from '@/src/features/security/components/VaultAccess';
import { useI18n } from '@/src/i18n';
import { Banner, Button, Card, Text, TextField, useTheme, Screen } from '@/src/ui';

// Wallet von diesem Geraet entfernen. Frueher genuegte ein einziger Dialog
// (WalletContext.tsx). Jetzt: Sicherung bestaetigen, Wort eintippen und den
// Tresor noch einmal oeffnen (Biometrie/PIN) -- wer nur ein entsperrtes
// Telefon in der Hand hat, kann die Wallet nicht loeschen.
// Guthabenwarnung: sobald Etappe 3 das Guthaben laedt.

export default function Remove() {
  const { t } = useI18n();
  const { meta, remove } = useSession();
  const { colors, radius, space } = useTheme();
  const router = useRouter();
  const [confirmed, setConfirmed] = useState(false);
  const [typed, setTyped] = useState('');
  if (!meta) return null;

  const word = t('remove.word');
  const ready = confirmed && typed.trim().toUpperCase() === word.toUpperCase();
  const hasPhrase = meta.kind === 'phrase';

  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <Text tone="secondary">{t('remove.lead')}</Text>
      {!hasPhrase ? (
        <Banner tone="negative" title={t('remove.noPhrase')} />
      ) : !meta.backedUp ? (
        <Banner tone="warning" title={t('remove.notChecked')} action={{ label: t('security.showBackup'), onPress: () => router.push('/backup') }} />
      ) : null}

      <Card padded={false}>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: confirmed }}
          onPress={() => setConfirmed((c) => !c)}
          style={[styles.row, { padding: space.lg, gap: space.md }]}
        >
          <View
            style={[
              styles.box,
              { borderRadius: radius.sm, borderColor: confirmed ? colors.accent : colors.borderStrong, backgroundColor: confirmed ? colors.accent : 'transparent' },
            ]}
          >
            {confirmed ? <Text tone="onAccent" variant="footnote">✓</Text> : null}
          </View>
          <Text style={styles.fill}>{hasPhrase ? t('remove.confirmBackup') : t('remove.confirmNoPhrase')}</Text>
        </Pressable>
      </Card>

      <TextField
        label={t('remove.typeLabel', { word })}
        value={typed}
        onChangeText={setTyped}
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="off"
      />

      <VaultAccess
        protection={meta.protection}
        label={t('remove.submit')}
        destructive
        disabled={!ready}
        onSubmit={(pin) => remove(t('remove.prompt'), pin)}
      />
      <Button variant="tertiary" label={t('common.cancel')} onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  box: { width: 24, height: 24, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  fill: { flex: 1 },
});
