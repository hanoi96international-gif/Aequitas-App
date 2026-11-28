/**
 * Store-Eintrag fuer Google Play (store/play/<sprache>/): Grenzen von Google
 * und ehrliche Aussagen. Google weist zu lange Texte ab; und der Eintrag darf
 * nicht mehr versprechen als die App (gleich wie ehrlicheTexte.test.ts):
 * kein absolutes "faelschungssicher", und solange im Testbetrieb ein einziger
 * Knoten laeuft, steht das dabei, statt "dezentral" als Tatsache.
 */
import * as fs from 'fs';
import * as path from 'path';

const ORDNER = path.join(__dirname, '..', '..', 'store', 'play');
const SPRACHEN = ['ar', 'de-DE', 'en-US', 'es-ES', 'fr-FR', 'hi-IN', 'id', 'it-IT', 'pt-PT', 'ru-RU', 'tr-TR', 'zh-CN'];
const lies = (l: string, f: string) => fs.readFileSync(path.join(ORDNER, l, f), 'utf8').trim();
const laenge = (s: string) => Array.from(s).length;

// Dass im Testbetrieb erst ein Knoten laeuft, steht in jeder Sprache.
const EIN_KNOTEN: Record<string, string> = {
  'ar': 'عقدة واحدة', 'de-DE': 'ein einziger Knoten', 'en-US': 'a single node', 'es-ES': 'un solo nodo',
  'fr-FR': 'un seul nœud', 'hi-IN': 'केवल एक नोड', 'id': 'satu node', 'it-IT': 'un solo nodo',
  'pt-PT': 'um único nó', 'ru-RU': 'один узел', 'tr-TR': 'tek bir düğüm', 'zh-CN': '只有一个节点',
};
const VERBOTEN = ['fälschungssicher', 'counterfeit-proof', 'unkopierbar', 'impossible to copy', 'infalsificable', 'infalsifiable'];

test('alle 12 Sprachen sind da', () => {
  const da = fs.readdirSync(ORDNER).filter((d) => fs.existsSync(path.join(ORDNER, d, 'title.txt'))).sort();
  expect(da).toEqual([...SPRACHEN].sort());
});

test.each(SPRACHEN)('%s: Grenzen von Google Play', (l) => {
  expect(laenge(lies(l, 'title.txt'))).toBeLessThanOrEqual(30);
  expect(laenge(lies(l, 'short_description.txt'))).toBeLessThanOrEqual(80);
  expect(laenge(lies(l, 'full_description.txt'))).toBeLessThanOrEqual(4000);
  expect(laenge(lies(l, 'short_description.txt'))).toBeGreaterThan(0);
});

test.each(SPRACHEN)('%s: ehrlich -- ein Knoten im Testbetrieb, nichts Absolutes', (l) => {
  const alles = ['title.txt', 'short_description.txt', 'full_description.txt'].map((f) => lies(l, f)).join('\n');
  expect(alles).toContain(EIN_KNOTEN[l]);
  for (const v of VERBOTEN) expect(alles.toLowerCase()).not.toContain(v.toLowerCase());
});
