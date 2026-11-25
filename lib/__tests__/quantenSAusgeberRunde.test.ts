// Ausgeber in Weg B (B4b-4c-2c, lib/quantenSAusgeberRunde.ts): Aufträge an die
// Gelosten als Hüllen, Antworten aus dem eigenen Kasten prüfen und sammeln,
// Wurzel und Proben. Ende zu Ende gegen einen nachgebauten Knoten: die
// Inhaberin verschlüsselt (neuWegB), der Ausgeber beauftragt, vier
// Präparatorinnen antworten mit ihrem eigenen Ablauf (runde), der Ausgeber
// sammelt in seiner Runde. Dazu die Angriffe: fremde, vertauschte, veränderte
// und zweite Antworten, ein Knoten mit falschem Register, Reste einer alten Runde.
jest.mock('expo-secure-store', () => ({}));
jest.mock('expo-crypto', () => ({ getRandomBytes: () => new Uint8Array(0) }));
jest.mock('../config', () => ({ API_BASE: 'https://knoten.test/api' }));

import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { abschnitt, adresseVon, antwortNachricht, basenHash, fuerInhaberinOeffnen, hashListe, merkleWurzel, probeHashV2, pubVon, unterschreiben, type Bestellung } from '../quantenS';
import { ANTWORT, BESTAETIGUNG, RAHMEN, bestellPfand, losRunde, vergessen, zustandLesen, zustandSchreiben, type AusgeberZustand } from '../quantenSAusgeber';
import { ANTWORTEN_MAX, antwortenStand, auftraegeSenden, auftragBauen, beauftragen, ausgeben, bestaetigenAnfrageBauen, bestaetigungenAnfordern, bestaetigungenStand, sAusgabeNachricht, type Rahmen } from '../quantenSAusgeberRunde';
import { Zusammensetzer, einpacken, oeffnen, type Nachricht } from '../quantenSHuelle';
import { neuWegB, type Speicher, type Umgebung } from '../quantenSInhaberin';
import { runde, type Messer, type PraepUmgebung } from '../quantenSPraepAblauf';
import { AUFTRAG_ALT, auftragLesen, auftragNachricht } from '../quantenSPraepAuftrag';
import { drbg } from '../quantenSPraepTresor';
import { sBestaetigungNachricht } from '../quantenSPraeparieren';

const API = 'https://knoten.test/api';
const K = 'c2'.repeat(32);
const JETZT = 1_800_000_000;
const BESTELLT = JETZT - 900;
const N = 1200;
const V = 4;
const T = 1;
const TOL = 2;
const AUSGEBER = '99'.repeat(32);
const PRAEP = [0x61, 0x62, 0x63, 0x64].map((b) => b.toString(16).repeat(32));
const LOS = PRAEP.map(adresseVon);
const FREMD = '77'.repeat(32);
const INHABERIN_STELLEN: [{ adresse: string; schluessel: string }, { adresse: string; schluessel: string }] = [
  { adresse: adresseVon('31'.repeat(32)), schluessel: pubVon('31'.repeat(32)) },
  { adresse: adresseVon('32'.repeat(32)), schluessel: pubVon('32'.repeat(32)) },
];

function speicher(): Speicher & { daten: Map<string, string> } {
  const daten = new Map<string, string>();
  return { daten, lesen: async (k) => daten.get(k) ?? null, schreiben: async (k, v) => void daten.set(k, v), loeschen: async (k) => void daten.delete(k) };
}

interface Opt {
  register?: (eintraege: Record<string, unknown>[]) => void;
  bestellung?: (b: Record<string, unknown>) => void;
  /** Antwort des Knotens auf s_ausgeben (Vorgabe: annehmen und den Token zeigen). */
  ausgeben?: (koerper: Record<string, any>) => { status: number; zeigen: boolean };
}

/** Ein Knoten im Speicher: Register mit der Bestellung und Briefkasten (Unterschriften prüft briefkasten.test.ts). */
function knoten(opt: Opt = {}) {
  let id = 0;
  const kasten: { id: number; von: string; an: string; inhalt: string }[] = [];
  const kette: { token: Record<string, unknown> | null; eingereicht: Record<string, any>[] } = { token: null, eingereicht: [] };
  const f = (async (url: string, init?: RequestInit) => {
    const ok = (o: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(o) }) as unknown as Response;
    if (url === `${API}/quanten-w/note?k=${K}`) {
      return kette.token ? ok(kette.token) : ({ ok: false, status: 404, text: async () => '{"error":"unbekannt"}' } as unknown as Response);
    }
    if (url === `${API}/quanten-w/s_ausgeben`) {
      const koerper = JSON.parse(init!.body as string);
      kette.eingereicht.push(koerper);
      const a = opt.ausgeben?.(koerper) ?? { status: 200, zeigen: true };
      if (a.zeigen) {
        const q = koerper.quanten_w;
        kette.token = { k: q.k, art: 's', n: q.n, t: q.t, v: q.validatoren.length, tol: q.tol, inhaber: q.inhaber, stellen: q.annahme, gebunden: false, gewaehlt: false, fehl: 0, wert_mikro: 1, probe_art: q.probe_art, wurzel: q.wurzel, proben: q.proben };
      }
      return { ok: a.status === 200, status: a.status, text: async () => (a.status === 200 ? '{"ok":true}' : '{"error":"quanten_w_bestaetigung: abgewiesen"}') } as unknown as Response;
    }
    if (url === `${API}/quanten-w/praeparatoren`) {
      const eintraege: Record<string, unknown>[] = [...PRAEP, FREMD].map((s) => ({ konto: adresseVon(s), pub: pubVon(s), gemeldet: 1, im_los_ab: 2 }));
      opt.register?.(eintraege);
      const b: Record<string, unknown> = {
        k: K, ausgeber: adresseVon(AUSGEBER), v: V, t: T, zeit: BESTELLT, frist: BESTELLT + 2 * 86400, runde: losRunde(BESTELLT),
        deckung: 1_000_000, pfand: bestellPfand(1_000_000), im_abbild: 5, los: LOS,
      };
      opt.bestellung?.(b);
      return ok({ aktiv: true, vorlauf: 86400, nachlauf: 1, hoechstens: 256, praeparatoren: eintraege, bestellungen: [b] });
    }
    const k = JSON.parse(init!.body as string);
    if (url.endsWith('/briefkasten/ablegen')) {
      kasten.push({ id: ++id, von: k.von, an: k.an, inhalt: k.inhalt });
      return ok({ ok: true, id });
    }
    if (url.endsWith('/briefkasten/abholen')) {
      const alle = kasten.filter((x) => x.an === k.an && x.id > k.nach);
      const b = alle.slice(0, 32);
      return ok({ briefe: b.map(({ id: i, von, inhalt }) => ({ id: i, von, inhalt, zeit: JETZT })), mehr: alle.length > b.length });
    }
    if (url.endsWith('/briefkasten/quittieren')) {
      const vor = kasten.length;
      for (let i = kasten.length - 1; i >= 0; i--) if (kasten[i].an === k.an && kasten[i].id <= k.bis) kasten.splice(i, 1);
      return ok({ ok: true, geloescht: vor - kasten.length });
    }
    throw new Error('unbekannt ' + url);
  }) as unknown as typeof fetch;
  const einwerfen = (von: string, an: string, inhalt: string) => void kasten.push({ id: ++id, von, an, inhalt });
  return { f, kasten, einwerfen, kette };
}

