// 4c-4: die Messung der Präparatorin ist fortsetzbar. Eine Messung bei IBM wartet
// bis zu Stunden; das Handy beendet die App vorher. Vor dem ersten IBM-Auftrag
// liegt eine Messung (Seed, Kennungen) im Tresor; die nächste Runde setzt fort,
// mit demselben Seed (also denselben u, t) und ohne neuen Auftrag bei IBM.
// Harness wie quantenSPraepAblauf.test.ts.
jest.mock('expo-secure-store', () => ({}));
jest.mock('expo-crypto', () => ({ getRandomBytes: () => new Uint8Array(0) }));
jest.mock('../config', () => ({ API_BASE: 'https://knoten.test/api' }));
import { ethers } from 'ethers';
import vektor from './vektoren/quanten_s_praep_auftrag_vektor.json';
import { adresseVon, pubVon, unterschreiben } from '../quantenS';
import { Zusammensetzer, einpacken, oeffnen } from '../quantenSHuelle';
import type { Speicher } from '../quantenSInhaberin';
import { MESSUNG_ALT, auftragBeantworten, bestellungenHolen, runde, type Fortsetzung, type Messer, type PraepUmgebung } from '../quantenSPraepAblauf';
import { auftragNachricht } from '../quantenSPraepAuftrag';
import { MESSUNGEN_MAX, PraepTresor, drbg, type Messung } from '../quantenSPraepTresor';

const API = 'https://knoten.test/api';
const AUSGEBER = vektor.praeger_schluessel_nur_test;
const ICH = vektor.praeparatoren_schluessel_nur_test[vektor.auftrag.x - 1];
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


class Abbruch extends Error {}

/** Ein Messer wie IBM: reicht einen Auftrag ein (merken), dann bricht die App ab -- oder liefert. */
function ibmAttrappe() {
  const aufrufe: { u: number[]; t: number[]; jobs: (string | null)[] }[] = [];
  let eingereicht = 0;
  let abbrechen = true;
  const messer: Messer = {
    messen: async (u, t, y, fort?: Fortsetzung) => {
      aufrufe.push({ u: [...u], t: [...t], jobs: [...(fort?.jobs ?? [])] });
      const jobs = [...(fort?.jobs ?? [])];
      if (jobs[0] == null) {
        eingereicht++;
        jobs[0] = 'job' + eingereicht + 'abcdef';
        await fort!.merken(jobs);
      }
      if (abbrechen) throw new Abbruch('App beendet');
      return ideal.messen(u, t, y);
    },
  };
  return { messer, aufrufe, eingereicht: () => eingereicht, weiter: () => void (abbrechen = false) };
}

