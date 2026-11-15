// Validator-Bereich: ist die eigene Wallet als Validator eingetragen, und wie
// viele Bloecke hat ihr Knoten heute und insgesamt gebaut?
//
// Quelle: GET /api/validator-stand?wallet=0x... (Aequitas-Repo,
// keeper/validator_stand.go). Die Antwort ist oeffentlich, wird hier aber
// nicht ungeprueft geglaubt: nur, was formal stimmt und genau DIESE Wallet
// nennt, wird angezeigt; alles andere gilt als "nicht lesbar" -- nie als
// "nicht eingetragen" oder "0 Bloecke".
import { API_BASE } from './config';

export interface ValidatorSchluessel {
  /** Signieradresse des Knotens, klein geschrieben. */
  adresse: string;
  /** Im Validator-Register der Kette. */
  kette: boolean;
  /** Der Schluessel hat spaeter einem anderen Betreiber zugestimmt. */
  ueberholt: boolean;
  /** Bindung beim Knoten (bevor sie auf der Kette steht). */
  knoten: boolean;
  /** In der Erzeugerliste: baut Bloecke. */
  erzeuger: boolean;
  bloeckeHeute: number;
  bloeckeGesamt: number;
  /** Unix-Sekunden des letzten gebauten Blocks, 0 = nie. */
  letzterBlock: number;
}

export interface ValidatorStand {
  wallet: string;
  eingetragen: boolean;
  erzeuger: boolean;
  /** Beginn des heutigen Berliner Tages (Unix-Sekunden). */
  tagBeginn: number;
  schluessel: ValidatorSchluessel[];
  bloeckeHeute: number;
  bloeckeGesamt: number;
  letzterBlock: number;
}

export type ValidatorStandErgebnis = { ok: true; stand: ValidatorStand } | { ok: false; fehler: 'adresse' | 'nicht_lesbar' };

const ADRESSE = /^0x[0-9a-f]{40}$/;
/** Mehr nennt der Knoten nie (validatorStandSchluesselMax). */
const SCHLUESSEL_MAX = 8;
/** Die Antwort ist ein kleines JSON; mehr wird nicht gelesen. */
const ANTWORT_MAX = 8192;
const ZEIT_MS = 10_000;

function zahl(x: unknown): number | null {
  return typeof x === 'number' && Number.isSafeInteger(x) && x >= 0 ? x : null;
}

/** Prueft die Antwort des Knotens fuer genau diese Wallet. null = ungueltig. */
export function leseValidatorStand(j: any, wallet: string): ValidatorStand | null {
  const w = String(wallet ?? '').toLowerCase();
  if (!j || typeof j !== 'object' || j.wallet !== w) return null;
  if (typeof j.eingetragen !== 'boolean' || typeof j.erzeuger !== 'boolean') return null;
  const tagBeginn = zahl(j.tag_beginn);
  if (tagBeginn === null || !Array.isArray(j.schluessel) || j.schluessel.length > SCHLUESSEL_MAX) return null;
  const schluessel: ValidatorSchluessel[] = [];
  for (const s of j.schluessel) {
    const adresse = typeof s?.signing_address === 'string' ? s.signing_address : '';
    const heute = zahl(s?.bloecke_heute);
    const gesamt = zahl(s?.bloecke_gesamt);
    const letzter = zahl(s?.letzter_block);
    if (!ADRESSE.test(adresse) || heute === null || gesamt === null || letzter === null || heute > gesamt) return null;
    for (const f of ['kette', 'ueberholt', 'knoten', 'erzeuger']) if (typeof s[f] !== 'boolean') return null;
    schluessel.push({
      adresse,
      kette: s.kette,
      ueberholt: s.ueberholt,
      knoten: s.knoten,
      erzeuger: s.erzeuger,
      bloeckeHeute: heute,
      bloeckeGesamt: gesamt,
      letzterBlock: letzter,
    });
  }
  // Eingetragen nur mit einem gueltigen Schluessel -- ein "eingetragen" ohne
  // Schluessel waere eine Behauptung ohne Grundlage.
  const gueltig = schluessel.filter((s) => (s.kette && !s.ueberholt) || s.knoten);
  if (j.eingetragen !== gueltig.length > 0) return null;
  if (j.erzeuger && !gueltig.some((s) => s.erzeuger)) return null;
  // Summen ueber die gueltigen Schluessel: das sind die Bloecke dieses Menschen.
  return {
    wallet: w,
    eingetragen: j.eingetragen,
    erzeuger: j.erzeuger,
    tagBeginn,
    schluessel,
    bloeckeHeute: gueltig.reduce((n, s) => n + s.bloeckeHeute, 0),
    bloeckeGesamt: gueltig.reduce((n, s) => n + s.bloeckeGesamt, 0),
    letzterBlock: gueltig.reduce((n, s) => Math.max(n, s.letzterBlock), 0),
  };
}

export async function holeValidatorStand(wallet: string, fetchFn: typeof fetch = fetch): Promise<ValidatorStandErgebnis> {
  const w = String(wallet ?? '').toLowerCase();
  if (!ADRESSE.test(w)) return { ok: false, fehler: 'adresse' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ZEIT_MS);
  try {
    const r = await fetchFn(`${API_BASE}/validator-stand?wallet=${encodeURIComponent(w)}`, {
      headers: { Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!r.ok) return { ok: false, fehler: 'nicht_lesbar' };
    const text = (await r.text()).slice(0, ANTWORT_MAX + 1);
    if (text.length > ANTWORT_MAX) return { ok: false, fehler: 'nicht_lesbar' };
    const stand = leseValidatorStand(JSON.parse(text), w);
    return stand ? { ok: true, stand } : { ok: false, fehler: 'nicht_lesbar' };
  } catch {
    return { ok: false, fehler: 'nicht_lesbar' };
  } finally {
    clearTimeout(timer);
  }
}

/** Signieradresse kurz: 0x3066…42dc */
export function adresseKurz(a: string): string {
  return a.length > 12 ? a.slice(0, 6) + '…' + a.slice(-4) : a;
}
