import React from 'react';
import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

import { useTheme } from '../theme';
import type { Palette, TypeVariant } from '../tokens';

type Tone = 'primary' | 'secondary' | 'tertiary' | 'accent' | 'positive' | 'negative' | 'warning' | 'onAccent';

const toneColor: Record<Tone, keyof Palette> = {
  primary: 'text',
  secondary: 'textSecondary',
  tertiary: 'textTertiary',
  accent: 'accent',
  positive: 'positive',
  negative: 'negative',
  warning: 'warning',
  onAccent: 'textOnAccent',
};

export interface TextProps extends RNTextProps {
  variant?: TypeVariant;
  tone?: Tone;
  align?: 'left' | 'center' | 'right';
  /** Tabellarische Ziffern -- Betraege stehen sauber untereinander. */
  tabular?: boolean;
}

export function Text({ variant = 'body', tone = 'primary', align, tabular, style, ...rest }: TextProps) {
  const { colors, type } = useTheme();
  return (
    <RNText
      // Schrift waechst mit der Systemeinstellung, aber nicht ins Unlesbare.
      maxFontSizeMultiplier={1.6}
      {...rest}
      style={[
        type[variant],
        { color: colors[toneColor[tone]] },
        align ? { textAlign: align } : null,
        tabular ? { fontVariant: ['tabular-nums'] } : null,
        style,
      ]}
    />
  );
}

/** Ueberschrift mit Rolle fuer Screenreader. */
export function Heading({ level = 1, ...rest }: Omit<TextProps, 'variant'> & { level?: 1 | 2 | 3 }) {
  const variant: TypeVariant = level === 1 ? 'title1' : level === 2 ? 'title2' : 'title3';
  return <Text accessibilityRole="header" variant={variant} {...rest} />;
}