function umgebung(f: typeof fetch, saat: string, jetzt = JETZT): PraepUmgebung & { geheim: ReturnType<typeof speicher>; ablage: ReturnType<typeof speicher> } {
  return { fetchFn: f, apiBasis: API, geheim: speicher(), ablage: speicher(), zufall: drbg(saat.repeat(32)), jetzt: () => jetzt * 1000 };
}

const wallet = (s: string) => ({ entsperren: async () => ({ privateKey: '0x' + s }) });
const ideal: Messer = { messen: async (u, t, y) => u.map((ui, i) => (ui === y[i] ? t[i] : (i * 7) % 2)) };
/** Jede passende Stelle falsch: die ehrliche Vorlage bestünde nicht. */
const kaputt: Messer = { messen: async (u, t, y) => u.map((ui, i) => (ui === y[i] ? 1 - t[i] : 0)) };

const GELOST: AusgeberZustand = {
  k: K, ausgeber: adresseVon(AUSGEBER), v: V, t: T, deckung: 1_000_000, zeit: BESTELLT, stand: 'gelost', buchzeit: BESTELLT,
  runde: losRunde(BESTELLT), frist: BESTELLT + 2 * 86400, los: LOS,
};

/** Die Inhaberin verschlüsselt y an die Gelosten (neuWegB). */
async function inhaberinBestellt(f: typeof fetch) {
  const sp = speicher();
  const ab = speicher();
  const ui: Umgebung = { fetchFn: f, speicher: sp, ablage: ab, zufall: drbg('1a'.repeat(32)), apiBasis: API, warten: async () => {}, jetzt: () => JETZT * 1000 };
  const best = await neuWegB(ui, N, K, INHABERIN_STELLEN);
  return { best, sp };
}

async function welt(opt: Opt = {}) {
  const k = knoten(opt);
  const ua = umgebung(k.f, 'a0');
  await zustandSchreiben(ua, GELOST);
  const { best, sp } = await inhaberinBestellt(knoten().f);
  return { k, ua, best, inhaberinSpeicher: sp };
}

/** Die Gelosten x (1-basiert) beantworten ihre Aufträge mit ihrem eigenen Ablauf. */
async function praepAntworten(k: ReturnType<typeof knoten>, xs: number[], messer = ideal, ups: Record<number, PraepUmgebung> = {}) {
  const out: Record<number, Awaited<ReturnType<typeof runde>>> = {};
  for (const x of xs) {
    ups[x] ??= umgebung(k.f, (0x10 + x).toString(16));
    out[x] = await runde(ups[x], wallet(PRAEP[x - 1]), messer);
  }
  return out;
}

/** Die Nachricht in einem Brief an den Ausgeber (zum Fälschen). */
function antwortenImKasten(k: ReturnType<typeof knoten>): Nachricht[] {
  const zs = new Zusammensetzer();
  const out: Nachricht[] = [];
  for (const b of k.kasten.filter((x) => x.an === adresseVon(AUSGEBER))) {
    const m = zs.hinzu(oeffnen(AUSGEBER, b.inhalt, JETZT), JETZT);
    if (m) out.push(m);
  }
  return out;
}

/** Eine Antwort als Hülle von `absender` an den Ausgeber einwerfen. */
function einwerfen(k: ReturnType<typeof knoten>, absender: string, antwort: unknown, saat = 'e1') {
  for (const brief of einpacken(absender, { adresse: adresseVon(AUSGEBER), pub: pubVon(AUSGEBER) }, 'antwort', ethers.toUtf8Bytes(JSON.stringify(antwort)), JETZT, drbg(saat.repeat(32)))) {
    k.einwerfen(adresseVon(absender), adresseVon(AUSGEBER), brief);
  }
}

/** Antwort neu unterschreiben (mit dem Schlüssel `schl`). */
function neuUnterschreiben(a: Record<string, any>, schl: string) {
  const m = antwortNachricht(a.k, a.x, a.von, a.bis, hashListe(a.blaetter), a.fuer_inhaberin, hashListe(a.buendel), hashListe(a.buendel_sig), a.teile, a.zaehlung, a.basen_hash);
  return { ...a, validator: adresseVon(schl), sig: unterschreiben(schl, m) };
}

