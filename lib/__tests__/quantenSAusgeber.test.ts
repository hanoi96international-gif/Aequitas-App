// Ausgeber in Weg B, Teil a (lib/quantenSAusgeber.ts): bestellen und losen
// gegen einen nachgebauten Knoten (Register + Einreichen) und nachgebaute
// drand-Relais. Der Beacon ist echt (quicknet, Runde 1.000.000; derselbe, den
// der Knoten in drand_zufall_test.go prüft). Der Prüfvektor entsteht hier; der
// Knoten prüft ihn mit eigenem Code (quanten_s_ausgeber_bestellen_vektor_test.go).
import fs from 'fs';
import path from 'path';
import { ethers } from 'ethers';
import { adresseVon, unterschreiben, unterschriftVon } from '../quantenS';
import type { Speicher } from '../quantenSInhaberin';
import {
  AbweisungFehler,
  BESTELL_FRIST,
  DRAND_KETTE,
  RELAIS,
  bestellNachricht,
  bestellPfand,
  bestellen,
  losRunde,
  losStand,
  registerBestellungLesen,
  vergessen,
  zeitDerRunde,
  zustandLesen,
  type AusgeberUmgebung,
} from '../quantenSAusgeber';
import { drbg } from '../quantenSPraepTresor';

const API = 'https://knoten.test/api';
const ECHT_RUNDE = 1000000;
const ECHT_SIG = '83ad29e4c409f9470fc2ef02f90214df49e02b441a1a241a82d622d9f608ef98fd8b11a029f1bee9d9e83b45088abe72';
const SCHL = '4b'.repeat(32);
const ICH = adresseVon(SCHL);
/** Bestellzeit so, dass genau die echte Runde lost. */
const BUCH = zeitDerRunde(ECHT_RUNDE) - 600;
const LOS = Array.from({ length: 5 }, (_, i) => adresseVon((i + 1).toString(16).padStart(64, '0')));

function speicher(): Speicher & { daten: Map<string, string> } {
  const daten = new Map<string, string>();
  return { daten, lesen: async (k) => daten.get(k) ?? null, schreiben: async (k, v) => void daten.set(k, v), loeschen: async (k) => void daten.delete(k) };
}

function antwort(status: number, o: unknown): Response {
  return { ok: status === 200, status, text: async () => JSON.stringify(o) } as unknown as Response;
}

interface KnotenOpt {
  aktiv?: boolean;
  /** Register verfälschen */
  faelschen?: (b: Record<string, unknown>) => void;
  bestellenAbweisen?: boolean;
  bestellenNetzfehler?: boolean;
  /** Antwort je Relais (sonst die echte) */
  relais?: Record<string, () => Response>;
}

