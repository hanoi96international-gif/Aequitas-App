// Quantengeld Weg B (B4b-4c-1d): der Ablauf der App als Präparatorin, Teil 1 --
// Aufträge abholen und beantworten.
//
// Eine Runde (`runde`):
//   1. Eigener Schlüssel = Schlüssel der Menschen-Wallet (sein pub steht im
//      Register; kein Ausweichen auf einen anderen Schlüssel).
//   2. Briefe abholen (lib/briefkasten.ts), höchstens SEITEN_MAX Seiten, ab der
//      gespeicherten Nummer `nach`.
//   3. Jeden Brief als Hülle öffnen (lib/quantenSHuelle.ts) und zusammensetzen;
//      die Liste erledigter Hüllen übersteht einen Neustart. Ein kaputter oder
//      fremder Brief zählt als erledigt (er wird nie besser) und blockiert nichts.
//   4. Je fertigem Auftrag: lesen, Absender der Hülle = Ausgeber des Auftrags,
//      prüfen gegen die Bestellung (lib/quantenSPraepAuftrag.ts), gibt es den Fall
//      schon, dieselbe Antwort noch einmal (derselbe Seed, derselbe Auftrag),
//      sonst neuer Seed, messen (Messer), Antwort bauen, Fall in den Tresor,
//      Antwort als Hülle an den Ausgeber (an seinen Schlüssel aus der Unterschrift
//      seiner Hülle). Die Bündel an die anderen Präparatorinnen stecken in der
//      Antwort; der Ausgeber reicht sie mit der Bestätigung weiter (wie Weg A).
//   5. Quittieren nur bis zum letzten Brief, VOR dem alles erledigt ist: ein Teil
//      einer noch unvollständigen Nachricht wird nie gelöscht.
//
// Die Runde ist der EINZIGE Leser des Kastens einer Wallet: Präparatorin und
// Ausgeber (B4b-4c-2c) teilen sich die Menschen-Wallet und damit den Kasten.
// Darum verteilt sie nach Art -- `antwort` an den Ausgeber
// (lib/quantenSAusgeberRunde.ts, antwortAufnehmen sichert vor dem Quittieren),
// `bestaetigung` mit genau {k, x, sig} an den Ausgeber (bestaetigungAufnehmen),
// jede andere `bestaetigung` (die Anfrage) sowie `auftrag` und `oeffnung` an
// die Präparatorin. Ein zweiter Leser
// würde Briefe des anderen quittieren.
//
// Zufall: alles Geheime eines Falls folgt aus seinem Seed (drbg), in fester
// Reihenfolge: erst u und t (messbitsZiehen), dann die Antwort. So lässt sich die
// Antwort später für Bestätigung und Öffnung genau wiederherstellen.

import { ethers } from 'ethers';
import { abholen, ablegen, quittieren, type Brief } from './briefkasten';
import { QuantenSFehler, abschnitt, adresseVon, unterschreiben, unterschriftVon } from './quantenS';
import { Zusammensetzer, einpacken, oeffnen, type Nachricht } from './quantenSHuelle';
import type { Speicher } from './quantenSInhaberin';
import { antwortAufAuftrag, auftragLesen, auftragNachricht, auftragPruefen, basenOeffnen, bestellungenLesen, messbitsZiehen, type AbschnittAuftrag, type GepruefterAuftrag } from './quantenSPraepAuftrag';
import { REGISTER_MAX, registerLesen } from './quantenSPraeparator';
import { antwortAufnehmen, bestaetigungAufnehmen, istBestaetigung, paketAbschnittAus } from './quantenSAusgeberRunde';
import { bestaetigen, oeffnungFuerStelle, sBestaetigungNachricht, type AbschnittTresor, type Antwort, type BestaetigenAnfrage, type Zufall } from './quantenSPraeparieren';
import { PraepTresor, drbg, type Fall } from './quantenSPraepTresor';

