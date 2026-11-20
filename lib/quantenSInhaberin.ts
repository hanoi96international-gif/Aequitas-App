// Quantengeld S: die App als Inhaberin -- der Ablauf (R4b, Teil 2;
// aequitas forschung/quantengeld/DEZENTRAL.md 17). Die Rechnung steht in
// lib/quantenS.ts; hier: Schluessel und Zustand im Geraet, Abrufe beim Knoten
// und bei den Validatoren, Bindung und Wahl einreichen, Vorlage bauen.
//
// Wie das Werkzeug der Inhaberin im Knoten (quanten_s_rollen.go):
//   neu        Schluessel und Basen y aus dem Zufall des Geraets; heraus kommt
//              die Bestellung (oeffentlich) fuer den Ausgeber.
//   abholen    nur mit K: Stand von der Kette, jeder Abschnitt direkt vom
//              Validator (GET /api/quanten-w/validator/fuer-inhaberin), alles
//              geprueft (quantenS.annehmen), dann x im Geraet.
//   einloesen  Maske z ZUERST speichern, dann binden (d = y XOR z) und
//              waehlen (c = b XOR z), jeweils nur, wenn es noch nicht auf der
//              Kette steht; die Vorlage nur fuer die gewaehlte Stelle.
//
// Fail-closed: jede Abweichung wirft. Antworten sind in der Groesse begrenzt,
// jede Anfrage hat eine Frist, das Warten auf die Kette ist begrenzt. Der
// Schluessel verlaesst das Geraet nie und steht in keiner Meldung.
import * as SecureStore from 'expo-secure-store';
import { getRandomBytes } from 'expo-crypto';
import { ethers } from 'ethers';
import { API_BASE } from './config';
import {
  abschnitt,
  adresseVon,
  annehmen,
  binden,
  bindenNachricht,
  bitsZuHex,
  hexZuBits,
  N_MAX,
  V_MAX,
  pubVon,
  QuantenSFehler,
  unterschreiben,
  vorlageText,
  wahlNachricht,
  type Bestellung,
  type KettenStand,
  type PaketAbschnitt,
} from './quantenS';

const SCHLUESSEL = 'aequitas.quantenS.inhaberin.schluessel';
const ZUSTAND = 'aequitas.quantenS.inhaberin.zustand';
/** Abschnitt eines Validators: Blaetter fuer bis zu 16.384 Stellen (~1,1 MB). */
const ABSCHNITT_MAX = 4 * 1024 * 1024;
/** Stand eines Tokens: d und die Stichprobe einer Anmeldung, je bis 16.384. */
const STAND_MAX = 1024 * 1024;
const FRIST_MS = 30_000;
/** So lange wartet die App hoechstens, bis Bindung oder Wahl auf der Kette stehen. */
export const WARTEN_MAX_MS = 20 * 60_000;
const TAKT_MS = 5_000;

const K_FORM = /^[0-9a-f]{64}$/;
const ADRESSE = /^0x[0-9a-f]{40}$/;
const PUB = /^04[0-9a-f]{128}$/;
const N_KURVE = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');

function fehler(text: string): never {
  throw new QuantenSFehler(text);
}

export interface Stelle {
  adresse: string;
  schluessel: string;
}

export interface ValidatorAngabe {
  adresse: string;
  api: string;
}

/** Was die App zu ihrem Token aufbewahrt (ohne Schluessel; hex statt Bits: SecureStore <= 2048 Byte je Wert). */
export interface Zustand {
  n: number;
  v: number;
  y: string;
  stellen: [string, string];
  /** oeffentliche Schluessel der Stellen -- damit die Bestellung jederzeit wieder gezeigt werden kann. */
  stellenSchluessel: [string, string];
  k?: string;
  x?: string;
  z?: 0 | 1;
  validatoren?: string[];
}

export interface Speicher {
  lesen(key: string): Promise<string | null>;
  schreiben(key: string, wert: string, geheim: boolean): Promise<void>;
  loeschen(key: string): Promise<void>;
}

export interface Umgebung {
  fetchFn: typeof fetch;
  speicher: Speicher;
  zufall: (n: number) => Uint8Array;
  apiBasis: string;
  warten: (ms: number) => Promise<void>;
  jetzt: () => number;
}

