// Der Ablauf der App als Inhaberin (lib/quantenSInhaberin.ts) gegen eine
// Schein-Kette und Schein-Validatoren aus dem Pruefvektor des Knotens: die
// App schickt genau die Bindung und Wahl, die der Knoten erwartet, und
// unterschreibt genau seine Vorlage.
jest.mock('expo-secure-store', () => ({}));
jest.mock('expo-crypto', () => ({ getRandomBytes: () => new Uint8Array(0) }));
jest.mock('../config', () => ({ API_BASE: 'https://knoten.test/api' }));

import { ethers } from 'ethers';
import vektor from './vektoren/quanten_s_inhaberin_vektor.json';
import { abholen, apiPruefen, einloesen, neu, stelleSchluesselPruefen, vergessen, WARTEN_MAX_MS, zustandAnzeigen, type Umgebung } from '../quantenSInhaberin';

const V = vektor as any;
const API = 'https://knoten.test/api';
const VAL = V.abschnitte.map((a: any, i: number) => ({ adresse: a.validator, api: `https://v${i + 1}.test/api` }));

function stelle(seed: number) {
  const w = new ethers.Wallet('0x' + seed.toString(16).padStart(2, '0').repeat(32));
  return { adresse: w.address.toLowerCase(), schluessel: w.signingKey.publicKey.slice(2) };
}

interface Welt {
  u: Umgebung;
  kette: Record<string, any> | null;
  posts: { url: string; body: any }[];
  speicher: Map<string, string>;
  zeit: number;
  antwort: (url: string) => { status: number; text: string } | null;
}

function welt(): Welt {
  const st = [stelle(0x31), stelle(0x32)];
  const w: Welt = {
    kette: {
      k: V.k, art: 's', n: V.n, t: 1, v: V.v, tol: 2, inhaber: V.inhaberin, stellen: [st[0].adresse, st[1].adresse],
      gebunden: false, gewaehlt: false, fehl: 0, probe_art: 2, wurzel: V.wurzel, proben: V.proben,
    },
    posts: [],
    speicher: new Map(),
    zeit: 0,
    antwort: () => null,
    u: undefined as unknown as Umgebung,
  };
  // Zufall: erst der Schluessel (0x51...), dann die Basen y des Vektors, dann z.
  const zufall = [ethers.getBytes('0x' + V.inhaberin_schluessel_nur_test), Uint8Array.from(V.y.split('').map(Number)), Uint8Array.from([V.z])];
  const fetchFn = (async (url: string, init?: any) => {
    const sonder = w.antwort(url);
    if (sonder) return { status: sonder.status, ok: sonder.status < 300, text: async () => sonder.text } as any;
    if (init?.method === 'POST') {
      const body = JSON.parse(init.body);
      w.posts.push({ url, body });
      if (url === `${API}/quanten-w/s_binden`) w.kette = { ...w.kette!, gebunden: true, d: body.quanten_w.d };
      if (url === `${API}/quanten-w/s_waehlen`) w.kette = { ...w.kette!, gewaehlt: true, c: Number(body.quanten_w.c) };
      return { status: 200, ok: true, text: async () => '{}' } as any;
    }
    if (url === `${API}/quanten-w/note?k=${V.k}`) {
      return w.kette ? ({ status: 200, ok: true, text: async () => JSON.stringify(w.kette) } as any) : ({ status: 404, ok: false, text: async () => '' } as any);
    }
    const i = VAL.findIndex((v: any) => url === `${v.api}/quanten-w/validator/fuer-inhaberin?k=${V.k}`);
    if (i >= 0) return { status: 200, ok: true, text: async () => JSON.stringify(V.abschnitte[i].abschnitt) } as any;
    return { status: 404, ok: false, text: async () => '' } as any;
  }) as unknown as typeof fetch;
  w.u = {
    fetchFn,
    speicher: {
      lesen: async (k) => w.speicher.get(k) ?? null,
      schreiben: async (k, v) => void w.speicher.set(k, v),
      loeschen: async (k) => void w.speicher.delete(k),
    },
    zufall: (n) => {
      const z = zufall.shift();
      if (!z || z.length !== n) throw new Error(`Zufall ${n}`);
      return z;
    },
    apiBasis: API,
    warten: async (ms) => void (w.zeit += ms),
    jetzt: () => w.zeit,
  };
  (w as any).stellen = st;
  return w;
}

