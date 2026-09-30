import React from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { useTheme } from '../theme';
import { minTouch } from '../tokens';
import { Text } from './Text';

/** Grundgeruest eines Bildschirms: Hintergrund, sichere Raender, optional Scroll + Pull-to-Refresh. */
export function Screen({
  children,
  scroll = true,
  edges = ['top', 'left', 'right'],
  refreshing,
  onRefresh,
  contentStyle,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  edges?: Edge[];
  refreshing?: boolean;
  onRefresh?: () => void;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const { colors, space } = useTheme();
  const inner = [{ padding: space.lg, gap: space.lg }, contentStyle];
  return (
    <SafeAreaView edges={edges} style={[styles.fill, { backgroundColor: colors.bg }]}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={inner}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            onRefresh ? (
              <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.textTertiary} />
            ) : undefined
          }
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.fill, inner]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

/** Flaeche fuer zusammengehoerige Inhalte. */
export function Card({ style, padded = true, ...rest }: ViewProps & { padded?: boolean }) {
  const { colors, radius, space } = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: colors.surface,
          borderRadius: radius.lg,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
          padding: padded ? space.lg : 0,
          overflow: 'hidden',
        },
        style,
      ]}
      {...rest}
    />
  );
}

export function Divider({ inset = 0 }: { inset?: number }) {
  const { colors } = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: inset }} />;
}

export function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  const { space } = useTheme();
  return (
    <View style={[styles.rowBetween, { paddingHorizontal: space.xs, marginBottom: -space.xs }]}>
      <Text variant="caption" tone="tertiary" accessibilityRole="header">
        {title.toUpperCase()}
      </Text>
      {action}
    </View>
  );
}

/** Listenzeile: Titel, Untertitel, rechter Wert; beruehrbar, wenn onPress. */
export function ListRow({
  title,
  subtitle,
  leading,
  trailing,
  value,
  onPress,
  accessibilityHint,
  destructive,
}: {
  title: string;
  subtitle?: string;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  value?: string;
  onPress?: () => void;
  accessibilityHint?: string;
  destructive?: boolean;
}) {
  const { colors, space } = useTheme();
  const content = (
    <View style={[styles.row, { minHeight: minTouch + 12, paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.md }]}>
      {leading}
      <View style={styles.fill}>
        <Text variant="body" tone={destructive ? 'negative' : 'primary'} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="footnote" tone="secondary" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text variant="body" tone="secondary" tabular>
          {value}
        </Text>
      ) : null}
      {trailing}
      {onPress && !trailing ? <Text tone="tertiary">›</Text> : null}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      style={({ pressed }) => ({ backgroundColor: pressed ? colors.surfaceSunken : 'transparent' })}
    >
      {content}
    </Pressable>
  );
}

/** Zeile "Bezeichnung ... Wert", z. B. fuer Gebuehrenaufstellungen. */
export function KeyValueRow({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  const { space } = useTheme();
  return (
    <View style={[styles.rowBetween, { paddingVertical: space.xs, gap: space.md }]} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text variant={emphasis ? 'bodyStrong' : 'callout'} tone={emphasis ? 'primary' : 'secondary'}>
        {label}
      </Text>
      <Text variant={emphasis ? 'bodyStrong' : 'callout'} tabular align="right" style={styles.shrink}>
        {value}
      </Text>
    </View>
  );
}

export function Stack({ gap = 'md', style, ...rest }: ViewProps & { gap?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' }) {
  const { space } = useTheme();
  return <View style={[{ gap: space[gap] }, style]} {...rest} />;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  shrink: { flexShrink: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