const NACH = 'aequitas.quantenS.praep.nach';
const GESEHEN = 'aequitas.quantenS.praep.gesehen';
/** Höchstens so viele Seiten Briefe je Runde (je 32 Briefe). */
export const SEITEN_MAX = 8;
const FRIST_MS = 20_000;

function fehler(text: string): never {
  throw new QuantenSFehler(text);
}

/** Die Messung eines Abschnitts: aus u, t (Präparatorin) und y (Inhaberin) das Ergebnis x. */
export interface Messer {
  messen(u: number[], t: number[], y: number[]): Promise<number[]>;
}

export interface WalletSchluessel {
  entsperren(): Promise<{ privateKey: string }>;
}

export interface PraepUmgebung {
  fetchFn: typeof fetch;
  apiBasis: string;
  /** SecureStore (geheim) */
  geheim: Speicher;
  /** AsyncStorage (Chiffrate des Tresors, Zähler, erledigte Hüllen) */
  ablage: Speicher;
  /** Zufall des Geräts */
  zufall: Zufall;
  /** Millisekunden */
  jetzt: () => number;
  /** Ablage in Dateien für große Daten (die App als Ausgeber: Antworten der Gelosten; lib/dateiAblage.ts). */
  dateien?: Speicher;
}

export interface RundenBericht {
  briefe: number;
  abgewiesen: { id: number; grund: string }[];
  beantwortet: string[];
  bestaetigt: string[];
  geoeffnet: string[];
  wiederholt: string[];
  abgelehnt: { k: string; grund: string }[];
  /** Antworten an die App als Ausgeber (B4b-4c-2c), gesichert; `fertig` = damit alle da */
  antworten: { k: string; x: number; fertig: boolean }[];
  /** Bestätigungen an die App als Ausgeber (B4b-4c-2d), gesichert; `fertig` = damit alle da */
  bestaetigungen: { k: string; x: number; fertig: boolean }[];
  /** unfertige Nachrichten (ihre Briefe bleiben im Kasten) */
  offen: number;
  quittiertBis: number;
}

/** Bestellungen aus dem Register des Knotens, streng gelesen. */
export async function bestellungenHolen(u: PraepUmgebung) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FRIST_MS);
  try {
    const r = await u.fetchFn(`${u.apiBasis}/quanten-w/praeparatoren`, { headers: { Accept: 'application/json' }, signal: ctrl.signal, redirect: 'error' } as RequestInit);
    if (!r.ok) fehler(`Register: HTTP ${r.status}`);
    const text = await r.text();
    if (text.length > REGISTER_MAX) fehler('Register: zu groß');
    const roh = JSON.parse(text) as unknown;
    const reg = registerLesen(roh);
    const best = bestellungenLesen(roh);
    if (!reg || !best) fehler('Register: Form');
    if (!reg.aktiv) fehler('Weg B ist im Knoten nicht aktiv');
    return best;
  } catch (e) {
    if (e instanceof QuantenSFehler) throw e;
    return fehler('Register: Netz');
  } finally {
    clearTimeout(t);
  }
}

async function zahlLesen(s: Speicher, key: string): Promise<number> {
  const roh = await s.lesen(key);
  if (roh === null) return 0;
  const n = Number(roh);
  if (!/^\d{1,15}$/.test(roh) || !Number.isSafeInteger(n)) fehler(`${key} beschädigt`);
  return n;
}

async function gesehenLesen(s: Speicher): Promise<[string, number][]> {
  const roh = await s.lesen(GESEHEN);
  if (roh === null) return [];
  try {
    return JSON.parse(roh) as [string, number][];
  } catch {
    return fehler('Liste erledigter Hüllen beschädigt');
  }
}

