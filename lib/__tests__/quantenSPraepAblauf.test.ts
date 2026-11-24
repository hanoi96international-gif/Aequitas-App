// Ablauf der Präparatorin (lib/quantenSPraepAblauf.ts) gegen einen
// nachgebauten Knoten (Briefkasten + Register im Speicher). Der Auftrag ist
// der echte aus dem Prüfvektor des Knotens.
jest.mock('expo-secure-store', () => ({}));
jest.mock('expo-crypto', () => ({ getRandomBytes: () => new Uint8Array(0) }));
jest.mock('../config', () => ({ API_BASE: 'https://knoten.test/api' }));
import { ethers } from 'ethers';
import vektor from './vektoren/quanten_s_praep_auftrag_vektor.json';
import { abschnitt, adresseVon, antwortNachricht, eciesOeffnen, hashListe, merkleWurzel, probeHashV2, pubVon, unterschreiben, unterschriftVon } from '../quantenS';
import { antwortBauen, sAuftragNachricht, sBestaetigungNachricht, type Antwort } from '../quantenSPraeparieren';
import { Zusammensetzer, einpacken, oeffnen } from '../quantenSHuelle';
import type { Speicher } from '../quantenSInhaberin';
import { runde, type Messer, type PraepUmgebung } from '../quantenSPraepAblauf';
import { PraepTresor, drbg } from '../quantenSPraepTresor';

const API = 'https://knoten.test/api';
const AUSGEBER = vektor.praeger_schluessel_nur_test;
const ICH = vektor.praeparatoren_schluessel_nur_test[vektor.auftrag.x - 1];
const FREMD = '9a'.repeat(32);
const ZEIT = vektor.auftrag.zeit + 10;

function speicher(): Speicher & { daten: Map<string, string> } {
  const daten = new Map<string, string>();
  return { daten, lesen: async (k) => daten.get(k) ?? null, schreiben: async (k, v) => void daten.set(k, v), loeschen: async (k) => void daten.delete(k) };
}

/** Ein Knoten im Speicher: Briefkasten (ohne Unterschriftsprüfung, die prüft briefkasten.test.ts) und Register. */
/** Kettenstand je Knoten (für die Öffnung): Token, Höhe, finalisierte Höhe. */
interface Kette {
  token: Record<string, unknown> | null;
  hoehe: number;
  final: number;
}
const K2 = 'https://k2.test/api';

function knoten(opt: { aktiv?: boolean } = {}) {
  let id = 0;
  const kette: Record<string, Kette> = { [API]: { token: null, hoehe: 100, final: 0 }, [K2]: { token: null, hoehe: 100, final: 0 } };
  const kasten: { id: number; von: string; an: string; inhalt: string; zeit: number }[] = [];
  const bestellung = { k: vektor.auftrag.k, ausgeber: vektor.auftrag.praeger, v: 3, t: 2, zeit: vektor.auftrag.zeit - 600, frist: vektor.auftrag.zeit + 3000, im_abbild: 3, runde: 1, deckung: 1, pfand: 1, los: vektor.auftrag.validatoren };
  const f = (async (url: string, init?: RequestInit) => {
    const ok = (o: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(o) }) as unknown as Response;
    for (const basis of [API, K2]) {
      const kt = kette[basis];
      if (url === `${basis}/quanten-w/note?k=${vektor.auftrag.k}`) {
        return kt.token ? ok({ k: vektor.auftrag.k, art: 's', ...kt.token }) : ({ ok: false, status: 404, text: async () => '{}' } as unknown as Response);
      }
      if (url === `${basis}/status`) return ok({ height: kt.hoehe });
      if (url === `${basis}/health/combined`) return ok({ sync_diagnostics: { finalized_height: kt.final } });
    }
    if (url === `${API}/quanten-w/praeparatoren`) return ok({ aktiv: opt.aktiv ?? true, vorlauf: 86400, nachlauf: 695160, hoechstens: 256, praeparatoren: [], bestellungen: [bestellung] });
    const k = JSON.parse(init!.body as string);
    if (url.endsWith('/briefkasten/ablegen')) {
      kasten.push({ id: ++id, von: k.von, an: k.an, inhalt: k.inhalt, zeit: k.zeit });
      return ok({ ok: true, id });
    }
    if (url.endsWith('/briefkasten/abholen')) {
      const b = kasten.filter((x) => x.an === k.an && x.id > k.nach).slice(0, 32);
      return ok({ briefe: b.map(({ id: i, von, inhalt, zeit }) => ({ id: i, von, inhalt, zeit })), mehr: false });
    }
    if (url.endsWith('/briefkasten/quittieren')) {
      const vor = kasten.length;
      for (let i = kasten.length - 1; i >= 0; i--) if (kasten[i].an === k.an && kasten[i].id <= k.bis) kasten.splice(i, 1);
      return ok({ ok: true, geloescht: vor - kasten.length });
    }
    throw new Error('unbekannt ' + url);
  }) as unknown as typeof fetch;
  const einwerfen = (von: string, an: string, inhalt: string) => kasten.push({ id: ++id, von, an, inhalt, zeit: ZEIT });
  return { f, kasten, einwerfen, kette };
}

