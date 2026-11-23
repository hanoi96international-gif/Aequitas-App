// IBM Quantum aus dem Handy (Quantengeld Weg B, B4b-2; Weg 1: alles im Gerät).
//
// Der IBM-Schlüssel (API key) und die Instanz (CRN) der Präparatorin bleiben im
// Gerät; die App holt damit ein kurzlebiges Token und reicht die Schaltkreise
// ihres Abschnitts (lib/quantenSSchaltkreis.ts, OpenQASM 3 in nativen Gattern)
// selbst als Sampler-Auftrag ein. Kein Dritter sieht Schlüssel oder Messwerte.
//
// QUELLEN:
//   - IBM-Doku "Sampler with the REST API" (quantum.cloud.ibm.com/docs/en/
//     guides/sampler-rest-api, über die Websuche gelesen): Schaltkreise gehen
//     als OpenQASM-3-Text in pubs, program_id "sampler", Kopfzeilen
//     Service-CRN und IBM-API-Version; das Ergebnis liest die Doku als
//     results[i].data.c.samples (je Schuss ein Hex-Wert).
//   - qiskit-ibm-runtime 0.52.1 (api/auth.py, api/rest/runtime.py,
//     api/rest/program_job.py, runtime_job_v2.py, json.py, options.py):
//     Token aus IBM Cloud IAM; POST {basis}/jobs; GET {basis}/jobs/{id}
//     (state.status: QUEUED, RUNNING, COMPLETED, FAILED, CANCELLED) und
//     {basis}/jobs/{id}/results. Der Python-Client schickt immer
//     "support_qiskit": true und bekommt dann die kodierte Form mit
//     __type__-Hüllen (PrimitiveResult → SamplerPubResult → DataBin → BitArray,
//     ndarray als base64(zlib(.npy))). Die App schickt den Schalter nicht.
//     Ohne Angabe sucht der Client die Instanzen über IBM Cloud Global Search
//     (accounts/account.py: POST api.global-search-tagging.cloud.ibm.com
//     /v3/resources/search, query "service_name:quantum-computing") und die
//     Geräte über GET {basis}/backends ("devices": name, status.name,
//     queue_length, qubits); least_busy nimmt das freie ("online", keine
//     Attrappe) mit der kürzesten Schlange. instanzenSuchen/geraetWaehlen tun
//     dasselbe, damit die Präparatorin nur ihren Schlüssel eingeben muss.
// Die App liest BEIDE Formen, jede streng (ergebnisSchuesse). Die Probe auf
// echter Hardware (Aequitas .github/workflows/quanten-s-rest-probe.yml) prüft
// GENAU den Körper aus auftragKoerper (Prüfvektor ibm_auftrag_vektor.json)
// und hält fest, welche Form IBM zurückgibt.
//
// Fail-closed: feste Adressen (kein Ziel aus Eingaben), Zeitgrenzen,
// redirect: 'error', Größengrenzen, strenges Lesen; nichts Geheimes in
// Fehlermeldungen.

import { ethers } from 'ethers';
import { unzlibSync } from 'fflate';

export const IAM_URL = 'https://iam.cloud.ibm.com/identity/token';
export const API_BASIS = 'https://quantum.cloud.ibm.com/api/v1';
export const API_VERSION = '2026-04-15';
export const SUCHE_URL = 'https://api.global-search-tagging.cloud.ibm.com/v3/resources/search?limit=100';
export const INSTANZEN_MAX = 8;
const GERAETE_MAX = 256;

const FRIST_MS = 30_000;
export const ANTWORT_MAX = 8 * 1024 * 1024;
export const SCHUESSE_MAX = 15;
export const KREISE_MAX = 64;

const CRN = /^crn:v1:bluemix:public:quantum-computing:[a-z0-9-]{2,20}:a\/[0-9a-f]{32}:[0-9a-f-]{36}::$/;
const BACKEND = /^[a-z][a-z0-9_]{2,40}$/;
const JOB_ID = /^[a-z0-9]{8,64}$/;

export class IbmFehler extends Error {}

export interface IbmZugang {
  apiKey: string;
  crn: string;
}