/** Antwort und Werte zu einem Fall (wieder)herstellen: derselbe Seed, derselbe Auftrag -> dasselbe Ergebnis. */
export function antwortAusFall(schluessel: string, f: Fall, g: GepruefterAuftrag): { antwort: Antwort; tresor: AbschnittTresor } {
  const z = drbg(f.seed);
  const n = g.bis - g.von;
  const { u, t } = messbitsZiehen(n, z);
  if (u.join('') !== f.u || t.join('') !== f.t) fehler('Tresor: u oder t passt nicht zum Seed');
  return antwortAufAuftrag(schluessel, f.auftrag, g, { y: g.y.split('').map(Number), u, t, x: f.x.split('').map(Number) }, z);
}

/** Der geprüfte Auftrag eines Falls ohne Netz: Abschnitt und Basen aus dem gespeicherten Auftrag. */
export function gepruefterAuftragAusFall(schluessel: string, f: Fall): GepruefterAuftrag {
  const q = f.auftrag;
  const a = abschnitt(q.n, q.validatoren.length, q.x);
  if (!a || !q.basen_verschluesselt) fehler('Tresor: Auftrag');
  const y = basenOeffnen(schluessel, q.basen_verschluesselt, q.n, q.validatoren, q.x, q.inhaberin);
  return { von: a.von, bis: a.bis, y, auftragHash: ethers.sha256(ethers.toUtf8Bytes(auftragNachricht(q))).slice(2) };
}

const ANFRAGE_FELDER = ['art', 'blaetter', 'buendel', 'buendel_sig', 'k', 'n', 'praeger', 'praeger_sig', 'proben', 't', 'tol', 'validatoren', 'wurzel', 'x', 'zeit'];

/** Die Bestätigungs-Anfrage des Ausgebers aus der Nutzlast einer Hülle, streng (genau diese Felder). */
export function bestaetigenAnfrageLesen(nutzlast: Uint8Array): BestaetigenAnfrage {
  let o: unknown;
  try {
    o = JSON.parse(ethers.toUtf8String(nutzlast));
  } catch {
    return fehler('Bestätigungs-Anfrage: kein JSON');
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) fehler('Bestätigungs-Anfrage: Form');
  const a = o as Record<string, unknown>;
  if (Object.keys(a).sort().join(',') !== ANFRAGE_FELDER.join(',')) fehler('Bestätigungs-Anfrage: Felder');
  for (const k of ['art', 'k', 'praeger', 'praeger_sig', 'wurzel']) if (typeof a[k] !== 'string') fehler(`Bestätigungs-Anfrage: ${k}`);
  for (const k of ['n', 't', 'tol', 'x', 'zeit']) if (typeof a[k] !== 'number' || !Number.isSafeInteger(a[k])) fehler(`Bestätigungs-Anfrage: ${k}`);
  for (const k of ['blaetter', 'buendel', 'buendel_sig', 'proben', 'validatoren']) {
    if (!Array.isArray(a[k]) || !(a[k] as unknown[]).every((x) => typeof x === 'string')) fehler(`Bestätigungs-Anfrage: ${k}`);
  }
  return a as unknown as BestaetigenAnfrage;
}

/**
 * Eine Bestätigungs-Anfrage beantworten. Zu einem K bestätigt die
 * Präparatorin nur EINE Ausgabe: ergibt eine spätere Anfrage eine andere
 * Unterschrift (andere Wurzel oder Stichproben), wird sie abgewiesen.
 */
