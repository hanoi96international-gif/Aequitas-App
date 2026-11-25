// Weg B in Pilot-Größe (v = 7, t = 4, n = 2822 -- das kleinste n für k_note bei
// Toleranz 2 %): Messung 25.11.2026. Die sieben Antworten sind zusammen ~4,2 MB;
// ohne Ablage in Dateien weist der Ausgeber die letzte ab (AsyncStorage-Grenze),
// mit Ablage in Dateien (u.dateien) sammelt er alle, bestätigt und rechnet die
// Wurzel. Schlank gehalten: bis zu den Bestätigungen, ohne Ausgabe.
jest.mock('expo-secure-store', () => ({}));
jest.mock('expo-crypto', () => ({ getRandomBytes: () => new Uint8Array(0) }));
jest.mock('../config', () => ({ API_BASE: 'https://knoten.test/api' }));

import { adresseVon, pubVon } from '../quantenS';
import { ANTWORT, bestellPfand, losRunde, zustandLesen, zustandSchreiben, type AusgeberZustand } from '../quantenSAusgeber';
import { ANTWORTEN_MAX, ANTWORTEN_MAX_DATEIEN, beauftragen, bestaetigungenAnfordern } from '../quantenSAusgeberRunde';
import { neuWegB, type Speicher, type Umgebung } from '../quantenSInhaberin';
import { runde, type Messer, type PraepUmgebung } from '../quantenSPraepAblauf';
import { drbg } from '../quantenSPraepTresor';

const API = 'https://knoten.test/api';
const K = 'c7'.repeat(32);
const JETZT = 1_800_000_000;
const BESTELLT = JETZT - 900;
const N = 2822;
const V = 7;
const T = 4;
const TOL = 2;
const AUSGEBER = '99'.repeat(32);
const PRAEP = [0x61, 0x62, 0x63, 0x64, 0x65, 0x66, 0x67].map((b) => b.toString(16).repeat(32));
const LOS = PRAEP.map(adresseVon);
const STELLEN: [{ adresse: string; schluessel: string }, { adresse: string; schluessel: string }] = [
  { adresse: adresseVon('31'.repeat(32)), schluessel: pubVon('31'.repeat(32)) },
  { adresse: adresseVon('32'.repeat(32)), schluessel: pubVon('32'.repeat(32)) },
];

function speicher(): Speicher & { daten: Map<string, string> } {
  const daten = new Map<string, string>();
  return { daten, lesen: async (k) => daten.get(k) ?? null, schreiben: async (k, v) => void daten.set(k, v), loeschen: async (k) => void daten.delete(k) };
}

function knoten() {
  let id = 0;
  const kasten: { id: number; an: string; von: string; inhalt: string }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    const ok = (o: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(o) }) as unknown as Response;
    if (url === `${API}/quanten-w/praeparatoren`) {
      const b = { k: K, ausgeber: adresseVon(AUSGEBER), v: V, t: T, zeit: BESTELLT, frist: BESTELLT + 2 * 86400, runde: losRunde(BESTELLT), deckung: 1_000_000, pfand: bestellPfand(1_000_000), im_abbild: 14, los: LOS };
      return ok({ aktiv: true, vorlauf: 86400, nachlauf: 1, hoechstens: 256, praeparatoren: PRAEP.map((s) => ({ konto: adresseVon(s), pub: pubVon(s), gemeldet: 1, im_los_ab: 2 })), bestellungen: [b] });
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
  return { f, kasten };
}

const ideal: Messer = { messen: async (u, t, y) => u.map((ui, i) => (ui === y[i] ? t[i] : (i * 7) % 2)) };
const wallet = (s: string) => ({ entsperren: async () => ({ privateKey: '0x' + s }) });

async function welt(mitDateien: boolean) {
  const k = knoten();
  const ua: PraepUmgebung & { ablage: ReturnType<typeof speicher> } = {
    fetchFn: k.f, apiBasis: API, geheim: speicher(), ablage: speicher(), zufall: drbg('a7'.repeat(32)), jetzt: () => JETZT * 1000,
    ...(mitDateien ? { dateien: speicher() } : {}),
  };
  const gelost: AusgeberZustand = {
    k: K, ausgeber: adresseVon(AUSGEBER), v: V, t: T, deckung: 1_000_000, zeit: BESTELLT, stand: 'gelost', buchzeit: BESTELLT,
    runde: losRunde(BESTELLT), frist: BESTELLT + 2 * 86400, los: LOS,
  };
  await zustandSchreiben(ua, gelost);
  const ui: Umgebung = { fetchFn: k.f, speicher: speicher(), ablage: speicher(), zufall: drbg('1b'.repeat(32)), apiBasis: API, warten: async () => {}, jetzt: () => JETZT * 1000 };
  const best = await neuWegB(ui, N, K, STELLEN);
  await beauftragen(ua, wallet(AUSGEBER), best, TOL);
  const ups = PRAEP.map((_, i) => ({ fetchFn: k.f, apiBasis: API, geheim: speicher(), ablage: speicher(), zufall: drbg((0x20 + i).toString(16).repeat(32)), jetzt: () => JETZT * 1000 }) as PraepUmgebung);
  for (let i = 0; i < V; i++) expect((await runde(ups[i], wallet(PRAEP[i]), ideal)).beantwortet).toEqual([K]);
  const r = await runde(ua, wallet(AUSGEBER), ideal);
  return { k, ua, ups, r };
}

describe('Weg B in Pilot-Größe (v = 7, t = 4, n = 2822)', () => {
  test('ohne Ablage in Dateien: die Antworten sprengen die Grenze des AsyncStorage -- abgewiesen, nichts halb gesichert', async () => {
    const { ua, r } = await welt(false);
    expect(r.antworten).toHaveLength(6);
    expect(r.abgelehnt.map((a) => a.grund)).toEqual(['Antworten zu groß für die Ablage (kleineres n)']);
    const summe = [...ua.ablage.daten.entries()].filter(([k]) => k.startsWith(ANTWORT)).reduce((s, [, v]) => s + v.length, 0);
    expect(summe).toBeLessThanOrEqual(ANTWORTEN_MAX);
    expect((await zustandLesen(ua))!.stand).toBe('beauftragt');
  });

  test('mit Ablage in Dateien: alle sieben gesichert, beantwortet, Bestätigungen gehen hinaus', async () => {
    const { ua, k, r } = await welt(true);
    expect(r.abgelehnt).toEqual([]);
    expect(r.antworten.filter((a) => a.fertig)).toHaveLength(1);
    const z = (await zustandLesen(ua))!;
    expect(z.stand).toBe('beantwortet');
    const dateien = (ua.dateien as ReturnType<typeof speicher>).daten;
    const summe = [...dateien.values()].reduce((s, v) => s + v.length, 0);
    expect(summe).toBeGreaterThan(ANTWORTEN_MAX); // genau das, was AsyncStorage nicht trug
    expect(summe).toBeLessThanOrEqual(ANTWORTEN_MAX_DATEIEN);
    expect([...ua.ablage.daten.keys()].filter((key) => key.startsWith(ANTWORT))).toEqual([]); // nichts davon im AsyncStorage
    expect((await bestaetigungenAnfordern(ua, wallet(AUSGEBER))).gesendet).toEqual([1, 2, 3, 4, 5, 6, 7]);
    // Je Geloster liegt die Anfrage im Kasten, innerhalb der Grenzen des Briefkastens (je Paar 64 Briefe).
    for (const a of LOS) expect(k.kasten.filter((b) => b.an === a).length).toBeLessThanOrEqual(64);
  });
});
