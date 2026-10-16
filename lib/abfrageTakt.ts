/**
 * Takt fuer wiederkehrende Abfragen an den Knoten (Beta-Pruefung, NIEDRIG).
 *
 * Vorher lief jede Abfrage mit setInterval, unabhaengig davon, ob der Tab
 * sichtbar war, die App im Hintergrund lag oder der Knoten seit Minuten nicht
 * antwortete:
 *   - im Hintergrund weiter Netz und Akku, ohne dass jemand hinsieht;
 *   - ein langsamer Knoten bekam alle 10 s eine NEUE Anfrage, auch wenn die
 *     letzte noch lief -- bei vielen Geraeten genau dann mehr Last, wenn er
 *     ohnehin nicht nachkommt;
 *   - kein Hinweis fuer den Nutzer: die Zahlen blieben einfach stehen.
 *
 * Jetzt:
 *   - hoechstens EINE Abfrage gleichzeitig: die naechste wird erst geplant,
 *     wenn die vorige fertig ist (setTimeout-Kette statt setInterval);
 *   - nach einem Fehlschlag verdoppelt sich die Pause bis hoechstens
 *     MAX_PAUSE_MS; der erste Erfolg setzt sie zurueck;
 *   - nach FEHLER_BIS_OFFLINE Fehlschlaegen in Folge meldet der Takt
 *     "offline", nach dem ersten Erfolg wieder "online";
 *   - anhalten/fortsetzen fuer Hintergrund und unsichtbaren Tab
 *     (hooks/use-abfrage.ts). Fortsetzen fragt sofort ab.
 *
 * Fehlschlag heisst: lade() wirft oder gibt ausdruecklich false zurueck.
 */

export const MAX_PAUSE_MS = 2 * 60 * 1000;
export const FEHLER_BIS_OFFLINE = 2;

export type Lade = () => Promise<unknown>;

export interface Takt {
  /** Haelt an; eine laufende Abfrage darf zu Ende laufen, plant aber nichts. */
  anhalten(): void;
  /** Setzt fort und fragt sofort ab (wenn nicht schon eine laeuft). */
  fortsetzen(): void;
  /** Endgueltig beenden; danach meldet der Takt nichts mehr. */
  beenden(): void;
}

export function pauseNach(intervallMs: number, fehlerInFolge: number): number {
  if (fehlerInFolge <= 0) return intervallMs;
  // 2^n ohne Ueberlauf: ab 2^20 liegt jedes sinnvolle Intervall ueber der Grenze.
  const faktor = 2 ** Math.min(fehlerInFolge, 20);
  return Math.min(MAX_PAUSE_MS, Math.max(intervallMs, intervallMs * faktor));
}

export function starteTakt(
  lade: Lade,
  intervallMs: number,
  meldeOffline?: (offline: boolean) => void,
): Takt {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let laeuft = false;
  let aktiv = true;
  let beendet = false;
  let fehler = 0;
  let offline = false;

  const melden = (jetztOffline: boolean) => {
    if (jetztOffline === offline || beendet) return;
    offline = jetztOffline;
    meldeOffline?.(offline);
  };

  const planen = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!aktiv || beendet) return;
    timer = setTimeout(runde, pauseNach(intervallMs, fehler));
  };

  async function runde() {
    timer = null;
    if (laeuft || !aktiv || beendet) return;
    laeuft = true;
    let ok: boolean;
    try {
      ok = (await lade()) !== false;
    } catch {
      ok = false;
    }
    laeuft = false;
    if (beendet) return;
    if (ok) {
      fehler = 0;
      melden(false);
    } else {
      fehler = Math.min(fehler + 1, 1000);
      if (fehler >= FEHLER_BIS_OFFLINE) melden(true);
    }
    planen();
  }

  runde();

  return {
    anhalten() {
      aktiv = false;
      if (timer) clearTimeout(timer);
      timer = null;
    },
    fortsetzen() {
      if (beendet || aktiv) return;
      aktiv = true;
      if (!laeuft) runde();
    },
    beenden() {
      beendet = true;
      aktiv = false;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