/** Ein Knoten im Speicher: prüft Bestellen und Losen wie die Kette (Unterschrift, Runde, echte Signatur). */
function knoten(uhr: { t: number }, opt: KnotenOpt = {}) {
  const best: Record<string, Record<string, unknown>> = {};
  const eingereicht: { url: string; body: { wallet: string; zeit: number; quanten_w: Record<string, unknown> } }[] = [];
  const relaisGefragt: string[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    if (url === `${API}/quanten-w/praeparatoren`) {
      const liste = Object.values(best).map((b) => {
        const c = JSON.parse(JSON.stringify(b));
        opt.faelschen?.(c);
        return c;
      });
      return antwort(200, { aktiv: opt.aktiv ?? true, praeparatoren: [], bestellungen: liste });
    }
    for (const r of RELAIS) {
      if (url.startsWith(r + '/')) {
        relaisGefragt.push(r);
        expect(url).toBe(`${r}/${DRAND_KETTE}/public/${ECHT_RUNDE}`);
        if (opt.relais?.[r]) return opt.relais[r]();
        return antwort(200, { round: ECHT_RUNDE, randomness: ethers.sha256('0x' + ECHT_SIG).slice(2), signature: ECHT_SIG });
      }
    }
    const body = JSON.parse(init!.body as string);
    eingereicht.push({ url, body });
    expect(Object.keys(body).sort()).toEqual(['quanten_w', 'wallet', 'zeit']);
    const q = body.quanten_w;
    if (url === `${API}/quanten-w/s_bestellen`) {
      if (opt.bestellenNetzfehler) throw new Error('weg');
      if (opt.bestellenAbweisen) return antwort(409, { error: 'rejected: quanten_s_bestellung_offen: schon eine' });
      expect(Object.keys(q).sort()).toEqual(['deckung', 'k', 'praep_zahl', 't', 'wallet_sig']);
      const ok = unterschriftVon(bestellNachricht(body.wallet, q.k, q.praep_zahl, q.t, q.deckung, body.zeit), q.wallet_sig, body.wallet);
      if (!ok || Math.abs(body.zeit - uhr.t) > 300) return antwort(409, { error: 'rejected: quanten_w_unterschrift: x' });
      best[q.k] = { k: q.k, ausgeber: body.wallet, v: q.praep_zahl, t: q.t, zeit: BUCH, frist: BUCH + BESTELL_FRIST, im_abbild: 15, runde: losRunde(BUCH), deckung: q.deckung, pfand: bestellPfand(q.deckung) };
      return antwort(200, { ok: true });
    }
    if (url === `${API}/quanten-w/s_losen`) {
      expect(body.wallet).toBe('');
      expect(body.zeit).toBe(0);
      expect(Object.keys(q).sort()).toEqual(['k', 'runde', 'runde_sig']);
      const b = best[q.k];
      if (!b) return antwort(409, { error: 'rejected: quanten_w_unbekannt: x' });
      if (b.los) return antwort(409, { error: 'rejected: quanten_s_los_doppelt: x' });
      if (q.runde !== b.runde) return antwort(409, { error: 'rejected: quanten_s_los_runde: x' });
      if (q.runde_sig !== ECHT_SIG) return antwort(409, { error: 'rejected: quanten_s_los_drand: drand: Signatur' });
      b.los = LOS.slice(0, b.v as number);
      return antwort(200, { ok: true });
    }
    throw new Error('unbekannt ' + url);
  }) as unknown as typeof fetch;
  return { f, best, eingereicht, relaisGefragt };
}

function umgebung(f: typeof fetch, uhr: { t: number }): AusgeberUmgebung & { ablage: ReturnType<typeof speicher> } {
  return { fetchFn: f, apiBasis: API, ablage: speicher(), zufall: drbg('a1'.repeat(32)), jetzt: () => uhr.t * 1000 };
}
const wallet = { entsperren: async () => ({ privateKey: '0x' + SCHL }) };

describe('B4b-4c-2a: Rechnung wie der Knoten', () => {
  test('Runde: die erste ab Bestellzeit + 600 s (quantenSLosRunde)', () => {
    expect(losRunde(BUCH)).toBe(ECHT_RUNDE);
    expect(losRunde(BUCH + 1)).toBe(ECHT_RUNDE + 1);
    expect(losRunde(BUCH + 3)).toBe(ECHT_RUNDE + 1);
    expect(losRunde(BUCH + 4)).toBe(ECHT_RUNDE + 2);
    expect(losRunde(BUCH - 2)).toBe(ECHT_RUNDE);
    expect(losRunde(BUCH - 3)).toBe(ECHT_RUNDE - 1);
    expect(losRunde(1)).toBe(1);
    expect(() => losRunde(0)).toThrow();
  });
  test('Pfand: max(1 AEQ, ceil(10 %))', () => {
    expect(bestellPfand(1_000_000)).toBe(1_000_000);
    expect(bestellPfand(10_000_000)).toBe(1_000_000);
    expect(bestellPfand(10_000_001)).toBe(1_000_001);
    expect(bestellPfand(10_000_009)).toBe(1_000_001);
    expect(bestellPfand(10_000_010)).toBe(1_000_001);
    expect(bestellPfand(10_000_011)).toBe(1_000_002);
    expect(bestellPfand(123_456_789)).toBe(12_345_679);
  });
});

