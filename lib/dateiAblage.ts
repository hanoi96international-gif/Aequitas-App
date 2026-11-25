// Ablage in Dateien (B4b-4c, Messung in Pilot-Größe 25.11.2026): große, nicht
// geheime Daten des Quantengelds -- vor allem die Antworten der Gelosten beim
// Ausgeber (bei v = 7, n = 2822 zusammen ~4,2 MB) -- passen nicht in
// AsyncStorage (Android ~6 MB gesamt ohne eigene Einstellung).
//
// Eine Datei je Schlüssel im Ordner `quantenS` unter Paths.document (laut
// expo-file-system 19: "safe from being deleted by the system"). Schreiben
// erst in `<name>.neu`, dann an die Stelle der alten Datei verschoben: bricht
// es dazwischen ab, bleibt die alte Datei oder gar keine -- nie eine halbe.
// Was hier liegt, ist nicht geheim (Chiffrate, Unterschriften, Blätter) und wird
// beim Lesen jedes Mal neu geprüft (Unterschriften, Wurzel); eine veränderte
// Datei fällt also auf, statt geglaubt zu werden.
//
// Schlüssel: nur [A-Za-z0-9._-], 1..120 Zeichen -- kein Pfad, kein `..`.

import { Directory, File, Paths } from 'expo-file-system';
import { QuantenSFehler } from './quantenS';
import type { Speicher } from './quantenSInhaberin';

const NAME = /^[A-Za-z0-9._-]{1,120}$/;

function name(key: string): string {
  if (!NAME.test(key) || key.includes('..') || key.endsWith('.neu')) throw new QuantenSFehler('Ablage: Schlüssel');
  return key;
}

/** Eine Ablage in Dateien (Schnittstelle wie Speicher; `geheim` wird nicht unterstützt). */
export function dateiAblage(ordner = 'quantenS'): Speicher {
  if (!NAME.test(ordner) || ordner.includes('..')) throw new QuantenSFehler('Ablage: Ordner');
  const dir = () => {
    const d = new Directory(Paths.document, ordner);
    if (!d.exists) d.create({ intermediates: true });
    return d;
  };
  return {
    lesen: async (key) => {
      const f = new File(dir(), name(key));
      return f.exists ? f.text() : null;
    },
    schreiben: async (key, wert, geheim) => {
      if (geheim) throw new QuantenSFehler('Ablage in Dateien: nichts Geheimes');
      const d = dir();
      const ziel = new File(d, name(key));
      const neu = new File(d, `${key}.neu`);
      if (neu.exists) neu.delete();
      neu.create();
      neu.write(wert);
      if (ziel.exists) ziel.delete();
      neu.move(ziel);
    },
    loeschen: async (key) => {
      const f = new File(dir(), name(key));
      if (f.exists) f.delete();
    },
  };
}