export function zugangPruefen(z: IbmZugang): IbmZugang {
  const apiKey = z.apiKey.trim();
  const crn = z.crn.trim();
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(apiKey)) throw new IbmFehler('API-Schlüssel: Form');
  if (!CRN.test(crn)) throw new IbmFehler('Instanz (CRN): Form');
  return { apiKey, crn };
}

async function anfrage(fetchFn: typeof fetch, url: string, init: RequestInit): Promise<{ status: number; text: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FRIST_MS);
  try {
    const r = await fetchFn(url, { ...init, signal: ctrl.signal, redirect: 'error' } as RequestInit);
    const text = await r.text();
    if (text.length > ANTWORT_MAX) throw new IbmFehler('Antwort zu groß');
    return { status: r.status, text };
  } catch (e) {
    if (e instanceof IbmFehler) throw e;
    throw new IbmFehler('Netz');
  } finally {
    clearTimeout(t);
  }
}

function json(text: string, was: string): any {
  try {
    return JSON.parse(text);
  } catch {
    throw new IbmFehler(`${was}: kein JSON`);
  }
}

/** Token aus dem API-Schlüssel (IBM Cloud IAM). Gültig bis bis (ms). */
export async function holeToken(z: IbmZugang, jetztMs: number, fetchFn: typeof fetch = fetch): Promise<{ token: string; bis: number }> {
  const { apiKey } = zugangPruefen(z);
  const body = `grant_type=${encodeURIComponent('urn:ibm:params:oauth:grant-type:apikey')}&apikey=${encodeURIComponent(apiKey)}`;
  const r = await anfrage(fetchFn, IAM_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  });
  if (r.status !== 200) throw new IbmFehler(`Anmeldung bei IBM: HTTP ${r.status}`);
  const j = json(r.text, 'Anmeldung');
  if (typeof j?.access_token !== 'string' || j.access_token.length < 20 || !Number.isSafeInteger(j?.expires_in) || j.expires_in <= 0) {
    throw new IbmFehler('Anmeldung: Antwort');
  }
  return { token: j.access_token, bis: jetztMs + j.expires_in * 1000 };
}

function kopf(token: string, crn: string, mitKoerper: boolean): Record<string, string> {
  const h: Record<string, string> = { Authorization: `Bearer ${token}`, 'Service-CRN': crn, 'IBM-API-Version': API_VERSION, Accept: 'application/json' };
  if (mitKoerper) h['Content-Type'] = 'application/json';
  return h;
}

/** Der Körper eines Sampler-Auftrags: je Schaltkreis ein pub (Text, keine Parameter, Schüsse). */
export function auftragKoerper(backend: string, kreiseQasm: string[], schuesse: number): string {
  if (!BACKEND.test(backend)) throw new IbmFehler('Backend: Form');
  if (kreiseQasm.length < 1 || kreiseQasm.length > KREISE_MAX) throw new IbmFehler('Zahl der Schaltkreise');
  if (!Number.isInteger(schuesse) || schuesse < 1 || schuesse > SCHUESSE_MAX) throw new IbmFehler('Schüsse');
  if (!kreiseQasm.every((q) => q.startsWith('OPENQASM 3.0;') && q.length < 16_384)) throw new IbmFehler('Schaltkreis: Form');
  return JSON.stringify({ program_id: 'sampler', backend, params: { pubs: kreiseQasm.map((q) => [q, null, schuesse]), version: 2 } });
}

export async function einreichen(token: string, crn: string, koerper: string, fetchFn: typeof fetch = fetch): Promise<string> {
  const r = await anfrage(fetchFn, `${API_BASIS}/jobs`, { method: 'POST', headers: kopf(token, crn, true), body: koerper });
  if (r.status !== 200 && r.status !== 201) throw new IbmFehler(`Auftrag: HTTP ${r.status} ${fehlerText(r.text)}`);
  const id = json(r.text, 'Auftrag')?.id;
  if (typeof id !== 'string' || !JOB_ID.test(id)) throw new IbmFehler('Auftrag: keine Kennung');
  return id;
}

