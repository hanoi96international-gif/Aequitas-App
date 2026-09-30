import React from 'react';
import { StyleSheet, View } from 'react-native';

import { completeWord, currentWord, suggestWords } from '@/src/crypto/mnemonic';
import { Button, TextField, useTheme } from '@/src/ui';
import { NoScreenCapture } from './NoScreenCapture';

/**
 * Eingabe einer Phrase (oder eines privaten Schluessels) mit Wortvorschlaegen.
 * Keine Autokorrektur, kein Lernen der Tastatur, kein Autofill, keine
 * Bildschirmfotos.
 */
export function PhraseInput({
  label,
  hint,
  value,
  onChange,
  error,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
}) {
  const { space } = useTheme();
  const suggestions = suggestWords(currentWord(value));
  return (
    <View style={{ gap: space.sm }}>
      <NoScreenCapture />
      <TextField
        label={label}
        hint={hint}
        value={value}
        onChangeText={onChange}
        error={error}
        multiline
        numberOfLines={4}
        textAlignVertical="top"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        importantForAutofill="no"
        spellCheck={false}
        keyboardType="visible-password"
      />
      {suggestions.length > 0 ? (
        <View style={[styles.wrap, { gap: space.sm }]}>
          {suggestions.map((w) => (
            <Button key={w} label={w} variant="secondary" fullWidth={false} onPress={() => onChange(completeWord(value, w))} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
});