export async function bestaetigungBeantworten(u: PraepUmgebung, schluessel: string, tresor: PraepTresor, m: Nachricht): Promise<{ k: string; art: 'neu' | 'wiederholt' }> {
  const q = bestaetigenAnfrageLesen(m.nutzlast);
  const f = await tresor.laden(q.k);
  if (!f) fehler('kein Auftrag zu diesem K');
  // Die Hülle muss vom Ausgeber des gespeicherten Auftrags sein; dass die Anfrage
  // denselben Ausgeber nennt, prüft bestaetigen (praeger gegen den Auftrag).
  if (f.auftrag.praeger !== m.von) fehler('Hülle nicht vom Ausgeber des Auftrags');
  const g = gepruefterAuftragAusFall(schluessel, f);
  const { tresor: t } = antwortAusFall(schluessel, f, g);
  const a = f.auftrag;
  const b = bestaetigen(q, {
    schluessel, k: a.k, n: a.n, t: a.t, tol: a.tol, x: a.x, zeit: a.zeit, praeger: a.praeger, validatoren: a.validatoren,
    werte: t.werte, koeff: t.koeff, probeV2: a.probe_art === 2,
  });
  if (f.bestaetigung && f.bestaetigung.sig !== b.sig) fehler('schon eine andere Ausgabe zu diesem K bestätigt');
  const art = f.bestaetigung ? 'wiederholt' : 'neu';
  if (!f.bestaetigung) {
    await tresor.speichern({ ...f, stand: 'bestaetigt', bestaetigung: { sig: b.sig, anteile: b.anteile, oeffnungen: b.oeffnungen ?? {} } });
  }
  const jetzt = Math.floor(u.jetzt() / 1000);
  const ich = adresseVon(schluessel);
  const signer = { signMessage: async (n: string) => unterschreiben(schluessel, n) };
  const inhalt = ethers.toUtf8Bytes(JSON.stringify({ k: a.k, x: a.x, sig: b.sig }));
  for (const brief of einpacken(schluessel, { adresse: m.von, pub: m.pub }, 'bestaetigung', inhalt, jetzt, u.zufall)) {
    await ablegen(ich, m.von, brief, signer, jetzt, u.fetchFn, u.apiBasis);
  }
  return { k: a.k, art };
}

/**
 * Einen fertigen Auftrag beantworten. Gibt 'neu' oder 'wiederholt'; wirft mit
 * lesbarem Grund, wenn der Auftrag abgelehnt wird.
 */
export async function auftragBeantworten(
  u: PraepUmgebung,
  schluessel: string,
  tresor: PraepTresor,
  m: Nachricht,
  messer: Messer,
  bestellungen: () => Promise<ReturnType<typeof bestellungenLesen> & object>,
): Promise<{ k: string; art: 'neu' | 'wiederholt' }> {
  const q: AbschnittAuftrag = auftragLesen(m.nutzlast);
  if (m.von !== q.praeger) fehler('Hülle nicht vom Ausgeber des Auftrags');
  const jetzt = Math.floor(u.jetzt() / 1000);
  const g = auftragPruefen(q, schluessel, await bestellungen(), jetzt);
  const alt = await tresor.laden(q.k);
  let antwort: Antwort;
  let art: 'neu' | 'wiederholt';
  if (alt) {
    if (JSON.stringify(alt.auftrag) !== JSON.stringify(q)) fehler('schon ein anderer Auftrag für dieses K');
    antwort = antwortAusFall(schluessel, alt, g).antwort;
    art = 'wiederholt';
  } else {
    const seed = tresor.neuerSeed();
    const z = drbg(seed);
    const n = g.bis - g.von;
    const { u: ub, t: tb } = messbitsZiehen(n, z);
    const y = g.y.split('').map(Number);
    const x = await messer.messen(ub, tb, y);
    if (x.length !== n || !x.every((b) => b === 0 || b === 1)) fehler('Messung: Form');
    antwort = antwortAufAuftrag(schluessel, q, g, { y, u: ub, t: tb, x }, z).antwort;
    // Erst sichern, dann senden: geht das Senden schief, ist die Antwort wiederherstellbar.
    await tresor.speichern({ k: q.k, auftrag: q, seed, u: ub.join(''), t: tb.join(''), x: x.join(''), stand: 'gemessen', zeit: jetzt });
    art = 'neu';
  }
  const ich = adresseVon(schluessel);
  const signer = { signMessage: async (n: string) => unterschreiben(schluessel, n) };
  for (const brief of einpacken(schluessel, { adresse: m.von, pub: m.pub }, 'antwort', ethers.toUtf8Bytes(JSON.stringify(antwort)), jetzt, u.zufall)) {
    await ablegen(ich, m.von, brief, signer, jetzt, u.fetchFn, u.apiBasis);
  }
  const f = await tresor.laden(q.k);
  if (f && f.stand === 'gemessen') await tresor.speichern({ ...f, stand: 'beantwortet' });
  return { k: q.k, art };
}

