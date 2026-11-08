// Jeder Satz, den die Aufnahme laut spricht, hat in jeder Sprache eine
// mitgelieferte Aufnahme (scripts/stimmen-erzeugen.mjs). Schlaegt dieser Test
// fehl, wurde eine Uebersetzung geaendert: dann das Skript erneut laufen
// lassen -- bis dahin spraeche an dieser Stelle die Geraetestimme.
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const wurzel = path.join(__dirname, '..', '..');
const quelle = fs.readFileSync(path.join(wurzel, 'lib', 'sprachaufnahmen.ts'), 'utf8');
const eintraege = new Map<string, string>();
for (const m of quelle.matchAll(/^  ("(?:[^"\\]|\\.)*"): require\('\.\.\/(assets\/stimme\/[a-z]{2}\/[0-9a-f]{16}\.mp3)'\),$/gm)) {
  eintraege.set(JSON.parse(m[1]), m[2]);
}

describe('mitgelieferte Sprachaufnahmen', () => {
  const texte: Record<string, string[]> = JSON.parse(
    execFileSync('node', ['scripts/stimmen-texte.mjs'], { cwd: wurzel }).toString()
  );

  it('jede Sprache, jeder gesprochene Satz hat eine Aufnahme', () => {
    const fehlen: string[] = [];
    for (const [sprache, saetze] of Object.entries(texte)) {
      for (const s of saetze) if (!eintraege.has(`${sprache}|${s}`)) fehlen.push(`${sprache}|${s.slice(0, 40)}`);
    }
    expect(fehlen).toEqual([]);
    expect(Object.keys(texte)).toHaveLength(12);
  });

  it('jede Datei gibt es, und sie ist kein leerer Rest', () => {
    for (const datei of eintraege.values()) {
      expect(fs.statSync(path.join(wurzel, datei)).size).toBeGreaterThan(1000);
    }
  });

  it('keine verwaisten Dateien im Ordner', () => {
    const benutzt = new Set(eintraege.values());
    for (const sprache of fs.readdirSync(path.join(wurzel, 'assets', 'stimme'))) {
      for (const f of fs.readdirSync(path.join(wurzel, 'assets', 'stimme', sprache))) {
        expect(benutzt.has(`assets/stimme/${sprache}/${f}`)).toBe(true);
      }
    }
  });
});
