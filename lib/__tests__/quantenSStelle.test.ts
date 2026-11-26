// Die App als Annahmestelle (lib/quantenSStelle.ts) gegen den Pruefvektor des
// Knotens (x/humanity/keeper/quanten_s_stelle_vektor_test.go): dieselbe
// Rechnung wie quantenSAnnahmeLauf, Zeichen fuer Zeichen, und der ganze Weg
// gegen eine Schein-Kette und einen Schein-Validator -- mit den Angriffen, die
// vor dem Anmelden abbrechen muessen.
jest.mock('expo-secure-store', () => ({}));
jest.mock('expo-crypto', () => ({ getRandomBytes: () => new Uint8Array(0) }));
jest.mock('../config', () => ({ API_BASE: 'https://knoten.test/api' }));

import { ethers } from 'ethers';
import vektor from './vektoren/quanten_s_stelle_vektor.json';
import { unterschreiben, vorlageText } from '../quantenS';
import type { Umgebung } from '../quantenSInhaberin';
import { drbg } from '../quantenSPraepTresor';
import {
  NACHWEIS,
  anmeldenNachricht,
  annehmenAlsStelle,
  nachweisLaden,
  oeffnungLaden,
  oeffnungLesen,
  probeV2Pruefen,
  pruefsumme,
  stelleKennung,
  urteilLesen,
  vorlageLesen,
} from '../quantenSStelle';

const V = vektor as any;
const API = 'https://knoten.test/api';
const VAL_API = 'https://c1.test/api';
const VALIDATOREN = [{ adresse: V.validator, api: VAL_API }];
const N = 1104;
const SCHL = V.stelle_schluessel_nur_test;

interface Welt {
  u: Umgebung;
  kette: Record<string, any> | null;
  abschnitt: any;
  oeffnung: string;
  posts: { url: string; body: any }[];
  vorFinal: number;
  urteil: 'eingeloest' | 'abgewiesen' | 'frist';
  zeit: number;
  /** Was die Kette nach dem Ende zeigt (Stichtag des eindeutigen Urteils); null = Token weg. */
  ende: Record<string, any> | null;
}

function welt(): Welt {
  const w: Welt = {
    kette: JSON.parse(JSON.stringify(V.stand)),
    abschnitt: JSON.parse(JSON.stringify(V.abschnitt)),
    oeffnung: V.oeffnung,
    posts: [],
    vorFinal: 2,
    urteil: 'eingeloest',
    zeit: 0,
    ende: null,
    u: undefined as unknown as Umgebung,
  };
  let nachAnmeldung = 0;
  const antwort = (status: number, text: string) => ({ status, ok: status < 300, text: async () => text }) as any;
  const fetchFn = (async (url: string, init?: any) => {
    if (init?.method === 'POST') {
      w.posts.push({ url, body: JSON.parse(init.body) });
      w.kette = { ...w.kette!, anmeldung: { stelle: 1 } };
      return antwort(200, '{}');
    }
    if (url === `${API}/quanten-w/note?k=${V.k}`) {
      if (w.kette?.anmeldung && ++nachAnmeldung > 2) {
        // Die Kette urteilt: eingeloest = Token weg, abgewiesen = ein Fehlversuch mehr.
        if (w.urteil === 'eingeloest') w.kette = w.ende;
        else w.kette = { ...w.kette, anmeldung: undefined, fehl: w.urteil === 'abgewiesen' ? 1 : 0 };
      }
      return w.kette ? antwort(200, JSON.stringify(w.kette)) : antwort(404, '');
    }
    if (url === `${VAL_API}/quanten-w/validator/fuer-inhaberin?k=${V.k}`) return antwort(200, JSON.stringify(w.abschnitt));
    if (url === `${VAL_API}/quanten-w/validator/oeffnung?k=${V.k}&b=${V.b}`) {
      if (w.vorFinal-- > 0) return antwort(409, '{"error":"noch nicht final"}');
      return antwort(200, JSON.stringify({ oeffnung: w.oeffnung }));
    }
    return antwort(404, '');
  }) as unknown as typeof fetch;
  w.u = {
    fetchFn,
    speicher: { lesen: async () => null, schreiben: async () => {}, loeschen: async () => {} },
    zufall: () => {
      throw new Error('kein Zufall noetig');
    },
    apiBasis: API,
    warten: async (ms) => void (w.zeit += ms),
    jetzt: () => w.zeit,
  };
  return w;
}

