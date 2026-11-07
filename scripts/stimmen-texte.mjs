// Alle Saetze, die die Aufnahme laut spricht -- in jeder Sprache, genau so,
// wie t() sie auf dem Bildschirm zeigt (app/biometric-capture.tsx: speak,
// sayStage, schrittText). Ausgabe: JSON {sprache: [text, ...]} auf stdout.
// Grundlage fuer scripts/stimmen-erzeugen.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');

const SPRACHEN = ['de', 'en', 'es', 'fr', 'it', 'pt', 'tr', 'id', 'ru', 'zh', 'hi', 'ar'];
const RICHTUNGSFENSTER_S = 3; // DIRECTION_WINDOW_MS / 1000 in biometric-capture.tsx
const OVALE = [1, 2, 3];

function laden(sprache) {
  const quelle = fs.readFileSync(path.join('lib/i18n/locales', `${sprache}.ts`), 'utf8');
  const js = ts.transpileModule(quelle, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', js)(mod, mod.exports, () => ({}));
  return mod.exports.default ?? mod.exports;
}

const en = laden('en');
const aus = {};
for (const s of SPRACHEN) {
  const tab = laden(s);
  const t = (schluessel, werte = {}) => {
    const [abschnitt, name] = schluessel.split('.');
    let text = tab?.[abschnitt]?.[name] ?? en[abschnitt][name];
    for (const [k, v] of Object.entries(werte)) text = text.split(`{${k}}`).join(v);
    return text;
  };
  const mitSekunden = (r) => `${r} · ${t('identity.biometricBurstHoldSeconds', { seconds: String(RICHTUNGSFENSTER_S) })}`;
  const saetze = new Set([
    t('identity.biometricFaceHint'),
    t('identity.biometricBurstHoldOval'),
    t('identity.biometricBurstBlinkNow'),
  ]);
  for (const k of ['LookLeft', 'LookRight', 'LookUp', 'LookDown', 'Smile']) saetze.add(mitSekunden(t(`identity.biometricChallenge${k}`)));
  for (const nr of OVALE) for (const seite of ['zwSeiteLinks', 'zwSeiteRechts']) {
    saetze.add(t('identity.zwSchrittKurz', { nr: String(nr), seite: t(`identity.${seite}`) }));
  }
  aus[s] = [...saetze].map((x) => x.trim());
}
process.stdout.write(JSON.stringify(aus, null, 1));
