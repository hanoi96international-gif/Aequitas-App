// Wer hat einen Block erzeugt? Ein Knoten unterschreibt mit seiner eigenen
// Signieradresse, die niemand kennt (z. B. 0x3066…42dc fuer C1). Gemeint ist
// aber der Mensch dahinter, an dessen Wallet der Knoten gebunden ist. Die
// Website zeigt deshalb "Validator #1 · 0x0be8…d016" (explorer.js,
// proposerHTML); die App zeigt dasselbe.
//
// Quelle: GET /api/validator-labels (Aequitas, handleValidatorLabels):
//   { "labels":    { "<Signieradresse>": "Validator #1", ... },
//     "operators": { "<Signieradresse>": "<Betreiber-Wallet>", ... } }
//
// Was das Netz liefert, wird nicht ungeprueft angezeigt: nur Adressen der
// Form 0x + 40 Hex, Bezeichnungen nur kurz und aus druckbaren Zeichen,
// hoechstens MAX_EINTRAEGE Eintraege. Alles andere wird verworfen, und der
// Block zeigt wie bisher die Signieradresse.

export interface ValidatorNamen {
  labels: Record<string, string>;
  operators: Record<string, string>;
}

export const LEER: ValidatorNamen = { labels: {}, operators: {} };

const MAX_EINTRAEGE = 256;
const ADRESSE = /^0x[0-9a-f]{40}$/;
// Druckbares ASCII, ein Leerzeichen erlaubt, aber kein Steuerzeichen.
const BEZEICHNUNG = /^[\x20-\x7e]{1,32}$/;

function adresse(a: unknown): string | null {
  if (typeof a !== 'string') return null;
  const k = a.toLowerCase();
  return ADRESSE.test(k) ? k : null;
}

/** Liest die Antwort von /api/validator-labels; Unbrauchbares faellt weg. */
export function validatorNamenLesen(roh: unknown): ValidatorNamen {
  const out: ValidatorNamen = { labels: {}, operators: {} };
  if (!roh || typeof roh !== 'object') return out;
  const r = roh as { labels?: unknown; operators?: unknown };
  if (r.labels && typeof r.labels === 'object') {
    for (const [k, v] of Object.entries(r.labels as Record<string, unknown>).slice(0, MAX_EINTRAEGE)) {
      const a = adresse(k);
      if (a && typeof v === 'string' && BEZEICHNUNG.test(v)) out.labels[a] = v;
    }
  }
  if (r.operators && typeof r.operators === 'object') {
    for (const [k, v] of Object.entries(r.operators as Record<string, unknown>).slice(0, MAX_EINTRAEGE)) {
      const a = adresse(k);
      const w = adresse(v);
      if (a && w) out.operators[a] = w;
    }
  }
  return out;
}

export function kurzeAdresse(a: string): string {
  return a.slice(0, 6) + '…' + a.slice(-4);
}

/**
 * Anzeige fuer den Erzeuger eines Blocks, wie auf der Website:
 * "Validator #1 · 0x0be8…d016" -- die Betreiber-Wallet, wenn eine bekannt
 * ist, sonst die Signieradresse.
 */
export function erzeugerAnzeige(proposer: string, namen: ValidatorNamen): string {
  const p = (proposer || '').toLowerCase();
  const op = namen.operators[p];
  const wer = kurzeAdresse(op && op !== p ? op : proposer || '');
  const label = namen.labels[p];
  return label ? label + ' · ' + wer : wer;
}