// ------------------------------------------------------------ Öffnung (B4b-4c-1g)

const STAND_MAX = 1024 * 1024;

async function jsonHolen(u: PraepUmgebung, url: string, max: number, fehlt = 'Knoten: HTTP 404'): Promise<Record<string, unknown>> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FRIST_MS);
  try {
    const r = await u.fetchFn(url, { headers: { Accept: 'application/json' }, signal: ctrl.signal, redirect: 'error' } as RequestInit);
    if (r.status === 404) fehler(fehlt);
    if (!r.ok) fehler(`Knoten: HTTP ${r.status}`);
    const text = await r.text();
    if (text.length > max) fehler('Knoten: Antwort zu groß');
    const o = JSON.parse(text) as unknown;
    if (!o || typeof o !== 'object' || Array.isArray(o)) fehler('Knoten: Form');
    return o as Record<string, unknown>;
  } catch (e) {
    if (e instanceof QuantenSFehler) throw e;
    return fehler('Knoten: Netz');
  } finally {
    clearTimeout(t);
  }
}

interface TokenSicht {
  d: string;
  c: number;
  wurzel: string;
  proben: [string, string];
}

/** Bindung, Wahl, Wurzel und Proben eines Tokens bei einem Knoten; wirft, solange nicht gebunden und gewählt. */
async function tokenSicht(u: PraepUmgebung, api: string, K: string): Promise<TokenSicht> {
  const o = await jsonHolen(u, `${api}/quanten-w/note?k=${K}`, STAND_MAX, 'erst, wenn Bindung und Wahl auf der Kette stehen (Token noch nicht auf der Kette)');
  if (o.k !== K || o.art !== 's') fehler('Token: fremdes K oder keine S-Ausgabe');
  if (o.probe_art !== 2) fehler('Token: nicht mit Stichprobe v2 ausgegeben');
  if (o.gebunden !== true || o.gewaehlt !== true) fehler('erst, wenn Bindung und Wahl auf der Kette stehen');
  const proben = o.proben;
  if (typeof o.d !== 'string' || !/^[01]+$/.test(o.d) || (o.c !== 0 && o.c !== 1) || typeof o.wurzel !== 'string' || !/^[0-9a-f]{64}$/.test(o.wurzel) ||
    !Array.isArray(proben) || proben.length !== 2 || !proben.every((p) => typeof p === 'string' && /^[0-9a-f]{64}$/.test(p))) {
    fehler('Token: Form');
  }
  return { d: o.d, c: o.c, wurzel: o.wurzel, proben: [proben[0] as string, proben[1] as string] };
}

/** Höhe und finalisierte Höhe eines Knotens. */
async function hoehen(u: PraepUmgebung, api: string): Promise<{ hoehe: number; final: number }> {
  const st = await jsonHolen(u, `${api}/status`, STAND_MAX);
  const ge = await jsonHolen(u, `${api}/health/combined`, STAND_MAX);
  const sd = ge.sync_diagnostics as Record<string, unknown> | undefined;
  const hoehe = st.height;
  const final = sd?.finalized_height;
  if (typeof hoehe !== 'number' || !Number.isSafeInteger(hoehe) || hoehe < 0 || typeof final !== 'number' || !Number.isSafeInteger(final) || final < 0) {
    fehler('Knoten: Höhen');
  }
  return { hoehe, final };
}