describe('B4b-4c-2c: Ausgeber beauftragt und sammelt', () => {
  test('Gutfall Ende zu Ende: vier Aufträge, vier Antworten, Wurzel und Proben; die Inhaberin liest x', async () => {
    const w = await welt();
    const r = await beauftragen(w.ua, wallet(AUSGEBER), w.best, TOL);
    expect(r.gesendet).toEqual([1, 2, 3, 4]);
    expect((await zustandLesen(w.ua))!.stand).toBe('beauftragt');
    // Jede Geloste bekommt genau einen Auftrag, und ihr eigener Ablauf nimmt ihn an.
    for (const a of LOS) expect(w.k.kasten.filter((b) => b.an === a).length).toBeGreaterThan(0);
    const p = await praepAntworten(w.k, [1, 2, 3, 4]);
    for (let x = 1; x <= V; x++) {
      expect(p[x].abgelehnt).toEqual([]);
      expect(p[x].beantwortet).toEqual([K]);
    }
    // Der Ausgeber sammelt in seiner Runde (derselbe Kasten wie als Präparatorin).
    const ra = await runde(w.ua, wallet(AUSGEBER), ideal);
    expect(ra.abgelehnt).toEqual([]);
    expect(ra.antworten.map((a) => a.x).sort()).toEqual([1, 2, 3, 4]);
    expect(ra.antworten.filter((a) => a.fertig)).toHaveLength(1);
    expect(w.k.kasten.filter((b) => b.an === adresseVon(AUSGEBER))).toHaveLength(0);
    const z = (await zustandLesen(w.ua))!;
    expect(z.stand).toBe('beantwortet');
    // Wurzel und Proben unabhängig nachgerechnet.
    const antw = [1, 2, 3, 4].map((x) => JSON.parse(w.ua.ablage.daten.get(ANTWORT + x)!));
    expect(z.wurzel).toBe(merkleWurzel(antw.flatMap((a) => a.blaetter)));
    expect(z.proben).toEqual([probeHashV2(K, 0, antw.map((a) => a.teile[0])), probeHashV2(K, 1, antw.map((a) => a.teile[1]))]);
    expect(antw.map((a) => a.basen_hash)).toEqual(w.best.basen_verschluesselt!.map(basenHash));
    // Was die Inhaberin bekommt, kann nur sie öffnen: x passt zu ihrem Abschnitt.
    const ischl = w.inhaberinSpeicher.daten.get('aequitas.quantenS.inhaberin.schluessel')!;
    for (const a of antw) {
      const ab = abschnitt(N, V, a.x)!;
      expect(fuerInhaberinOeffnen(ischl, a.fuer_inhaberin, K, ab.von, ab.bis)).toHaveLength(ab.bis - ab.von);
    }
    expect(await antwortenStand(w.ua)).toEqual({ fehlen: [], wurzel: z.wurzel, proben: z.proben });
    // Danach wird nichts mehr gesendet.
    await expect(auftraegeSenden(w.ua, wallet(AUSGEBER))).rejects.toThrow('alle Antworten sind da');
  });

  test('Wiederholung: derselbe Auftrag Byte für Byte, nur an die Fehlenden; die Präparatorin antwortet dasselbe', async () => {
    const w = await welt();
    await beauftragen(w.ua, wallet(AUSGEBER), w.best, TOL);
    const z = (await zustandLesen(w.ua))!;
    const r: Rahmen = JSON.parse(w.ua.ablage.daten.get(RAHMEN)!);
    expect(JSON.stringify(auftragBauen(AUSGEBER, z, r, 2))).toBe(JSON.stringify(auftragBauen(AUSGEBER, z, r, 2)));
    const ups: Record<number, PraepUmgebung> = {};
    await praepAntworten(w.k, [1, 2], ideal, ups);
    await runde(w.ua, wallet(AUSGEBER), ideal);
    expect((await antwortenStand(w.ua)).fehlen).toEqual([3, 4]);
    // Präparatorin 1 hat ihre Antwort, bekommt nichts; 3 und 4 bekommen den Auftrag noch einmal.
    expect((await auftraegeSenden(w.ua, wallet(AUSGEBER))).gesendet).toEqual([3, 4]);
    expect(w.k.kasten.filter((b) => b.an === LOS[0])).toHaveLength(0);
    // Präparatorin 2 antwortet (ein Auftrag kam doppelt an) noch einmal dasselbe: wiederholt, kein Fehler.
    const erste = w.ua.ablage.daten.get(ANTWORT + 2)!;
    const r2 = await praepAntworten(w.k, [3, 4]);
    // 3 und 4 haben den Auftrag zweimal im Kasten: einmal gemessen, einmal aus dem Tresor wiederholt.
    expect(r2[3].beantwortet).toEqual([K]);
    expect(r2[3].wiederholt).toEqual([K]);
    // Eine zweite, gleiche Antwort von 2 (Netz wiederholt) zählt als wiederholt.
    einwerfen(w.k, PRAEP[1], JSON.parse(erste));
    const ra = await runde(w.ua, wallet(AUSGEBER), ideal);
    expect(ra.abgelehnt).toEqual([]);
    // Je eine doppelte Antwort von 2, 3 und 4: gleich, also nur wiederholt.
    expect(ra.wiederholt).toEqual([K, K, K]);
    expect(ra.antworten.map((a) => a.x).sort()).toEqual([3, 4]);
    expect((await zustandLesen(w.ua))!.stand).toBe('beantwortet');
  });

  test('Missbrauch: fremde, vertauschte, veränderte und zweite Antworten werden abgewiesen', async () => {
    const w = await welt();
    await beauftragen(w.ua, wallet(AUSGEBER), w.best, TOL);
    await praepAntworten(w.k, [1, 2]);
    // Die echten Antworten lesen (ohne den Kasten zu leeren), dann leeren.
    const echt = antwortenImKasten(w.k).map((m) => JSON.parse(ethers.toUtf8String(m.nutzlast)));
    const a2 = echt.find((a) => a.x === 2)!;
    const a1 = echt.find((a) => a.x === 1)!;
    w.k.kasten.splice(0, w.k.kasten.length);
    const faelle: [string, string, Record<string, unknown>, string][] = [
      ['ein Fremder unterschreibt als 2', FREMD, neuUnterschreiben(a2, FREMD), 'nicht von der Gelosten 2'],
      ['Geloste 1 gibt sich als 2 aus', PRAEP[0], neuUnterschreiben(a2, PRAEP[0]), 'nicht von der Gelosten 2'],
      ['echte Antwort 2, Hülle von 1', PRAEP[0], a2, 'nicht von der Gelosten 2'],
      ['Blatt verändert', PRAEP[1], { ...a2, blaetter: [a2.blaetter[1], ...a2.blaetter.slice(1)] }, 'nicht von der Gelosten unterschrieben'],
      ['anderes K', PRAEP[1], neuUnterschreiben({ ...a2, k: 'd0'.repeat(32) }, PRAEP[1]), 'K oder Abschnitt'],
      ['anderer Abschnitt', PRAEP[1], neuUnterschreiben({ ...a2, von: a2.von + 1 }, PRAEP[1]), 'K oder Abschnitt'],
      ['andere Basen', PRAEP[1], neuUnterschreiben({ ...a2, basen_hash: basenHash(w.best.basen_verschluesselt![0]) }, PRAEP[1]), 'nicht mit den Basen'],
      ['ohne Basen-Hash', PRAEP[1], neuUnterschreiben({ ...a2, basen_hash: undefined }, PRAEP[1]), 'nicht mit den Basen'],
      ['Zählung unmöglich', PRAEP[1], neuUnterschreiben({ ...a2, zaehlung: [[3, 4], a2.zaehlung[1]] }, PRAEP[1]), 'unmöglich'],
      ['ohne Stichprobe v2', PRAEP[1], neuUnterschreiben({ ...a2, teile: undefined, zaehlung: undefined }, PRAEP[1]), 'Stichprobe v2 fehlt'],
      ['eigenes Bündel nicht leer', PRAEP[1], neuUnterschreiben({ ...a2, buendel: a2.buendel.map((b: string, i: number) => (i === 1 ? a2.buendel[0] : b)) }, PRAEP[1]), 'Bündel'],
      ['Bündel fehlt', PRAEP[1], neuUnterschreiben({ ...a2, buendel: a2.buendel.slice(0, 3), buendel_sig: a2.buendel_sig.slice(0, 3) }, PRAEP[1]), 'Bündel'],
      ['fremdes Feld', PRAEP[1], { ...a2, mehr: 1 }, 'Feld mehr'],
    ];
    for (const [i, [, absender, antwort, grund]] of faelle.entries()) {
      // Jede Hülle mit eigener Kennung (sonst weist schon der Zusammensetzer die Wiederholung ab).
      einwerfen(w.k, absender, JSON.parse(JSON.stringify(antwort)), (0x20 + i).toString(16));
      const ra = await runde(w.ua, wallet(AUSGEBER), ideal);
      expect(ra.antworten).toEqual([]);
      expect(ra.abgelehnt.map((a) => a.grund).join()).toContain(grund);
    }
    expect(w.ua.ablage.daten.has(ANTWORT + 2)).toBe(false);
    // Die echte Antwort 2 wird angenommen; eine zweite, andere (neu gemessen, neu unterschrieben) nicht.
    einwerfen(w.k, PRAEP[1], a2);
    expect((await runde(w.ua, wallet(AUSGEBER), ideal)).antworten).toEqual([{ k: K, x: 2, fertig: false }]);
    const anders = neuUnterschreiben({ ...a2, zaehlung: [a2.zaehlung[0], [a2.zaehlung[1][0], a2.zaehlung[1][1] + (a2.zaehlung[1][1] < a2.zaehlung[1][0] ? 1 : -1)]] }, PRAEP[1]);
    einwerfen(w.k, PRAEP[1], anders, 'f2');
    const ra = await runde(w.ua, wallet(AUSGEBER), ideal);
    expect(ra.abgelehnt.map((a) => a.grund).join()).toContain('schon eine andere Antwort');
    expect(JSON.parse(w.ua.ablage.daten.get(ANTWORT + 2)!)).toEqual(a2);
    // Antwort 1 gilt weiter.
    einwerfen(w.k, PRAEP[0], a1, 'f3');
    expect((await runde(w.ua, wallet(AUSGEBER), ideal)).antworten).toEqual([{ k: K, x: 1, fertig: false }]);
  });

  test('Missbrauch: ohne eigene Bestellung nimmt die Runde keine Antwort an', async () => {
    const w = await welt();
    await beauftragen(w.ua, wallet(AUSGEBER), w.best, TOL);
    await praepAntworten(w.k, [1]);
    const fremd = umgebung(w.k.f, 'b0'); // anderes Gerät mit derselben Wallet, ohne Bestellung
    const ra = await runde(fremd, wallet(AUSGEBER), ideal);
    expect(ra.antworten).toEqual([]);
    expect(ra.abgelehnt.map((a) => a.grund)).toEqual(['keine Bestellung']);
  });

  test('ehrliche Vorlage bestünde nicht: Abbruch vor der Kette, Stand bleibt beauftragt', async () => {
    const w = await welt();
    await beauftragen(w.ua, wallet(AUSGEBER), w.best, TOL);
    await praepAntworten(w.k, [1, 2, 3, 4], kaputt);
    const ra = await runde(w.ua, wallet(AUSGEBER), ideal);
    expect(ra.abgelehnt.map((a) => a.grund).join()).toContain('bestünde bei Toleranz 2 % nicht');
    expect((await zustandLesen(w.ua))!.stand).toBe('beauftragt');
  });

  test('Missbrauch: der Knoten setzt für eine Geloste einen fremden Schlüssel ein -- nichts gesendet', async () => {
    const w = await welt({ register: (e) => void (e[1].pub = pubVon(FREMD)) });
    await expect(beauftragen(w.ua, wallet(AUSGEBER), w.best, TOL)).rejects.toThrow('Register: Form');
    expect(w.k.kasten).toHaveLength(0);
    expect(w.ua.ablage.daten.has(RAHMEN)).toBe(false);
    expect((await zustandLesen(w.ua))!.stand).toBe('gelost');
  });

  const faelle: [string, Opt, (b: Bestellung) => Bestellung, number, string][] = [
    ['Los im Register anders', { bestellung: (b) => void (b.los = [LOS[1], LOS[0], LOS[2], LOS[3]]) }, (b) => b, TOL, 'Los passt nicht'],
    ['Bestellung fehlt im Register', { bestellung: (b) => void (b.k = 'd0'.repeat(32)) }, (b) => b, TOL, 'nicht (mehr) im Register'],
    ['Geloste fehlt im Register', { register: (e) => void e.splice(2, 1) }, (b) => b, TOL, 'nicht (eindeutig) im Register'],
    ['Inhaberin ist der Ausgeber', {}, (b) => ({ ...b, inhaberin: adresseVon(AUSGEBER), inhaberin_schluessel: pubVon(AUSGEBER) }), TOL, 'Ausgeber selbst'],
    ['Schlüssel der Inhaberin fremd', {}, (b) => ({ ...b, inhaberin_schluessel: pubVon(FREMD) }), TOL, 'gehoert nicht zur Adresse'],
    ['Stelle ist die Inhaberin', {}, (b) => ({ ...b, stellen: [{ adresse: b.inhaberin, schluessel: b.inhaberin_schluessel }, b.stellen[1]] }), TOL, 'Annahmestelle 0'],
    ['zweimal dieselbe Stelle', {}, (b) => ({ ...b, stellen: [b.stellen[0], b.stellen[0]] }), TOL, 'Annahmestelle 1'],
    ['Basen im Klartext', {}, (b) => ({ ...b, basen: ['0'], basen_verschluesselt: undefined }), TOL, 'nur verschlüsselt'],
    ['Basen zusätzlich im Klartext', {}, (b) => ({ ...b, basen: ['0'] }), TOL, 'nur verschlüsselt'],
    ['ein Abschnitt zu wenig', {}, (b) => ({ ...b, basen_verschluesselt: b.basen_verschluesselt!.slice(0, 3) }), TOL, '4 Abschnitte verlangt'],
    ['Chiffrat kein Hex', {}, (b) => ({ ...b, basen_verschluesselt: ['zz', ...b.basen_verschluesselt!.slice(1)] }), TOL, 'Abschnitt 1: Form'],
    ['Toleranz unbekannt', {}, (b) => b, 7, 'Toleranz unbekannt'],
    ['n zu klein für k_note', {}, (b) => ({ ...b, n: 1100 }), TOL, 'Prüfgröße'],
  ];
  test.each(faelle)('abgewiesen vor dem Senden: %s', async (_, opt, aendern, tol, grund) => {
    const w = await welt(opt);
    await expect(beauftragen(w.ua, wallet(AUSGEBER), aendern(w.best), tol)).rejects.toThrow(grund);
    expect(w.k.kasten).toHaveLength(0);
    expect(w.ua.ablage.daten.has(RAHMEN)).toBe(false);
  });

  test('nur die Wallet des Ausgebers, nur gelost, nur einmal, nur im Zeitfenster', async () => {
    const w = await welt();
    await expect(beauftragen(w.ua, wallet(FREMD), w.best, TOL)).rejects.toThrow('nicht die des Ausgebers');
    await expect(auftraegeSenden(w.ua, wallet(AUSGEBER))).rejects.toThrow('noch nicht beauftragt');
    await beauftragen(w.ua, wallet(AUSGEBER), w.best, TOL);
    await expect(beauftragen(w.ua, wallet(AUSGEBER), w.best, TOL)).rejects.toThrow('schon beauftragt');
    await expect(auftraegeSenden(w.ua, wallet(FREMD))).rejects.toThrow('nicht die des Ausgebers');
    const spaet = { ...w.ua, jetzt: () => (JETZT + AUFTRAG_ALT) * 1000 };
    await expect(auftraegeSenden(spaet, wallet(AUSGEBER))).rejects.toThrow('zu alt');
    const verfallen = { ...w.ua, jetzt: () => (GELOST.frist! + 1) * 1000 };
    await expect(auftraegeSenden(verfallen, wallet(AUSGEBER))).rejects.toThrow('verfallen');
    // Ungelost: kein Auftrag.
    const u2 = umgebung(knoten().f, 'c0');
    await zustandSchreiben(u2, { ...GELOST, stand: 'bestellt', los: undefined });
    await expect(beauftragen(u2, wallet(AUSGEBER), w.best, TOL)).rejects.toThrow('noch nicht gelost');
  });

  test('der Auftrag ist genau der, den die Präparatorin prüft (Nachricht, Felder, Basen ihres Abschnitts)', async () => {
    const w = await welt();
    await beauftragen(w.ua, wallet(AUSGEBER), w.best, TOL);
    const zs = new Zusammensetzer();
    let m: Nachricht | null = null;
    for (const b of w.k.kasten.filter((x) => x.an === LOS[2])) m = zs.hinzu(oeffnen(PRAEP[2], b.inhalt, JETZT), JETZT) ?? m;
    expect(m!.art).toBe('auftrag');
    expect(m!.von).toBe(adresseVon(AUSGEBER));
    const q = auftragLesen(m!.nutzlast);
    expect(q).toMatchObject({ k: K, n: N, t: T, tol: TOL, x: 3, validatoren: LOS, basen: '', probe_art: 2, zeit: JETZT, praeger: adresseVon(AUSGEBER) });
    expect(q.basen_verschluesselt).toBe(w.best.basen_verschluesselt![2]);
    expect(ethers.verifyMessage(auftragNachricht(q), q.praeger_sig).toLowerCase()).toBe(adresseVon(AUSGEBER));
  });

  test('Reste einer früheren Runde zählen nie: beauftragen und vergessen räumen auf', async () => {
    const w = await welt();
    w.ua.ablage.daten.set(ANTWORT + 3, '{"alt":1}');
    await beauftragen(w.ua, wallet(AUSGEBER), w.best, TOL);
    expect(w.ua.ablage.daten.has(ANTWORT + 3)).toBe(false);
    expect((await antwortenStand(w.ua)).fehlen).toEqual([1, 2, 3, 4]);
    // Vergessen erst nach der Frist, dann alles weg.
    await expect(vergessen(w.ua)).rejects.toThrow('gilt noch');
    await praepAntworten(w.k, [1]);
    await runde(w.ua, wallet(AUSGEBER), ideal);
    const nach = { ...w.ua, jetzt: () => (GELOST.frist! + 1) * 1000 };
    await vergessen(nach);
    expect([...w.ua.ablage.daten.keys()].filter((k) => k.startsWith('aequitas.quantenS.ausgeber.'))).toEqual([]);
  });

  test('Grenze: Antworten über ANTWORTEN_MAX werden nicht gesichert', async () => {
    const w = await welt();
    await beauftragen(w.ua, wallet(AUSGEBER), w.best, TOL);
    for (let x = 1; x <= 3; x++) w.ua.ablage.daten.set(ANTWORT + x, 'x'.repeat(Math.ceil(ANTWORTEN_MAX / 3)));
    await praepAntworten(w.k, [4]);
    const ra = await runde(w.ua, wallet(AUSGEBER), ideal);
    expect(ra.abgelehnt.map((a) => a.grund).join()).toContain('zu groß');
    expect(w.ua.ablage.daten.has(ANTWORT + 4)).toBe(false);
  });
});

