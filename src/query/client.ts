import { focusManager, onlineManager, QueryClient } from '@tanstack/react-query';
import * as Network from 'expo-network';
import { AppState, type AppStateStatus } from 'react-native';

import { isApiError } from '@/src/api/errors';

// Server-State ueber TanStack Query (docs/NEUBAU_ANALYSE.md 3.2).
//
// Ersetzt die verstreuten setInterval-Abfragen: Abfragen laufen nur, solange
// die App im Vordergrund und online ist, werden dedupliziert und nach einer
// Mutation gezielt ungueltig gemacht. Die Wiederholungsregeln fuer einzelne
// HTTP-Aufrufe stehen in src/api/http.ts; hier nur, ob TanStack eine ganze
// Abfrage noch einmal startet.

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        gcTime: 5 * 60_000,
        retry: (failureCount, error) => failureCount < 2 && isApiError(error) && error.transient,
        refetchOnReconnect: true,
      },
      mutations: {
        // Signierte Auftraege nie automatisch wiederholen.
        retry: false,
      },
    },
  });
}

let wired = false;

/** Vordergrund/Hintergrund und Netzstatus an TanStack melden. Einmal beim Start. */
export function wireQueryEnvironment(): () => void {
  if (wired) return () => {};
  wired = true;
  const sub = AppState.addEventListener('change', (s: AppStateStatus) => focusManager.setFocused(s === 'active'));
  onlineManager.setEventListener((setOnline) => {
    const netSub = Network.addNetworkStateListener((state) => setOnline(!!state.isConnected));
    return () => netSub.remove();
  });
  return () => {
    sub.remove();
    wired = false;
  };
}
