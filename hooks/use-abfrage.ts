import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { starteTakt, type Lade, type Takt } from '@/lib/abfrageTakt';

/**
 * Bindet einen Takt (lib/abfrageTakt.ts) an App und Bildschirm: er laeuft nur,
 * solange die App im Vordergrund ist und -- mit useAbfrage -- der Bildschirm
 * den Fokus hat. Gibt zurueck, ob die Abfragen gerade fehlschlagen.
 *
 * lade wechselt (etwa mit der Adresse) -> neuer Takt, sofortige Abfrage.
 */
function anAppZustandBinden(takt: Takt): () => void {
  if (AppState.currentState && AppState.currentState !== 'active') takt.anhalten();
  const sub = AppState.addEventListener('change', (s) => {
    if (s === 'active') takt.fortsetzen();
    else takt.anhalten();
  });
  return () => {
    sub.remove();
    takt.beenden();
  };
}

/** Fuer Bildschirme: laeuft nur bei Fokus und im Vordergrund. */
export function useAbfrage(lade: Lade | null, intervallMs: number): boolean {
  const [offline, setOffline] = useState(false);
  useFocusEffect(
    useCallback(() => {
      if (!lade) return;
      return anAppZustandBinden(starteTakt(lade, intervallMs, setOffline));
    }, [lade, intervallMs]),
  );
  return offline;
}

/** Fuer Dinge ohne Bildschirm (Kontexte): laeuft im Vordergrund. */
export function useAbfrageImVordergrund(lade: Lade | null, intervallMs: number): boolean {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    if (!lade) return;
    return anAppZustandBinden(starteTakt(lade, intervallMs, setOffline));
  }, [lade, intervallMs]);
  return offline;
}