const vorlageText_ = (v: any = V.vorlage) => JSON.stringify(v);

describe('Annahmestelle: Rechnung wie der Knoten', () => {
  const offen = oeffnungLesen(SCHL, V.oeffnung, V.k, V.b, 1, 0, N);

  it('Oeffnung lesen: Salz und Werte genau fuer diese Stelle', () => {
    expect(offen.salz).toBe(V.salze[0]);
    expect([...offen.werte.keys()].sort((a, b) => a - b)).toEqual(V.probe);
    expect(() => oeffnungLesen(SCHL, V.falsche_oeffnung, V.k, V.b, 1, 0, N)).toThrow('nicht fuer diesen Schluessel');
    expect(() => oeffnungLesen(SCHL, V.oeffnung, V.k, 0, 1, 0, N)).toThrow('passt nicht');
    expect(() => oeffnungLesen(SCHL, V.oeffnung, 'ab'.repeat(32), V.b, 1, 0, N)).toThrow('passt nicht');
  });

  it('jedes Blatt aus seinem Wert (Pruefsumme), Ladung gegen die Wurzel', () => {
    for (const [i, w] of offen.werte) expect(pruefsumme(V.k, i, w)).toBe(V.abschnitt.blaetter[i]);
    const geladen = oeffnungLaden(V.b, V.k, N, V.stand.wurzel, V.abschnitt.blaetter, offen.werte, 552);
    expect(geladen.size).toBe(552);
    // Vorab wie die Kette: Basis d XOR b XOR c.
    let treffer = 0, fehlerZahl = 0;
    for (const [i, [basis, wert]] of geladen) {
      if ((Number(V.stand.d[i]) ^ V.b ^ V.stand.c) === basis) {
        treffer++;
        if (Number(V.vorlage.x[i]) !== wert) fehlerZahl++;
      }
    }
    expect([treffer, fehlerZahl]).toEqual([V.treffer, V.fehler]);
  });

  it('Ladung weist ab: falscher Wert, andere Stelle, zu kleine Stichprobe, falsche Wurzel', () => {
    const [i0, w0] = [...offen.werte][0];
    const gefaelscht = new Map(offen.werte);
    gefaelscht.set(i0, w0 ^ 2n); // Wert gekippt
    expect(() => oeffnungLaden(V.b, V.k, N, V.stand.wurzel, V.abschnitt.blaetter, gefaelscht, 552)).toThrow('passt nicht zu ihrem Blatt');
    expect(() => oeffnungLaden(0, V.k, N, V.stand.wurzel, V.abschnitt.blaetter, offen.werte, 552)).toThrow('anderen Annahmestelle');
    expect(() => oeffnungLaden(V.b, V.k, N, V.stand.wurzel, V.abschnitt.blaetter, offen.werte, 553)).toThrow('zu klein');
    expect(() => oeffnungLaden(V.b, V.k, N, '00'.repeat(32), V.abschnitt.blaetter, offen.werte, 552)).toThrow('Wurzel');
  });

  it('Stichprobe und Salz ergeben die Bindung der Ausgabe; jede Aenderung nicht', () => {
    expect(probeV2Pruefen(V.k, V.b, N, 1, V.probe, V.salze)).toBe(V.stand.proben[V.b]);
    expect(probeV2Pruefen(V.k, V.b, N, 1, V.probe.slice(1), V.salze)).not.toBe(V.stand.proben[V.b]);
    expect(probeV2Pruefen(V.k, V.b, N, 1, V.probe, ['00'.repeat(32)])).not.toBe(V.stand.proben[V.b]);
    expect(() => probeV2Pruefen(V.k, V.b, N, 1, [...V.probe, V.probe[0]], V.salze)).toThrow('doppelt');
  });

  it('Anmeldung: dieselbe Nachricht und Unterschrift wie der Knoten', () => {
    const m = anmeldenNachricht(V.stelle, V.k, String(V.b), V.vorlage.x, V.probe, 0);
    expect(m).toBe(V.anmelden_nachricht);
    expect(unterschreiben(SCHL, m)).toBe(V.anmelden_sig);
    expect(stelleKennung(SCHL)).toBe(`${V.stelle}=${V.stelle_pub}`);
  });

  it('Vorlage lesen: genau k, b, x, vorlage', () => {
    expect(vorlageLesen(vorlageText_()).k).toBe(V.k);
    expect(() => vorlageLesen(JSON.stringify({ ...V.vorlage, blaetter: [] }))).toThrow('genau');
    expect(() => vorlageLesen(JSON.stringify({ ...V.vorlage, b: 2 }))).toThrow('Form');
    expect(() => vorlageLesen('kein json')).toThrow('kein JSON');
  });
});