/**
 * Die Öffnung für Annahmestelle b herausgeben -- wie oeffnungFuerStelle des
 * Dienstes, aber das Handy hat keine eigene Kette und fragt die Knoten:
 *   - die Anfrage kommt von Stelle b selbst (Absender der Hülle), die Antwort
 *     geht nur an sie;
 *   - der Token auf der Kette ist GENAU die Ausgabe, die diese Präparatorin
 *     bestätigt hat (eigene Unterschrift gegen Wurzel und Proben der Kette);
 *   - Bindung und Wahl stehen, und zwar final: beim ersten Sehen wird die Höhe
 *     gemerkt (Sichtung), herausgegeben wird erst, wenn die finalisierte Höhe
 *     sie erreicht hat (Befund 5i: nichts vor der Finalität);
 *   - alle befragten Knoten sind sich einig (mehr Knoten = weniger Vertrauen).
 * Vor der Finalität wirft sie; die Stelle fragt später noch einmal.
 */
export async function oeffnungBeantworten(u: PraepUmgebung, schluessel: string, tresor: PraepTresor, m: Nachricht, knoten: string[]): Promise<{ k: string; art: 'neu' | 'wiederholt' }> {
  let o: unknown;
  try {
    o = JSON.parse(ethers.toUtf8String(m.nutzlast));
  } catch {
    return fehler('Öffnungs-Anfrage: kein JSON');
  }
  if (!o || typeof o !== 'object' || Array.isArray(o) || Object.keys(o).sort().join(',') !== 'b,k') fehler('Öffnungs-Anfrage: Felder');
  const q = o as { k: unknown; b: unknown };
  if (typeof q.k !== 'string' || !/^[0-9a-f]{64}$/.test(q.k) || (q.b !== 0 && q.b !== 1)) fehler('Öffnungs-Anfrage: k, b');
  const K = q.k;
  const b = q.b as 0 | 1;
  const f = await tresor.laden(K);
  // Eine gespeicherte Bestätigung gibt es nur mit Stand bestaetigt/geoeffnet (der Tresor prüft das).
  if (!f || !f.bestaetigung) fehler('keine bestätigte Ausgabe zu diesem K');
  const a = f.auftrag;
  if (m.von !== a.stellen[b]) fehler('Anfrage nicht von dieser Annahmestelle');
  if (knoten.length < 1 || knoten.length > 8) fehler('Knoten: 1 bis 8');

  const sichten = [];
  for (const api of knoten) sichten.push(await tokenSicht(u, api, K));
  const s0 = sichten[0];
  if (!sichten.every((s) => s.d === s0.d && s.c === s0.c && s.wurzel === s0.wurzel && s.proben.join() === s0.proben.join())) fehler('Knoten uneins über den Token');
  const ich = adresseVon(schluessel);
  if (!unterschriftVon(sBestaetigungNachricht(K, s0.wurzel, a.n, a.t, a.validatoren, a.x, s0.proben, a.zeit, a.tol), f.bestaetigung.sig, ich)) {
    fehler('Token auf der Kette ist nicht die bestätigte Ausgabe');
  }
  const schl = ethers.sha256(ethers.toUtf8Bytes(`${s0.d}|${s0.c}`)).slice(2);
  const hs = [];
  for (const api of knoten) hs.push(await hoehen(u, api));
  if (!f.sichtung || f.sichtung.schl !== schl) {
    await tresor.speichern({ ...f, sichtung: { schl, hoehe: Math.max(...hs.map((h) => h.hoehe)) } });
    fehler('erst, wenn Bindung und Wahl final sind (gesehen, bitte später noch einmal)');
  }
  if (Math.min(...hs.map((h) => h.final)) < f.sichtung.hoehe) fehler('erst, wenn Bindung und Wahl final sind');

  const g = gepruefterAuftragAusFall(schluessel, f);
  const { antwort, tresor: t } = antwortAusFall(schluessel, f, g);
  const stelle = { adresse: a.stellen[b], pub: a.stellen_schluessel[b] };
  const oeffnung = oeffnungFuerStelle(stelle, K, b, a.x, g.von, g.bis, t.werte, t.salze[b], u.zufall);
  const pakete: Record<string, string> = {};
  for (const [xv, p] of Object.entries(f.bestaetigung.oeffnungen)) pakete[xv] = p[b];
  const art = f.stand === 'geoeffnet' ? 'wiederholt' : 'neu';
  if (f.stand !== 'geoeffnet') await tresor.speichern({ ...f, stand: 'geoeffnet' });
  const jetzt = Math.floor(u.jetzt() / 1000);
  const signer = { signMessage: async (n: string) => unterschreiben(schluessel, n) };
  // Dazu der eigene, unterschriebene Abschnitt (B4b-4c-2f-2): die Annahmestelle in
  // Weg B hat keinen Dienst, der ihn nennt; sie prüft ihn selbst gegen die Wurzel der Kette.
  const inhalt = ethers.toUtf8Bytes(JSON.stringify({ k: K, b, x: a.x, oeffnung, pakete, abschnitt: paketAbschnittAus(antwort) }));
  for (const brief of einpacken(schluessel, { adresse: m.von, pub: m.pub }, 'oeffnung', inhalt, jetzt, u.zufall)) {
    await ablegen(ich, m.von, brief, signer, jetzt, u.fetchFn, u.apiBasis);
  }
  return { k: K, art };
}

