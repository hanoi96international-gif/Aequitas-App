// Ablauf der Präparatorin (lib/quantenSPraepAblauf.ts) gegen einen
// nachgebauten Knoten (Briefkasten + Register im Speicher). Der Auftrag ist
// der echte aus dem Prüfvektor des Knotens.
jest.mock('expo-secure-store', () => ({}));
jest.mock('expo-crypto', () => ({ getRandomBytes: () => new Uint8Array(0) }));
jest.mock('../config', () => ({ API_BASE: 'https://knoten.test/api' }));
import { ethers } from 'ethers';
import vektor from './vektoren/quanten_s_praep_auftrag_vektor.json';
import { adresseVon, antwortNachricht, hashListe, pubVon, unterschriftVon } from '../quantenS';
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
function knoten(opt: { aktiv?: boolean } = {}) {
  let id = 0;
  const kasten: { id: number; von: string; an: string; inhalt: string; zeit: number }[] = [];
  const bestellung = { k: vektor.auftrag.k, ausgeber: vektor.auftrag.praeger, v: 3, t: 2, zeit: vektor.auftrag.zeit - 600, frist: vektor.auftrag.zeit + 3000, im_abbild: 3, runde: 1, deckung: 1, pfand: 1, los: vektor.auftrag.validatoren };
  const f = (async (url: string, init?: RequestInit) => {
    const ok = (o: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(o) }) as unknown as Response;
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
  return { f, kasten, einwerfen };
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