// ------------------------------------------------------------ Prüfvektor

const PFAD = path.join(__dirname, 'vektoren', 'quanten_s_ausgeber_auftrag_vektor.json');

/** Ende zu Ende mit festem Zufall; daraus der Vektor, den der Knoten mit eigenem Code prüft. */
async function vektorBauen() {
  const w = await welt();
  await beauftragen(w.ua, wallet(AUSGEBER), w.best, TOL);
  // Den Auftrag an die Geloste 2 aus dem Kasten lesen, bevor sie ihn abholt.
  const zs = new Zusammensetzer();
  let m: Nachricht | null = null;
  for (const b of w.k.kasten.filter((x) => x.an === LOS[1])) m = zs.hinzu(oeffnen(PRAEP[1], b.inhalt, JETZT), JETZT) ?? m;
  const auftrag = auftragLesen(m!.nutzlast);
  await praepAntworten(w.k, [1, 2, 3, 4]);
  await runde(w.ua, wallet(AUSGEBER), ideal);
  const z = (await zustandLesen(w.ua))!;
  const antw = [1, 2, 3, 4].map((x) => JSON.parse(w.ua.ablage.daten.get(ANTWORT + x)!));
  const treffer = [0, 1].map((s) => antw.reduce((a, x) => a + x.zaehlung[s][0], 0));
  const fehlerZ = [0, 1].map((s) => antw.reduce((a, x) => a + x.zaehlung[s][1], 0));
  return {
    hinweis: 'Aus der App (lib/__tests__/quantenSAusgeberRunde.test.ts, Ende zu Ende); der Knoten prüft ihn mit eigenem Code. Schlüssel NUR für Tests.',
    ausgeber_schluessel_nur_test: AUSGEBER,
    praeparatoren_schluessel_nur_test: PRAEP,
    k: K,
    n: N,
    t: T,
    tol: TOL,
    los: LOS,
    basen_hashes: w.best.basen_verschluesselt!.map(basenHash),
    auftrag,
    auftrag_nachricht: auftragNachricht(auftrag),
    // In der Form für Inhaberin und Annahmestelle (Bündel nur als Hashes, die Unterschrift bleibt prüfbar).
    abschnitte: antw.map((a) => ({
      x: a.x, von: a.von, bis: a.bis, blaetter: a.blaetter, fuer_inhaberin: a.fuer_inhaberin, buendel_hash: hashListe(a.buendel),
      buendel_sig_hash: hashListe(a.buendel_sig), teile: a.teile, zaehlung: a.zaehlung, sig: a.sig, basen_hash: a.basen_hash,
    })),
    wurzel: z.wurzel,
    proben: z.proben,
    treffer,
    fehler: fehlerZ,
  };
}