describe('Annahmestelle: der ganze Weg', () => {
  it('ehrliche Vorlage: wartet auf die Finalitaet, meldet genau wie der Knoten an, eingeloest', async () => {
    const w = welt();
    const schritte: string[] = [];
    const erg = await annehmenAlsStelle(w.u, SCHL, vorlageText_(), VALIDATOREN, (s) => schritte.push(s));
    expect(erg).toEqual({
      k: V.k, stelle_nummer: V.b, stelle: V.stelle, inhaberin: V.inhaberin, stichprobe: 552, treffer: V.treffer, fehler: V.fehler, vorab: 'besteht', urteil: 'eingeloest',
      wurzel: V.stand.wurzel, proben: V.stand.proben, nachweisGesichert: false, // ohne Ablage
    });
    expect(schritte).toEqual(['pruefen', 'blaetter', 'oeffnung', 'anmelden', 'urteil']);
    expect(w.posts).toHaveLength(1);
    expect(w.posts[0].url).toBe(`${API}/quanten-w/s_anmelden`);
    expect(w.posts[0].body).toEqual({
      wallet: V.stelle,
      zeit: 0,
      quanten_w: { k: V.k, b: String(V.b), x: V.vorlage.x, probe: V.probe, vorlage: V.vorlage.vorlage, salze: V.salze, wallet_sig: V.anmelden_sig },
    });
  });

  it('P5c: der Stoff fuer einen Nachweis liegt VOR dem Anmelden im Geraet; nach dem eigenen Einloesen ist er weg, solange der Token lebt bleibt er', async () => {
    for (const urteil of ['eingeloest', 'frist'] as const) {
      const w = welt();
      w.urteil = urteil;
      const daten = new Map<string, string>();
      w.u.ablage = { lesen: async (k) => daten.get(k) ?? null, schreiben: async (k, v) => void daten.set(k, v), loeschen: async (k) => void daten.delete(k) };
      w.u.zufall = drbg('33'.repeat(32));
      const echt = w.u.fetchFn;
      let beimAnmelden = false;
      w.u.fetchFn = (async (url: string, init?: any) => {
        if (init?.method === 'POST') beimAnmelden = daten.has(NACHWEIS + V.k);
        return echt(url, init);
      }) as typeof fetch;
      const erg = await annehmenAlsStelle(w.u, SCHL, vorlageText_(), VALIDATOREN);
      expect(erg.nachweisGesichert).toBe(true);
      expect(beimAnmelden).toBe(true);
      if (urteil === 'eingeloest') {
        expect(daten.has(NACHWEIS + V.k)).toBe(false);
        continue;
      }
      // Der Token lebt (Frist): der Stoff bleibt und ist gegen Blaetter und Wurzel lesbar.
      const st = await nachweisLaden(w.u, SCHL, V.k);
      expect(st && [st.probe, st.salze, st.vorab, st.wurzel, st.x]).toEqual([V.probe, V.salze, 'besteht', V.stand.wurzel, V.vorlage.x]);
      expect(st!.werte.map((x, j) => pruefsumme(V.k, V.probe[j], x))).toEqual(V.probe.map((i: number) => V.abschnitt.blaetter[i]));
    }
  });

  it('BEFUND, wenn die Kette anders urteilt als die eigene Rechnung', async () => {
    const w = welt();
    w.urteil = 'abgewiesen';
    await expect(annehmenAlsStelle(w.u, SCHL, vorlageText_(), VALIDATOREN)).rejects.toThrow('BEFUND');
  });

  const angriffe: [string, (w: Welt) => string | void, string][] = [
    ['Vorlage fuer die andere Stelle', () => vorlageText_({ ...V.vorlage, b: 0 }), 'nicht dieses Konto'],
    ['von jemand anderem unterschrieben', () => vorlageText_({ ...V.vorlage, vorlage: unterschreiben('82'.repeat(32), vorlageText(V.k, V.b, V.vorlage.x)) }), 'nicht von der Inhaberin'],
    ['x veraendert', () => vorlageText_({ ...V.vorlage, x: (V.vorlage.x[0] === '0' ? '1' : '0') + V.vorlage.x.slice(1) }), 'nicht von der Inhaberin'],
    ['Token schon tot', (w) => void (w.kette!.tot = true), 'tot'],
    // So steht ein beendeter Token wirklich auf der Kette (quantenWNoteAnsicht): nur k, tot, urteil.
    ['Vorlage nach dem Einloesen erneut (Doppelausgabe)', (w) => void (w.kette = { k: V.k, tot: true, urteil: 'eingeloest' }), 'bereits eingeloest'],
    ['Vorlage nach Urteil tot erneut', (w) => void (w.kette = { k: V.k, tot: true, urteil: 'tot' }), 'Urteil der Kette'],
    ['beendet ohne Urteil (vor dem Stichtag)', (w) => void (w.kette = { k: V.k, tot: true }), 'beendet'],
    ['Token nicht auf der Kette', (w) => void (w.kette = null), 'nicht (mehr) auf der Kette'],
    ['offene Anmeldung', (w) => void (w.kette!.anmeldung = { stelle: 0 }), 'offene Anmeldung'],
    ['noch nicht gewaehlt', (w) => void (w.kette!.gewaehlt = false), 'Bindung und Wahl'],
    ['alte Stichprobe (v1)', (w) => void (w.kette!.probe_art = 1), 'Stichprobe v2'],
    ['zwei Fehlversuche (Urteil nicht eindeutig)', (w) => void (w.kette!.fehl = 2), 'Fehlversuche'],
    ['Blatt vertauscht', (w) => void (w.abschnitt.blaetter[3] = w.abschnitt.blaetter[4]), 'Abschnitt'],
    // Schon vor der Oeffnung (die eigene Meldung, nicht erst die der Ladung).
    ['Wurzel auf der Kette anders', (w) => void ((w.kette!.wurzel = '11'.repeat(32)), (w.vorFinal = 1e9)), 'ergeben nicht die Wurzel'],
    ['Bindung der Stichprobe anders', (w) => void (w.kette!.proben = [w.kette!.proben[0], '22'.repeat(32)]), 'Bindung der Ausgabe'],
    ['Oeffnung fuer einen anderen Schluessel', (w) => void (w.oeffnung = V.falsche_oeffnung), 'nicht fuer diesen Schluessel'],
    ['Oeffnung kommt nie (nicht final)', (w) => void (w.vorFinal = 1e9), 'gibt sie nicht heraus'],
  ];
  it('letzter Versuch mit eindeutigem Urteil der Kette: eingeloest bzw. tot', async () => {
    for (const urteil of ['eingeloest', 'tot'] as const) {
      const w = welt();
      w.kette!.fehl = 2;
      w.kette!.urteil_eindeutig = true;
      w.ende = { k: V.k, tot: true, urteil, ende: 123 };
      const erg = urteil === 'eingeloest' ? await annehmenAlsStelle(w.u, SCHL, vorlageText_(), VALIDATOREN) : null;
      if (urteil === 'eingeloest') expect(erg!.urteil).toBe('eingeloest');
      else await expect(annehmenAlsStelle(w.u, SCHL, vorlageText_(), VALIDATOREN)).rejects.toThrow('BEFUND'); // vorab besteht, Kette: tot
      expect(w.posts).toHaveLength(1);
    }
  });

  it('letzter Versuch, Kette nennt kein Urteil: kein behaupteter Erfolg', async () => {
    const w = welt();
    w.kette!.fehl = 2;
    w.kette!.urteil_eindeutig = true;
    w.ende = { k: V.k, tot: true };
    await expect(annehmenAlsStelle(w.u, SCHL, vorlageText_(), VALIDATOREN)).rejects.toThrow('kein Urteil');
  });

  it.each(angriffe)('%s: abgewiesen, bevor angemeldet wird', async (_was, machen, meldung) => {
    const w = welt();
    const text = machen(w) ?? vorlageText_();
    await expect(annehmenAlsStelle(w.u, SCHL, text, VALIDATOREN)).rejects.toThrow(meldung);
    expect(w.posts).toHaveLength(0);
  });

  it('fremder Validator in der eigenen Liste: abgewiesen', async () => {
    const w = welt();
    await expect(annehmenAlsStelle(w.u, SCHL, vorlageText_(), [{ adresse: '0x' + '11'.repeat(20), api: VAL_API }])).rejects.toThrow();
    expect(w.posts).toHaveLength(0);
  });

  it('dieses Konto ist gar keine Stelle des Tokens', async () => {
    const w = welt();
    const fremd = new ethers.Wallet('0x' + '83'.repeat(32)).privateKey.slice(2);
    await expect(annehmenAlsStelle(w.u, fremd, vorlageText_(), VALIDATOREN)).rejects.toThrow('nicht dieses Konto');
    expect(w.posts).toHaveLength(0);
  });
});

