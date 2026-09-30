// Zuerst: sicherer Zufall fuer ethers (Phrase, Schluessel).
import 'react-native-get-random-values';

import { DarkTheme, DefaultTheme, ThemeProvider as NavThemeProvider, type Theme as NavTheme } from '@react-navigation/native';
import { QueryClientProvider } from '@tanstack/react-query';
import { Stack, type ErrorBoundaryProps } from 'expo-router';
import * as ScreenCapture from 'expo-screen-capture';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text as RNText, View } from 'react-native';
import 'react-native-reanimated';

import { NetzProvider } from '@/src/features/network/NetzProvider';
import { SessionProvider, useSession } from '@/src/features/security/SessionProvider';
import { I18nProvider } from '@/src/i18n';
import { createQueryClient, wireQueryEnvironment } from '@/src/query/client';
import { palettes, ThemeProvider, useTheme } from '@/src/ui';

// Wurzel des Neubaus (docs/NEUBAU_ANALYSE.md 3.3).
//
// Drei Bereiche, jeder hinter einem Guard (Stack.Protected, wie in der alten
// App: alle Routen bleiben deklariert, nur der Zugang wechselt):
//   kein Tresor         -> (onboarding)
//   Tresor, gesperrt    -> lock (+ recover)
//   entsperrt           -> (app)
// Waehrend der Tresor geladen wird, bleibt der Startbildschirm stehen.
//
// Die alte Wurzel importierte lib/globalErrorHandler, der fatale Fehler
// verschluckte -- eine Wallet lief dann in unbekanntem Zustand weiter. Jetzt
// faengt ErrorBoundary (unten) den Fehler und bietet einen Neustart an.

SplashScreen.preventAutoHideAsync().catch(() => {});

function RootNavigator() {
  const { status, touch } = useSession();
  const { scheme, colors } = useTheme();

  useEffect(() => {
    if (status !== 'loading') SplashScreen.hideAsync().catch(() => {});
  }, [status]);

  useEffect(() => {
    // iOS: im App-Umschalter nur eine unscharfe Flaeche zeigen. (Android:
    // FLAG_SECURE auf den Bildschirmen mit Phrase, NoScreenCapture.)
    if (Platform.OS === 'ios') ScreenCapture.enableAppSwitcherProtectionAsync(0.9).catch(() => {});
  }, []);

  const navTheme = useMemo<NavTheme>(() => {
    const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: colors.accent,
        background: colors.bg,
        card: colors.bg,
        text: colors.text,
        border: colors.border,
        notification: colors.negative,
      },
    };
  }, [scheme, colors]);

  if (status === 'loading') return null;

  return (
    <NavThemeProvider value={navTheme}>
      {/* Jede Beruehrung schiebt die Inaktivitaetssperre hinaus; die Beruehrung selbst geht normal weiter. */}
      <View
        style={styles.fill}
        onStartShouldSetResponderCapture={() => {
          touch();
          return false;
        }}
      >
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
          <Stack.Protected guard={status === 'noVault'}>
            <Stack.Screen name="(onboarding)" />
          </Stack.Protected>
          <Stack.Protected guard={status === 'locked' || status === 'unavailable'}>
            <Stack.Screen name="lock" options={{ animation: 'fade' }} />
            <Stack.Screen name="recover" options={{ headerShown: true, title: '', headerShadowVisible: false }} />
          </Stack.Protected>
          <Stack.Protected guard={status === 'unlocked'}>
            <Stack.Screen name="(app)" options={{ animation: 'fade' }} />
          </Stack.Protected>
        </Stack>
      </View>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
    </NavThemeProvider>
  );
}

export default function RootLayout() {
  const [queryClient] = useState(createQueryClient);
  useEffect(() => wireQueryEnvironment(), []);

  return (
    <ThemeProvider>
      <I18nProvider>
        <QueryClientProvider client={queryClient}>
          <SessionProvider>
            <NetzProvider>
              <RootNavigator />
            </NetzProvider>
          </SessionProvider>
        </QueryClientProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}

/**
 * Letzte Rettung bei einem Fehler beim Zeichnen. Laeuft ausserhalb der
 * Provider, deshalb ohne Theme/i18n: feste dunkle Farben, zweisprachig.
 * Kein Fehlertext nach aussen -- er koennte Adressen oder Antworten enthalten.
 */
export function ErrorBoundary({ retry }: ErrorBoundaryProps) {
  const c = palettes.dark;
  return (
    <View style={[styles.fill, styles.center, { backgroundColor: c.bg, padding: 24, gap: 16 }]} accessibilityRole="alert">
      <RNText style={{ color: c.text, fontSize: 20, fontWeight: '600', textAlign: 'center' }}>
        Etwas ist schiefgelaufen.{'\n'}Something went wrong.
      </RNText>
      <RNText style={{ color: c.textSecondary, fontSize: 15, textAlign: 'center' }}>
        Deine Wallet ist sicher gespeichert. / Your wallet is stored safely.
      </RNText>
      <Pressable
        accessibilityRole="button"
        onPress={retry}
        style={{ backgroundColor: c.accent, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 12 }}
      >
        <RNText style={{ color: c.textOnAccent, fontSize: 16, fontWeight: '600' }}>Erneut versuchen / Try again</RNText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
});
