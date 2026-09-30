import React, { useState } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { useTheme } from '../theme';
import { minTouch } from '../tokens';
import { Text } from './Text';

export interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  hint?: string;
  error?: string | null;
  trailing?: React.ReactNode;
  /** Monospace/tabellarisch fuer Adressen und Betraege. */
  numeric?: boolean;
}

export function TextField({ label, hint, error, trailing, numeric, onFocus, onBlur, ...rest }: TextFieldProps) {
  const { colors, radius, space, type } = useTheme();
  const [focused, setFocused] = useState(false);
  const border = error ? colors.negative : focused ? colors.focus : colors.borderStrong;
  return (
    <View style={{ gap: space.xs }}>
      <Text variant="footnote" tone="secondary">
        {label}
      </Text>
      <View
        style={[
          styles.row,
          {
            minHeight: minTouch + 8,
            borderRadius: radius.md,
            borderWidth: focused || error ? 2 : StyleSheet.hairlineWidth * 2,
            borderColor: border,
            backgroundColor: colors.surface,
            paddingHorizontal: space.md,
            gap: space.sm,
          },
        ]}
      >
        <TextInput
          accessibilityLabel={label}
          accessibilityHint={error ?? hint}
          placeholderTextColor={colors.textTertiary}
          selectionColor={colors.accent}
          maxFontSizeMultiplier={1.6}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[
            type.body,
            styles.input,
            { color: colors.text },
            numeric ? { fontVariant: ['tabular-nums'] } : null,
          ]}
          {...rest}
        />
        {trailing}
      </View>
      {error ? (
        <Text variant="footnote" tone="negative" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="footnote" tone="tertiary">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  input: { flex: 1, paddingVertical: 10 },
});
