import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type PressableProps, type ViewStyle } from 'react-native';

import { useTheme } from '../theme';
import { minTouch } from '../tokens';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'destructive';

export interface ButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  label: string;
  variant?: ButtonVariant;
  loading?: boolean;
  icon?: React.ReactNode;
  fullWidth?: boolean;
  style?: ViewStyle;
}

export function Button({
  label,
  variant = 'primary',
  loading = false,
  disabled,
  icon,
  fullWidth = true,
  style,
  ...rest
}: ButtonProps) {
  const { colors, radius, space } = useTheme();
  const inactive = disabled || loading;

  const bg: Record<ButtonVariant, string> = {
    primary: colors.accent,
    secondary: colors.surface,
    tertiary: 'transparent',
    destructive: colors.negative,
  };
  const pressedBg: Record<ButtonVariant, string> = {
    primary: colors.accentPressed,
    secondary: colors.surfaceSunken,
    tertiary: colors.accentSoft,
    destructive: colors.negative,
  };
  const fg = variant === 'primary' || variant === 'destructive' ? 'onAccent' : 'accent';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!inactive, busy: loading }}
      disabled={inactive}
      hitSlop={4}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: minTouch + 8,
          borderRadius: radius.md,
          paddingHorizontal: space.lg,
          backgroundColor: pressed ? pressedBg[variant] : bg[variant],
          borderWidth: variant === 'secondary' ? StyleSheet.hairlineWidth * 2 : 0,
          borderColor: colors.borderStrong,
          opacity: inactive && !loading ? 0.45 : 1,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
        },
        style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={fg === 'onAccent' ? colors.textOnAccent : colors.accent} />
      ) : (
        <View style={[styles.row, { gap: space.sm }]}>
          {icon}
          <Text variant="bodyStrong" tone={fg}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center' },
});
