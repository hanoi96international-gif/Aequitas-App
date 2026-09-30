import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { api } from '@/src/api/http';
import { pruefeNetz, signierenErlaubt, type NetzBefund } from '@/src/api/netz';
import { useSession } from '@/src/features/security/SessionProvider';

// Netzabgleich fuer die ganze App (Regeln: src/api/netz.ts).
//
// Die zuletzt gesehene Netzkennung ist kein Geheimnis -> AsyncStorage.
// Abgefragt wird nur bei entsperrter App (TanStack pausiert ausserdem im
// Hintergrund und offline, src/query/client.ts).

const KENNUNG_KEY = 'aequitas.netz.kennung';
export const STATUS_QUERY_KEY = ['status'] as const;

interface NetzValue {
  befund: NetzBefund | null;
  /** Nur bei bekanntem, gleichem Netz -- jede Signatur prueft das vorher. */
  signierenErlaubt: boolean;
  /** Neustart der Kette zur Kenntnis genommen: neue Kennung merken, alte Kettenstaende verwerfen. */
  bestaetigeWechsel: () => Promise<void>;
}

const NetzContext = createContext<NetzValue | null>(null);

export function NetzProvider({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const queryClient = useQueryClient();
  // undefined = noch nicht gelesen
  const [gespeichert, setGespeichert] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    AsyncStorage.getItem(KENNUNG_KEY)
      .then((v) => setGespeichert(v))
      .catch(() => setGespeichert(null));
  }, []);

  const statusQuery = useQuery({
    queryKey: STATUS_QUERY_KEY,
    queryFn: async () => (await api.get<unknown>('/status')).data,
    enabled: status === 'unlocked',
    refetchInterval: 60_000,
  });

  const befund = useMemo<NetzBefund | null>(
    () => (statusQuery.data === undefined || gespeichert === undefined ? null : pruefeNetz(statusQuery.data, gespeichert)),
    [statusQuery.data, gespeichert],
  );

  useEffect(() => {
    if (befund?.art !== 'erstmals') return;
    setGespeichert(befund.kennung);
    AsyncStorage.setItem(KENNUNG_KEY, befund.kennung).catch(() => {});
  }, [befund]);

  const bestaetigeWechsel = useCallback(async () => {
    if (befund?.art !== 'gewechselt') return;
    await AsyncStorage.setItem(KENNUNG_KEY, befund.neu);
    setGespeichert(befund.neu);
    // Alles ausser dem Status stammt aus dem alten Netz.
    queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== STATUS_QUERY_KEY[0] });
  }, [befund, queryClient]);

  const value = useMemo<NetzValue>(
    () => ({ befund, signierenErlaubt: signierenErlaubt(befund), bestaetigeWechsel }),
    [befund, bestaetigeWechsel],
  );

  return <NetzContext.Provider value={value}>{children}</NetzContext.Provider>;
}

export function useNetz(): NetzValue {
  const ctx = useContext(NetzContext);
  if (!ctx) throw new Error('useNetz muss innerhalb von NetzProvider aufgerufen werden');
  return ctx;
}