/** Eine Runde: abholen, öffnen, Aufträge beantworten, sicher quittieren. */
export async function runde(u: PraepUmgebung, wallet: WalletSchluessel, messer: Messer, knoten: string[] = [u.apiBasis]): Promise<RundenBericht> {
  const schluessel = (await wallet.entsperren()).privateKey.replace(/^0x/, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(schluessel)) fehler('Wallet: Schlüssel unlesbar');
  const ich = adresseVon(schluessel);
  const signer = { signMessage: async (n: string) => unterschreiben(schluessel, n) };
  const tresor = new PraepTresor(u.geheim, u.ablage, u.zufall);
  const zs = new Zusammensetzer(await gesehenLesen(u.ablage));
  const jetzt = () => Math.floor(u.jetzt() / 1000);
  zs.aufraeumen(jetzt());
  const bericht: RundenBericht = { briefe: 0, abgewiesen: [], beantwortet: [], bestaetigt: [], geoeffnet: [], wiederholt: [], abgelehnt: [], antworten: [], bestaetigungen: [], offen: 0, quittiertBis: 0 };

  // 2. + 3. Abholen und öffnen. Je Brief: zu welcher Nachricht (von|id) er gehört.
  const nachStart = await zahlLesen(u.ablage, NACH);
  let nach = nachStart;
  const briefe: { b: Brief; schl: string | null }[] = [];
  const fertig: Nachricht[] = [];
  const fertigeSchl = new Set<string>();
  for (let s = 0; s < SEITEN_MAX; s++) {
    const r = await abholen(ich, nach, signer, jetzt(), u.fetchFn, u.apiBasis);
    for (const b of r.briefe) {
      bericht.briefe++;
      nach = b.id;
      try {
        const t = oeffnen(schluessel, b.inhalt, jetzt());
        const schl = `${t.von}|${t.id}`;
        const m = zs.hinzu(t, jetzt());
        // Erst nach dem Zusammensetzen eintragen: wirft hinzu, gilt der Brief als erledigt (unten).
        briefe.push({ b, schl });
        if (m) {
          fertig.push(m);
          fertigeSchl.add(schl);
        }
      } catch (e) {
        briefe.push({ b, schl: null });
        bericht.abgewiesen.push({ id: b.id, grund: (e as Error).message.slice(0, 200) });
      }
    }
    if (!r.mehr) break;
  }
  // Erledigte sofort sichern (vor dem Quittieren und vor dem Messen).
  await u.ablage.schreiben(GESEHEN, JSON.stringify(zs.gesehenListe()), false);
  bericht.offen = zs.stand().offen;

  // 4. Aufträge beantworten; andere Arten kommen in späteren Schritten. Wie
  // viele es sein können, begrenzt das Register: nur Bestellungen, in deren Los
  // diese Präparatorin steht (je Mensch eine Bestellung). Scheitert eine Antwort
  // (Netz), wiederholt der Ausgeber seinen Auftrag -- der Fall liegt dann schon
  // im Tresor, und es kommt dieselbe Antwort.
  let bestCache: ReturnType<typeof bestellungenLesen> & object | null = null;
  const bestellungen = async () => (bestCache ??= await bestellungenHolen(u));
  for (const m of fertig) {
    if (m.art === 'antwort') {
      // An die App als Ausgeber: gesichert wird vor dem Quittieren (antwortAufnehmen schreibt zuerst).
      try {
        const r = await antwortAufnehmen(u, m);
        if (r.art === 'neu') bericht.antworten.push({ k: r.k, x: r.x, fertig: r.ergebnis !== undefined });
        else bericht.wiederholt.push(r.k);
      } catch (e) {
        bericht.abgelehnt.push({ k: '?', grund: (e as Error).message.slice(0, 200) });
      }
      continue;
    }
    if (m.art === 'oeffnung') {
      try {
        const r = await oeffnungBeantworten(u, schluessel, tresor, m, knoten);
        if (r.art === 'neu') bericht.geoeffnet.push(r.k);
        else bericht.wiederholt.push(r.k);
      } catch (e) {
        bericht.abgelehnt.push({ k: '?', grund: (e as Error).message.slice(0, 200) });
      }
      continue;
    }
    if (m.art === 'bestaetigung' && istBestaetigung(m.nutzlast)) {
      // Art `bestaetigung` in beide Richtungen: genau {k, x, sig} ist die Antwort einer Gelosten an den Ausgeber.
      try {
        const r = await bestaetigungAufnehmen(u, m);
        if (r.art === 'neu') bericht.bestaetigungen.push({ k: r.k, x: r.x, fertig: r.fertig });
        else bericht.wiederholt.push(r.k);
      } catch (e) {
        bericht.abgelehnt.push({ k: '?', grund: (e as Error).message.slice(0, 200) });
      }
      continue;
    }
    if (m.art === 'bestaetigung') {
      try {
        const r = await bestaetigungBeantworten(u, schluessel, tresor, m);
        if (r.art === 'neu') bericht.bestaetigt.push(r.k);
        else bericht.wiederholt.push(r.k);
      } catch (e) {
        bericht.abgelehnt.push({ k: '?', grund: (e as Error).message.slice(0, 200) });
      }
      continue;
    }
    if (m.art !== 'auftrag') continue;
    try {
      const r = await auftragBeantworten(u, schluessel, tresor, m, messer, bestellungen);
      if (r.art === 'neu') bericht.beantwortet.push(r.k);
      else bericht.wiederholt.push(r.k);
    } catch (e) {
      let k = '?';
      try {
        k = auftragLesen(m.nutzlast).k;
      } catch {
        // unlesbar
      }
      bericht.abgelehnt.push({ k, grund: (e as Error).message.slice(0, 200) });
    }
  }

  // 5. Quittieren bis zum letzten Brief, vor dem alles erledigt ist: erledigt
  // ist ein Brief, der kaputt war (schl null) oder dessen Nachricht fertig ist.
  let bis = nachStart;
  for (const { b, schl } of briefe) {
    if (schl !== null && !fertigeSchl.has(schl)) break;
    bis = b.id;
  }
  if (bis > nachStart) {
    await quittieren(ich, bis, signer, jetzt(), u.fetchFn, u.apiBasis);
    await u.ablage.schreiben(NACH, String(bis), false);
  }
  bericht.quittiertBis = bis;
  return bericht;
}
