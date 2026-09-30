/** Kurzform fuer Ueberschriften ("0x1234…abcd"). Nie zum Bestaetigen einer Zahlung -- dort immer die volle Adresse. */
export function shortAddress(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}
