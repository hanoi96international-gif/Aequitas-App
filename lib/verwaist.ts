// Verwaiste Einschreibung vor einer neuen Registrierung aufraeumen.
//
// DER FALL (30.09.2026, am Geraet): Gesichtspruefung erfolgreich, die
// Vergleichsdienste schreiben das Gesicht ein -- dann scheitert der Schritt
// auf der Kette (dort: MetaMask "active chainId is different"). Die
// Einschreibung bleibt, auf der Kette steht niemand. Beim naechsten Versuch
// erkennen die Vergleichsdienste das Gesicht wieder und weisen es als
// Duplikat ab; eine Bescheinigung gibt es fuer ein Duplikat bewusst nicht.
// Der Mensch ist ausgesperrt.
//
// Die App hat die bio_hash der eigenen Einschreibung gespeichert
// (rememberBioHash). Kennt die Kette sie NICHT als registriert, ist die
// Einschreibung verwaist, und die App loescht sie selbst -- derselbe Weg wie
// "Daten loeschen (Widerruf)" im Identitaets-Tab. Danach laeuft die
// Registrierung wie beim ersten Mal.
//
// Fail-closed: laesst sich nicht sicher feststellen, dass die Kette die
// Kennung nicht kennt, wird nichts geloescht.

export type AufraeumErgebnis = 'keine' | 'registriert' | 'geloescht' | 'unklar';

export interface AufraeumWerkzeuge {
  gespeicherteKennung: () => Promise<string | null>;
  /** Kennt die Kette diese bio (identityFromBioHash(...).bio) als registriert? */
  pruefe: (bio: string) => Promise<{ registered: boolean }>;
  bioAus: (bioHash: string) => string;
  loesche: (bioHash: string) => Promise<{ status: string }>;
}

export async function raeumeVerwaisteEinschreibungAuf(w: AufraeumWerkzeuge): Promise<AufraeumErgebnis> {
  let kennung: string | null = null;
  try {
    kennung = await w.gespeicherteKennung();
  } catch {
    return 'unklar';
  }
  if (!kennung) return 'keine';

  let registriert: boolean;
  try {
    const antwort = await w.pruefe(w.bioAus(kennung));
    if (typeof antwort?.registered !== 'boolean') return 'unklar';
    registriert = antwort.registered;
  } catch {
    return 'unklar';
  }
  if (registriert) return 'registriert';

  try {
    const r = await w.loesche(kennung);
    return r?.status === 'deleted' || r?.status === 'not_found' ? 'geloescht' : 'unklar';
  } catch {
    return 'unklar';
  }
}
