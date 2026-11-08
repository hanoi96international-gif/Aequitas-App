// Erzeugt die mitgelieferten Sprachaufnahmen (assets/stimme/<sprache>/*.mp3)
// und lib/sprachaufnahmen.ts -- EINMALIG, nicht zur Laufzeit. Die App fragt
// den Sprachdienst nie; sie spielt nur diese Dateien ab (lib/sprachausgabe.ts).
//
// Quelle der Saetze: scripts/stimmen-texte.mjs (genau die Texte, die t()
// liefert). Aendert sich eine Uebersetzung, passt ihre Aufnahme nicht mehr
// (der Schluessel ist der fertige Text) und es spricht wieder das Geraet --
// bis dieses Skript erneut laeuft.
//
// Dienst: Microsoft Azure Speech, Tarif F0 (gratis, kann keine Kosten
// verursachen). Schluessel: AZURE_SPEECH_KEY, oder -- in der Cloud-Umgebung --
// vom Netzwerk-Proxy eingesetzt. Region: AZURE_SPEECH_REGION (Vorgabe
// germanywestcentral). Gesendet werden nur die festen Ansagesaetze.
//
// Aufruf: node scripts/stimmen-erzeugen.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

// Je Sprache eine muttersprachliche, freundliche Frauenstimme (Entscheidung
// des Betreibers vom 08.11.2026: Deutsch Seraphina; die anderen Sprachen
// muttersprachlich, damit kein Akzent entsteht).
const STIMMEN = {
  de: ['de-DE', 'de-DE-SeraphinaMultilingualNeural'],
  en: ['en-US', 'en-US-AvaMultilingualNeural'],
  es: ['es-ES', 'es-ES-ElviraNeural'],
  fr: ['fr-FR', 'fr-FR-DeniseNeural'],
  it: ['it-IT', 'it-IT-ElsaNeural'],
  pt: ['pt-PT', 'pt-PT-RaquelNeural'],
  tr: ['tr-TR', 'tr-TR-EmelNeural'],
  id: ['id-ID', 'id-ID-GadisNeural'],
  ru: ['ru-RU', 'ru-RU-SvetlanaNeural'],
  zh: ['zh-CN', 'zh-CN-XiaoxiaoNeural'],
  hi: ['hi-IN', 'hi-IN-SwaraNeural'],
  ar: ['ar-SA', 'ar-SA-ZariyahNeural'],
};
const FORMAT = 'audio-24khz-48kbitrate-mono-mp3';
const REGION = process.env.AZURE_SPEECH_REGION || 'germanywestcentral';
const ZIEL = 'assets/stimme';

function xml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// Was gesprochen wird: wie auf dem Bildschirm, nur der Trennpunkt " · " als
// kurze Pause (sonst liest die Stimme ihn vor oder verschluckt ihn).
// Zahlen ausdruecklich als Grundzahl: "nicht erst bei 0." las die Stimme
// sonst als Ordnungszahl ("nullten" -- im Deutschen macht der Punkt nach
// einer Zahl sie zur Ordnungszahl).
function gesprochen(text) {
  return xml(text)
    .replace(/(^|[^0-9A-Za-z])([0-9]+)(?![0-9])/g, "$1<say-as interpret-as='cardinal'>$2</say-as>")
    .split(' · ').join(". <break time='250ms'/>");
}

// Aendert sich, WIE gesprochen wird (oben), bekommen alle Saetze neue Dateien.
const SPRECHWEISE = 2;

function erzeugen(sprache, text, datei) {
  const [locale, stimme] = STIMMEN[sprache];
  const ssml = `<speak version='1.0' xml:lang='${locale}'><voice name='${stimme}'><lang xml:lang='${locale}'>${gesprochen(text)}</lang></voice></speak>`;
  const kopf = ['-H', 'Content-Type: application/ssml+xml', '-H', `X-Microsoft-OutputFormat: ${FORMAT}`, '-H', 'User-Agent: aequitas-stimmen'];
  if (process.env.AZURE_SPEECH_KEY) kopf.push('-H', `Ocp-Apim-Subscription-Key: ${process.env.AZURE_SPEECH_KEY}`);
  const code = execFileSync('curl', ['-sS', '-m', '60', '-o', datei, '-w', '%{http_code}', '-X', 'POST',
    `https://${REGION}.tts.speech.microsoft.com/cognitiveservices/v1`, ...kopf, '--data-binary', '@-'], { input: ssml }).toString();
  if (code !== '200' || fs.statSync(datei).size < 1000) {
    fs.rmSync(datei, { force: true });
    throw new Error(`${sprache}: HTTP ${code} fuer "${text.slice(0, 40)}"`);
  }
}

const texte = JSON.parse(execFileSync('node', ['scripts/stimmen-texte.mjs']).toString());
const zeilen = [];
let neu = 0;
for (const sprache of Object.keys(STIMMEN)) {
  fs.mkdirSync(path.join(ZIEL, sprache), { recursive: true });
  const behalten = new Set();
  for (const text of texte[sprache] ?? []) {
    // Dateiname aus Stimme und Text: eine andere Stimme oder ein anderer
    // Text ergibt eine neue Datei, eine unveraenderte wird nicht neu erzeugt.
    const name = crypto.createHash('sha256').update(`${SPRECHWEISE}\n${STIMMEN[sprache][1]}\n${text}`).digest('hex').slice(0, 16) + '.mp3';
    const datei = path.join(ZIEL, sprache, name);
    if (!fs.existsSync(datei)) {
      erzeugen(sprache, text, datei);
      neu++;
    }
    behalten.add(name);
    zeilen.push(`  ${JSON.stringify(`${sprache}|${text}`)}: require('../${ZIEL}/${sprache}/${name}'),`);
  }
  for (const alt of fs.readdirSync(path.join(ZIEL, sprache))) {
    if (!behalten.has(alt)) fs.rmSync(path.join(ZIEL, sprache, alt));
  }
}
fs.writeFileSync('lib/sprachaufnahmen.ts', `// ERZEUGT von scripts/stimmen-erzeugen.mjs -- nicht von Hand bearbeiten.
// Schluessel: "<sprache>|<fertiger Text>" -> mitgelieferte Aufnahme.
// Fehlt ein Schluessel (Text geaendert), spricht das Geraet.
export const AUFNAHMEN: Record<string, number> = {
${zeilen.join('\n')}
};
`);
console.log(`${zeilen.length} Aufnahmen, davon ${neu} neu erzeugt`);
