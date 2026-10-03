// Altersangabe vor der Gesichtsaufnahme -- dieselbe Regel wie der Coordinator
// (aequitas-biometric-beta/coordinator/app/altersregel.py).
//
// Wer selbst angibt, zu jung zu sein, kommt nicht zur Kamera: sein Gesicht wird
// nie aufgenommen. Der Coordinator prueft dieselbe Angabe noch einmal, bevor er
// eine Aufnahme an einen Vergleichsdienst gibt -- diese Pruefung hier ist nur
// die freundliche, fruehe Fassung davon, nicht die verbindliche.
//
// Gespeichert wird nichts davon, weder hier noch auf dem Server.

export const GRUNDALTER = 18;

// Nur Abweichungen von 18; wo Quellen sich widersprechen, der hoehere Wert.
// Muss zu LAENDER in altersregel.py passen (Test prueft die Werte).
export const LAENDER: Record<string, number> = {
  KR: 19, TH: 20, NZ: 20, ID: 21, EG: 21, KW: 21, BH: 21, CM: 21, AE: 21, SG: 21, MZ: 21,
};

export const REGIONEN: Record<string, Record<string, number>> = {
  US: { AL: 19, NE: 19, MS: 21 },
  CA: { BC: 19, NB: 19, NL: 19, NS: 19, NT: 19, NU: 19, YT: 19 },
};

export interface Altersangabe {
  geburtsjahr: number;
  geburtsmonat: number;
  land: string;
  region?: string;
}

export type Pruefung =
  | { ok: true; mindestalter: number }
  | { ok: false; grund: 'fehlt' | 'ungueltig' | 'zu_jung'; mindestalter?: number };

export function mindestalter(land: string, region?: string): number {
  const l = land.toUpperCase();
  const teile = REGIONEN[l];
  if (teile) {
    const r = region?.toUpperCase();
    if (r && teile[r] !== undefined) return teile[r];
    if (r) return GRUNDALTER;
    return Math.max(...Object.values(teile));
  }
  return LAENDER[l] ?? GRUNDALTER;
}

/** Volle Jahre. Im Geburtsmonat gilt der Geburtstag als noch nicht erreicht. */
export function volleJahre(jahr: number, monat: number, jetzt: Date = new Date()): number {
  let alter = jetzt.getUTCFullYear() - jahr;
  if (jetzt.getUTCMonth() + 1 <= monat) alter -= 1;
  return alter;
}

/** Liest die Eingabefelder. Leere Felder -> fehlt, alles Unsinnige -> ungueltig. */
export function pruefen(
  eingabe: { jahr: string; monat: string; land: string; region?: string },
  jetzt: Date = new Date(),
): Pruefung {
  const jahrText = eingabe.jahr.trim();
  const monatText = eingabe.monat.trim();
  const land = eingabe.land.trim().toUpperCase();
  const region = eingabe.region?.trim().toUpperCase() || undefined;
  if (!jahrText || !monatText || !land) return { ok: false, grund: 'fehlt' };
  if (!/^\d{4}$/.test(jahrText) || !/^\d{1,2}$/.test(monatText)) return { ok: false, grund: 'ungueltig' };
  const jahr = Number(jahrText);
  const monat = Number(monatText);
  if (
    !/^[A-Z]{2}$/.test(land) ||
    (region !== undefined && !/^[A-Z0-9]{1,3}$/.test(region)) ||
    monat < 1 || monat > 12 ||
    jahr < 1900 || jahr > jetzt.getUTCFullYear()
  ) {
    return { ok: false, grund: 'ungueltig' };
  }
  const grenze = mindestalter(land, region);
  if (volleJahre(jahr, monat, jetzt) < grenze) return { ok: false, grund: 'zu_jung', mindestalter: grenze };
  return { ok: true, mindestalter: grenze };
}

/** Land aus der Spracheinstellung des Geraets ("de-DE" -> "DE"), sonst leer. */
export function landAusGeraet(): string {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale ?? '';
    const m = /[-_]([A-Za-z]{2})(?:$|[-_])/.exec(locale);
    return m ? m[1].toUpperCase() : '';
  } catch {
    return '';
  }
}

/** Die Felder, die /register und /nachziehen erwarten. */
export function formularFelder(a: Altersangabe): [string, string][] {
  const felder: [string, string][] = [
    ['geburtsjahr', String(a.geburtsjahr)],
    ['geburtsmonat', String(a.geburtsmonat)],
    ['land', a.land.toUpperCase()],
  ];
  if (a.region) felder.push(['region', a.region.toUpperCase()]);
  return felder;
}
