// Quantengeld Weg B (B4b-4c-2f): die Inhaberin holt das Paket des Ausgebers
// aus ihrem eigenen Briefkasten und nimmt den Token an.
//
// Eigenes Modul (nicht in quantenSInhaberin.ts): briefkasten.ts und
// quantenSHuelle.ts haengen ueber quantenSPraeparator -> quantenSPraeparieren
// -> quantenSStelle an quantenSInhaberin; ein Import von dort waere ein Ring,
// in dem ZEIT_SPIEL beim Laden noch fehlt (ALTER_MAX = NaN).

import { ethers } from 'ethers';
import { abholen as briefeAbholen, quittieren } from './briefkasten';
import { QuantenSFehler, adresseVon, annehmen, bitsZuHex, unterschreiben, type PaketAbschnitt } from './quantenS';
import { Zusammensetzer, oeffnen, type Nachricht } from './quantenSHuelle';
import { PAKET_GESEHEN, PAKET_NACH, bestellungAus, schluesselLesen, stand, zustandLesen, zustandSchreiben, type Umgebung } from './quantenSInhaberin';

function fehler(text: string): never {
  throw new QuantenSFehler(text);
}

/** Höchstens so viele Seiten Briefe je Abruf (je 32 Briefe). */
export const PAKET_SEITEN_MAX = 8;

/** Das Paket des Ausgebers aus der Nutzlast, streng (genau k, validatoren, abschnitte). */
function paketLesen(m: Nachricht, K: string, v: number): PaketAbschnitt[] {
  let o: unknown;
  try {
    o = JSON.parse(ethers.toUtf8String(m.nutzlast));
  } catch {
    return fehler('Paket: kein JSON');
  }
  if (!o || typeof o !== 'object' || Array.isArray(o) || Object.keys(o).sort().join(',') !== 'abschnitte,k,validatoren') fehler('Paket: Felder');
  const p = o as { k: unknown; validatoren: unknown; abschnitte: unknown };
  if (p.k !== K) fehler('Paket: anderes K');
  if (!Array.isArray(p.abschnitte) || p.abschnitte.length !== v) fehler('Paket: Zahl der Abschnitte');
  const felder = 'basen_hash,bis,blaetter,buendel_hash,buendel_sig_hash,fuer_inhaberin,sig,teile,von,x,zaehlung';
  for (const ab of p.abschnitte) {
    if (!ab || typeof ab !== 'object' || Array.isArray(ab) || Object.keys(ab).sort().join(',') !== felder) fehler('Paket: Abschnitt, Felder');
  }
  return p.abschnitte as PaketAbschnitt[];
}

/**
 * Weg B: das Paket des Ausgebers aus dem eigenen Briefkasten holen (Adresse =
 * Schluessel der Inhaberin, nicht die Wallet) und annehmen. Geprueft wird ALLES
 * gegen die Kette und gegen die Gelosten, an die die Basen verschluesselt sind
 * (annehmen: Unterschrift jeder Gelosten, Hash ihres Chiffrats, Wurzel, Proben,
 * Zaehlungen, ehrliche Vorlage) -- wer das Paket schickt, zaehlt nicht. Erst
 * wenn der Token auf der Kette steht, wird der Kasten angefasst; ein falsches
 * Paket gilt als erledigt, ein echtes wird angenommen.
 */
export async function paketAbholen(u: Umgebung): Promise<{ stand: 'angenommen'; k: string; n: number } | { stand: 'warten'; grund: string; abgewiesen: string[] }> {
  if (!u.ablage) fehler('ohne Ablage kein Weg B');
  const z = await zustandLesen(u);
  if (!z || !z.wegB || !z.verschluesseltAn) fehler('keine Bestellung in Weg B');
  const K = z.wegB;
  if (z.k) {
    if (z.k !== K) fehler('es gibt schon einen anderen angenommenen Token');
    return { stand: 'angenommen', k: K, n: z.n };
  }
  const st = await stand(u, K);
  if (!st) return { stand: 'warten', grund: 'der Token steht noch nicht auf der Kette', abgewiesen: [] };
  const schl = await schluesselLesen(u);
  const ich = adresseVon(schl);
  const best = await bestellungAus(u, z, schl);
  const signer = { signMessage: async (m: string) => unterschreiben(schl, m) };
  const jetzt = () => Math.floor(u.jetzt() / 1000);
  let gesehen: [string, number][] = [];
  const roh = await u.ablage.lesen(PAKET_GESEHEN);
  if (roh !== null) {
    try {
      gesehen = JSON.parse(roh) as [string, number][];
    } catch {
      fehler('Liste erledigter Huellen beschaedigt');
    }
  }
  const zs = new Zusammensetzer(gesehen);
  zs.aufraeumen(jetzt());
  const nachRoh = await u.ablage.lesen(PAKET_NACH);
  if (nachRoh !== null && !/^\d{1,15}$/.test(nachRoh)) fehler('Zaehler beschaedigt');
  const nachStart = nachRoh === null ? 0 : Number(nachRoh);
  let nach = nachStart;
  const briefe: { id: number; schl: string | null }[] = [];
  const fertig: { m: Nachricht; schl: string }[] = [];
  const abgewiesen: string[] = [];
  for (let s = 0; s < PAKET_SEITEN_MAX; s++) {
    const r = await briefeAbholen(ich, nach, signer, jetzt(), u.fetchFn, u.apiBasis);
    for (const b of r.briefe) {
      nach = b.id;
      try {
        const t = oeffnen(schl, b.inhalt, jetzt());
        const key = `${t.von}|${t.id}`;
        const m = zs.hinzu(t, jetzt());
        briefe.push({ id: b.id, schl: key });
        if (m) fertig.push({ m, schl: key });
      } catch (e) {
        briefe.push({ id: b.id, schl: null });
        abgewiesen.push((e as Error).message.slice(0, 200));
      }
    }
    if (!r.mehr) break;
  }
  await u.ablage.schreiben(PAKET_GESEHEN, JSON.stringify(zs.gesehenListe()), false);
  let angenommen = false;
  for (const { m } of fertig) {
    if (angenommen || m.art !== 'paket') continue;
    try {
      const abschnitte = paketLesen(m, K, z.v);
      const erg = annehmen({ schluessel: schl, bestellung: best, validatoren: z.verschluesseltAn, K, stand: st, abschnitte });
      // Erst sichern, dann quittieren.
      await zustandSchreiben(u, { ...z, k: K, x: bitsZuHex(erg.x), validatoren: z.verschluesseltAn });
      angenommen = true;
    } catch (e) {
      abgewiesen.push((e as Error).message.slice(0, 200));
    }
  }
  // Quittieren bis zum letzten Brief, vor dem alles erledigt ist (kaputt oder fertig).
  const fertigeSchl = new Set(fertig.map((f) => f.schl));
  let bis = nachStart;
  for (const b of briefe) {
    if (b.schl !== null && !fertigeSchl.has(b.schl)) break;
    bis = b.id;
  }
  if (bis > nachStart) {
    await quittieren(ich, bis, signer, jetzt(), u.fetchFn, u.apiBasis);
    await u.ablage.schreiben(PAKET_NACH, String(bis), false);
  }
  if (angenommen) return { stand: 'angenommen', k: K, n: z.n };
  return { stand: 'warten', grund: fertig.length ? 'kein gueltiges Paket' : 'noch kein Paket', abgewiesen };
}