const ideal: Messer = { messen: async (u, t, y) => u.map((ui, i) => (ui === y[i] ? t[i] : (i * 7) % 2)) };
const wallet = { entsperren: async () => ({ privateKey: '0x' + ICH }) };

function umgebung(f: typeof fetch): PraepUmgebung & { geheim: ReturnType<typeof speicher>; ablage: ReturnType<typeof speicher> } {
  return { fetchFn: f, apiBasis: API, geheim: speicher(), ablage: speicher(), zufall: drbg('5e'.repeat(32)), jetzt: () => ZEIT * 1000 };
}

/** Der Ausgeber schickt den Auftrag als Hülle an die Präparatorin. */
function auftragSenden(k: ReturnType<typeof knoten>, absender = AUSGEBER, saat = 'a') {
  for (const b of einpacken(absender, { adresse: adresseVon(ICH), pub: pubVon(ICH) }, 'auftrag', ethers.toUtf8Bytes(JSON.stringify(vektor.auftrag)), ZEIT, drbg(saat.padEnd(64, '0').replace(/[^0-9a-f]/g, '0')))) {
    k.einwerfen(adresseVon(absender), adresseVon(ICH), b);
  }
}

/** Der Ausgeber holt seine Antwort aus dem Kasten und öffnet sie. */
function antwortLesen(k: ReturnType<typeof knoten>) {
  const zs = new Zusammensetzer();
  let m = null;
  for (const b of k.kasten.filter((x) => x.an === vektor.auftrag.praeger)) m = zs.hinzu(oeffnen(AUSGEBER, b.inhalt, ZEIT), ZEIT) ?? m;
  return m;
}

