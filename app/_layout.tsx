import '@/lib/globalErrorHandler';
import 'react-native-get-random-values';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { WalletProvider, useWallet } from '@/contexts/WalletContext';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { appKit } from '@/lib/walletconnect';
import { WalletConnectErrorBoundary } from '@/components/WalletConnectErrorBoundary';
import NetworkSetupOverlay from '@/components/NetworkSetupOverlay';

function Navigation() {
  const { hydrating, address } = useWallet();

  if (hydrating) return null;

  // FIX (real-device crash: "TypeError: Cannot read property 'ErrorBoundary'
  // of undefined" inside expo-router's ContextNavigator/getQualifiedRouteComponent,
  // production builds only): this used to render an ENTIRELY DIFFERENT set of
  // Stack.Screen children depending on `address` (either just "onboarding", or
  // "(tabs)"+"modal") -- a known expo-router crash class, since the static
  // route manifest built at bundle time expects a stable declared route tree,
  // not one whose children swap out wholesale at runtime. Stack.Protected
  // (expo-router 6+) is the supported fix: every route stays declared,
  // `guard` only gates navigation/redirect behavior.
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!address}>
        <Stack.Screen name="onboarding" />
      </Stack.Protected>

      <Stack.Protected guard={!!address}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal', headerShown: true }} />
        <Stack.Screen name="biometric-capture" options={{ presentation: 'modal', headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );
}

function AppShell() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Navigation />
      <NetworkSetupOverlay />
      <StatusBar style="light" />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  const content = (
    <LanguageProvider>
      <WalletProvider>
        <AppShell />
      </WalletProvider>
    </LanguageProvider>
  );

  // Lazily required, not statically imported at the top of this file — see
  // lib/walletconnect.ts's own comment on appKit for why: this is the ROOT
  // route expo-router loads first, before any error boundary exists, so a
  // top-level `import { AppKit, AppKitProvider } from '@reown/...'` here
  // crashed the entire app on launch if that SDK ever threw during its own
  // module evaluation. By the time appKit is truthy, this require() has
  // already succeeded once (inside walletconnect.ts's own try/catch), so
  // this just returns the cached module.
  if (appKit) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AppKit, AppKitProvider } = require('@reown/appkit-react-native');
    return (
      <AppKitProvider instance={appKit}>
        {content}
        <WalletConnectErrorBoundary>
          <AppKit />
        </WalletConnectErrorBoundary>
      </AppKitProvider>
    );
  }
  return content;
}
