import { Mnemonic, randomBytes, wordlists } from 'ethers';

// Wiederherstellungsphrase (BIP-39, englische Wortliste -- der Standard, den
// jede andere Wallet lesen kann). Nur reine Funktionen, kein Speicher.

const WORDS = wordlists.en;

/** Frische Phrase mit 128 Bit Entropie (12 Woerter) aus dem sicheren Zufall des Systems. */
export function newPhrase(): string {
  return Mnemonic.fromEntropy(randomBytes(16)).phrase;
}

/** Eingabe vereinheitlichen: Kleinbuchstaben, einfache Leerzeichen, keine Satzzeichen. */
export function normalizePhrase(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
}

export type PhraseProblem = 'wordCount' | 'unknownWord' | 'checksum';

/** Prueft Wortzahl, Wortliste und Pruefsumme. null = gueltig. */
export function checkPhrase(input: string): { problem: PhraseProblem; word?: string } | null {
  const phrase = normalizePhrase(input);
  const words = phrase ? phrase.split(' ') : [];
  if (![12, 15, 18, 21, 24].includes(words.length)) return { problem: 'wordCount' };
  const unknown = words.find((w) => WORDS.getWordIndex(w) < 0);
  if (unknown) return { problem: 'unknownWord', word: unknown };
  if (!Mnemonic.isValidMnemonic(phrase)) return { problem: 'checksum' };
  return null;
}

/** Eingabe beim Neueinrichten: 64 Hex-Zeichen sind ein privater Schluessel, alles andere eine Phrase. */
export function secretFromInput(input: string): { phrase: string } | { privateKey: string } {
  const k = input.trim();
  return /^(0x)?[0-9a-fA-F]{64}$/.test(k) ? { privateKey: k } : { phrase: input };
}

/** Das Wort, an dem gerade getippt wird (fuer Vorschlaege), oder '' nach einem Leerzeichen. */
export function currentWord(input: string): string {
  if (/\s$/.test(input)) return '';
  const parts = input.trim().split(/\s+/);
  return (parts[parts.length - 1] ?? '').toLowerCase();
}

/** Ersetzt das angefangene Wort durch den Vorschlag und haengt ein Leerzeichen an. */
export function completeWord(input: string, word: string): string {
  const head = input.replace(/\S*$/, '');
  return `${head}${word} `;
}

/** Wortvorschlaege fuer die Eingabe beim Wiederherstellen (hoechstens 4). */
export function suggestWords(prefix: string, max = 4): string[] {
  const p = prefix.trim().toLowerCase();
  if (p.length < 2) return [];
  const out: string[] = [];
  for (let i = 0; i < 2048 && out.length < max; i++) {
    const w = WORDS.getWord(i);
    if (w.startsWith(p)) out.push(w);
  }
  return out;
}

/**
 * Drei verschiedene Positionen (0-basiert) fuer die Sicherungspruefung.
 * rnd ist austauschbar fuer Tests; Standard ist der sichere Zufall.
 */
export function pickCheckPositions(wordCount: number, count = 3, rnd: () => number = secureRandom): number[] {
  const pos = new Set<number>();
  while (pos.size < Math.min(count, wordCount)) pos.add(Math.floor(rnd() * wordCount));
  return [...pos].sort((a, b) => a - b);
}

/** Gleichverteilt in [0, 1) aus dem sicheren Zufall. */
function secureRandom(): number {
  const b = randomBytes(4);
  const u32 = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
  return u32 / 2 ** 32;
}