describe('runde der Präparatorin', () => {
  it('beantwortet den Auftrag: Antwort als Hülle an den Ausgeber, Fall im Tresor, Kasten quittiert', async () => {
    const k = knoten();
    auftragSenden(k);
    const u = umgebung(k.f);
    const r = await runde(u, wallet, ideal);
    expect(r.beantwortet).toEqual([vektor.auftrag.k]);
    expect(r.abgelehnt).toEqual([]);
    const m = antwortLesen(k)!;
    expect(m.art).toBe('antwort');
    expect(m.von).toBe(adresseVon(ICH));
    const a = JSON.parse(ethers.toUtf8String(m.nutzlast));
    expect(a.validator).toBe(adresseVon(ICH));
    expect(unterschriftVon(antwortNachricht(a.k, a.x, a.von, a.bis, hashListe(a.blaetter), a.fuer_inhaberin, hashListe(a.buendel), hashListe(a.buendel_sig), a.teile, a.zaehlung, a.basen_hash), a.sig, a.validator)).toBe(true);
    // Eigener Kasten leer, Fall gesichert und beantwortet.
    expect(k.kasten.filter((x) => x.an === adresseVon(ICH))).toHaveLength(0);
    const f = await new PraepTresor(u.geheim, u.ablage, u.zufall).laden(vektor.auftrag.k);
    expect(f?.stand).toBe('beantwortet');
  });

  it('derselbe Auftrag noch einmal: dieselbe Antwort, keine neue Messung', async () => {
    const k = knoten();
    auftragSenden(k);
    const u = umgebung(k.f);
    await runde(u, wallet, ideal);
    const erste = antwortLesen(k)!;
    k.kasten.splice(0, k.kasten.length);
    auftragSenden(k, AUSGEBER, 'b'); // neue Hülle, derselbe Auftrag
    let gemessen = 0;
    const r = await runde(u, wallet, { messen: async (...a) => (gemessen++, ideal.messen(...a)) });
    expect(r.wiederholt).toEqual([vektor.auftrag.k]);
    expect(gemessen).toBe(0);
    expect(ethers.hexlify(antwortLesen(k)!.nutzlast)).toBe(ethers.hexlify(erste.nutzlast));
  });

  it('lehnt einen Auftrag ab, dessen Hülle nicht vom Ausgeber ist', async () => {
    const k = knoten();
    auftragSenden(k, FREMD);
    const r = await runde(umgebung(k.f), wallet, ideal);
    expect(r.beantwortet).toEqual([]);
    expect(r.abgelehnt[0].grund).toContain('nicht vom Ausgeber');
    expect(k.kasten.filter((x) => x.an !== adresseVon(ICH))).toHaveLength(0);
  });

  it('lehnt ab, solange Weg B im Knoten schläft', async () => {
    const k = knoten({ aktiv: false });
    auftragSenden(k);
    const r = await runde(umgebung(k.f), wallet, ideal);
    expect(r.abgelehnt[0].grund).toContain('nicht aktiv');
  });

  it('ein kaputter Brief blockiert nichts und wird quittiert', async () => {
    const k = knoten();
    k.einwerfen(adresseVon(FREMD), adresseVon(ICH), 'abcd');
    auftragSenden(k);
    const r = await runde(umgebung(k.f), wallet, ideal);
    expect(r.abgewiesen).toHaveLength(1);
    expect(r.beantwortet).toEqual([vektor.auftrag.k]);
    expect(k.kasten.filter((x) => x.an === adresseVon(ICH))).toHaveLength(0);
  });

  it('quittiert nie einen Teil einer unvollständigen Nachricht', async () => {
    const k = knoten();
    const gross = einpacken(FREMD, { adresse: adresseVon(ICH), pub: pubVon(ICH) }, 'oeffnung', new Uint8Array(40_000).fill(7), ZEIT, drbg('77'.repeat(32)));
    expect(gross).toHaveLength(2);
    k.einwerfen(adresseVon(FREMD), adresseVon(ICH), gross[0]);
    auftragSenden(k);
    const u = umgebung(k.f);
    const r1 = await runde(u, wallet, ideal);
    expect(r1.offen).toBe(1);
    expect(r1.beantwortet).toEqual([vektor.auftrag.k]);
    // Der erste Teil (und alles danach) bleibt im Kasten.
    expect(k.kasten.filter((x) => x.an === adresseVon(ICH)).length).toBeGreaterThan(0);
    k.einwerfen(adresseVon(FREMD), adresseVon(ICH), gross[1]);
    const r2 = await runde(u, wallet, ideal);
    expect(r2.offen).toBe(0);
    expect(r2.wiederholt).toEqual([]); // der Auftrag ist erledigt (Liste), nicht noch einmal beantwortet
    expect(k.kasten.filter((x) => x.an === adresseVon(ICH))).toHaveLength(0);
  });

  it('bricht ab, wenn die Wallet keinen lesbaren Schlüssel liefert', async () => {
    const k = knoten();
    await expect(runde(umgebung(k.f), { entsperren: async () => ({ privateKey: 'xyz' }) }, ideal)).rejects.toThrow('Wallet');
  });

  it('weist eine falsch geformte Messung ab (keine Antwort, kein Fall)', async () => {
    const k = knoten();
    auftragSenden(k);
    const u = umgebung(k.f);
    const r = await runde(u, wallet, { messen: async (u2) => u2.map(() => 2) });
    expect(r.abgelehnt[0].grund).toContain('Messung');
    expect(await new PraepTresor(u.geheim, u.ablage, u.zufall).laden(vektor.auftrag.k)).toBeNull();
    expect(k.kasten.filter((x) => x.an === vektor.auftrag.praeger)).toHaveLength(0);
  });
});