async function bestellt(w: Welt) {
  return neu(w.u, V.n, V.v, (w as any).stellen);
}

describe('App als Inhaberin: Ablauf', () => {
  test('neu, abholen, einloesen: genau die Bindung, Wahl und Vorlage des Knotens', async () => {
    const w = welt();
    const best = await bestellt(w);
    expect(best.inhaberin).toBe(V.inhaberin);
    expect(best.inhaberin_schluessel).toBe(V.inhaberin_pub);
    expect(best.basen!.join('')).toBe(V.y);
    expect(JSON.stringify(best)).not.toContain(V.inhaberin_schluessel_nur_test);
    expect(await abholen(w.u, V.k.toUpperCase(), VAL)).toEqual({ k: V.k, n: V.n });
    const schritte: string[] = [];
    const vl = await einloesen(w.u, V.stelle, (s) => schritte.push(s));
    expect(schritte).toEqual(['binden', 'waehlen', 'vorlage']);
    expect(w.posts.map((p) => p.url)).toEqual([`${API}/quanten-w/s_binden`, `${API}/quanten-w/s_waehlen`]);
    expect(w.posts[0].body).toEqual({ wallet: V.inhaberin, zeit: 0, quanten_w: { k: V.k, d: V.d, wallet_sig: V.binden_sig } });
    expect(w.posts[1].body).toEqual({ wallet: V.inhaberin, zeit: 0, quanten_w: { k: V.k, c: V.c, wallet_sig: V.wahl_sig } });
    expect(vl).toEqual(V.vorlage);
    // Dieselbe Stelle noch einmal: nichts Neues auf der Kette, dieselbe Vorlage.
    expect(await einloesen(w.u, V.stelle)).toEqual(V.vorlage);
    expect(w.posts.length).toBe(2);
    // Zustand: kompakt, ohne Schluessel.
    const roh = w.speicher.get('aequitas.quantenS.inhaberin.zustand')!;
    expect(roh.length).toBeLessThan(2048);
    expect(roh).not.toContain(V.inhaberin_schluessel_nur_test);
    expect(await zustandAnzeigen(w.u)).toEqual({ n: V.n, v: V.v, k: V.k, stellen: w.kette!.stellen, gebunden: true, wegB: false });
  });

  test('keine Doppelvorlage: fuer die nicht gewaehlte Stelle keine Unterschrift', async () => {
    const w = welt();
    await bestellt(w);
    await abholen(w.u, V.k, VAL);
    await einloesen(w.u, V.stelle);
    await expect(einloesen(w.u, (1 - V.stelle) as 0 | 1)).rejects.toThrow('Doppelvorlage');
  });

  test('die Maske wird VOR der Bindung gespeichert; ein Fehler beim Einreichen verliert sie nicht', async () => {
    const w = welt();
    await bestellt(w);
    await abholen(w.u, V.k, VAL);
    w.antwort = (url) => (url.endsWith('/s_binden') ? { status: 503, text: '' } : null);
    await expect(einloesen(w.u, V.stelle)).rejects.toThrow('Bindung: HTTP 503');
    expect(JSON.parse(w.speicher.get('aequitas.quantenS.inhaberin.zustand')!).z).toBe(V.z);
    w.antwort = () => null;
    expect(await einloesen(w.u, V.stelle)).toEqual(V.vorlage); // dieselbe Maske, kein neuer Zufall
  });

  test('Warten auf die Kette ist begrenzt', async () => {
    const w = welt();
    await bestellt(w);
    await abholen(w.u, V.k, VAL);
    w.antwort = (url) => (url.endsWith('/s_binden') ? { status: 200, text: '{}' } : null); // angenommen, aber nie auf der Kette
    await expect(einloesen(w.u, V.stelle)).rejects.toThrow('Bindung: nicht in 20 Minuten');
    expect(w.zeit).toBeGreaterThanOrEqual(WARTEN_MAX_MS);
    expect(w.zeit).toBeLessThanOrEqual(WARTEN_MAX_MS + 5_000); // hoechstens ein Takt darueber
  });
});

