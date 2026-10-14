// Zeitgrenze fuer jede Netzanfrage (Beta-Pruefung 14.10.2026).
//
// Ohne Grenze wartet ein fetch, bis das Betriebssystem aufgibt -- auf
// Mobilfunk oft minutenlang, und der Mensch sieht einen Kreisel ohne Ende.
// Gleiches Muster wie lib/unternehmen.ts und /health in biometricIdentity:
// globales fetch mit AbortController. Ein Signal des Aufrufers bleibt
// wirksam.

/** Lesende und kleine Anfragen an Knoten und Dienste. */
export const FRIST_MS = 20_000;
/** Anfragen, die der Coordinator an alle Vergleichsdienste weiterreicht
 * (/vouch, DELETE /enrollment): je Dienst 20 s, plus Weg und Antwort. */
export const FRIST_ALLE_DIENSTE_MS = 40_000;
/** Aufnahmen hochladen und vergleichen lassen (Bilder, Video, Quorum).
 * Laenger als der Coordinator selbst rechnet: propose_timeout_seconds() in
 * coordinator/app/quorum.py steht auf 180 s (der Vergleichsdienst bremst
 * wiederholte Duplikatversuche absichtlich um bis zu 120 s), dazu bis 20 s
 * Mengengrenze und 20 s /commit. Sonst meldete die App "unerreichbar",
 * waehrend der Coordinator noch eintraegt. */
export const FRIST_AUFNAHME_MS = 240_000;

export async function fetchMitFrist(
  url: string,
  init: RequestInit = {},
  ms: number = FRIST_MS,
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  const aussen = init.signal;
  if (aussen) {
    if (aussen.aborted) ctrl.abort();
    else aussen.addEventListener('abort', () => ctrl.abort(), { once: true });
  }
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}
