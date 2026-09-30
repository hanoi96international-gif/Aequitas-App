// Betraege exakt, ohne Gleitkomma (Neubau 2026-09-30).
//
// Die Kette fuehrt Kontostaende in Mikro-AEQ (int64, 1 AEQ = 10^6,
// x/humanity/keeper/decimal.go). Die EVM-Seite (RPC, signierte
// Ueberweisungen) rechnet in Wei (10^18). Die App haelt Betraege als bigint
// in Mikro und wandelt nur an der Grenze zur EVM. parseFloat/Number kommen
// fuer Geld nicht mehr vor: 0.1 + 0.2 ist in float nicht 0.3, und ein Mensch,
// der "alles senden" drueckt, darf nicht an einem Rundungsrest scheitern.

export type Micro = bigint;

export const MICRO_PER_AEQ = 1_000_000n;
const WEI_PER_MICRO = 1_000_000_000_000n; // 10^12

/** Obergrenze fuer Eingaben: mehr als die gesamte denkbare Geldmenge ist ein Tippfehler. */
export const MAX_INPUT_MICRO = 10n ** 15n * MICRO_PER_AEQ; // 10^15 AEQ

/**
 * Nutzereingabe -> Mikro. Akzeptiert Punkt oder Komma als Dezimaltrennzeichen,
 * hoechstens 6 Nachkommastellen, keine Tausendertrenner, kein Vorzeichen.
 * Gibt null zurueck statt zu raten.
 */
export function parseAmount(input: string): Micro | null {
  const s = input.trim().replace(',', '.');
  const m = /^(\d{1,16})(?:\.(\d{0,6}))?$/.exec(s);
  if (!m) return null;
  const whole = BigInt(m[1]);
  const frac = BigInt((m[2] ?? '').padEnd(6, '0') || '0');
  const v = whole * MICRO_PER_AEQ + frac;
  return v > MAX_INPUT_MICRO ? null : v;
}

/** Kettenwert (AEQ als Zahl oder String, z. B. aus JSON) -> Mikro, auf das naechste Mikro gerundet wie NewDecimal. */
export function fromChain(v: number | string | null | undefined): Micro | null {
  if (v == null) return null;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null;
    return BigInt(Math.round(v * 1e6));
  }
  const s = v.trim();
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const frac = (m[3] ?? '').padEnd(7, '0');
  let micro = BigInt(m[2]) * MICRO_PER_AEQ + BigInt(frac.slice(0, 6));
  if (Number(frac[6]) >= 5) micro += 1n;
  return m[1] === '-' ? -micro : micro;
}

export function toWei(m: Micro): bigint {
  return m * WEI_PER_MICRO;
}

/** Wei -> Mikro, abgerundet (nie mehr anzeigen, als da ist). */
export function fromWei(wei: bigint): Micro {
  return wei / WEI_PER_MICRO;
}

/** Fester Dezimalstring ohne Tausendertrenner, fuer Signaturtexte und APIs. */
export function toPlainString(m: Micro, decimals = 6): string {
  const neg = m < 0n;
  const abs = neg ? -m : m;
  const whole = abs / MICRO_PER_AEQ;
  const frac = (abs % MICRO_PER_AEQ).toString().padStart(6, '0').slice(0, decimals);
  const body = decimals > 0 ? `${whole}.${frac}` : `${whole}`;
  return neg ? `-${body}` : body;
}

export interface FormatOptions {
  locale: string;
  /** Mindest-/Hoechstzahl Nachkommastellen. Standard 2..6: kleine Betraege bleiben sichtbar. */
  minDecimals?: number;
  maxDecimals?: number;
  signed?: boolean;
}

/**
 * Anzeige nach Sprache (Tausendertrenner, Dezimalzeichen). Rechnet in bigint
 * und nutzt Intl nur fuer die Trennzeichen -- auch 10^15 AEQ bleiben exakt.
 */
export function formatAmount(m: Micro, { locale, minDecimals = 2, maxDecimals = 6, signed = false }: FormatOptions): string {
  const neg = m < 0n;
  const abs = neg ? -m : m;
  const whole = abs / MICRO_PER_AEQ;
  let frac = (abs % MICRO_PER_AEQ).toString().padStart(6, '0').slice(0, maxDecimals);
  while (frac.length > minDecimals && frac.endsWith('0')) frac = frac.slice(0, -1);

  const parts = new Intl.NumberFormat(locale).formatToParts(1234567.5);
  const group = parts.find((p) => p.type === 'group')?.value ?? ',';
  const decimal = parts.find((p) => p.type === 'decimal')?.value ?? '.';
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, group);
  const body = frac.length > 0 ? `${wholeStr}${decimal}${frac}` : wholeStr;
  const sign = neg ? '−' : signed && m > 0n ? '+' : '';
  return sign + body;
}

export function minMicro(a: Micro, b: Micro): Micro {
  return a < b ? a : b;
}

export function maxMicro(a: Micro, b: Micro): Micro {
  return a > b ? a : b;
}