describe('App als Inhaberin: Missbrauch', () => {
  test('Bestellung: falscher Schluessel der Stelle, dieselbe Stelle zweimal, Groessen', async () => {
    const w = welt();
    const [a, b] = (w as any).stellen;
    await expect(neu(w.u, V.n, V.v, [{ ...a, schluessel: b.schluessel }, b])).rejects.toThrow('gehoert nicht zur Adresse');
    await expect(neu(w.u, V.n, V.v, [a, a])).rejects.toThrow('zweimal');
    await expect(neu(w.u, 1, 1, [a, b])).rejects.toThrow('n oder v');
    await expect(neu(w.u, 16385, 1, [a, b])).rejects.toThrow('n oder v');
    expect(() => stelleSchluesselPruefen({ adresse: a.adresse, schluessel: 'zz' })).toThrow('Form');
  });

  test('neu ueberschreibt keine offene Bestellung (der Ausgeber koennte schon ausgegeben haben)', async () => {
    const w = welt();
    const best = await bestellt(w);
    await expect(neu(w.u, V.n, V.v, (w as any).stellen)).rejects.toThrow('schon eine Bestellung');
    const { bestellungAnzeigen } = require('../quantenSInhaberin');
    expect(await bestellungAnzeigen(w.u)).toEqual(best); // nach einem Neustart wieder zu zeigen
    await abholen(w.u, V.k, VAL);
    expect(await bestellungAnzeigen(w.u)).toBeNull();
  });

  test('zu grosses n fuer den Speicher: nichts geschrieben', async () => {
    const w = welt();
    await expect(neu(w.u, 8000, 1, (w as any).stellen)).rejects.toThrow('zu gross');
    expect(w.speicher.size).toBe(0);
  });

  test('neu ueberschreibt keinen angenommenen Token; vergessen nicht, solange er auf der Kette steht', async () => {
    const w = welt();
    await bestellt(w);
    await abholen(w.u, V.k, VAL);
    await expect(neu(w.u, V.n, V.v, (w as any).stellen)).rejects.toThrow('schon einen angenommenen Token');
    await expect(vergessen(w.u)).rejects.toThrow('noch auf der Kette');
    w.kette = null; // eingeloest oder tot
    await vergessen(w.u);
    expect(w.speicher.size).toBe(0);
  });

  test('abholen: nur https, strenge Felder, Groesse, fremdes K, schon gebunden', async () => {
    const bereit = async () => {
      const w = welt();
      await bestellt(w);
      return w;
    };
    let w = await bereit();
    await expect(abholen(w.u, V.k, [{ ...VAL[0], api: 'http://v1.test/api' }, VAL[1]])).rejects.toThrow('nur https');
    await expect(abholen(w.u, V.k, [{ ...VAL[0], api: 'https://x@v1.test/api' }, VAL[1]])).rejects.toThrow('nur https');
    await expect(abholen(w.u, 'kein K', VAL)).rejects.toThrow('K');
    await expect(abholen(w.u, V.k, [VAL[0], VAL[0]])).rejects.toThrow('Validatoren');
    w.antwort = (url) => (url.includes('v2.test') ? { status: 200, text: JSON.stringify({ ...V.abschnitte[1].abschnitt, extra: 1 }) } : null);
    await expect(abholen(w.u, V.k, VAL)).rejects.toThrow('Felder');
    w.antwort = (url) => (url.includes('v1.test') ? { status: 200, text: 'x'.repeat(4 * 1024 * 1024 + 1) } : null);
    await expect(abholen(w.u, V.k, VAL)).rejects.toThrow('zu gross');
    w.antwort = (url) => (url.includes('/note') ? { status: 200, text: JSON.stringify({ ...w.kette, k: '0'.repeat(64) }) } : null);
    await expect(abholen(w.u, V.k, VAL)).rejects.toThrow('fremdes K');
    w.antwort = () => null;
    w.kette = { ...w.kette!, gebunden: true };
    await expect(abholen(w.u, V.k, VAL)).rejects.toThrow('BEFUND');
    // Abschnitte in falscher Reihenfolge: schon die Form passt nicht.
    w = await bereit();
    await expect(abholen(w.u, V.k, [VAL[1], VAL[0]])).rejects.toThrow('Abschnitt 1 hat nicht die Form');
    // Die App vertraut anderen Validatoren als denen, die unterschrieben haben.
    await expect(
      abholen(w.u, V.k, [
        { adresse: VAL[1].adresse, api: VAL[0].api },
        { adresse: VAL[0].adresse, api: VAL[1].api },
      ]),
    ).rejects.toThrow('nicht von Validator 1');
    expect(JSON.parse(w.speicher.get('aequitas.quantenS.inhaberin.zustand')!).k).toBeUndefined();
  });

  test('einloesen: Bindung auf der Kette passt nicht, Token fremd oder angemeldet', async () => {
    const w = welt();
    await bestellt(w);
    await abholen(w.u, V.k, VAL);
    const gut = { ...w.kette! };
    w.kette = { ...gut, gebunden: true, d: '0'.repeat(V.n) };
    await expect(einloesen(w.u, V.stelle)).rejects.toThrow('BEFUND: der Token ist gebunden, aber im Geraet fehlt die Maske');
    w.kette = { ...gut, inhaber: VAL[0].adresse };
    await expect(einloesen(w.u, V.stelle)).rejects.toThrow('passt nicht zum Geraet');
    w.kette = { ...gut, anmeldung: { b: 0 } };
    await expect(einloesen(w.u, V.stelle)).rejects.toThrow('schon angemeldet');
    // Nach dem Einloesen nochmal eine Stelle waehlen: so steht der Token wirklich auf der Kette.
    w.kette = { k: V.k, tot: true, urteil: 'eingeloest' };
    await expect(einloesen(w.u, V.stelle)).rejects.toThrow('bereits eingeloest');
    w.kette = { k: V.k, tot: true, urteil: 'tot' };
    await expect(einloesen(w.u, V.stelle)).rejects.toThrow('Urteil der Kette');
    w.kette = { k: V.k, tot: true };
    await expect(einloesen(w.u, V.stelle)).rejects.toThrow('beendet');
    w.kette = { ...gut, tot: true };
    await expect(einloesen(w.u, V.stelle)).rejects.toThrow('beendet');
    w.kette = null;
    await expect(einloesen(w.u, V.stelle)).rejects.toThrow('nicht (mehr) auf der Kette');
    expect(w.posts.length).toBe(0);
  });

  test('einloesen: die Bindung auf der Kette weicht von der Maske im Geraet ab', async () => {
    const w = welt();
    await bestellt(w);
    await abholen(w.u, V.k, VAL);
    await einloesen(w.u, V.stelle);
    w.kette = { ...w.kette!, d: V.d.replace(/^./, (c: string) => (c === '0' ? '1' : '0')) };
    await expect(einloesen(w.u, V.stelle)).rejects.toThrow('BEFUND: die Bindung auf der Kette passt nicht zum Geraet');
  });

  test('API-Adresse', () => {
    expect(apiPruefen('https://knoten.test/api/')).toBe('https://knoten.test/api');
    expect(apiPruefen('http://localhost:8080/api')).toBe('http://localhost:8080/api');
    for (const roh of ['http://knoten.test/api', 'ftp://x', 'https://u:p@x', 'https://x/api?k=1', 'kein']) {
      expect(() => apiPruefen(roh)).toThrow();
    }
  });
});