describe('B4b-4c-2c: Prüfvektor', () => {
  test('Byte für Byte wie im Vektor (der Knoten prüft genau ihn)', async () => {
    const neu = await vektorBauen();
    if (process.env.AEQUITAS_VEKTOR_SCHREIBEN === '1') fs.writeFileSync(PFAD, JSON.stringify(neu, null, 1) + '\n');
    const alt = JSON.parse(fs.readFileSync(PFAD, 'utf8'));
    expect(neu).toEqual(alt);
    expect(alt.abschnitte).toHaveLength(V);
  });
});

// ------------------------------------------------------------ B4b-4c-2d: Bestätigungen

/** Bis zum Stand `beantwortet`; die Präparatorinnen behalten ihre Geräte (Tresor) für die Bestätigung. */
async function bisBeantwortet(messer = ideal) {
  const w = await welt();
  await beauftragen(w.ua, wallet(AUSGEBER), w.best, TOL);
  const ups: Record<number, PraepUmgebung> = {};
  await praepAntworten(w.k, [1, 2, 3, 4], messer, ups);
  await runde(w.ua, wallet(AUSGEBER), ideal);
  expect((await zustandLesen(w.ua))!.stand).toBe('beantwortet');
  return { ...w, ups };
}

/** Eine Bestätigung {k, x, sig} als Hülle von `absender` an den Ausgeber. */
function bestaetigungEinwerfen(k: ReturnType<typeof knoten>, absender: string, inhalt: unknown, saat: string) {
  for (const brief of einpacken(absender, { adresse: adresseVon(AUSGEBER), pub: pubVon(AUSGEBER) }, 'bestaetigung', ethers.toUtf8Bytes(JSON.stringify(inhalt)), JETZT, drbg(saat.repeat(32)))) {
    k.einwerfen(adresseVon(absender), adresseVon(AUSGEBER), brief);
  }
}