describe('validatorKennung (C1 eintragen)', () => {
  const { validatorKennung } = require('../quantenSStelle');
  const v = new ethers.Wallet('0x' + '61'.repeat(32));
  const pub = v.signingKey.publicKey.slice(2);
  const mit = (antwort: any): Umgebung => ({
    fetchFn: (async () => ({ status: 200, ok: true, text: async () => JSON.stringify(antwort) })) as any,
    speicher: { lesen: async () => null, schreiben: async () => {}, loeschen: async () => {} },
    zufall: () => new Uint8Array(0),
    apiBasis: API,
    warten: async () => {},
    jetzt: () => 0,
  });
  it('liefert Stelle und Validator in der Form der Eingabefelder', async () => {
    const k = await validatorKennung(mit({ validator: v.address.toLowerCase(), schluessel: pub }));
    expect(k).toEqual({ stelle: `${v.address.toLowerCase()}=${pub}`, validator: `${v.address.toLowerCase()}=${API}` });
  });
  it('weist einen Schluessel ab, der nicht zur Adresse gehoert', async () => {
    const fremd = new ethers.Wallet('0x' + '62'.repeat(32)).signingKey.publicKey.slice(2);
    await expect(validatorKennung(mit({ validator: v.address.toLowerCase(), schluessel: fremd }))).rejects.toThrow('gehoert nicht');
    await expect(validatorKennung(mit({ validator: 'x', schluessel: pub }))).rejects.toThrow('Form');
  });
});