/** Die Bestätigungs-Anfrage des Ausgebers für Präparatorin 2: Antworten von 1 und 3 mit ihren Testschlüsseln gebaut. */
function anfrageBauen(meine: Antwort, x: { proben?: string[] } = {}) {
  const q = vektor.auftrag;
  const n = q.n, v = 3;
  const stellen = [0, 1].map((b) => ({ adresse: q.stellen[b], pub: q.stellen_schluessel[b] })) as [{ adresse: string; pub: string }, { adresse: string; pub: string }];
  const antw: Antwort[] = [];
  for (let e = 1; e <= v; e++) {
    if (e === q.x) { antw.push(meine); continue; }
    const a = abschnitt(n, v, e)!;
    const len = a.bis - a.von;
    const bits = (s: number) => Array.from({ length: len }, (_, i) => (i * s + e) % 2);
    antw.push(antwortBauen(vektor.praeparatoren_schluessel_nur_test[e - 1], {
      K: q.k, x: e, t: q.t, von: a.von, bis: a.bis, schluessel: q.schluessel, stellen, inhaberin: { adresse: q.inhaberin, pub: q.inhaberin_schluessel },
    }, { y: bits(1), u: bits(3), t: bits(5), x: bits(7) }, drbg(String(e).repeat(64))).antwort);
  }
  const blaetter = antw.flatMap((a) => a.blaetter);
  const wurzel = merkleWurzel(blaetter);
  const proben = x.proben ?? [0, 1].map((b) => probeHashV2(q.k, b, antw.map((a) => a.teile![b])));
  const buendel = antw.map((a) => a.buendel[q.x - 1]);
  const buendel_sig = antw.map((a) => a.buendel_sig[q.x - 1]);
  const praeger_sig = unterschreiben(AUSGEBER, sAuftragNachricht(q.praeger, q.k, n, q.t, q.tol, q.x, wurzel, q.validatoren, proben, q.zeit, hashListe(buendel)));
  return { art: 's', k: q.k, n, t: q.t, tol: q.tol, x: q.x, wurzel, validatoren: q.validatoren, zeit: q.zeit, blaetter, praeger: q.praeger, praeger_sig, proben, buendel, buendel_sig };
}

function anfrageSenden(k: ReturnType<typeof knoten>, anfrage: unknown, absender = AUSGEBER, saat = 'c') {
  for (const b of einpacken(absender, { adresse: adresseVon(ICH), pub: pubVon(ICH) }, 'bestaetigung', ethers.toUtf8Bytes(JSON.stringify(anfrage)), ZEIT, drbg(saat.padEnd(64, '0').replace(/[^0-9a-f]/g, '0')))) {
    k.einwerfen(adresseVon(absender), adresseVon(ICH), b);
  }
}