describe('B4b-4c-2d: Ausgeber holt die Bestätigungen', () => {
  test('Gutfall Ende zu Ende: jede Geloste prüft die Bündel der anderen und bestätigt genau diese Ausgabe', async () => {
    const w = await bisBeantwortet();
    expect((await bestaetigungenAnfordern(w.ua, wallet(AUSGEBER))).gesendet).toEqual([1, 2, 3, 4]);
    const p = await praepAntworten(w.k, [1, 2, 3, 4], ideal, w.ups);
    for (let x = 1; x <= V; x++) {
      expect(p[x].abgelehnt).toEqual([]);
      expect(p[x].bestaetigt).toEqual([K]);
    }
    const ra = await runde(w.ua, wallet(AUSGEBER), ideal);
    expect(ra.abgelehnt).toEqual([]);
    expect(ra.bestaetigungen.map((b) => b.x).sort()).toEqual([1, 2, 3, 4]);
    expect(ra.bestaetigungen.filter((b) => b.fertig)).toHaveLength(1);
    const z = (await zustandLesen(w.ua))!;
    expect(z.stand).toBe('bestaetigt');
    const st = await bestaetigungenStand(w.ua);
    expect(st.fehlen).toEqual([]);
    const r: Rahmen = JSON.parse(w.ua.ablage.daten.get(RAHMEN)!);
    st.bestaetigungen!.forEach((sig, i) => {
      expect(ethers.verifyMessage(sBestaetigungNachricht(K, z.wurzel!, N, T, LOS, i + 1, z.proben!, r.zeit, TOL), sig).toLowerCase()).toBe(LOS[i]);
    });
    await expect(bestaetigungenAnfordern(w.ua, wallet(AUSGEBER))).rejects.toThrow('alle Bestätigungen sind da');
    // Spätere Antworten oder Bestätigungen derselben Gelosten (Netz wiederholt) stören nicht.
    expect((await antwortenStand(w.ua)).wurzel).toBe(z.wurzel);
  });

  test('Wiederholung: nur an die Fehlenden, dieselbe Anfrage, dieselbe Bestätigung', async () => {
    const w = await bisBeantwortet();
    await bestaetigungenAnfordern(w.ua, wallet(AUSGEBER));
    const z = (await zustandLesen(w.ua))!;
    const r: Rahmen = JSON.parse(w.ua.ablage.daten.get(RAHMEN)!);
    const antw = [1, 2, 3, 4].map((x) => JSON.parse(w.ua.ablage.daten.get(ANTWORT + x)!));
    expect(JSON.stringify(bestaetigenAnfrageBauen(AUSGEBER, z, r, antw, 3))).toBe(JSON.stringify(bestaetigenAnfrageBauen(AUSGEBER, z, r, antw, 3)));
    await praepAntworten(w.k, [1, 2], ideal, w.ups);
    await runde(w.ua, wallet(AUSGEBER), ideal);
    expect((await bestaetigungenStand(w.ua)).fehlen).toEqual([3, 4]);
    expect((await bestaetigungenAnfordern(w.ua, wallet(AUSGEBER))).gesendet).toEqual([3, 4]);
    const p = await praepAntworten(w.k, [3, 4], ideal, w.ups);
    // 3 und 4 haben die Anfrage zweimal: einmal neu bestätigt, einmal wiederholt (dieselbe Unterschrift).
    expect(p[3].bestaetigt).toEqual([K]);
    expect(p[3].wiederholt).toEqual([K]);
    const ra = await runde(w.ua, wallet(AUSGEBER), ideal);
    expect(ra.abgelehnt).toEqual([]);
    expect(ra.wiederholt).toEqual([K, K]);
    expect((await zustandLesen(w.ua))!.stand).toBe('bestaetigt');
  });

  test('Missbrauch: fremde, vertauschte, für eine andere Ausgabe unterschriebene und zweite Bestätigungen', async () => {
    const w = await bisBeantwortet();
    const z = (await zustandLesen(w.ua))!;
    const r: Rahmen = JSON.parse(w.ua.ablage.daten.get(RAHMEN)!);
    const echt = (schl: string, x: number, wurzel = z.wurzel!) => unterschreiben(schl, sBestaetigungNachricht(K, wurzel, N, T, LOS, x, z.proben!, r.zeit, TOL));
    const faelle: [string, string, Record<string, unknown>, string][] = [
      ['ein Fremder als 2', FREMD, { k: K, x: 2, sig: echt(FREMD, 2) }, 'nicht von der Gelosten 2'],
      ['Geloste 1 als 2', PRAEP[0], { k: K, x: 2, sig: echt(PRAEP[0], 2) }, 'nicht von der Gelosten 2'],
      ['echte 2 in Hülle von 1', PRAEP[0], { k: K, x: 2, sig: echt(PRAEP[1], 2) }, 'nicht von der Gelosten 2'],
      ['2 für Platz 3', PRAEP[1], { k: K, x: 2, sig: echt(PRAEP[1], 3) }, 'über diese Ausgabe'],
      ['andere Wurzel', PRAEP[1], { k: K, x: 2, sig: echt(PRAEP[1], 2, 'ee'.repeat(32)) }, 'über diese Ausgabe'],
      ['anderes K', PRAEP[1], { k: 'd0'.repeat(32), x: 2, sig: echt(PRAEP[1], 2) }, 'K oder Nummer'],
      ['Nummer außerhalb', PRAEP[1], { k: K, x: 5, sig: echt(PRAEP[1], 2) }, 'K oder Nummer'],
      ['Unterschrift kein Text', PRAEP[1], { k: K, x: 2, sig: 7 }, 'K oder Nummer'],
    ];
    for (const [i, [, absender, inhalt, grund]] of faelle.entries()) {
      bestaetigungEinwerfen(w.k, absender, inhalt, (0x40 + i).toString(16));
      const ra = await runde(w.ua, wallet(AUSGEBER), ideal);
      expect(ra.bestaetigungen).toEqual([]);
      expect(ra.abgelehnt.map((a) => a.grund).join()).toContain(grund);
    }
    expect(w.ua.ablage.daten.has(BESTAETIGUNG + 2)).toBe(false);
    // Eine andere, schon gesicherte Bestätigung wird nie überschrieben.
    w.ua.ablage.daten.set(BESTAETIGUNG + 2, '0x' + 'ab'.repeat(65));
    bestaetigungEinwerfen(w.k, PRAEP[1], { k: K, x: 2, sig: echt(PRAEP[1], 2) }, '5f');
    expect((await runde(w.ua, wallet(AUSGEBER), ideal)).abgelehnt.map((a) => a.grund).join()).toContain('schon eine andere');
  });

  test('Missbrauch: vor allen Antworten keine Bestätigung; veränderte Ablage hält die Anfragen auf', async () => {
    const w = await welt();
    await beauftragen(w.ua, wallet(AUSGEBER), w.best, TOL);
    await expect(bestaetigungenAnfordern(w.ua, wallet(AUSGEBER))).rejects.toThrow('noch nicht alle Antworten');
    bestaetigungEinwerfen(w.k, PRAEP[0], { k: K, x: 1, sig: '0x' + '11'.repeat(65) }, '61');
    expect((await runde(w.ua, wallet(AUSGEBER), ideal)).abgelehnt.map((a) => a.grund)).toEqual(['keine offenen Bestätigungen']);

    const b = await bisBeantwortet();
    // Eine gesicherte Antwort verändert (Blatt): die Unterschrift der Gelosten passt nicht mehr.
    const a2 = JSON.parse(b.ua.ablage.daten.get(ANTWORT + 2)!);
    b.ua.ablage.daten.set(ANTWORT + 2, JSON.stringify({ ...a2, blaetter: [a2.blaetter[1], ...a2.blaetter.slice(1)] }));
    await expect(bestaetigungenAnfordern(b.ua, wallet(AUSGEBER))).rejects.toThrow('nicht von der Gelosten unterschrieben');
    b.ua.ablage.daten.set(ANTWORT + 2, JSON.stringify(a2));
    // Wurzel im Zustand verändert: passt nicht zu den Antworten.
    const z = (await zustandLesen(b.ua))!;
    await zustandSchreiben(b.ua, { ...z, wurzel: 'ee'.repeat(32) });
    await expect(bestaetigungenAnfordern(b.ua, wallet(AUSGEBER))).rejects.toThrow('Wurzel oder Proben');
    await zustandSchreiben(b.ua, z);
    // Fremde Wallet, zu spät.
    await expect(bestaetigungenAnfordern(b.ua, wallet(FREMD))).rejects.toThrow('nicht die des Ausgebers');
    await expect(bestaetigungenAnfordern({ ...b.ua, jetzt: () => (JETZT + AUFTRAG_ALT) * 1000 }, wallet(AUSGEBER))).rejects.toThrow('zu alt');
    expect(b.k.kasten.filter((x) => LOS.includes(x.an))).toHaveLength(0);
  });

  test('Missbrauch: die Präparatorin lehnt eine Anfrage mit vertauschten Bündeln ab', async () => {
    const w = await bisBeantwortet();
    const z = (await zustandLesen(w.ua))!;
    const r: Rahmen = JSON.parse(w.ua.ablage.daten.get(RAHMEN)!);
    const antw = [1, 2, 3, 4].map((x) => JSON.parse(w.ua.ablage.daten.get(ANTWORT + x)!));
    // Der Ausgeber reicht Geloster 2 das Bündel, das 1 für 3 gemacht hat (neu unterschrieben -- der Auftrag selbst ist echt).
    const falsch = antw.map((a) => ({ ...a, buendel: [...a.buendel], buendel_sig: [...a.buendel_sig] }));
    falsch[0].buendel[1] = antw[0].buendel[2];
    falsch[0].buendel_sig[1] = antw[0].buendel_sig[2];
    const q = bestaetigenAnfrageBauen(AUSGEBER, z, r, falsch, 2);
    for (const brief of einpacken(AUSGEBER, { adresse: LOS[1], pub: pubVon(PRAEP[1]) }, 'bestaetigung', ethers.toUtf8Bytes(JSON.stringify(q)), JETZT, drbg('71'.repeat(32)))) {
      w.k.einwerfen(adresseVon(AUSGEBER), LOS[1], brief);
    }
    const p = await praepAntworten(w.k, [2], ideal, w.ups);
    expect(p[2].bestaetigt).toEqual([]);
    expect(p[2].abgelehnt).toHaveLength(1);
  });
});

