// Umzug: das Menschsein auf eine neue Wallet holen (Kette: umzug.go,
// Entscheidungen vom 07.11.2026).
//
//   - Wiederherstellungscode: die App erzeugt ihn EINMAL und zeigt ihn EINMAL.
//     Auf der Kette steht nur sein Hash, an die Wallet gebunden. Er wird nicht
//     gespeichert, nicht verschickt und kann nirgends erneut angefordert
//     werden. Mit Gesicht + Code geschieht ein Umzug sofort, und die alte
//     Wallet kann ihn nicht aufhalten.
//   - Ohne Code: Gesicht allein, 14 Tage Frist; in der Zeit kann die alte
//     Wallet widerrufen.
//   - Das Guthaben bleibt bei der alten Wallet. Es gibt kein neues Startgeld.
//
// Saetze werden hier gebaut, Byte fuer Byte wie in der Kette; Antworten des
// Netzes werden nur in Form gebracht.
import * as Crypto from 'expo-crypto';
import { ethers } from 'ethers';
import { API_BASE } from './config';
import type { AequitasSigner } from './signer';

export const CODE_ZEICHEN = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CODE_LAENGE = 24;
const CHAIN = 1926;
const ADRESSE = /^0x[0-9a-f]{40}$/;
const NULLIFIER = /^[1-9][0-9]{0,77}$/;

/** Ein neuer Code: 24 Zeichen, 120 Bit Zufall (32 Zeichen, 256 % 32 == 0: gleichverteilt). */
export function codeErzeugen(zufall: (n: number) => Uint8Array = (n) => Crypto.getRandomBytes(n)): string {
  const b = zufall(CODE_LAENGE);
  if (!b || b.length < CODE_LAENGE) throw new Error('kein Zufall');
  let s = '';
  for (let i = 0; i < CODE_LAENGE; i++) s += CODE_ZEICHEN[b[i] & 31];
  return s;
}

/** Grossbuchstaben, ohne Bindestriche und Leerzeichen -- oder null. */
export function codeNormal(roh: string): string | null {
  if (typeof roh !== 'string' || roh.length > 64) return null;
  const s = roh.toUpperCase().replace(/[-\s]/g, '');
  if (s.length !== CODE_LAENGE) return null;
  for (const c of s) if (!CODE_ZEICHEN.includes(c)) return null;
  return s;
}

/** Zum Abschreiben: sechs Gruppen zu je vier Zeichen. */
export function codeAnzeige(code: string): string {
  return (code.match(/.{1,4}/g) ?? []).join('-');
}

/** Was auf der Kette steht (umzugCodeHash). */
export function codeHash(alt: string, code: string): string {
  return ethers.sha256(ethers.toUtf8Bytes(`aequitas-umzug-code-v1|chain:${CHAIN}|${alt.toLowerCase()}|${code}`)).slice(2);
}

export function codeSetzenNachricht(alt: string, hash: string, zeit: number): string {
  return `aequitas-umzug-code-setzen-v1|chain:${CHAIN}|${alt.toLowerCase()}|${hash}|${zeit}`;
}

export function antragNachricht(n: string, alt: string, neu: string, zeit: number): string {
  return `aequitas-umzug-v1|chain:${CHAIN}|${n}|${alt.toLowerCase()}|${neu.toLowerCase()}|${zeit}`;
}

export function widerrufNachricht(n: string, neu: string, angekuendigt: number): string {
  return `aequitas-umzug-widerruf-v1|chain:${CHAIN}|${n}|${neu.toLowerCase()}|${angekuendigt}`;
}

/** Fuer den Coordinator: die neue Wallet gehoert dem Aufrufer. */
export function startNachricht(neu: string, nonce: string): string {
  return `aequitas-umzug-start-v1|chain:${CHAIN}|${neu.toLowerCase()}|${nonce}`;
}

async function unterschreibe(signer: AequitasSigner, text: string): Promise<string | null> {
  const roh = await signer.signMessage(text);
  try {
    const sig = ethers.Signature.from(roh).serialized.toLowerCase();
    return ethers.verifyMessage(text, sig).toLowerCase() === signer.address.toLowerCase() ? sig : null;
  } catch {
    return null;
  }
}

export interface UmzugOffen {
  nullifier: string;
  alt: string;
  neu: string;
  angekuendigt: number;
  freiAb: number;
}

export interface UmzugStand {
  aktivAb: number;
  /** Seit wann ein Code hinterlegt ist (0 = keiner). */
  codeSeit: number;
  offen: UmzugOffen | null;
}

const zahl = (x: unknown) => (typeof x === 'number' && Number.isSafeInteger(x) && x >= 0 ? x : 0);

/** Stand beim Knoten fuer diese Wallet -- null bei Fehler. */
export async function umzugStand(wallet: string, fetchFn: typeof fetch = fetch): Promise<UmzugStand | null> {
  try {
    const r = await fetchFn(`${API_BASE}/umzug?wallet=${encodeURIComponent(wallet.toLowerCase())}`);
    if (!r.ok) return null;
    const j: any = await r.json();
    const o = j?.offen;
    const offen =
      o && ADRESSE.test(o.alt) && ADRESSE.test(o.neu) && NULLIFIER.test(o.nullifier)
        ? { nullifier: o.nullifier, alt: o.alt, neu: o.neu, angekuendigt: zahl(o.angekuendigt), freiAb: zahl(o.frei_ab) }
        : null;
    return { aktivAb: zahl(j?.aktiv_ab), codeSeit: zahl(j?.code_seit), offen };
  } catch {
    return null;
  }
}

