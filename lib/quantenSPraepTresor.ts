// Quantengeld Weg B (B4b-4c-1c): der Tresor der Präparatorin im Gerät.
//
// Was die Präparatorin zu einem Auftrag aufbewahren muss, bis sie bestätigt
// und geöffnet hat: den Auftrag, u und t (geheim), das Messergebnis x und ihre
// Werte, Koeffizienten und Salze (geheim). Werte und Koeffizienten sind groß
// (t × Stellen × 32 Byte); Android-AsyncStorage verträgt nur ~2 MB je Eintrag.
//
// Darum speichert der Tresor einen geheimen SEED (32 Byte) statt der Werte:
// `drbg(seed)` ist ein deterministischer Zufall (HMAC-SHA-256 im Zählermodus),
// aus dem `antwortBauen` in fester Reihenfolge Werte, Koeffizienten, Salze und
// die Verschlüsselungen zieht. Derselbe Seed ergibt dieselbe Antwort -- wie der
// Dienst des Knotens, der denselben Auftrag noch einmal mit denselben Werten
// beantwortet. Der Seed kommt aus dem Zufall des Geräts.
//
// Speicher: der Fall als JSON, mit AES-256-GCM verschlüsselt (Zusatzdaten:
// Domäne und K, damit kein Fall unter einem anderen K gilt) in der Ablage
// (AsyncStorage); der Schlüssel dazu in SecureStore (geheim: Biometrie, nur
// dieses Gerät). Fail-closed: Schlüssel fehlt, Chiffrat verändert, Form falsch
// -> Fehler, nie ein halber Fall.
//
// GRENZEN: höchstens FAELLE_MAX offene Fälle, ein Fall höchstens FALL_MAX Byte.
//
// Laufende Messung (4c-4, fortsetzbar): eine Messung bei IBM wartet bis zu
// Stunden in der Schlange; das Handy beendet die App vorher. Darum liegt VOR dem
// ersten IBM-Auftrag eine `Messung` im Tresor: Auftrag, Seed (daraus u, t und
// alles Weitere -- derselbe Seed, dieselbe Antwort), Schlüssel des Ausgebers und
// die Kennungen der IBM-Aufträge. Getrennt vom Fall (eigene Domäne, eigene Liste,
// höchstens MESSUNGEN_MAX): ein Fall entsteht erst mit dem Messergebnis, und
// Bestätigung und Öffnung sehen nur Fälle.

import { gcm } from '@noble/ciphers/aes.js';
import { ethers } from 'ethers';
import { QuantenSFehler } from './quantenS';
import type { Speicher } from './quantenSInhaberin';
import { auftragLesen, type AbschnittAuftrag } from './quantenSPraepAuftrag';
import type { Zufall } from './quantenSPraeparieren';

const DOM_DRBG = 'aequitas-praep-drbg-v1';
const DOM_TRESOR = 'aequitas-praep-tresor-v1';
export const TRESOR_SCHLUESSEL = 'aequitas.quantenS.praep.tresorSchluessel';
const FALL_PREFIX = 'aequitas.quantenS.praep.fall.';
const LISTE = 'aequitas.quantenS.praep.faelle';
export const FAELLE_MAX = 16;
/** Ein Fall: Auftrag, Bits und Antwort; deutlich unter den ~2 MB je Eintrag von AsyncStorage. */
export const FALL_MAX = 1024 * 1024;
const MESSUNG_PREFIX = 'aequitas.quantenS.praep.messung.';
const MESSUNG_LISTE = 'aequitas.quantenS.praep.messungen';
const DOM_MESSUNG = 'aequitas-praep-messung-v1';
/** Höchstens so viele laufende Messungen (je Los eine; ein Mensch steht selten in mehreren Losen zugleich). */
export const MESSUNGEN_MAX = 4;
/** Höchstens so viele IBM-Aufträge je Messung (ein Abschnitt: n ≤ 16384 Stellen, je Auftrag viele Kreise). */
export const JOBS_MAX = 64;
const JOB_ID = /^[a-z0-9]{8,64}$/;
const PUB = /^04[0-9a-f]{128}$/;

const HEX64 = /^[0-9a-f]{64}$/;
const HEX = /^[0-9a-f]*$/;
const BITS = /^[01]+$/;

function fehler(text: string): never {
  throw new QuantenSFehler(text);
}

