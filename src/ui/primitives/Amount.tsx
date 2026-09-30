import React from 'react';

import { formatAmount, type Micro } from '@/src/domain/amount';
import { useI18n } from '@/src/i18n';
import type { TypeVariant } from '../tokens';
import { Text } from './Text';

/**
 * Betrag mit Einheit. Nie abgekuerzt ("1,2K") -- wer bestaetigt, muss die
 * ganze Zahl sehen. Screenreader lesen Betrag und Einheit zusammen.
 */
export function Amount({
  value,
  unit = 'AEQ',
  variant = 'body',
  signed,
  maxDecimals,
  tone,
}: {
  value: Micro | null | undefined;
  unit?: string;
  variant?: TypeVariant;
  signed?: boolean;
  maxDecimals?: number;
  tone?: 'primary' | 'secondary' | 'positive' | 'negative';
}) {
  const { locale } = useI18n();
  if (value == null) {
    return (
      <Text variant={variant} tone="tertiary">
        —
      </Text>
    );
  }
  const text = formatAmount(value, { locale, signed, maxDecimals });
  const autoTone = signed ? (value > 0n ? 'positive' : value < 0n ? 'negative' : 'primary') : 'primary';
  return (
    <Text variant={variant} tone={tone ?? autoTone} tabular accessibilityLabel={`${text} ${unit}`}>
      {text} <Text variant={variant} tone="secondary">{unit}</Text>
    </Text>
  );
}