describe('B4b-4c-2a: bestellen und losen', () => {
  test('Gutfall: bestellen, warten bis zur Runde, losen mit dem echten Beacon, Los gesichert', async () => {
    const uhr = { t: BUCH };
    const k = knoten(uhr);
    const u = umgebung(k.f, uhr);
    const z = await bestellen(u, wallet, 5, 3, 5_000_000);
    expect(z.stand).toBe('eingereicht');
    expect(z.ausgeber).toBe(ICH);
    expect(k.best[z.k]).toBeDefined();
    // Vor der Runde: warten, kein Relais gefragt.
    uhr.t = BUCH + 300;
    const w = await losStand(u);
    expect(w).toMatchObject({ stand: 'warten', ab: zeitDerRunde(ECHT_RUNDE) });
    expect(k.relaisGefragt).toEqual([]);
    expect((await zustandLesen(u))!.stand).toBe('bestellt');
    uhr.t = BUCH + 605;
    const g = await losStand(u);
    expect(g.stand).toBe('gelost');
    expect((await zustandLesen(u))!.los).toEqual(LOS);
    expect(k.relaisGefragt).toEqual([RELAIS[0]]);
    // Noch einmal: nichts mehr im Netz.
    const n = k.eingereicht.length;
    expect((await losStand(u)).stand).toBe('gelost');
    expect(k.eingereicht.length).toBe(n);
    // Eine zweite Bestellung, solange die erste gilt: nein.
    await expect(bestellen(u, wallet, 5, 3, 5_000_000)).rejects.toThrow('offene Bestellung');
    await expect(vergessen(u)).rejects.toThrow('gilt noch');
    uhr.t = BUCH + BESTELL_FRIST + 1;
    await vergessen(u);
    expect(await zustandLesen(u)).toBeNull();
  });

  test('Missbrauch: Relais liefern Unsinn oder eine falsche Signatur -- das nächste Relais', async () => {
    const uhr = { t: BUCH };
    const falsch = 'a'.repeat(96);
    const k = knoten(uhr, {
      relais: {
        [RELAIS[0]]: () => antwort(200, { round: ECHT_RUNDE + 1, randomness: ethers.sha256('0x' + ECHT_SIG).slice(2), signature: ECHT_SIG }),
        [RELAIS[1]]: () => antwort(200, { round: ECHT_RUNDE, randomness: '00'.repeat(32), signature: ECHT_SIG }),
        [RELAIS[2]]: () => antwort(200, { round: ECHT_RUNDE, randomness: ethers.sha256('0x' + falsch).slice(2), signature: falsch }),
      },
    });
    const u = umgebung(k.f, uhr);
    await bestellen(u, wallet, 5, 3, 5_000_000);
    uhr.t = BUCH + 700;
    expect((await losStand(u)).stand).toBe('gelost');
    expect(k.relaisGefragt).toEqual(RELAIS);
    // Nur die falsche Signatur von Relais 3 erreichte den Knoten, dann die echte.
    expect(k.eingereicht.filter((e) => e.url.endsWith('s_losen')).map((e) => e.body.quanten_w.runde_sig)).toEqual([falsch, ECHT_SIG]);
  });

  test('Missbrauch: alle Relais falsch -- Fehler, Zustand bleibt bestellt', async () => {
    const uhr = { t: BUCH };
    const kaputt = () => antwort(200, { round: ECHT_RUNDE, signature: 'zz' });
    const k = knoten(uhr, { relais: Object.fromEntries(RELAIS.map((r) => [r, kaputt])) });
    const u = umgebung(k.f, uhr);
    await bestellen(u, wallet, 5, 3, 5_000_000);
    uhr.t = BUCH + 700;
    await expect(losStand(u)).rejects.toThrow('Losen gescheitert');
    expect((await zustandLesen(u))!.stand).toBe('bestellt');
    expect(k.eingereicht.filter((e) => e.url.endsWith('s_losen'))).toEqual([]);
  });

  test('Missbrauch: der Knoten fälscht Runde, Pfand, Frist oder Los -- abgewiesen', async () => {
    const faelschungen: [string, (b: Record<string, unknown>) => void, string][] = [
      ['Runde', (b) => void (b.runde = (b.runde as number) + 1), 'Runde'],
      ['Pfand', (b) => void (b.pfand = 1), 'Pfand'],
      ['Frist', (b) => void (b.frist = (b.frist as number) + 1), 'Frist'],
      ['Los doppelt', (b) => void (b.los = [LOS[0], LOS[0], LOS[1], LOS[2], LOS[3]]), 'Los'],
      ['Los zu kurz', (b) => void (b.los = LOS.slice(0, 4)), 'Los'],
      ['Los Form', (b) => void (b.los = LOS.map((a) => a.toUpperCase())), 'Los'],
      ['fremder Ausgeber', (b) => void (b.ausgeber = LOS[0]), 'passt nicht'],
      ['andere Deckung', (b) => {
        b.deckung = 6_000_000;
        b.pfand = bestellPfand(6_000_000);
      }, 'passt nicht'],
    ];
    for (const [, fn, grund] of faelschungen) {
      const uhr = { t: BUCH };
      const k = knoten(uhr, { faelschen: (b) => {
        b.los ??= LOS;
        fn(b);
      } });
      const u = umgebung(k.f, uhr);
      await bestellen(u, wallet, 5, 3, 5_000_000);
      uhr.t = BUCH + 700;
      await expect(losStand(u)).rejects.toThrow(grund);
      expect((await zustandLesen(u))!.stand).toBe('eingereicht');
    }
  });

  test('Missbrauch: Weg B schläft -- nichts', async () => {
    const uhr = { t: BUCH };
    const k = knoten(uhr, { aktiv: false });
    const u = umgebung(k.f, uhr);
    await bestellen(u, wallet, 5, 3, 5_000_000);
    await expect(losStand(u)).rejects.toThrow('nicht aktiv');
  });

  test('abgewiesen: Zustand gelöscht; Netzfehler: Zustand bleibt, später verworfen', async () => {
    const uhr = { t: BUCH };
    const a = knoten(uhr, { bestellenAbweisen: true });
    const ua = umgebung(a.f, uhr);
    await expect(bestellen(ua, wallet, 5, 3, 5_000_000)).rejects.toThrow(AbweisungFehler);
    expect(await zustandLesen(ua)).toBeNull();

    const n = knoten(uhr, { bestellenNetzfehler: true });
    const un = umgebung(n.f, uhr);
    await expect(bestellen(un, wallet, 5, 3, 5_000_000)).rejects.toThrow('Netz');
    expect((await zustandLesen(un))!.stand).toBe('eingereicht');
    expect((await losStand(un)).stand).toBe('eingereicht');
    await expect(bestellen(un, wallet, 5, 3, 5_000_000)).rejects.toThrow('offene Bestellung');
    uhr.t = BUCH + 301;
    expect((await losStand(un)).stand).toBe('verworfen');
    expect(await zustandLesen(un)).toBeNull();
  });

  test('Eingaben: v, t und Deckung wie die Kette', async () => {
    const uhr = { t: BUCH };
    const u = umgebung(knoten(uhr).f, uhr);
    for (const [v, t, d] of [[3, 2, 5e6], [17, 3, 5e6], [5, 0, 5e6], [5, 6, 5e6]]) {
      await expect(bestellen(u, wallet, v, t, d)).rejects.toThrow('oder t (1..v)');
    }
    for (const d of [999_999, 1.5e6 + 0.5]) await expect(bestellen(u, wallet, 5, 3, d)).rejects.toThrow('Deckung mindestens');
    expect(await zustandLesen(u)).toBeNull();
  });

  test('beschädigter Zustand im Gerät: abgewiesen', async () => {
    const uhr = { t: BUCH };
    const k = knoten(uhr);
    const u = umgebung(k.f, uhr);
    const z = await bestellen(u, wallet, 5, 3, 5_000_000);
    for (const kaputt of ['{', JSON.stringify({ ...z, v: 3 }), JSON.stringify({ ...z, stand: 'gelost' }), JSON.stringify({ ...z, extra: 1 })]) {
      u.ablage.daten.set('aequitas.quantenS.ausgeber.zustand', kaputt);
      await expect(losStand(u)).rejects.toThrow('unlesbar');
    }
  });

  test('Register ohne Bestellungen oder ohne eigene: null', () => {
    expect(registerBestellungLesen({ aktiv: true }, 'a'.repeat(64))).toBeNull();
    expect(registerBestellungLesen({ aktiv: true, bestellungen: [] }, 'a'.repeat(64))).toBeNull();
    expect(() => registerBestellungLesen({ aktiv: true, bestellungen: {} }, 'a'.repeat(64))).toThrow();
  });
});