function fehlerText(text: string): string {
  // Nur Text ohne Steuerzeichen, gekürzt -- nie ein Token oder Schlüssel (die schickt IBM nicht zurück).
  try {
    const j = JSON.parse(text);
    const m = j?.errors?.[0]?.message ?? j?.message ?? j?.error;
    if (typeof m === 'string') return m.replace(/[^\x20-\x7e]/g, '').slice(0, 200);
  } catch {
    // kein JSON
  }
  return '';
}

export type IbmStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export async function status(token: string, crn: string, id: string, fetchFn: typeof fetch = fetch): Promise<IbmStatus> {
  if (!JOB_ID.test(id)) throw new IbmFehler('Kennung: Form');
  const r = await anfrage(fetchFn, `${API_BASIS}/jobs/${id}`, { method: 'GET', headers: kopf(token, crn, false) });
  if (r.status !== 200) throw new IbmFehler(`Status: HTTP ${r.status}`);
  const s = String(json(r.text, 'Status')?.state?.status ?? '').toUpperCase();
  if (!['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'].includes(s)) throw new IbmFehler('Status: unbekannt');
  return s as IbmStatus;
}

export async function ergebnisRoh(token: string, crn: string, id: string, fetchFn: typeof fetch = fetch): Promise<unknown> {
  if (!JOB_ID.test(id)) throw new IbmFehler('Kennung: Form');
  const r = await anfrage(fetchFn, `${API_BASIS}/jobs/${id}/results`, { method: 'GET', headers: kopf(token, crn, false) });
  if (r.status !== 200) throw new IbmFehler(`Ergebnis: HTTP ${r.status}`);
  return json(r.text, 'Ergebnis');
}

// ------------------------------------------------------------ Instanz und Gerät finden

/**
 * Die Quantum-Instanzen (CRN) des Kontos, höchstens INSTANZEN_MAX, sortiert.
 * Nur, was die strenge CRN-Form erfüllt; alles andere wird übergangen.
 */
export async function instanzenSuchen(token: string, fetchFn: typeof fetch = fetch): Promise<string[]> {
  const r = await anfrage(fetchFn, SUCHE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query: 'service_name:quantum-computing', fields: ['crn', 'name'] }),
  });
  if (r.status !== 200) throw new IbmFehler(`Instanzen: HTTP ${r.status}`);
  const items = json(r.text, 'Instanzen')?.items;
  if (!Array.isArray(items) || items.length > 100) throw new IbmFehler('Instanzen: Antwort');
  const crns = [...new Set(items.map((i: any) => i?.crn).filter((c: unknown): c is string => typeof c === 'string' && CRN.test(c)))].sort();
  if (!crns.length) throw new IbmFehler('Instanzen: keine Quantum-Instanz im Konto');
  return crns.slice(0, INSTANZEN_MAX);
}

export interface Geraet {
  name: string;
  schlange: number;
  qubits: number;
}