/** Deterministischer Zufall aus einem 32-Byte-Seed: HMAC-SHA-256(seed, Domäne | Zähler), fortlaufend. */
export function drbg(seedHex: string): Zufall {
  if (!HEX64.test(seedHex)) fehler('Seed');
  const seed = ethers.getBytes('0x' + seedHex);
  let puffer = new Uint8Array(0);
  let z = 0;
  return (n: number) => {
    if (!Number.isSafeInteger(n) || n < 0 || n > 1 << 24) fehler('Zufall');
    while (puffer.length < n) {
      const block = ethers.getBytes(ethers.computeHmac('sha256', seed, ethers.toUtf8Bytes(`${DOM_DRBG}|${z++}`)));
      const neu = new Uint8Array(puffer.length + block.length);
      neu.set(puffer);
      neu.set(block, puffer.length);
      puffer = neu;
    }
    const out = puffer.slice(0, n);
    puffer = puffer.slice(n);
    return out;
  };
}

export type Stand = 'gemessen' | 'beantwortet' | 'bestaetigt' | 'geoeffnet';
const STAENDE: Stand[] = ['gemessen', 'beantwortet', 'bestaetigt', 'geoeffnet'];

/** Was die Präparatorin zu einem K aufbewahrt. */
export interface Fall {
  k: string;
  auftrag: AbschnittAuftrag;
  /** geheim: daraus folgen Werte, Koeffizienten, Salze (drbg) */
  seed: string;
  /** geheim: Basis und Wert der Präparatorin, je '0'/'1' */
  u: string;
  t: string;
  /** Messergebnis */
  x: string;
  stand: Stand;
  /** Zeit der Annahme (Sekunden) */
  zeit: number;
  /** nach der Bestätigung: Unterschrift, alle n eigenen Anteile, je anderer Präparatorin die zwei Pakete */
  bestaetigung?: GespeicherteBestaetigung;
  /** Öffnung: wann Bindung und Wahl (schl = SHA-256 von d|c) zuerst gesehen wurden (Höhe der Kette) */
  sichtung?: { schl: string; hoehe: number };
}

export interface GespeicherteBestaetigung {
  sig: string;
  anteile: string[];
  oeffnungen: Record<string, string[]>;
}

const SIG = /^0x[0-9a-f]{130}$/;
const ANTEIL = /^[0-9a-f]{1,64}$/;
const PAKET = /^[0-9a-f]+$/;

function bestaetigungPruefen(b: unknown, n: number, v: number): GespeicherteBestaetigung {
  if (!b || typeof b !== 'object' || Array.isArray(b)) fehler('Tresor: Bestätigung');
  const o = b as Record<string, unknown>;
  if (Object.keys(o).sort().join(',') !== 'anteile,oeffnungen,sig') fehler('Tresor: Bestätigung, Felder');
  if (typeof o.sig !== 'string' || !SIG.test(o.sig)) fehler('Tresor: Bestätigung, Unterschrift');
  if (!Array.isArray(o.anteile) || o.anteile.length !== n || !o.anteile.every((a) => typeof a === 'string' && ANTEIL.test(a))) fehler('Tresor: Bestätigung, Anteile');
  const oe = o.oeffnungen;
  if (!oe || typeof oe !== 'object' || Array.isArray(oe)) fehler('Tresor: Bestätigung, Pakete');
  for (const [k, p] of Object.entries(oe as Record<string, unknown>)) {
    const x = Number(k);
    if (!/^[1-9][0-9]?$/.test(k) || x > v || !Array.isArray(p) || p.length !== 2 || !p.every((h) => typeof h === 'string' && h.length % 2 === 0 && PAKET.test(h))) {
      fehler('Tresor: Bestätigung, Pakete');
    }
  }
  return { sig: o.sig, anteile: o.anteile as string[], oeffnungen: oe as Record<string, string[]> };
}

function fallPruefen(f: unknown): Fall {
  if (!f || typeof f !== 'object' || Array.isArray(f)) fehler('Tresor: Form');
  const o = f as Record<string, unknown>;
  const felder = Object.keys(o).sort().join(',');
  if (![
    'auftrag,k,seed,stand,t,u,x,zeit',
    'auftrag,bestaetigung,k,seed,stand,t,u,x,zeit',
    'auftrag,bestaetigung,k,seed,sichtung,stand,t,u,x,zeit',
  ].includes(felder)) fehler('Tresor: Felder');
  if (typeof o.k !== 'string' || !HEX64.test(o.k) || typeof o.seed !== 'string' || !HEX64.test(o.seed)) fehler('Tresor: K oder Seed');
  for (const b of ['u', 't', 'x'] as const) if (typeof o[b] !== 'string' || !BITS.test(o[b] as string)) fehler(`Tresor: ${b}`);
  if ((o.u as string).length !== (o.t as string).length || (o.u as string).length !== (o.x as string).length) fehler('Tresor: Längen');
  if (typeof o.stand !== 'string' || !STAENDE.includes(o.stand as Stand)) fehler('Tresor: Stand');
  if (typeof o.zeit !== 'number' || !Number.isSafeInteger(o.zeit) || o.zeit <= 0) fehler('Tresor: Zeit');
  const auftrag = auftragLesen(ethers.toUtf8Bytes(JSON.stringify(o.auftrag)));
  if (auftrag.k !== o.k) fehler('Tresor: Auftrag zu anderem K');
  const fall: Fall = { k: o.k, auftrag, seed: o.seed, u: o.u as string, t: o.t as string, x: o.x as string, stand: o.stand as Stand, zeit: o.zeit };
  // Bestätigt oder geöffnet genau dann, wenn die Bestätigung gespeichert ist.
  const mitB = fall.stand === 'bestaetigt' || fall.stand === 'geoeffnet';
  if (mitB !== ('bestaetigung' in o)) fehler('Tresor: Stand und Bestätigung passen nicht');
  if (mitB) fall.bestaetigung = bestaetigungPruefen(o.bestaetigung, auftrag.n, auftrag.validatoren.length);
  if ('sichtung' in o) {
    const si = o.sichtung as Record<string, unknown> | null;
    if (!si || typeof si !== 'object' || Object.keys(si).sort().join(',') !== 'hoehe,schl' || typeof si.schl !== 'string' || !HEX64.test(si.schl) ||
      typeof si.hoehe !== 'number' || !Number.isSafeInteger(si.hoehe) || si.hoehe < 0) fehler('Tresor: Sichtung');
    fall.sichtung = { schl: si.schl as string, hoehe: si.hoehe as number };
  }
  return fall;
}

