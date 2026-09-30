// Ein Fehlertyp fuer alle Netzaufrufe (docs/NEUBAU_ANALYSE.md 3.4).
//
// Bildschirme entscheiden anhand von `kind`, nie anhand von Freitext. Die
// Abbildung auf Texte steht in errorText() -- i18n-Schluessel errors.<kind>.

export type ApiErrorKind =
  | 'network' // keine Antwort (offline, DNS, TLS)
  | 'timeout' // Antwort kam nicht rechtzeitig
  | 'rateLimited' // 429 -- retryAfterMs sagt, wie lange
  | 'unavailable' // 503/502/504 -- Server ueberlastet oder im Wartungsfenster
  | 'rejected' // Fachliche Ablehnung (4xx oder {success:false})
  | 'invalidResponse' // Antwort ohne erwartete Form
  | 'chainMismatch' // Knoten gehoert nicht zu Chain 1926 -- nichts signieren
  | 'clockSkew'; // Geraeteuhr weicht zu weit ab (Tausch/Liquiditaet +-60 s)

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  readonly retryAfterMs?: number;
  /** Maschinenlesbarer Code der Kette, falls vorhanden. */
  readonly code?: string;

  constructor(kind: ApiErrorKind, message: string, opts: { status?: number; retryAfterMs?: number; code?: string } = {}) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = opts.status;
    this.retryAfterMs = opts.retryAfterMs;
    this.code = opts.code;
  }

  /** Darf ein Lesezugriff automatisch wiederholt werden? Signierte Auftraege nie. */
  get transient(): boolean {
    return this.kind === 'network' || this.kind === 'timeout' || this.kind === 'unavailable' || this.kind === 'rateLimited';
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

/**
 * Retry-After: Sekunden ("10") oder HTTP-Datum. Obergrenze 5 Minuten -- ein
 * kaputter Server darf die App nicht beliebig lange blockieren.
 */
export function parseRetryAfter(value: string | null | undefined, now: number = Date.now()): number | undefined {
  if (!value) return undefined;
  const v = value.trim();
  let ms: number | undefined;
  if (/^\d+$/.test(v)) {
    ms = Number(v) * 1000;
  } else {
    const t = Date.parse(v);
    if (!Number.isNaN(t)) ms = Math.max(0, t - now);
  }
  if (ms === undefined) return undefined;
  return Math.min(ms, 5 * 60 * 1000);
}

/** HTTP-Status -> Fehlerart (fuer Antworten ohne fachlichen Rumpf). */
export function kindForStatus(status: number): ApiErrorKind {
  if (status === 429) return 'rateLimited';
  if (status === 502 || status === 503 || status === 504) return 'unavailable';
  return 'rejected';
}