describe('App als Inhaberin: Eingaben der Seite', () => {
  test('Stelle und Validatoren lesen', () => {
    const { stelleLesen, validatorenLesen } = require('../quantenSInhaberin');
    const s = stelle(0x31);
    expect(stelleLesen(` ${s.adresse.toUpperCase().replace('0X', '0x')}=0x${s.schluessel} `)).toEqual(s);
    expect(() => stelleLesen(s.adresse)).toThrow('Form');
    expect(() => stelleLesen(`${s.adresse}=${s.schluessel}=x`)).toThrow('Form');
    expect(() => stelleLesen(`${stelle(0x32).adresse}=${s.schluessel}`)).toThrow('gehoert nicht zur Adresse');
    expect(validatorenLesen(`${VAL[0].adresse}=${VAL[0].api}\n${VAL[1].adresse}=${VAL[1].api}/`)).toEqual(VAL);
    expect(validatorenLesen(`${VAL[0].adresse}=${VAL[0].api}, ${VAL[1].adresse}=${VAL[1].api}`)).toEqual(VAL);
    expect(() => validatorenLesen('')).toThrow('mindestens einer');
    expect(() => validatorenLesen(`${VAL[0].adresse}`)).toThrow('Form');
    expect(() => validatorenLesen(`kein=https://v.test`)).toThrow('Form');
    expect(() => validatorenLesen(`${VAL[0].adresse}=http://v.test`)).toThrow('nur https');
  });
});