/** Die freien Geräte einer Instanz (online, keine Attrappe), kürzeste Schlange zuerst. */
export async function geraeteListe(token: string, crn: string, fetchFn: typeof fetch = fetch): Promise<Geraet[]> {
  if (!CRN.test(crn)) throw new IbmFehler('Instanz (CRN): Form');
  const r = await anfrage(fetchFn, `${API_BASIS}/backends`, { method: 'GET', headers: kopf(token, crn, false) });
  if (r.status !== 200) throw new IbmFehler(`Geräte: HTTP ${r.status}`);
  const devices = json(r.text, 'Geräte')?.devices;
  if (!Array.isArray(devices) || devices.length > GERAETE_MAX) throw new IbmFehler('Geräte: Antwort');
  const frei: Geraet[] = [];
  for (const d of devices) {
    if (d?.status?.name !== 'online' || d?.class === 'mock') continue;
    if (typeof d?.name !== 'string' || !BACKEND.test(d.name)) continue;
    if (!Number.isSafeInteger(d?.queue_length) || d.queue_length < 0 || !Number.isSafeInteger(d?.qubits) || d.qubits < 1) continue;
    frei.push({ name: d.name, schlange: d.queue_length, qubits: d.qubits });
  }
  return frei.sort((a, b) => a.schlange - b.schlange || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * Instanz und Gerät für einen Abschnitt: über alle Instanzen (höchstens
 * INSTANZEN_MAX) das freie Gerät mit der kürzesten Schlange und genug Qubits
 * (die Schaltkreise nutzen die physischen Qubits 0..minQubits-1).
 */
export async function geraetWaehlen(token: string, minQubits: number, fetchFn: typeof fetch = fetch): Promise<{ crn: string; geraet: Geraet }> {
  if (!Number.isInteger(minQubits) || minQubits < 1 || minQubits > 16) throw new IbmFehler('Qubits');
  let best: { crn: string; geraet: Geraet } | null = null;
  for (const crn of await instanzenSuchen(token, fetchFn)) {
    let liste: Geraet[];
    try {
      liste = await geraeteListe(token, crn, fetchFn);
    } catch (e) {
      // Eine Instanz ohne Zugang (z. B. ohne Geräte-Zuteilung) überspringen wie der Client.
      if (e instanceof IbmFehler && /^Geräte: HTTP 40[13]$/.test(e.message)) continue;
      throw e;
    }
    const g = liste.find((x) => x.qubits >= minQubits);
    if (g && (!best || g.schlange < best.geraet.schlange)) best = { crn, geraet: g };
  }
  if (!best) throw new IbmFehler('Geräte: kein freies Gerät');
  return best;
}

// ------------------------------------------------------------ Ergebnis lesen

function huelle(o: unknown, typ: string): any {
  if (!o || typeof o !== 'object' || (o as any).__type__ !== typ || !('__value__' in (o as any))) throw new IbmFehler(`Ergebnis: ${typ} erwartet`);
  return (o as any).__value__;
}

/**
 * .npy (Version 1/2/3, '|u1', C-Ordnung, zweidimensional) → Zeilen von Bytes.
 * Fail-closed bei allem anderen.
 */
export function npyZeilen(roh: Uint8Array): Uint8Array[] {
  if (roh.length < 10 || roh[0] !== 0x93 || String.fromCharCode(...roh.slice(1, 6)) !== 'NUMPY') throw new IbmFehler('npy: Kopf');
  const haupt = roh[6];
  let lang: number;
  let ab: number;
  if (haupt === 1) {
    lang = roh[8] | (roh[9] << 8);
    ab = 10;
  } else if (haupt === 2 || haupt === 3) {
    if (roh.length < 12) throw new IbmFehler('npy: Kopf');
    lang = roh[8] | (roh[9] << 8) | (roh[10] << 16) | (roh[11] << 24);
    ab = 12;
  } else throw new IbmFehler('npy: Version');
  if (lang > 4096 || ab + lang > roh.length) throw new IbmFehler('npy: Kopflänge');
  const kopfText = String.fromCharCode(...roh.slice(ab, ab + lang));
  if (!/'descr':\s*'\|u1'/.test(kopfText) || !/'fortran_order':\s*False/.test(kopfText)) throw new IbmFehler('npy: Typ');
  const m = /'shape':\s*\((\d+),\s*(\d+)\)/.exec(kopfText);
  if (!m) throw new IbmFehler('npy: Form');
  const zeilen = Number(m[1]);
  const breite = Number(m[2]);
  const daten = roh.slice(ab + lang);
  if (zeilen < 1 || zeilen > SCHUESSE_MAX || breite < 1 || breite > 8 || daten.length !== zeilen * breite) throw new IbmFehler('npy: Größe');
  return Array.from({ length: zeilen }, (_, i) => daten.slice(i * breite, (i + 1) * breite));
}

function ndarrayZeilen(nd: unknown): Uint8Array[] {
  const v = huelle(nd, 'ndarray');
  if (typeof v === 'string') {
    if (v.length > 1_000_000) throw new IbmFehler('ndarray: zu groß');
    let entpackt: Uint8Array;
    try {
      entpackt = unzlibSync(ethers.decodeBase64(v));
    } catch {
      throw new IbmFehler('ndarray: nicht entpackbar');
    }
    if (entpackt.length > 1_000_000) throw new IbmFehler('ndarray: zu groß');
    return npyZeilen(entpackt);
  }
  if (Array.isArray(v) && v.length >= 1 && v.length <= SCHUESSE_MAX) {
    return v.map((z) => {
      if (!Array.isArray(z) || z.length < 1 || z.length > 8 || !z.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)) throw new IbmFehler('ndarray: Liste');
      return Uint8Array.from(z);
    });
  }
  throw new IbmFehler('ndarray: Form');
}

function hexSchuss(v: bigint, n: number): string {
  if (v >> BigInt(n) !== 0n) throw new IbmFehler('Ergebnis: Bits über n');
  return '0x' + v.toString(16);
}

/** Kodierte Form (qiskit-ibm-runtime, RuntimeEncoder). */
function kodierteSchuesse(roh: unknown, kreiseN: number[]): string[][] {
  const pr = huelle(roh, 'PrimitiveResult');
  const pubs = pr?.pub_results;
  if (!Array.isArray(pubs) || pubs.length !== kreiseN.length) throw new IbmFehler('Ergebnis: Zahl der Schaltkreise');
  return pubs.map((p, j) => {
    const db = huelle(huelle(p, 'SamplerPubResult')?.data, 'DataBin');
    const ba = huelle(db?.fields?.c, 'BitArray');
    if (ba?.num_bits !== kreiseN[j]) throw new IbmFehler('Ergebnis: Zahl der Bits');
    const breite = Math.ceil(kreiseN[j] / 8);
    return ndarrayZeilen(ba.array).map((z) => {
      if (z.length !== breite) throw new IbmFehler('Ergebnis: Breite');
      let v = 0n;
      for (const b of z) v = (v << 8n) | BigInt(b);
      return hexSchuss(v, kreiseN[j]);
    });
  });
}

const HEX_SCHUSS = /^0x[0-9a-fA-F]{1,4}$/;

/** Einfache Form (IBM-Doku): results[i].data.c.samples, je Schuss ein Hex-Wert. */
function einfacheSchuesse(roh: any, kreiseN: number[]): string[][] {
  const res = roh.results;
  if (!Array.isArray(res) || res.length !== kreiseN.length) throw new IbmFehler('Ergebnis: Zahl der Schaltkreise');
  return res.map((r: any, j: number) => {
    const data = r?.data;
    // Nur das eine Register c der App-Schaltkreise; alles andere ist ein fremder Schaltkreis.
    if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).join() !== 'c') throw new IbmFehler('Ergebnis: Register');
    const c = data.c;
    if (c?.num_bits !== undefined && c.num_bits !== kreiseN[j]) throw new IbmFehler('Ergebnis: Zahl der Bits');
    const s = c?.samples;
    if (!Array.isArray(s) || s.length < 1 || s.length > SCHUESSE_MAX) throw new IbmFehler('Ergebnis: Schüsse');
    return s.map((h: unknown) => {
      if (typeof h !== 'string' || !HEX_SCHUSS.test(h)) throw new IbmFehler('Ergebnis: Schuss');
      return hexSchuss(BigInt(h), kreiseN[j]);
    });
  });
}

/**
 * Die Schüsse je Schaltkreis als Hex (Bit i = klassisches Bit i, Bit 0 rechts),
 * aus dem Ergebnis-JSON in einer der beiden Formen. BitArray packt big-endian:
 * das letzte Byte trägt die niedrigsten Bits. Register "c" wie in
 * lib/quantenSSchaltkreis.ts. Fail-closed bei allem anderen.
 */
export function ergebnisSchuesse(roh: unknown, kreiseN: number[]): string[][] {
  if (!kreiseN.length || kreiseN.length > KREISE_MAX || !kreiseN.every((n) => Number.isInteger(n) && n >= 1 && n <= 16)) throw new IbmFehler('Ergebnis: Schaltkreise');
  if (!roh || typeof roh !== 'object' || Array.isArray(roh)) throw new IbmFehler('Ergebnis: Form');
  const o = roh as any;
  if ('__type__' in o) return kodierteSchuesse(o, kreiseN);
  if ('results' in o) return einfacheSchuesse(o, kreiseN);
  throw new IbmFehler('Ergebnis: Form');
}