describe('Messung fortsetzbar (4c-4)', () => {
  it('Abbruch während der Messung: die nächste Runde setzt fort -- derselbe IBM-Auftrag, dieselben u und t, dann die Antwort', async () => {
    const k = knoten();
    auftragSenden(k);
    const u = umgebung(k.f);
    const ibm = ibmAttrappe();
    const r1 = await runde(u, wallet, ibm.messer);
    expect(r1.beantwortet).toEqual([]);
    expect(r1.abgelehnt.map((a) => a.grund)).toEqual(['App beendet']);
    expect(antwortLesen(k)).toBeNull();
    const tresor = new PraepTresor(u.geheim, u.ablage, u.zufall);
    expect(await tresor.messungen()).toEqual([vektor.auftrag.k]);
    expect((await tresor.messungLaden(vektor.auftrag.k))!.jobs).toEqual(['job1abcdef']);
    expect(await tresor.laden(vektor.auftrag.k)).toBeNull(); // noch kein Fall
    // Der Brief ist quittiert -- die Fortsetzung braucht ihn nicht.
    expect(k.kasten.filter((x) => x.an === adresseVon(ICH))).toHaveLength(0);

    ibm.weiter();
    const r2 = await runde(u, wallet, ibm.messer);
    expect(r2.beantwortet).toEqual([vektor.auftrag.k]);
    expect(ibm.eingereicht()).toBe(1); // kein zweiter IBM-Auftrag
    expect(ibm.aufrufe[1].jobs).toEqual(['job1abcdef']);
    expect(ibm.aufrufe[1].u).toEqual(ibm.aufrufe[0].u);
    expect(ibm.aufrufe[1].t).toEqual(ibm.aufrufe[0].t);
    const m = antwortLesen(k)!;
    expect(m.art).toBe('antwort');
    expect((await tresor.laden(vektor.auftrag.k))!.stand).toBe('beantwortet');
    expect(await tresor.messungen()).toEqual([]);
    // Eine dritte Runde misst nichts mehr.
    const r3 = await runde(u, wallet, ibm.messer);
    expect(r3.beantwortet).toEqual([]);
    expect(ibm.aufrufe).toHaveLength(2);
  });

  it('der Ausgeber schickt denselben Auftrag noch einmal: setzt dieselbe Messung fort (kein neuer Seed)', async () => {
    const k = knoten();
    auftragSenden(k);
    const u = umgebung(k.f);
    const ibm = ibmAttrappe();
    await runde(u, wallet, ibm.messer);
    auftragSenden(k, AUSGEBER, 'b');
    ibm.weiter();
    const r = await runde(u, wallet, ibm.messer);
    expect(r.beantwortet).toEqual([vektor.auftrag.k]);
    expect(ibm.eingereicht()).toBe(1);
    expect(ibm.aufrufe[1].u).toEqual(ibm.aufrufe[0].u);
  });

  it('ein ANDERER Auftrag zum selben K während der Messung: abgelehnt, die Messung bleibt', async () => {
    const k = knoten();
    auftragSenden(k);
    const u = umgebung(k.f);
    const ibm = ibmAttrappe();
    await runde(u, wallet, ibm.messer);
    // Echt vom Ausgeber unterschrieben, nur eine Sekunde später: besteht jede Prüfung des Auftrags.
    const anders: any = { ...vektor.auftrag, zeit: vektor.auftrag.zeit + 1 };
    anders.praeger_sig = unterschreiben(AUSGEBER, auftragNachricht(anders));
    const tresor = new PraepTresor(u.geheim, u.ablage, u.zufall);
    const vorher = (await tresor.messungLaden(vektor.auftrag.k))!;
    const m = { art: 'auftrag' as const, von: vektor.auftrag.praeger, pub: vorher.pub, id: 'x', zeit: ZEIT, nutzlast: ethers.toUtf8Bytes(JSON.stringify(anders)) };
    await expect(auftragBeantworten(u, ICH, tresor, m, ibm.messer, () => bestellungenHolen(u))).rejects.toThrow('schon ein anderer Auftrag für dieses K');
    expect(ibm.aufrufe).toHaveLength(1);
    expect((await tresor.messungLaden(vektor.auftrag.k))!.seed).toBe(vorher.seed);
  });

  it('zu alt (nie mehr beantwortbar): gelöscht, nichts gesendet', async () => {
    const k = knoten();
    auftragSenden(k);
    const u = umgebung(k.f);
    const ibm = ibmAttrappe();
    await runde(u, wallet, ibm.messer);
    ibm.weiter();
    const spaeter = { ...u, jetzt: () => (ZEIT + MESSUNG_ALT + 1) * 1000 };
    const r = await runde(spaeter, wallet, ibm.messer);
    expect(r.beantwortet).toEqual([]);
    expect(r.abgelehnt.map((a) => a.grund)).toContain('Messung verfallen (nie beantwortet)');
    expect(ibm.aufrufe).toHaveLength(1);
    expect(antwortLesen(k)).toBeNull();
    expect(await new PraepTresor(u.geheim, u.ablage, u.zufall).messungen()).toEqual([]);
  });

  it('die gesicherte Messung wird bei der Fortsetzung voll neu geprüft: ruht Weg B, keine Antwort', async () => {
    const k = knoten();
    auftragSenden(k);
    const u = umgebung(k.f);
    const ibm = ibmAttrappe();
    await runde(u, wallet, ibm.messer);
    ibm.weiter();
    const schlafend = knoten({ aktiv: false });
    const r = await runde({ ...u, fetchFn: schlafend.f }, wallet, ibm.messer);
    expect(r.beantwortet).toEqual([]);
    expect(r.abgelehnt).toHaveLength(1);
    expect(ibm.aufrufe).toHaveLength(1); // vor der Messung abgelehnt
    expect(schlafend.kasten).toHaveLength(0);
  });

  it('eine veränderte Messung im Gerät fällt auf (keine Antwort)', async () => {
    const k = knoten();
    auftragSenden(k);
    const u = umgebung(k.f);
    const ibm = ibmAttrappe();
    await runde(u, wallet, ibm.messer);
    const key = 'aequitas.quantenS.praep.messung.' + vektor.auftrag.k;
    const c = u.ablage.daten.get(key)!;
    u.ablage.daten.set(key, c.slice(0, -2) + (c.endsWith('00') ? '01' : '00'));
    ibm.weiter();
    const r = await runde(u, wallet, ibm.messer);
    expect(r.beantwortet).toEqual([]);
    expect(r.abgelehnt[0].grund).toContain('Tresor');
    expect(antwortLesen(k)).toBeNull();
  });
});