export function standardUmgebung(): Umgebung {
  return {
    fetchFn: fetch,
    speicher: {
      lesen: (key) => {
        const bio = SecureStore.canUseBiometricAuthentication();
        return SecureStore.getItemAsync(key, key === SCHLUESSEL ? { requireAuthentication: bio } : undefined);
      },
      schreiben: (key, wert, geheim) => {
        const bio = SecureStore.canUseBiometricAuthentication();
        return SecureStore.setItemAsync(
          key,
          wert,
          geheim
            ? { requireAuthentication: bio, keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
            : { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
        );
      },
      loeschen: (key) => SecureStore.deleteItemAsync(key),
    },
    zufall: (n) => getRandomBytes(n),
    apiBasis: API_BASE,
    warten: (ms) => new Promise((r) => setTimeout(r, ms)),
    jetzt: () => Date.now(),
  };
}

// ------------------------------------------------------------ Netz

/** QuantenSAPIBasis: nur https (oder http an den eigenen Rechner), ohne Benutzer, Pfad, Abfrage. */
export function apiPruefen(roh: string): string {
  let u: URL;
  try {
    u = new URL(roh);
  } catch {
    fehler('API: keine Adresse');
  }
  const lokal = u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]');
  if ((u.protocol !== 'https:' && !lokal) || u.username || u.password || u.search || u.hash) fehler('API: nur https, ohne Benutzerangabe');
  return roh.replace(/\/+$/, '');
}

async function holeJson(u: Umgebung, url: string, max: number): Promise<{ status: number; json: unknown }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FRIST_MS);
  try {
    const r = await u.fetchFn(url, { headers: { Accept: 'application/json' }, signal: ctrl.signal, redirect: 'error' } as RequestInit);
    const text = await r.text();
    if (text.length > max) fehler('Antwort zu gross');
    if (r.status === 404) return { status: 404, json: null };
    if (!r.ok) fehler(`HTTP ${r.status}`);
    return { status: r.status, json: JSON.parse(text) };
  } catch (e) {
    if (e instanceof QuantenSFehler) throw e;
    fehler('Netz oder Antwort nicht lesbar');
  } finally {
    clearTimeout(t);
  }
}

async function stand(u: Umgebung, K: string): Promise<KettenStand | null> {
  const { status, json } = await holeJson(u, `${u.apiBasis}/quanten-w/note?k=${K}`, STAND_MAX);
  if (status === 404) return null;
  if (!json || typeof json !== 'object' || Array.isArray(json) || (json as KettenStand).k !== K) fehler('Stand: fremdes K');
  return json as KettenStand;
}

const ABSCHNITT_FELDER = 'bis,blaetter,buendel_hash,buendel_sig_hash,fuer_inhaberin,sig,teile,von,x,zaehlung';

async function abschnittHolen(u: Umgebung, api: string, K: string): Promise<PaketAbschnitt> {
  const { status, json } = await holeJson(u, `${apiPruefen(api)}/quanten-w/validator/fuer-inhaberin?k=${K}`, ABSCHNITT_MAX);
  if (status === 404 || !json || typeof json !== 'object' || Array.isArray(json)) fehler('Abschnitt: keine Antwort');
  // Streng wie im Knoten (DisallowUnknownFields): genau diese Felder.
  if (Object.keys(json as object).sort().join(',') !== ABSCHNITT_FELDER) fehler('Abschnitt: Felder');
  return json as PaketAbschnitt;
}