/** Eine laufende Messung (vor dem Fall). */
export interface Messung {
  k: string;
  auftrag: AbschnittAuftrag;
  /** geheim: daraus u, t und alles Weitere (drbg) */
  seed: string;
  /** Schlüssel des Ausgebers (aus der Unterschrift seiner Hülle), für die Antwort */
  pub: string;
  /** IBM-Aufträge je Teil, null = noch nicht (oder neu) einzureichen */
  jobs: (string | null)[];
  /** Zeit der Annahme (Sekunden) */
  zeit: number;
}

function messungPruefen(m: unknown): Messung {
  if (!m || typeof m !== 'object' || Array.isArray(m)) fehler('Tresor: Messung, Form');
  const o = m as Record<string, unknown>;
  if (Object.keys(o).sort().join(',') !== 'auftrag,jobs,k,pub,seed,zeit') fehler('Tresor: Messung, Felder');
  if (typeof o.k !== 'string' || !HEX64.test(o.k) || typeof o.seed !== 'string' || !HEX64.test(o.seed)) fehler('Tresor: Messung, K oder Seed');
  if (typeof o.pub !== 'string' || !PUB.test(o.pub)) fehler('Tresor: Messung, Schlüssel');
  if (!Array.isArray(o.jobs) || o.jobs.length > JOBS_MAX || !o.jobs.every((j) => j === null || (typeof j === 'string' && JOB_ID.test(j)))) fehler('Tresor: Messung, Aufträge');
  if (typeof o.zeit !== 'number' || !Number.isSafeInteger(o.zeit) || o.zeit <= 0) fehler('Tresor: Messung, Zeit');
  const auftrag = auftragLesen(ethers.toUtf8Bytes(JSON.stringify(o.auftrag)));
  if (auftrag.k !== o.k) fehler('Tresor: Messung, Auftrag zu anderem K');
  return { k: o.k, auftrag, seed: o.seed, pub: o.pub, jobs: [...(o.jobs as (string | null)[])], zeit: o.zeit };
}

export class PraepTresor {
  constructor(
    private geheim: Speicher,
    private ablage: Speicher,
    private zufall: Zufall,
  ) {}

  /** Schlüssel des Tresors aus SecureStore; beim ersten Mal neu gezogen. */
  private async schluessel(neuErlaubt: boolean): Promise<Uint8Array> {
    const s = await this.geheim.lesen(TRESOR_SCHLUESSEL);
    if (s !== null) {
      if (!HEX64.test(s)) fehler('Tresor: Schlüssel beschädigt');
      return ethers.getBytes('0x' + s);
    }
    if (!neuErlaubt) fehler('Tresor: Schlüssel fehlt');
    const k = this.zufall(32);
    if (k.length !== 32) fehler('Zufall');
    await this.geheim.schreiben(TRESOR_SCHLUESSEL, ethers.hexlify(k).slice(2), true);
    return k;
  }

  /** Ein neuer geheimer Seed für einen Fall. */
  neuerSeed(): string {
    const s = this.zufall(32);
    if (s.length !== 32) fehler('Zufall');
    return ethers.hexlify(s).slice(2);
  }

  async liste(): Promise<string[]> {
    return this.listeLesen(LISTE, FAELLE_MAX);
  }

