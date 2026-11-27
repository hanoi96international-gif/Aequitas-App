/**
 * Ehrliche Texte (Gespräch mit dem Betreiber, 27.11.2026): Ohne Gerät beim
 * Inhaber (Weg C, C4) macht die Physik den Token noch nicht unkopierbar, und in
 * der Beta erzeugt der Betreiber allein die Blöcke. Kein Text der App sagt
 * darum absolut „fälschungssicheres Geld“ oder „die Physik macht es
 * unkopierbar“ -- in keiner der 12 Sprachen. Gleich wie die Website
 * (Aequitas seiten_test.go, TestLanding_QuantengeldEhrlichMitWegC).
 */
import * as fs from 'fs';
import * as path from 'path';

const ORDNER = path.join(__dirname, '..', 'i18n', 'locales');
const VERBOTEN = [
  'fairest counterfeit-proof money', 'fairste fälschungssichere Geld', 'dinero infalsificable más justo',
  'защищённые от подделки, –', '最公平的防伪货币', 'Uang anti-palsu paling adil', 'denaro non falsificabile più equo',
  'sahteciliğe karşı korunan para', 'monnaie infalsifiable la plus juste', 'dinheiro infalsificável mais justo',
  'نقود غير قابلة للتزوير', 'जालसाज़ी-रोधी पैसा',
  'physics makes it impossible to copy', 'die Physik macht ihn unkopierbar',
];

test('keine absolute Aussage in den Übersetzungen', () => {
  const dateien = fs.readdirSync(ORDNER).filter((d) => d.endsWith('.ts'));
  expect(dateien.length).toBeGreaterThanOrEqual(12);
  for (const d of dateien) {
    const text = fs.readFileSync(path.join(ORDNER, d), 'utf8');
    for (const v of VERBOTEN) expect({ datei: d, steht: text.includes(v) ? v : null }).toEqual({ datei: d, steht: null });
  }
});
