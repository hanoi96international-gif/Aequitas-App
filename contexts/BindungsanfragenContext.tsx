// Offene Bindungsanfragen meiner Server, app-weit (keeper/bindungsanfrage.go).
//
// Bis 1.12.3 las nur der Node-Tab sie, und auch nur, solange er offen war --
// ganz unten, unter der Einrichtungsanleitung. Wer seinen Server eingerichtet
// hatte, fand die Anfrage nicht (21.10.2026: "war aber nicht so leicht zu
// finden"). Jetzt zeigen Startseite und Tab-Leiste, dass eine wartet.
//
// Gelesen wird nur, was holeBindungsanfragen formal und kryptografisch
// prueft (hoechstens 10). Ein Fehler heisst: keine Anfrage -- angezeigt wird
// nie etwas Ungeprueftes, bestaetigt wird weiter nur in knoten-binden.tsx.
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { useWallet } from '@/contexts/WalletContext';
import { holeBindungsanfragen, type Bindungsanfrage } from '@/lib/knotenBindung';

// Im Hintergrund reicht alle 15 s; der Node-Tab laedt, solange er offen ist,
// selbst schneller nach.
export const BINDUNGSANFRAGEN_INTERVALL_MS = 15000;

interface Wert {
  anfragen: Bindungsanfrage[];
  neuLaden: () => Promise<void>;
  entfernen: (adresse: string) => void;
}

const Ctx = createContext<Wert>({ anfragen: [], neuLaden: async () => {}, entfernen: () => {} });

export function BindungsanfragenProvider({ children }: { children: React.ReactNode }) {
  const { address } = useWallet();
  const [anfragen, setAnfragen] = useState<Bindungsanfrage[]>([]);
  const aktuell = useRef<string | null | undefined>(address);

  const neuLaden = useCallback(async () => {
    if (!address) return;
    const a = await holeBindungsanfragen(address);
    // Eine Antwort fuer eine inzwischen gewechselte Wallet wird verworfen.
    if (aktuell.current === address) setAnfragen(a);
  }, [address]);

  useEffect(() => {
    aktuell.current = address;
    setAnfragen([]);
    if (!address) return;
    neuLaden();
    const timer = setInterval(neuLaden, BINDUNGSANFRAGEN_INTERVALL_MS);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') neuLaden();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [address, neuLaden]);

  const entfernen = useCallback((adresse: string) => {
    setAnfragen((alt) => alt.filter((x) => x.adresse !== adresse));
  }, []);

  return <Ctx.Provider value={{ anfragen, neuLaden, entfernen }}>{children}</Ctx.Provider>;
}

export function useBindungsanfragen(): Wert {
  return useContext(Ctx);
}
