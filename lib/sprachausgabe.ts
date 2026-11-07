// Gesprochene Anweisungen: zuerst eine mitgelieferte Sprachaufnahme mit
// natuerlicher Stimme (assets/stimme/, erzeugt von scripts/stimmen-erzeugen),
// sonst die Sprachausgabe des Geraets.
//
// Die Aufnahmen liegen in der App. Abgespielt wird vom Geraet; kein Text
// verlaesst das Telefon, und es braucht kein Netz. Zugeordnet wird ueber den
// FERTIGEN Text in der gewaehlten Sprache (dieselbe Zeichenkette, die t()
// liefert) -- aendert sich eine Uebersetzung, passt die alte Aufnahme nicht
// mehr und es spricht wieder das Geraet, bis die Aufnahmen neu erzeugt sind.
// Nie sagt die App also etwas anderes, als auf dem Bildschirm steht.
import * as Speech from 'expo-speech';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { AUFNAHMEN } from './sprachaufnahmen';

let aktuell: AudioPlayer | null = null;

/** Die Aufnahme zu genau diesem Text in dieser Sprache, oder undefined. */
export function aufnahmeFuer(sprache: string, text: string): number | undefined {
  return AUFNAHMEN[`${sprache}|${text.trim()}`];
}

/** Stoppt, was gerade spricht -- Aufnahme wie Geraetestimme. */
export function stoppen(): void {
  if (aktuell) {
    try {
      aktuell.pause();
      aktuell.remove();
    } catch {
      /* schon weg */
    }
    aktuell = null;
  }
  Speech.stop();
}

/**
 * Spielt die Aufnahme zu text, falls es eine gibt, und ruft danach fertig().
 * true: es wurde eine Aufnahme gespielt; false: keine da -- der Aufrufer
 * spricht mit der Geraetestimme.
 */
export function aufnahmeSpielen(sprache: string, text: string, fertig?: () => void): boolean {
  const quelle = aufnahmeFuer(sprache, text);
  if (quelle === undefined) return false;
  try {
    const p = createAudioPlayer(quelle);
    aktuell = p;
    let erledigt = false;
    const ende = () => {
      if (erledigt) return;
      erledigt = true;
      if (aktuell === p) aktuell = null;
      try {
        p.remove();
      } catch {
        /* schon weg */
      }
      fertig?.();
    };
    p.addListener('playbackStatusUpdate', (s) => {
      if (s.didJustFinish) ende();
    });
    p.play();
    return true;
  } catch {
    return false;
  }
}
