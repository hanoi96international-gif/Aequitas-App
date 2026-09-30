import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, type DimensionValue } from 'react-native';

import { useTheme } from '../theme';
import type { Palette } from '../tokens';
import { Button } from './Button';
import { Text } from './Text';

type BannerTone = 'info' | 'positive' | 'warning' | 'negative';

const bannerColors: Record<BannerTone, { bg: keyof Palette; fg: 'accent' | 'positive' | 'warning' | 'negative' }> = {
  info: { bg: 'infoSoft', fg: 'accent' },
  positive: { bg: 'positiveSoft', fg: 'positive' },
  warning: { bg: 'warningSoft', fg: 'warning' },
  negative: { bg: 'negativeSoft', fg: 'negative' },
};

/** Hinweis im Fluss des Bildschirms. Bedeutung nie nur ueber Farbe: immer mit Titel. */
export function Banner({
  tone = 'info',
  title,
  message,
  action,
}: {
  tone?: BannerTone;
  title: string;
  message?: string;
  action?: { label: string; onPress: () => void };
}) {
  const { colors, radius, space } = useTheme();
  const c = bannerColors[tone];
  return (
    <View
      accessibilityRole={tone === 'negative' || tone === 'warning' ? 'alert' : 'summary'}
      style={{ backgroundColor: colors[c.bg], borderRadius: radius.md, padding: space.md, gap: space.xs }}
    >
      <Text variant="bodyStrong" tone={c.fg}>
        {title}
      </Text>
      {message ? (
        <Text variant="footnote" tone="secondary">
          {message}
        </Text>
      ) : null}
      {action ? <Button label={action.label} variant="tertiary" fullWidth={false} onPress={action.onPress} /> : null}
    </View>
  );
}

/** Platzhalter waehrend des Ladens (ruhig pulsierend, respektiert "Bewegung reduzieren" ueber kurze Dauer). */
export function Skeleton({ width = '100%', height = 16 }: { width?: DimensionValue; height?: number }) {
  const { colors, radius } = useTheme();
  const opacity = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width, height, borderRadius: radius.sm, backgroundColor: colors.surfaceSunken, opacity }}
    />
  );
}

export function EmptyState({ title, message, action }: { title: string; message?: string; action?: { label: string; onPress: () => void } }) {
  const { space } = useTheme();
  return (
    <View style={[styles.center, { padding: space.xl, gap: space.sm }]}>
      <Text variant="title3" align="center">
        {title}
      </Text>
      {message ? (
        <Text variant="callout" tone="secondary" align="center">
          {message}
        </Text>
      ) : null}
      {action ? <Button label={action.label} variant="secondary" fullWidth={false} onPress={action.onPress} /> : null}
    </View>
  );
}

export function ErrorState({ title, message, retryLabel, onRetry }: { title: string; message?: string; retryLabel: string; onRetry?: () => void }) {
  const { space } = useTheme();
  return (
    <View accessibilityRole="alert" style={[styles.center, { padding: space.xl, gap: space.sm }]}>
      <Text variant="title3" align="center">
        {title}
      </Text>
      {message ? (
        <Text variant="callout" tone="secondary" align="center">
          {message}
        </Text>
      ) : null}
      {onRetry ? <Button label={retryLabel} variant="secondary" fullWidth={false} onPress={onRetry} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
});