/** Alle Nachrichten an den Ausgeber, nach Art. */
function anAusgeber(k: ReturnType<typeof knoten>, art: string) {
  const zs = new Zusammensetzer();
  const out = [];
  for (const b of k.kasten.filter((x) => x.an === vektor.auftrag.praeger)) {
    const m = zs.hinzu(oeffnen(AUSGEBER, b.inhalt, ZEIT), ZEIT);
    if (m && m.art === art) out.push(JSON.parse(ethers.toUtf8String(m.nutzlast)));
  }
  return out;
}

describe('Bestätigung (B4b-4c-1f)', () => {
  async function beantwortet() {
    const k = knoten();
    auftragSenden(k);
    const u = umgebung(k.f);
    await runde(u, wallet, ideal);
    const meine = anAusgeber(k, 'antwort')[0] as Antwort;
    return { k, u, meine };
  }

  it('bestätigt die Ausgabe: Unterschrift an den Ausgeber, Anteile und Pakete im Tresor', async () => {
    const { k, u, meine } = await beantwortet();
    const anfrage = anfrageBauen(meine);
    anfrageSenden(k, anfrage);
    const r = await runde(u, wallet, ideal);
    expect(r.bestaetigt).toEqual([vektor.auftrag.k]);
    const [b] = anAusgeber(k, 'bestaetigung');
    expect(b.x).toBe(vektor.auftrag.x);
    const m = sBestaetigungNachricht(vektor.auftrag.k, anfrage.wurzel, anfrage.n, anfrage.t, anfrage.validatoren, anfrage.x, [anfrage.proben[0], anfrage.proben[1]], anfrage.zeit, anfrage.tol);
    expect(unterschriftVon(m, b.sig, adresseVon(ICH))).toBe(true);
    const f = await new PraepTresor(u.geheim, u.ablage, u.zufall).laden(vektor.auftrag.k);
    expect(f?.stand).toBe('bestaetigt');
    expect(f?.bestaetigung?.anteile).toHaveLength(vektor.auftrag.n);
    expect(Object.keys(f?.bestaetigung?.oeffnungen ?? {}).sort()).toEqual(['1', '3']);
  });

  it('dieselbe Anfrage noch einmal: dieselbe Unterschrift', async () => {
    const { k, u, meine } = await beantwortet();
    const anfrage = anfrageBauen(meine);
    anfrageSenden(k, anfrage, AUSGEBER, 'c');
    await runde(u, wallet, ideal);
    anfrageSenden(k, anfrage, AUSGEBER, 'd');
    const r = await runde(u, wallet, ideal);
    expect(r.wiederholt).toEqual([vektor.auftrag.k]);
    const b = anAusgeber(k, 'bestaetigung');
    expect(b).toHaveLength(2);
    expect(b[1].sig).toBe(b[0].sig);
  });

  it('bestätigt zu einem K nie eine zweite, andere Ausgabe', async () => {
    const { k, u, meine } = await beantwortet();
    anfrageSenden(k, anfrageBauen(meine), AUSGEBER, 'c');
    await runde(u, wallet, ideal);
    anfrageSenden(k, anfrageBauen(meine, { proben: ['11'.repeat(32), '22'.repeat(32)] }), AUSGEBER, 'e');
    const r = await runde(u, wallet, ideal);
    expect(r.abgelehnt[0].grund).toContain('andere Ausgabe');
    expect(anAusgeber(k, 'bestaetigung')).toHaveLength(1);
  });

  it('weist eine Anfrage ab, die nicht vom Ausgeber kommt oder zu keinem Auftrag gehört', async () => {
    const { k, u, meine } = await beantwortet();
    anfrageSenden(k, anfrageBauen(meine), FREMD, 'f');
    const r = await runde(u, wallet, ideal);
    expect(r.abgelehnt[0].grund).toContain('nicht vom Ausgeber');
    const k2 = knoten();
    anfrageSenden(k2, anfrageBauen(meine));
    const r2 = await runde(umgebung(k2.f), wallet, ideal);
    expect(r2.abgelehnt[0].grund).toContain('kein Auftrag');
    expect(anAusgeber(k2, 'bestaetigung')).toHaveLength(0);
  });

  it('weist eine veränderte Anfrage ab (Wurzel passt nicht zu den Blättern)', async () => {
    const { k, u, meine } = await beantwortet();
    const a = anfrageBauen(meine);
    anfrageSenden(k, { ...a, blaetter: [...a.blaetter.slice(1), a.blaetter[0]] });
    const r = await runde(u, wallet, ideal);
    expect(r.bestaetigt).toEqual([]);
    expect(r.abgelehnt).toHaveLength(1);
  });

  it('weist eine Anfrage mit fremden Feldern ab', async () => {
    const { k, u, meine } = await beantwortet();
    anfrageSenden(k, { ...anfrageBauen(meine), extra: 1 });
    const r = await runde(u, wallet, ideal);
    expect(r.abgelehnt[0].grund).toContain('Felder');
  });
});