// ------------------------------------------------------------ Prüfvektor 2d

const PFAD_2D = path.join(__dirname, 'vektoren', 'quanten_s_ausgeber_bestaetigen_vektor.json');

describe('B4b-4c-2d: Prüfvektor', () => {
  test('Byte für Byte wie im Vektor (der Knoten prüft genau ihn)', async () => {
    const w = await bisBeantwortet();
    await bestaetigungenAnfordern(w.ua, wallet(AUSGEBER));
    // Die Anfrage an Geloste 2 aus dem Kasten, bevor sie abholt.
    const zs = new Zusammensetzer();
    let m: Nachricht | null = null;
    for (const b of w.k.kasten.filter((x) => x.an === LOS[1])) m = zs.hinzu(oeffnen(PRAEP[1], b.inhalt, JETZT), JETZT) ?? m;
    const q = JSON.parse(ethers.toUtf8String(m!.nutzlast));
    await praepAntworten(w.k, [1, 2, 3, 4], ideal, w.ups);
    await runde(w.ua, wallet(AUSGEBER), ideal);
    const z = (await zustandLesen(w.ua))!;
    expect(z.stand).toBe('bestaetigt');
    const neu = {
      hinweis: 'Aus der App (lib/__tests__/quantenSAusgeberRunde.test.ts, Ende zu Ende); der Knoten prüft ihn mit eigenem Code. Bündel und Blätter nur als Hash (Größe).',
      ausgeber_schluessel_nur_test: AUSGEBER,
      los: LOS,
      wurzel: z.wurzel,
      blaetter_hash: hashListe(q.blaetter),
      buendel_hash: hashListe(q.buendel),
      // Die Anfrage an Geloste 2 mit allen Feldern; Blätter und Bündel geleert (ihre Hashes oben).
      anfrage: { ...q, blaetter: [], buendel: [] },
      bestaetigungen: (await bestaetigungenStand(w.ua)).bestaetigungen,
    };
    if (process.env.AEQUITAS_VEKTOR_SCHREIBEN === '1') fs.writeFileSync(PFAD_2D, JSON.stringify(neu, null, 1) + '\n');
    expect(neu).toEqual(JSON.parse(fs.readFileSync(PFAD_2D, 'utf8')));
    expect(merkleWurzel(q.blaetter)).toBe(z.wurzel);
  });
});

// ------------------------------------------------------------ B4b-4c-2e: Ausgabe gegen das Los

async function bisBestaetigt(opt: Opt = {}) {
  const k = knoten(opt);
  const ua = umgebung(k.f, 'a0');
  await zustandSchreiben(ua, GELOST);
  const { best } = await inhaberinBestellt(knoten().f);
  await beauftragen(ua, wallet(AUSGEBER), best, TOL);
  const ups: Record<number, PraepUmgebung> = {};
  await praepAntworten(k, [1, 2, 3, 4], ideal, ups);
  await runde(ua, wallet(AUSGEBER), ideal);
  await bestaetigungenAnfordern(ua, wallet(AUSGEBER));
  await praepAntworten(k, [1, 2, 3, 4], ideal, ups);
  await runde(ua, wallet(AUSGEBER), ideal);
  expect((await zustandLesen(ua))!.stand).toBe('bestaetigt');
  return { k, ua, best };
}