  private async listeLesen(key: string, max: number): Promise<string[]> {
    const roh = await this.ablage.lesen(key);
    if (roh === null) return [];
    let l: unknown;
    try {
      l = JSON.parse(roh);
    } catch {
      return fehler('Tresor: Liste beschädigt');
    }
    if (!Array.isArray(l) || l.length > max || !l.every((k) => typeof k === 'string' && HEX64.test(k)) || new Set(l).size !== l.length) {
      fehler('Tresor: Liste beschädigt');
    }
    return l as string[];
  }

  private async verschluesseln(prefix: string, dom: string, K: string, obj: unknown): Promise<void> {
    const klar = ethers.toUtf8Bytes(JSON.stringify(obj));
    if (klar.length > FALL_MAX) fehler('Tresor: Fall zu groß');
    const key = await this.schluessel(true);
    const nonce = this.zufall(12);
    if (nonce.length !== 12) fehler('Zufall');
    const ct = gcm(key, nonce, ethers.toUtf8Bytes(`${dom}|${K}`)).encrypt(klar);
    await this.ablage.schreiben(prefix + K, ethers.hexlify(nonce).slice(2) + ethers.hexlify(ct).slice(2), false);
  }

  private async entschluesseln(prefix: string, dom: string, K: string): Promise<unknown | null> {
    if (!HEX64.test(K)) fehler('K');
    const roh = await this.ablage.lesen(prefix + K);
    if (roh === null) return null;
    if (!HEX.test(roh) || roh.length % 2 !== 0 || roh.length < 2 * (12 + 16) || roh.length > 2 * (FALL_MAX + 12 + 16)) fehler('Tresor: Chiffrat');
    const key = await this.schluessel(false);
    const b = ethers.getBytes('0x' + roh);
    let klar: Uint8Array;
    try {
      klar = gcm(key, b.slice(0, 12), ethers.toUtf8Bytes(`${dom}|${K}`)).decrypt(b.slice(12));
    } catch {
      return fehler('Tresor: Chiffrat verändert oder fremder Schlüssel');
    }
    try {
      return JSON.parse(ethers.toUtf8String(klar));
    } catch {
      return fehler('Tresor: Inhalt unlesbar');
    }
  }

  // ---- laufende Messungen (4c-4)

  async messungen(): Promise<string[]> {
    return this.listeLesen(MESSUNG_LISTE, MESSUNGEN_MAX);
  }

  async messungSpeichern(m: Messung): Promise<void> {
    const mess = messungPruefen(m);
    const liste = await this.messungen();
    if (!liste.includes(mess.k) && liste.length >= MESSUNGEN_MAX) fehler('Tresor: zu viele laufende Messungen');
    await this.verschluesseln(MESSUNG_PREFIX, DOM_MESSUNG, mess.k, mess);
    if (!liste.includes(mess.k)) await this.ablage.schreiben(MESSUNG_LISTE, JSON.stringify([...liste, mess.k]), false);
  }

  /** Die laufende Messung zu K; null, wenn es keine gibt. Jeder andere Fehler wirft. */
  async messungLaden(K: string): Promise<Messung | null> {
    const o = await this.entschluesseln(MESSUNG_PREFIX, DOM_MESSUNG, K);
    if (o === null) return null;
    const m = messungPruefen(o);
    if (m.k !== K) fehler('Tresor: Messung zu anderem K');
    return m;
  }

  async messungLoeschen(K: string): Promise<void> {
    if (!HEX64.test(K)) fehler('K');
    await this.ablage.loeschen(MESSUNG_PREFIX + K);
    const liste = await this.messungen();
    if (liste.includes(K)) await this.ablage.schreiben(MESSUNG_LISTE, JSON.stringify(liste.filter((k) => k !== K)), false);
  }

  async speichern(f: Fall): Promise<void> {
    const fall = fallPruefen(f);
    const liste = await this.liste();
    if (!liste.includes(fall.k) && liste.length >= FAELLE_MAX) fehler('Tresor: zu viele offene Fälle');
    await this.verschluesseln(FALL_PREFIX, DOM_TRESOR, fall.k, fall);
    if (!liste.includes(fall.k)) await this.ablage.schreiben(LISTE, JSON.stringify([...liste, fall.k]), false);
  }

  /** Den Fall zu K lesen; null, wenn es keinen gibt. Jeder andere Fehler wirft. */
  async laden(K: string): Promise<Fall | null> {
    const o = await this.entschluesseln(FALL_PREFIX, DOM_TRESOR, K);
    if (o === null) return null;
    const f = fallPruefen(o);
    if (f.k !== K) fehler('Tresor: Fall zu anderem K');
    return f;
  }

  async loeschen(K: string): Promise<void> {
    if (!HEX64.test(K)) fehler('K');
    await this.ablage.loeschen(FALL_PREFIX + K);
    const liste = await this.liste();
    if (liste.includes(K)) await this.ablage.schreiben(LISTE, JSON.stringify(liste.filter((k) => k !== K)), false);
  }
}
