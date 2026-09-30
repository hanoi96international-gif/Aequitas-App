import { usePreventScreenCapture } from 'expo-screen-capture';

/**
 * Solange eingeblendet: keine Bildschirmfotos und -aufnahmen, auf Android
 * auch kein Bild in der Liste der letzten Apps (FLAG_SECURE). Fuer alles,
 * was eine Phrase oder einen Schluessel zeigt oder annimmt.
 */
export function NoScreenCapture() {
  usePreventScreenCapture('aequitas-geheimnis');
  return null;
}