export interface Ergebnis {
  ok: boolean;
  meldung?: string;
  sofort?: boolean;
  freiAb?: number;
}

async function senden(pfad: string, body: unknown, fetchFn: typeof fetch): Promise<Ergebnis & { roh?: any }> {
  try {
    const r = await fetchFn(`${API_BASE}${pfad}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    let j: any = null;
    try {
      j = await r.json();
    } catch {
      /* Statuscode reicht */
    }
    if (!r.ok) {
      const t = typeof j?.error === 'string' ? j.error : `HTTP ${r.status}`;
      return { ok: false, meldung: t.slice(0, 200) };
    }
    return { ok: true, roh: j };
  } catch (e: any) {
    return { ok: false, meldung: String(e?.message ?? e).slice(0, 200) };
  }
}

/** Den Hash des Codes fuer die eigene Wallet auf der Kette hinterlegen. */
export async function codeHinterlegen(
  signer: AequitasSigner,
  code: string,
  fetchFn: typeof fetch = fetch,
  jetztS: () => number = () => Math.floor(Date.now() / 1000)
): Promise<Ergebnis> {
  const normal = codeNormal(code);
  if (!normal) return { ok: false, meldung: 'code' };
  const wallet = signer.address.toLowerCase();
  const hash = codeHash(wallet, normal);
  const zeit = jetztS();
  const sig = await unterschreibe(signer, codeSetzenNachricht(wallet, hash, zeit));
  if (!sig) return { ok: false, meldung: 'unterschrift' };
  const r = await senden('/umzug/code', { wallet, code_hash: hash, zeit, sig }, fetchFn);
  return { ok: r.ok, meldung: r.meldung };
}

/** Was der Coordinator bei /umzug bescheinigt (Form geprueft). */
export interface UmzugBescheinigung {
  alt: string;
  nullifier: string;
  zeit: number;
  modus: 'test' | 'real';
  bescheinigung: string[];
}

export function bescheinigungAusAntwort(j: any): UmzugBescheinigung | null {
  if (!j || j.status !== 'bescheinigt') return null;
  const e = Array.isArray(j.bescheinigung) ? j.bescheinigung : [];
  if (!ADRESSE.test(j.alt) || !NULLIFIER.test(j.nullifier) || !Number.isSafeInteger(j.zeit) || j.zeit <= 0) return null;
  if (j.modus !== 'test' && j.modus !== 'real') return null;
  if (e.length === 0 || e.length > 34 || !e.every((x: unknown) => typeof x === 'string' && /^v3k?:[0-9a-zA-Z.:_x]{1,600}$/.test(x))) {
    return null;
  }
  return { alt: j.alt, nullifier: j.nullifier, zeit: j.zeit, modus: j.modus, bescheinigung: e };
}

/** Den Umzug bei der Kette beantragen -- mit Code sofort, sonst 14 Tage. */
export async function antragEinreichen(
  signer: AequitasSigner,
  b: UmzugBescheinigung,
  code: string | null,
  fetchFn: typeof fetch = fetch
): Promise<Ergebnis> {
  const neu = signer.address.toLowerCase();
  let normal: string | null = null;
  if (code && code.trim()) {
    normal = codeNormal(code);
    if (!normal) return { ok: false, meldung: 'code' };
  }
  const sig = await unterschreibe(signer, antragNachricht(b.nullifier, b.alt, neu, b.zeit));
  if (!sig) return { ok: false, meldung: 'unterschrift' };
  const r = await senden(
    '/umzug/antrag',
    { neu, alt: b.alt, nullifier: b.nullifier, zeit: b.zeit, modus: b.modus, bescheinigung: b.bescheinigung, code: normal ?? '', sig },
    fetchFn
  );
  if (!r.ok) return { ok: false, meldung: r.meldung };
  return { ok: true, sofort: r.roh?.sofort === true, freiAb: zahl(r.roh?.frei_ab) };
}

/** Die alte Wallet widerruft einen offenen Umzug. */
export async function widerrufen(signer: AequitasSigner, o: UmzugOffen, fetchFn: typeof fetch = fetch): Promise<Ergebnis> {
  const alt = signer.address.toLowerCase();
  if (alt !== o.alt) return { ok: false, meldung: 'fremd' };
  const sig = await unterschreibe(signer, widerrufNachricht(o.nullifier, o.neu, o.angekuendigt));
  if (!sig) return { ok: false, meldung: 'unterschrift' };
  const r = await senden(
    '/umzug/widerruf',
    { alt, neu: o.neu, nullifier: o.nullifier, angekuendigt: o.angekuendigt, sig },
    fetchFn
  );
  return { ok: r.ok, meldung: r.meldung };
}

// Uebergabe von der Aufnahme (biometric-capture, zweck=umzug) an
// app/umzug.tsx -- nur im Speicher, einmal lesbar.
let uebergabe: { status: string; bescheinigung: UmzugBescheinigung | null } | null = null;

export function umzugErgebnisMerken(status: string, bescheinigung: UmzugBescheinigung | null): void {
  uebergabe = { status, bescheinigung };
}

export function umzugErgebnisNehmen(): { status: string; bescheinigung: UmzugBescheinigung | null } | null {
  const u = uebergabe;
  uebergabe = null;
  return u;
}