// ------------------------------------------------------------ Prüfvektor

const PFAD = path.join(__dirname, 'vektoren', 'quanten_s_ausgeber_bestellen_vektor.json');

function vektorBauen() {
  const K = ethers.sha256(ethers.toUtf8Bytes('aequitas-b4b4c2a-vektor')).slice(2);
  const v = 5;
  const t = 3;
  const deckung = 12_345_678;
  const zeit = BUCH;
  const nachricht = bestellNachricht(ICH, K, v, t, deckung, zeit);
  const sig = unterschreiben(SCHL, nachricht);
  return {
    hinweis: 'Aus der App (lib/__tests__/quantenSAusgeber.test.ts); der Knoten prüft ihn mit eigenem Code.',
    schluessel_nur_test: SCHL,
    wallet: ICH,
    k: K,
    v,
    t,
    deckung,
    zeit,
    nachricht,
    wallet_sig: sig,
    pfand: bestellPfand(deckung),
    koerper_bestellen: JSON.stringify({ wallet: ICH, zeit, quanten_w: { k: K, t, praep_zahl: v, deckung, wallet_sig: sig } }),
    runde: losRunde(zeit),
    runde_sig: ECHT_SIG,
    koerper_losen: JSON.stringify({ wallet: '', zeit: 0, quanten_w: { k: K, runde: losRunde(zeit), runde_sig: ECHT_SIG } }),
    pfand_tabelle: [1, 999_999, 1_000_000, 10_000_000, 10_000_001, 10_000_009, 10_000_010, 10_000_011, 123_456_789, 9_007_199_254_740_991].map((d) => [d, bestellPfand(d)]),
    runden_tabelle: [BUCH - 3, BUCH - 2, BUCH - 1, BUCH, BUCH + 1, BUCH + 2, BUCH + 3, BUCH + 4, 1, 1692803367 - 600, 1692803367 - 599].map((z) => [z, losRunde(z)]),
  };
}

describe('B4b-4c-2a: Prüfvektor', () => {
  const neu = vektorBauen();
  if (process.env.AEQUITAS_VEKTOR_SCHREIBEN === '1') fs.writeFileSync(PFAD, JSON.stringify(neu, null, 1) + '\n');
  const alt = JSON.parse(fs.readFileSync(PFAD, 'utf8'));

  test('Byte für Byte wie im Vektor (der Knoten prüft genau ihn)', () => {
    expect(neu).toEqual(alt);
    expect(alt.runde).toBe(ECHT_RUNDE);
    expect(unterschriftVon(alt.nachricht, alt.wallet_sig, alt.wallet)).toBe(true);
  });
});