describe('Öffnung (B4b-4c-1g)', () => {
  const STELLE = ['86', '87'].map((b) => b.repeat(32)); // Schlüssel der Annahmestellen im Knotenvektor (nur Tests)

  async function bestaetigt() {
    const k = knoten();
    auftragSenden(k);
    const u = umgebung(k.f);
    await runde(u, wallet, ideal);
    const meine = anAusgeber(k, 'antwort')[0] as Antwort;
    const anfrage = anfrageBauen(meine);
    anfrageSenden(k, anfrage);
    await runde(u, wallet, ideal);
    const token = { probe_art: 2, gebunden: true, gewaehlt: true, d: '0'.repeat(vektor.auftrag.n), c: 1, wurzel: anfrage.wurzel, proben: anfrage.proben };
    return { k, u, anfrage, token };
  }

  let saat = 0;
  function bitten(k: ReturnType<typeof knoten>, b: number, absender = STELLE[b]) {
    for (const brief of einpacken(absender, { adresse: adresseVon(ICH), pub: pubVon(ICH) }, 'oeffnung', ethers.toUtf8Bytes(JSON.stringify({ k: vektor.auftrag.k, b })), ZEIT, drbg((++saat).toString(16).padStart(64, '0')))) {
      k.einwerfen(adresseVon(absender), adresseVon(ICH), brief);
    }
  }

  function anStelle(k: ReturnType<typeof knoten>, b: number) {
    const zs = new Zusammensetzer();
    const out = [];
    for (const x of k.kasten.filter((y) => y.an === adresseVon(STELLE[b]))) {
      const m = zs.hinzu(oeffnen(STELLE[b], x.inhalt, ZEIT), ZEIT);
      if (m) out.push(JSON.parse(ethers.toUtf8String(m.nutzlast)));
    }
    return out;
  }

  it('gibt die Öffnung erst nach Bindung, Wahl und Finalität heraus, und nur an die Stelle', async () => {
    const { k, u, token } = await bestaetigt();
    bitten(k, 1);
    let r = await runde(u, wallet, ideal);
    expect(r.abgelehnt[0].grund).toContain('Bindung und Wahl auf der Kette');
    k.kette[API].token = { probe_art: 2, gebunden: false, gewaehlt: false, wurzel: token.wurzel, proben: token.proben };
    bitten(k, 1);
    r = await runde(u, wallet, ideal);
    expect(r.abgelehnt[0].grund).toContain('Bindung und Wahl auf der Kette'); // steht, aber ungebunden
    k.kette[API].token = token;
    k.kette[API].hoehe = 120;
    bitten(k, 1);
    r = await runde(u, wallet, ideal);
    expect(r.abgelehnt[0].grund).toContain('gesehen'); // erste Sichtung bei Höhe 120
    k.kette[API].final = 119;
    bitten(k, 1);
    r = await runde(u, wallet, ideal);
    expect(r.abgelehnt[0].grund).toContain('final');
    expect(anStelle(k, 1)).toHaveLength(0);
    k.kette[API].final = 120;
    bitten(k, 1);
    r = await runde(u, wallet, ideal);
    expect(r.geoeffnet).toEqual([vektor.auftrag.k]);
    const [oe] = anStelle(k, 1);
    expect([oe.k, oe.b, oe.x]).toEqual([vektor.auftrag.k, 1, vektor.auftrag.x]);
    expect(Object.keys(oe.pakete).sort()).toEqual(['1', '3']);
    const inhalt = JSON.parse(ethers.toUtf8String(eciesOeffnen(STELLE[1], oe.oeffnung)));
    expect(inhalt.b).toBe(1);
    expect(inhalt.salz).toMatch(/^[0-9a-f]{64}$/);
    expect(() => eciesOeffnen(STELLE[0], oe.oeffnung)).toThrow(); // nur Stelle 1 kann sie lesen
    expect((await new PraepTresor(u.geheim, u.ablage, u.zufall).laden(vektor.auftrag.k))?.stand).toBe('geoeffnet');
  });

  it('weist Anfragen ab, die nicht von der Stelle b kommen', async () => {
    const { k, u, token } = await bestaetigt();
    Object.assign(k.kette[API], { token, final: 1000 });
    bitten(k, 1, STELLE[0]);
    bitten(k, 0, FREMD);
    const r = await runde(u, wallet, ideal);
    expect(r.abgelehnt.map((x) => x.grund).every((g) => g.includes('nicht von dieser Annahmestelle'))).toBe(true);
    expect(r.abgelehnt).toHaveLength(2);
  });

  it('öffnet nicht, wenn auf der Kette eine andere Ausgabe steht als die bestätigte', async () => {
    const { k, u, token } = await bestaetigt();
    Object.assign(k.kette[API], { token: { ...token, wurzel: '77'.repeat(32) }, final: 1000 });
    bitten(k, 1);
    const r = await runde(u, wallet, ideal);
    expect(r.abgelehnt[0].grund).toContain('nicht die bestätigte Ausgabe');
  });

  it('öffnet nicht, wenn die Knoten uneins sind', async () => {
    const { k, u, token } = await bestaetigt();
    Object.assign(k.kette[API], { token, final: 1000 });
    Object.assign(k.kette[K2], { token: { ...token, c: 0 }, final: 1000 });
    bitten(k, 1);
    const r = await runde(u, wallet, ideal, [API, K2]);
    expect(r.abgelehnt[0].grund).toContain('uneins');
  });

  it('eine andere Bindung ist eine neue Sichtung (wieder warten)', async () => {
    const { k, u, token } = await bestaetigt();
    Object.assign(k.kette[API], { token, hoehe: 100, final: 0 });
    bitten(k, 1);
    await runde(u, wallet, ideal); // Sichtung bei 100
    Object.assign(k.kette[API], { token: { ...token, d: '1'.repeat(vektor.auftrag.n) }, hoehe: 200, final: 150 });
    bitten(k, 1);
    const r = await runde(u, wallet, ideal);
    expect(r.abgelehnt[0].grund).toContain('gesehen');
    expect(anStelle(k, 1)).toHaveLength(0);
  });

  it('öffnet nichts ohne Bestätigung und nichts ohne Stichprobe v2', async () => {
    const k = knoten();
    auftragSenden(k);
    const u = umgebung(k.f);
    await runde(u, wallet, ideal);
    bitten(k, 0);
    let r = await runde(u, wallet, ideal);
    expect(r.abgelehnt[0].grund).toContain('keine bestätigte Ausgabe');
    const b = await bestaetigt();
    Object.assign(b.k.kette[API], { token: { ...b.token, probe_art: 1 }, final: 1000 });
    bitten(b.k, 0);
    r = await runde(b.u, wallet, ideal);
    expect(r.abgelehnt[0].grund).toContain('Stichprobe v2');
  });
});