describe('Tresor: Messungen', () => {
  const mess = (k: string, mehr: Partial<Messung> = {}): Messung => ({
    k, auftrag: { ...vektor.auftrag, k } as any, seed: '11'.repeat(32), pub: pubVon(AUSGEBER).replace(/^0x/, ''), jobs: [], zeit: ZEIT, ...mehr,
  });
  const tresor = () => new PraepTresor(speicher(), speicher(), drbg('77'.repeat(32)));

  it('speichern, laden, löschen; getrennt vom Fall', async () => {
    const t = tresor();
    await t.messungSpeichern(mess(vektor.auftrag.k, { jobs: [null, 'abcdefgh1'] }));
    expect((await t.messungLaden(vektor.auftrag.k))!.jobs).toEqual([null, 'abcdefgh1']);
    expect(await t.laden(vektor.auftrag.k)).toBeNull();
    expect(await t.liste()).toEqual([]);
    await t.messungLoeschen(vektor.auftrag.k);
    expect(await t.messungLaden(vektor.auftrag.k)).toBeNull();
  });

  it.each([
    ['Kennung mit Großbuchstaben', { jobs: ['ABCDEFGH'] }],
    ['Kennung zu kurz', { jobs: ['abc'] }],
    ['zu viele Aufträge', { jobs: Array(65).fill(null) }],
    ['Schlüssel kein Punkt', { pub: '02' + 'ab'.repeat(32) }],
    ['Seed kein Hex', { seed: 'zz'.repeat(32) }],
    ['Zeit 0', { zeit: 0 }],
  ])('weist ab: %s', async (_n, mehr) => {
    await expect(tresor().messungSpeichern(mess(vektor.auftrag.k, mehr as Partial<Messung>))).rejects.toThrow('Tresor: Messung');
  });

  it('weist einen Auftrag zu anderem K und fremde Felder ab', async () => {
    await expect(tresor().messungSpeichern({ ...mess('ee'.repeat(32)), auftrag: vektor.auftrag as any })).rejects.toThrow('anderem K');
    await expect(tresor().messungSpeichern({ ...mess(vektor.auftrag.k), x: 1 } as any)).rejects.toThrow('Felder');
  });

  it('höchstens MESSUNGEN_MAX laufende Messungen', async () => {
    const t = tresor();
    const ks = Array.from({ length: MESSUNGEN_MAX + 1 }, (_, i) => (i + 1).toString(16).padStart(2, '0').repeat(32));
    for (const kk of ks.slice(0, MESSUNGEN_MAX)) await t.messungSpeichern(mess(kk));
    await expect(t.messungSpeichern(mess(ks[MESSUNGEN_MAX]))).rejects.toThrow('zu viele laufende Messungen');
    await t.messungSpeichern(mess(ks[0], { jobs: ['abcdefgh'] })); // eine bestehende darf sich ändern
  });

  it('das Chiffrat einer Messung gilt nicht unter einem anderen K und nicht als Fall', async () => {
    const g = speicher();
    const a = speicher();
    const t = new PraepTresor(g, a, drbg('77'.repeat(32)));
    const K2 = 'ee'.repeat(32);
    await t.messungSpeichern(mess(vektor.auftrag.k));
    const c = a.daten.get('aequitas.quantenS.praep.messung.' + vektor.auftrag.k)!;
    a.daten.set('aequitas.quantenS.praep.messung.' + K2, c);
    await expect(t.messungLaden(K2)).rejects.toThrow('Chiffrat');
    a.daten.set('aequitas.quantenS.praep.fall.' + vektor.auftrag.k, c);
    await expect(t.laden(vektor.auftrag.k)).rejects.toThrow('Chiffrat');
  });
});
