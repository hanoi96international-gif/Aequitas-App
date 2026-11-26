// React-Hülle der Automatik (lib/quantenSAutomatik.ts): läuft nur, solange
// die Seite im Fokus und die App im Vordergrund ist; beim Verlassen oder im
// Hintergrund hält sie an. Nie zwei Schleifen zugleich.

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { automatikStarten, type AutoEnde } from './quantenSAutomatik';

export interface AutomatikZustand {
  an: boolean;
  runde: number;
  fehler: string | null;
  ende: AutoEnde | null;
  start: () => void;
  stop: () => void;
}

export function useQuantenSAutomatik(
  schrittFabrik: () => () => Promise<'weiter' | 'fertig' | 'bestaetigen'>,
  nachRunde?: () => void,
): AutomatikZustand {
  const [an, setAn] = useState(false);
  const [runde, setRunde] = useState(0);
  const [fehler, setFehler] = useState<string | null>(null);
  const [ende, setEnde] = useState<AutoEnde | null>(null);
  const lauf = useRef<{ stop: () => void } | null>(null);
  const da = useRef(true);
  const nach = useRef(nachRunde);
  nach.current = nachRunde;

  const stop = useCallback(() => {
    lauf.current?.stop();
  }, []);

  const start = useCallback(() => {
    if (lauf.current) return; // nie zwei Schleifen
    setEnde(null);
    setFehler(null);
    setRunde(0);
    setAn(true);
    const a = automatikStarten({
      schritt: schrittFabrik(),
      meldung: (m) => {
        if (!da.current) return;
        setRunde(m.runde);
        setFehler(m.fehler ?? null);
        nach.current?.();
      },
    });
    lauf.current = a;
    a.fertig.then(
      (e) => {
        if (lauf.current === a) lauf.current = null;
        if (da.current) {
          setAn(false);
          setEnde(e);
        }
      },
      () => {
        if (lauf.current === a) lauf.current = null;
        if (da.current) {
          setAn(false);
          setEnde('fehler');
        }
      },
    );
  }, [schrittFabrik]);

  // Seite verlassen: anhalten.
  useFocusEffect(useCallback(() => () => lauf.current?.stop(), []));
  // App im Hintergrund: anhalten. Beim Aushängen ebenso.
  useEffect(() => {
    da.current = true;
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') lauf.current?.stop();
    });
    return () => {
      da.current = false;
      sub.remove();
      lauf.current?.stop();
    };
  }, []);

  return { an, runde, fehler, ende, start, stop };
}
