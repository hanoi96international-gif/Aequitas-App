// Tagesrunde mit Zahlen: GET /api/wirtschaft/runde?hoehe= (aequitas:
// x/humanity/keeper/wirtschaft_runde.go). Damit laesst sich eine Runde
// nachrechnen:
//   Rest der Vorrunde + Abgaben + andere Zufluesse = Topf vor der Auszahlung
//     = Grundeinkommen + Rest nach der Runde;  Grundeinkommen = Menschen x Anteil
//
// Nur Anzeige, abgeleitet aus den Bloecken (kein Konsens). Die Antwort wird
// streng gelesen: was nicht passt, wird nicht angezeigt (null), statt halb.
import { API_BASE } from './config';

const ANTWORT_MAX = 16 * 1024;
const BETRAG_MAX = 1e12;

export interface RundeStand {
  zeit: number;
  von: number;
  bis: number;
  vollstaendig: boolean;
  abgabenKonten: number;
  abgabenSumme: number;
  menschen: number;
  grundeinkommenSumme: number;
  jeMenschKleinster: number;
  jeMenschGroesster: number;
  /** Menschen x Anteil = ausgezahlt (nur wenn alle denselben Anteil bekamen). */
  probeGleich: boolean | null;
  restNach: number | null;
  topfVorAuszahlung: number | null;
  restVorrunde: number | null;
  andereZufluesse: number | null;
}

const ganz = (v: unknown, max = Number.MAX_SAFE_INTEGER): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max ? v : null;
const betrag = (v: unknown, negativErlaubt = false): number | null =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= BETRAG_MAX && (negativErlaubt || v >= 0) ? v : null;
const obj = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** Streng: alles Pflichtige muss passen, sonst null. */
export function leseRunde(d: unknown): RundeStand | null {
  const o = obj(d);
  const b = obj(o?.bloecke);
  const ab = obj(o?.abgaben);
  const ge = obj(o?.grundeinkommen);
  if (!o || !b || !ab || !ge || typeof o.vollstaendig !== 'boolean') return null;
  const zeit = ganz(o.zeit);
  const von = ganz(b.von);
  const bis = ganz(b.bis);
  const abgabenKonten = ganz(ab.konten);
  const abgabenSumme = betrag(ab.summe);
  const menschen = ganz(ge.menschen);
  const grundeinkommenSumme = betrag(ge.summe);
  const jeMenschKleinster = betrag(ge.je_mensch_kleinster);
  const jeMenschGroesster = betrag(ge.je_mensch_groesster);
  if (
    zeit === null || zeit === 0 || von === null || bis === null || bis < von ||
    abgabenKonten === null || abgabenSumme === null || menschen === null || grundeinkommenSumme === null ||
    jeMenschKleinster === null || jeMenschGroesster === null || jeMenschGroesster < jeMenschKleinster
  ) {
    return null;
  }
  const probe = obj(o.probe_menschen_mal_anteil);
  const opt = (k: string, negativ = false) => (k in o ? betrag(o[k], negativ) : null);
  return {
    zeit, von, bis, vollstaendig: o.vollstaendig,
    abgabenKonten, abgabenSumme, menschen, grundeinkommenSumme, jeMenschKleinster, jeMenschGroesster,
    probeGleich: probe && typeof probe.gleich === 'boolean' ? probe.gleich : null,
    restNach: opt('rest_nach'),
    topfVorAuszahlung: opt('topf_vor_auszahlung'),
    restVorrunde: opt('rest_vorrunde'),
    andereZufluesse: opt('andere_zufluesse', true),
  };
}

/** Die Runde, zu der die Buchung in Block `hoehe` gehoert; null bei 404,
 *  Netzfehler, altem Knoten oder unpassender Antwort. */
export async function holeRunde(hoehe: number, fetchFn: typeof fetch = fetch): Promise<RundeStand | null> {
  if (!Number.isInteger(hoehe) || hoehe <= 0) return null;
  try {
    const r = await fetchFn(`${API_BASE}/wirtschaft/runde?hoehe=${hoehe}`, { headers: { Accept: 'application/json' } });
    if (!r.ok) return null;
    const text = await r.text();
    if (text.length > ANTWORT_MAX) return null;
    return leseRunde(JSON.parse(text));
  } catch {
    return null;
  }
}