describe('stelleSchluesselHolen (Mein Konto eintragen)', () => {
  const { stelleSchluesselHolen } = require('../quantenSStelle');
  const umgebung = (zufall: Uint8Array[]) => {
    const speicher = new Map<string, string>();
    const u: Umgebung = {
      fetchFn: (async () => ({ status: 404, ok: false, text: async () => '' })) as any,
      speicher: { lesen: async (k) => speicher.get(k) ?? null, schreiben: async (k, v) => void speicher.set(k, v), loeschen: async (k) => void speicher.delete(k) },
      zufall: (n) => {
        const z = zufall.shift();
        if (!z || z.length !== n) throw new Error('Zufall');
        return z;
      },
      apiBasis: API,
      warten: async () => {},
      jetzt: () => 0,
    };
    return { u, speicher };
  };
  it('mit eigener Wallet: deren Schluessel, kein eigener angelegt', async () => {
    const { u, speicher } = umgebung([]);
    const s = await stelleSchluesselHolen(u, { vorhanden: async () => true, entsperren: async () => ({ privateKey: '0x' + 'AB'.repeat(32) }) });
    expect(s).toEqual({ schluessel: 'ab'.repeat(32), quelle: 'konto' });
    expect(speicher.size).toBe(0);
  });
  it('Wallet da, Entsperren abgebrochen: Fehler, KEIN Ausweichen auf einen anderen Schluessel', async () => {
    const { u, speicher } = umgebung([new Uint8Array(32).fill(7)]);
    await expect(stelleSchluesselHolen(u, { vorhanden: async () => true, entsperren: async () => { throw new Error('abgebrochen'); } })).rejects.toThrow('abgebrochen');
    expect(speicher.size).toBe(0);
  });
  it('ohne eigene Wallet: einmal ein eigener Schluessel des Geraets, danach derselbe', async () => {
    const { u, speicher } = umgebung([new Uint8Array(32).fill(0), new Uint8Array(32).fill(7)]); // 0 ist kein gueltiger Schluessel
    const ohne = { vorhanden: async () => false, entsperren: async () => { throw new Error('nie'); } };
    const a = await stelleSchluesselHolen(u, ohne);
    expect(a).toEqual({ schluessel: '07'.repeat(32), quelle: 'geraet' });
    expect([...speicher.values()]).toEqual(['07'.repeat(32)]);
    const b = await stelleSchluesselHolen(u, ohne); // kein Zufall mehr noetig
    expect(b).toEqual(a);
  });
  it('kaputter gespeicherter Schluessel: Fehler statt still neu', async () => {
    const { u, speicher } = umgebung([]);
    speicher.set('aequitas.quantenS.stelle.schluessel', 'kaputt');
    await expect(stelleSchluesselHolen(u, { vorhanden: async () => false, entsperren: async () => ({ privateKey: '' }) })).rejects.toThrow('unlesbar');
  });
});

describe('Urteil lesen (wie quantenSUrteilLesen im Knoten)', () => {
  it.each([
    [null, 0, false, 'eingeloest'],
    [{ tot: true }, 1, false, 'eingeloest'],
    [{ tot: true, urteil: 'eingeloest' }, 2, true, 'eingeloest'],
    [{ tot: true, urteil: 'tot' }, 2, true, 'tot'],
    [{ tot: true, urteil: 'tot' }, 0, false, 'tot'],
    [{ fehl: 1 }, 0, false, 'abgewiesen'],
    [{ fehl: 0 }, 0, false, 'frist'],
  ] as const)('%j fehl %d letzter %s -> %s', (nach, fehl, letzter, soll) => {
    expect(urteilLesen(nach as any, fehl, letzter)).toBe(soll);
  });
  it.each([
    [{ tot: true }, 2],
    [null, 2],
    [{ tot: true, urteil: 'echt' }, 2],
    [{ fehl: 5 }, 0],
  ] as const)('%j fehl %d: kein Urteil behauptet', (nach, fehl) => {
    expect(() => urteilLesen(nach as any, fehl, fehl + 1 >= 3)).toThrow();
  });
});
