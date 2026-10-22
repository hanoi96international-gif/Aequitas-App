// Jede Aufnahmedatei eines Ablaufs -- Momentaufnahmen fuer die
// Positionspruefung, Standbilder, Videos, Einzelbilder -- wird hier gemerkt
// und auf JEDEM Ausgang geloescht (Pruefung 21.10.2026, MEDIUM-1): beim
// Ergebnis, bei einem Abbruch, beim Schliessen des Bildschirms. Bis dahin
// blieben auf Fehlerwegen Gesichtsbilder im Cache liegen.
//
// Idempotent: eine schon geloeschte (oder schon hochgeladene und dort
// geloeschte) Datei ist kein Fehler, und jede Datei wird hoechstens einmal
// angefasst. Ein Fehler beim Loeschen haelt die uebrigen nicht auf.
//
// Rein: wie geloescht wird, gibt der Aufrufer vor (biometricIdentity
// aufnahmeDateiLoeschen) -- getestet in lib/__tests__/aufnahmeDateien.test.ts.

/** Hoechstens so viele offene Dateien: ein Ablauf erzeugt eine Handvoll, mehr
 *  ist ein Fehler -- dann wird die aelteste sofort geloescht statt gemerkt. */
export const AUFNAHME_DATEIEN_MAX = 64;

export class AufnahmeDateien {
  private offen: string[] = [];

  constructor(private readonly loeschen: (uri: string) => Promise<void>) {}

  /** Merkt eine Datei und gibt sie zurueck (zum Weiterreichen). */
  merke<T extends string | null | undefined>(uri: T): T {
    if (uri && !this.offen.includes(uri)) {
      this.offen.push(uri);
      if (this.offen.length > AUFNAHME_DATEIEN_MAX) {
        const alt = this.offen.shift();
        if (alt) this.loeschen(alt).catch(() => undefined);
      }
    }
    return uri;
  }

  /** Wie viele Dateien noch offen sind (fuer Tests). */
  anzahl(): number {
    return this.offen.length;
  }

  /** Loescht diese Dateien jetzt (z. B. eine Momentaufnahme gleich nach der
   *  Gesichtserkennung) und vergisst sie. */
  async sofort(...uris: (string | null | undefined)[]): Promise<void> {
    const weg = uris.filter((u): u is string => !!u);
    this.offen = this.offen.filter((u) => !weg.includes(u));
    await Promise.all(weg.map((u) => this.loeschen(u).catch(() => undefined)));
  }

  /** Loescht alle gemerkten Dateien und vergisst sie. */
  async alleVerwerfen(): Promise<void> {
    const weg = this.offen;
    this.offen = [];
    await Promise.all(weg.map((u) => this.loeschen(u).catch(() => undefined)));
  }
}