async function einreichen(u: Umgebung, art: 's_binden' | 's_waehlen', wallet: string, quantenW: Record<string, string>): Promise<void> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FRIST_MS);
  try {
    const r = await u.fetchFn(`${u.apiBasis}/quanten-w/${art}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ wallet, zeit: 0, quanten_w: quantenW }),
      signal: ctrl.signal,
      redirect: 'error',
    } as RequestInit);
    if (!r.ok) fehler(`${art === 's_binden' ? 'Bindung' : 'Wahl'}: HTTP ${r.status}`);
  } catch (e) {
    if (e instanceof QuantenSFehler) throw e;
    fehler('Netz');
  } finally {
    clearTimeout(t);
  }
}

async function wartenAuf(u: Umgebung, K: string, fertig: (st: KettenStand | null) => boolean, was: string): Promise<KettenStand> {
  const ende = u.jetzt() + WARTEN_MAX_MS;
  for (;;) {
    const st = await stand(u, K);
    if (fertig(st)) return st as KettenStand;
    if (u.jetzt() >= ende) fehler(`${was}: nicht in ${WARTEN_MAX_MS / 60_000} Minuten auf der Kette`);
    await u.warten(TAKT_MS);
  }
}

// ------------------------------------------------------------ Speicher

async function zustandLesen(u: Umgebung): Promise<Zustand | null> {
  const roh = await u.speicher.lesen(ZUSTAND);
  if (!roh) return null;
  const z = JSON.parse(roh) as Zustand;
  if (!Number.isInteger(z.n) || !Number.isInteger(z.v) || typeof z.y !== 'string' || !Array.isArray(z.stellen) || !Array.isArray(z.stellenSchluessel)) {
    fehler('Zustand im Geraet unlesbar');
  }
  return z;
}

async function zustandSchreiben(u: Umgebung, z: Zustand): Promise<void> {
  const roh = JSON.stringify(z);
  if (roh.length > 2048) fehler('Zustand zu gross fuer den Speicher');
  await u.speicher.schreiben(ZUSTAND, roh, false);
}

async function schluesselLesen(u: Umgebung): Promise<string> {
  const s = await u.speicher.lesen(SCHLUESSEL);
  if (!s || !/^[0-9a-f]{64}$/.test(s)) fehler('kein Schluessel der Inhaberin im Geraet');
  return s;
}

/** quantenSSchluesselPruefen: oeffentlicher Schluessel (unkomprimiert) gehoert zur Adresse. */
export function stelleSchluesselPruefen(s: Stelle): Stelle {
  const adresse = s.adresse.trim().toLowerCase();
  const schluessel = s.schluessel.trim().toLowerCase().replace(/^0x/, '');
  if (!ADRESSE.test(adresse) || !PUB.test(schluessel)) fehler('Annahmestelle: Form');
  let ab: string;
  try {
    ab = ethers.computeAddress('0x' + schluessel).toLowerCase();
  } catch {
    fehler('Annahmestelle: kein Punkt der Kurve');
  }
  if (ab !== adresse) fehler('Annahmestelle: Schluessel gehoert nicht zur Adresse');
  return { adresse, schluessel };
}

// ------------------------------------------------------------ neu, abholen, einloesen

/**
 * neu: Schluessel und Basen aus dem Zufall des Geraets; speichert beides und
 * gibt die Bestellung zurueck. Ein angenommener, noch nicht eingeloester Token
 * wird nicht ueberschrieben (er waere sonst verloren).
 */
export async function neu(u: Umgebung, n: number, v: number, stellen: [Stelle, Stelle]): Promise<Bestellung> {
  if (!Number.isInteger(n) || !Number.isInteger(v) || n < 2 || n > N_MAX || v < 1 || v > V_MAX || !abschnitt(n, v, v)) fehler('n oder v');
  const st = [stelleSchluesselPruefen(stellen[0]), stelleSchluesselPruefen(stellen[1])] as [Stelle, Stelle];
  if (st[0].adresse === st[1].adresse) fehler('Annahmestellen: zweimal dieselbe');
  // Nie eine bestehende Bestellung ueberschreiben: hat der Ausgeber schon auf
  // sie ausgegeben, waere dieser Token sonst verloren (Schluessel und y weg).
  const alt = await zustandLesen(u);
  if (alt?.k) fehler('es gibt schon einen angenommenen Token -- erst einloesen');
  if (alt) fehler('es gibt schon eine Bestellung -- erst abholen oder vergessen');
  // Passt der Zustand samt x nach dem Abholen in den Speicher (SecureStore:
  // 2048 Byte je Wert)? Vorher pruefen -- dann erst Zufall ziehen und schreiben.
  const hexLaenge = Math.ceil(n / 4);
  const groesst: Zustand = {
    n, v, y: '0'.repeat(hexLaenge), stellen: [st[0].adresse, st[1].adresse], stellenSchluessel: [st[0].schluessel, st[1].schluessel],
    k: '0'.repeat(64), x: '0'.repeat(hexLaenge), z: 1, validatoren: Array(v).fill('0x' + '0'.repeat(40)),
  };
  if (JSON.stringify(groesst).length > 2048) fehler('n zu gross fuer den Speicher dieses Geraets');
  let schl = '';
  for (let i = 0; i < 8 && !schl; i++) {
    const k = BigInt('0x' + ethers.hexlify(u.zufall(32)).slice(2));
    if (k > 0n && k < N_KURVE) schl = k.toString(16).padStart(64, '0');
  }
  if (!schl) fehler('Zufall');
  const inhaberin = adresseVon(schl);
  if (st.some((s) => s.adresse === inhaberin)) fehler('Annahmestelle ist die Inhaberin');
  const roh = u.zufall(n);
  if (roh.length !== n) fehler('Zufall');
  let y = '';
  for (let i = 0; i < n; i++) y += String(roh[i] & 1);
  const basen: string[] = [];
  for (let x = 1; x <= v; x++) {
    const a = abschnitt(n, v, x)!;
    basen.push(y.slice(a.von, a.bis));
  }
  await u.speicher.schreiben(SCHLUESSEL, schl, true);
  const zustand: Zustand = { n, v, y: bitsZuHex(y), stellen: [st[0].adresse, st[1].adresse], stellenSchluessel: [st[0].schluessel, st[1].schluessel] };
  await u.speicher.schreiben(SCHLUESSEL, schl, true);
  await zustandSchreiben(u, zustand);
  return bestellungAus(zustand, schl);
}

function bestellungAus(z: Zustand, schl: string): Bestellung {
  const y = hexZuBits(z.y, z.n);
  const basen: string[] = [];
  for (let x = 1; x <= z.v; x++) {
    const a = abschnitt(z.n, z.v, x)!;
    basen.push(y.slice(a.von, a.bis));
  }
  return {
    n: z.n,
    basen,
    inhaberin: adresseVon(schl),
    inhaberin_schluessel: pubVon(schl),
    stellen: [
      { adresse: z.stellen[0], schluessel: z.stellenSchluessel[0] },
      { adresse: z.stellen[1], schluessel: z.stellenSchluessel[1] },
    ],
  };
}

/** Die Bestellung noch einmal (z. B. nach einem Neustart), solange kein Token abgeholt ist. */
export async function bestellungAnzeigen(u: Umgebung): Promise<Bestellung | null> {
  const z = await zustandLesen(u);
  if (!z || z.k) return null;
  return bestellungAus(z, await schluesselLesen(u));
}

/** abholen: nur mit K -- Stand von der Kette, jeder Abschnitt direkt vom Validator, dann annehmen. */
export async function abholen(u: Umgebung, Kroh: string, validatoren: ValidatorAngabe[]): Promise<{ k: string; n: number }> {
  const K = Kroh.trim().toLowerCase();
  if (!K_FORM.test(K)) fehler('K: 64 Hex-Zeichen');
  if (validatoren.length < 1 || validatoren.length > V_MAX) fehler('Validatoren');
  const adressen = validatoren.map((v) => v.adresse.trim().toLowerCase());
  if (adressen.some((a) => !ADRESSE.test(a)) || new Set(adressen).size !== adressen.length) fehler('Validatoren: Adresse');
  validatoren.forEach((v) => apiPruefen(v.api));
  const z = await zustandLesen(u);
  if (!z) fehler('erst eine Bestellung anlegen');
  if (z.k && z.k !== K) fehler('es gibt schon einen anderen angenommenen Token');
  const schl = await schluesselLesen(u);
  const st = await stand(u, K);
  const abschnitte: PaketAbschnitt[] = [];
  for (const v of validatoren) abschnitte.push(await abschnittHolen(u, v.api, K));
  const best = bestellungAus(z, schl);
  if (z.k === K && st && st.gebunden === true) fehler('der Token ist schon gebunden -- weiter mit Einloesen');
  const erg = annehmen({ schluessel: schl, bestellung: best, validatoren: adressen, K, stand: st, abschnitte });
  await zustandSchreiben(u, { ...z, k: K, x: bitsZuHex(erg.x), validatoren: adressen });
  return { k: K, n: z.n };
}

export interface Vorlage {
  k: string;
  b: number;
  x: string;
  vorlage: string;
}

/**
 * einloesen: bindet und waehlt (je nur, wenn es noch nicht auf der Kette
 * steht) und unterschreibt die Vorlage fuer Stelle b. Ist die andere Stelle
 * gewaehlt, unterschreibt die App NICHT (Doppelvorlage = Fehlversuch).
 */
export async function einloesen(u: Umgebung, b: 0 | 1, fortschritt: (schritt: 'binden' | 'waehlen' | 'vorlage') => void = () => {}): Promise<Vorlage> {
  if (b !== 0 && b !== 1) fehler('Stelle 0 oder 1');
  const z = await zustandLesen(u);
  if (!z?.k || !z.x) fehler('noch kein Token abgeholt');
  const schl = await schluesselLesen(u);
  const inhaberin = adresseVon(schl);
  const K = z.k;
  const y = hexZuBits(z.y, z.n);
  const x = hexZuBits(z.x, z.n);
  let st = await stand(u, K);
  const stellen = st?.stellen as unknown;
  if (!st) fehler('der Token steht nicht (mehr) auf der Kette -- eingeloest oder tot');
  if (st.inhaber !== inhaberin || !Array.isArray(stellen) || stellen[b] !== z.stellen[b]) fehler('der Token auf der Kette passt nicht zum Geraet');
  if (st.tot === true) fehler('der Token ist tot');
  if (st.anmeldung != null) fehler('eine Annahmestelle hat schon angemeldet -- erst ihr Urteil abwarten');
  let zustand = z;
  if (st.gebunden !== true) {
    if (zustand.z === undefined) {
      zustand = { ...zustand, z: (u.zufall(1)[0] & 1) as 0 | 1 };
      await zustandSchreiben(u, zustand); // ZUERST speichern: ohne z waere der Token nicht vorlegbar
    }
    fortschritt('binden');
    const d = binden(y, zustand.z!);
    await einreichen(u, 's_binden', inhaberin, { k: K, d, wallet_sig: unterschreiben(schl, bindenNachricht(inhaberin, K, d)) });
    st = await wartenAuf(u, K, (s) => s != null && s.gebunden === true, 'Bindung');
  }
  if (zustand.z === undefined) fehler('BEFUND: der Token ist gebunden, aber im Geraet fehlt die Maske');
  const mz = zustand.z!;
  if (st.d !== binden(y, mz)) fehler('BEFUND: die Bindung auf der Kette passt nicht zum Geraet');
  if (st.gewaehlt !== true) {
    fortschritt('waehlen');
    const c = String(b ^ mz);
    await einreichen(u, 's_waehlen', inhaberin, { k: K, c, wallet_sig: unterschreiben(schl, wahlNachricht(inhaberin, K, c)) });
    st = await wartenAuf(u, K, (s) => s != null && s.gewaehlt === true, 'Wahl');
  }
  if (st.c !== (b ^ mz)) fehler(`gewaehlt ist die andere Stelle; eine Vorlage fuer Stelle ${b} waere eine Doppelvorlage -- nicht unterschrieben`);
  fortschritt('vorlage');
  return { k: K, b, x, vorlage: unterschreiben(schl, vorlageText(K, b, x)) };
}

/** Der Zustand fuer die Anzeige (ohne Schluessel). */
export async function zustandAnzeigen(u: Umgebung): Promise<{ n: number; v: number; k?: string; stellen: [string, string]; gebunden: boolean } | null> {
  const z = await zustandLesen(u);
  if (!z) return null;
  return { n: z.n, v: z.v, k: z.k, stellen: z.stellen, gebunden: z.z !== undefined };
}

/** vergessen: nur, wenn kein Token angenommen ist oder er nicht mehr auf der Kette steht. */
export async function vergessen(u: Umgebung): Promise<void> {
  const z = await zustandLesen(u);
  if (z?.k && (await stand(u, z.k)) != null) fehler('der Token steht noch auf der Kette -- erst einloesen');
  await u.speicher.loeschen(SCHLUESSEL);
  await u.speicher.loeschen(ZUSTAND);
}

// ------------------------------------------------------------ Eingaben der Seite

/** "0xadresse=04schluessel" (eine Annahmestelle), so wie die Stelle sie zeigt. */
export function stelleLesen(text: string): Stelle {
  const [a, s, rest] = text.trim().split('=');
  if (!a || !s || rest !== undefined) fehler('Annahmestelle: Form adresse=schluessel');
  return stelleSchluesselPruefen({ adresse: a, schluessel: s });
}

/** "0xadresse=https://api, ..." (Komma oder neue Zeile), in der Reihenfolge der Abschnitte. */
export function validatorenLesen(text: string): ValidatorAngabe[] {
  const teile = text.split(/[\n,]+/).map((t) => t.trim()).filter(Boolean);
  if (teile.length < 1 || teile.length > V_MAX) fehler('Validatoren: mindestens einer');
  return teile.map((t) => {
    const i = t.indexOf('=');
    const adresse = t.slice(0, i).trim().toLowerCase();
    const api = t.slice(i + 1).trim();
    if (i < 1 || !ADRESSE.test(adresse)) fehler('Validatoren: Form adresse=api');
    return { adresse, api: apiPruefen(api) };
  });
}
