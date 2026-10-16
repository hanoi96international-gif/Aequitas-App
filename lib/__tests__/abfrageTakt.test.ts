/**
 * Takt der Abfragen an den Knoten (lib/abfrageTakt.ts): hoechstens eine
 * Anfrage gleichzeitig, wachsende Pausen bei Fehlschlaegen, Stillstand im
 * Hintergrund.
 */
import { FEHLER_BIS_OFFLINE, MAX_PAUSE_MS, pauseNach, starteTakt } from '../abfrageTakt';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

// Laesst Timer UND die danach faelligen Promise-Ketten laufen.
async function vergehen(ms: number) {
  await jest.advanceTimersByTimeAsync(ms);
}

describe('abfrageTakt', () => {
  it('fragt sofort und dann im Intervall ab', async () => {
    const lade = jest.fn(async () => true);
    const takt = starteTakt(lade, 10_000);
    await vergehen(0);
    expect(lade).toHaveBeenCalledTimes(1);
    await vergehen(30_000);
    expect(lade).toHaveBeenCalledTimes(4);
    takt.beenden();
  });

  // MISSBRAUCH/LAST: ein langsamer Knoten bekommt keine zweite Anfrage,
  // solange die erste laeuft (setInterval haette alle 10 s eine neue gestartet).
  it('startet keine zweite Anfrage, solange eine laeuft', async () => {
    let gleichzeitig = 0;
    let hoechstens = 0;
    const lade = jest.fn(async () => {
      gleichzeitig++;
      hoechstens = Math.max(hoechstens, gleichzeitig);
      await new Promise((r) => setTimeout(r, 45_000));
      gleichzeitig--;
      return true;
    });
    const takt = starteTakt(lade, 10_000);
    await vergehen(200_000);
    expect(hoechstens).toBe(1);
    // 45 s Laufzeit + 10 s Pause je Runde
    expect(lade.mock.calls.length).toBeLessThanOrEqual(4);
    takt.beenden();
  });

  it('verlaengert die Pause nach Fehlschlaegen bis zur Grenze', async () => {
    expect(pauseNach(10_000, 0)).toBe(10_000);
    expect(pauseNach(10_000, 1)).toBe(20_000);
    expect(pauseNach(10_000, 3)).toBe(80_000);
    expect(pauseNach(10_000, 50)).toBe(MAX_PAUSE_MS);
    expect(pauseNach(10_000, 1_000_000)).toBe(MAX_PAUSE_MS);

    const lade = jest.fn(async () => {
      throw new Error('Knoten weg');
    });
    const takt = starteTakt(lade, 10_000);
    // Eine Stunde ohne Knoten: mit setInterval 360 Anfragen, jetzt die
    // Verdopplung bis 2 min -- hoechstens etwa 30.
    await vergehen(60 * 60 * 1000);
    expect(lade.mock.calls.length).toBeLessThan(40);
    takt.beenden();
  });

  it('false zaehlt als Fehlschlag, Erfolg setzt die Pause zurueck', async () => {
    let ok = false;
    const lade = jest.fn(async () => ok);
    const takt = starteTakt(lade, 1_000);
    await vergehen(0); // 1. Fehlschlag -> 2 s
    await vergehen(2_000); // 2. -> 4 s
    await vergehen(4_000); // 3. -> 8 s
    expect(lade).toHaveBeenCalledTimes(3);
    ok = true;
    await vergehen(8_000); // Erfolg -> 1 s
    await vergehen(1_000);
    expect(lade).toHaveBeenCalledTimes(5);
    takt.beenden();
  });

  it('meldet offline erst nach mehreren Fehlschlaegen und online nach einem Erfolg', async () => {
    let ok = false;
    const meldungen: boolean[] = [];
    const takt = starteTakt(async () => ok, 1_000, (o) => meldungen.push(o));
    await vergehen(0);
    expect(meldungen).toEqual(FEHLER_BIS_OFFLINE > 1 ? [] : [true]);
    await vergehen(60_000);
    expect(meldungen).toEqual([true]);
    ok = true;
    await vergehen(MAX_PAUSE_MS);
    expect(meldungen).toEqual([true, false]);
    takt.beenden();
  });

  // Hintergrund: keine einzige Anfrage, solange angehalten.
  it('fragt angehalten nicht ab und beim Fortsetzen sofort', async () => {
    const lade = jest.fn(async () => true);
    const takt = starteTakt(lade, 10_000);
    await vergehen(0);
    takt.anhalten();
    await vergehen(10 * 60 * 1000);
    expect(lade).toHaveBeenCalledTimes(1);
    takt.fortsetzen();
    await vergehen(0);
    expect(lade).toHaveBeenCalledTimes(2);
    // doppeltes Fortsetzen startet keine zweite Kette
    takt.fortsetzen();
    await vergehen(10_000);
    expect(lade).toHaveBeenCalledTimes(3);
    takt.beenden();
  });

  it('Anhalten waehrend einer laufenden Anfrage plant nichts nach', async () => {
    const lade = jest.fn(() => new Promise<boolean>((r) => setTimeout(() => r(true), 5_000)));
    const takt = starteTakt(lade, 1_000);
    takt.anhalten();
    await vergehen(60_000);
    expect(lade).toHaveBeenCalledTimes(1);
    takt.beenden();
  });

  it('nach beenden keine Anfragen und keine Meldungen mehr', async () => {
    const melde = jest.fn();
    const lade = jest.fn(() => new Promise<boolean>((r) => setTimeout(() => r(false), 5_000)));
    const takt = starteTakt(lade, 1_000, melde);
    takt.beenden();
    takt.fortsetzen();
    await vergehen(10 * 60 * 1000);
    expect(lade).toHaveBeenCalledTimes(1);
    expect(melde).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });
});