describe('B4b-4c-2e: Ausgabe gegen das Los', () => {
  test('Gutfall: eingereicht wie die Kette es prüft; danach nie doppelt', async () => {
    const w = await bisBestaetigt();
    expect(await ausgeben(w.ua, wallet(AUSGEBER))).toEqual({ stand: 'ausgegeben' });
    expect(w.k.kette.eingereicht).toHaveLength(1);
    const koerper = w.k.kette.eingereicht[0];
    const z = (await zustandLesen(w.ua))!;
    const r: Rahmen = JSON.parse(w.ua.ablage.daten.get(RAHMEN)!);
    expect(z.stand).toBe('ausgegeben');
    expect(koerper.wallet).toBe(adresseVon(AUSGEBER));
    expect(koerper.zeit).toBe(r.zeit);
    const q = koerper.quanten_w;
    expect(Object.keys(q)).toEqual(['k', 'n', 't', 'wurzel', 'validatoren', 'bestaetigungen', 'deckung', 'tol', 'inhaber', 'annahme', 'proben', 'probe_art', 'wallet_sig']);
    expect(q).toMatchObject({ k: K, n: N, t: T, wurzel: z.wurzel, validatoren: LOS, deckung: 1_000_000, tol: TOL, inhaber: r.inhaberin, annahme: r.stellen, proben: z.proben, probe_art: 2 });
    expect(q.bestaetigungen).toEqual((await bestaetigungenStand(w.ua)).bestaetigungen);
    const m = sAusgabeNachricht(adresseVon(AUSGEBER), K, N, T, z.wurzel!, LOS, z.proben!, r.stellen, r.inhaberin, 1_000_000, r.zeit, TOL, 2);
    expect(ethers.verifyMessage(m, q.wallet_sig).toLowerCase()).toBe(adresseVon(AUSGEBER));
    // Noch einmal: nichts mehr eingereicht.
    expect(await ausgeben(w.ua, wallet(AUSGEBER))).toEqual({ stand: 'ausgegeben' });
    expect(w.k.kette.eingereicht).toHaveLength(1);
  });

  test('Netz bricht nach dem Einreichen ab: später nur nachsehen, nicht doppelt einreichen', async () => {
    const w = await bisBestaetigt({ ausgeben: () => ({ status: 200, zeigen: false }) });
    expect(await ausgeben(w.ua, wallet(AUSGEBER))).toEqual({ stand: 'eingereicht' });
    expect((await zustandLesen(w.ua))!.stand).toBe('bestaetigt');
    // Der Block kommt: der Knoten zeigt den Token.
    const q = w.k.kette.eingereicht[0].quanten_w;
    w.k.kette.token = { k: q.k, art: 's', n: q.n, t: q.t, v: 4, tol: q.tol, inhaber: q.inhaber, stellen: q.annahme, probe_art: 2, wurzel: q.wurzel, proben: q.proben };
    expect(await ausgeben(w.ua, wallet(AUSGEBER))).toEqual({ stand: 'ausgegeben' });
    expect(w.k.kette.eingereicht).toHaveLength(1);
  });

  test('Missbrauch: K steht mit einer anderen Ausgabe auf der Kette -- nichts eingereicht, kein Stand', async () => {
    const w = await bisBestaetigt();
    const z = (await zustandLesen(w.ua))!;
    const r: Rahmen = JSON.parse(w.ua.ablage.daten.get(RAHMEN)!);
    const echt = { k: K, art: 's', n: N, t: T, v: 4, tol: TOL, inhaber: r.inhaberin, stellen: r.stellen, probe_art: 2, wurzel: z.wurzel, proben: z.proben };
    for (const anders of [{ wurzel: 'ee'.repeat(32) }, { proben: [z.proben![1], z.proben![0]] }, { inhaber: LOS[0] }, { stellen: [r.stellen[1], r.stellen[0]] }, { probe_art: undefined }, { v: 3 }]) {
      w.k.kette.token = { ...echt, ...anders };
      await expect(ausgeben(w.ua, wallet(AUSGEBER))).rejects.toThrow('nicht mit dieser Ausgabe');
    }
    expect(w.k.kette.eingereicht).toHaveLength(0);
    expect((await zustandLesen(w.ua))!.stand).toBe('bestaetigt');
  });

  const faelle: [string, Opt, string][] = [
    ['Los im Register anders', { bestellung: (b) => void (b.los = [LOS[1], LOS[0], LOS[2], LOS[3]]) }, 'passt nicht zur Ausgabe'],
    ['Deckung im Register anders', { bestellung: (b) => void ((b.deckung = 2_000_000), (b.pfand = bestellPfand(2_000_000))) }, 'passt nicht zur Ausgabe'],
  ];
  test.each(faelle)('Missbrauch vor dem Einreichen: %s', async (_, opt, grund) => {
    // Erst ehrlich bis bestätigt, dann ändert der Knoten sein Register.
    const w = await bisBestaetigt();
    const k2 = knoten(opt);
    const u2 = { ...w.ua, fetchFn: k2.f };
    await expect(ausgeben(u2, wallet(AUSGEBER))).rejects.toThrow(grund);
    expect(k2.kette.eingereicht).toHaveLength(0);
  });

  test('Missbrauch: Bestätigung in der Ablage verändert, fremde Wallet, zu spät, Abweisung des Knotens', async () => {
    const w = await bisBestaetigt();
    const alt = w.ua.ablage.daten.get(BESTAETIGUNG + 2)!;
    w.ua.ablage.daten.set(BESTAETIGUNG + 2, w.ua.ablage.daten.get(BESTAETIGUNG + 1)!);
    await expect(ausgeben(w.ua, wallet(AUSGEBER))).rejects.toThrow('Bestätigung 2 fehlt oder passt nicht');
    w.ua.ablage.daten.set(BESTAETIGUNG + 2, alt);
    await expect(ausgeben(w.ua, wallet(FREMD))).rejects.toThrow('nicht die des Ausgebers');
    await expect(ausgeben({ ...w.ua, jetzt: () => (JETZT + AUFTRAG_ALT) * 1000 }, wallet(AUSGEBER))).rejects.toThrow('zu alt');
    expect(w.k.kette.eingereicht).toHaveLength(0);
    const k2 = knoten({ ausgeben: () => ({ status: 400, zeigen: false }) });
    await expect(ausgeben({ ...w.ua, fetchFn: k2.f }, wallet(AUSGEBER))).rejects.toThrow('HTTP 400');
    expect((await zustandLesen(w.ua))!.stand).toBe('bestaetigt');
  });

  test('vor allen Bestätigungen keine Ausgabe', async () => {
    const w = await bisBeantwortet();
    await expect(ausgeben(w.ua, wallet(AUSGEBER))).rejects.toThrow('noch nicht alle Bestätigungen');
    expect(w.k.kette.eingereicht).toHaveLength(0);
  });

  test('Prüfvektor: Körper der Ausgabe Byte für Byte (der Knoten prüft genau ihn)', async () => {
    const w = await bisBestaetigt();
    await ausgeben(w.ua, wallet(AUSGEBER));
    const neu = {
      hinweis: 'Aus der App (lib/__tests__/quantenSAusgeberRunde.test.ts, Ende zu Ende, dieselbe Ausgabe wie 2c/2d); der Knoten prüft ihn mit eigenem Code.',
      ausgeber_schluessel_nur_test: AUSGEBER,
      bestell_zeit: BESTELLT,
      koerper_ausgeben: JSON.stringify(w.k.kette.eingereicht[0]),
    };
    const pfad = path.join(__dirname, 'vektoren', 'quanten_s_ausgeber_ausgeben_vektor.json');
    if (process.env.AEQUITAS_VEKTOR_SCHREIBEN === '1') fs.writeFileSync(pfad, JSON.stringify(neu, null, 1) + '\n');
    expect(neu).toEqual(JSON.parse(fs.readFileSync(pfad, 'utf8')));
  });
});
