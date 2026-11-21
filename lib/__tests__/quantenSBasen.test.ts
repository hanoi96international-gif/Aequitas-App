// R8: Basen y je Validator verschluesselt (aequitas quanten_s_basen_chiffrat.go).
// Gegen den Pruefvektor des Knotens in beide Richtungen und im Ablauf der App.
jest.mock('expo-secure-store', () => ({}));
jest.mock('expo-crypto', () => ({ getRandomBytes: () => new Uint8Array(0) }));
jest.mock('../config', () => ({ API_BASE: 'https://knoten.test/api' }));

import { ethers } from 'ethers';
import bv from './vektoren/quanten_s_basen_vektor.json';
import iv from './vektoren/quanten_s_inhaberin_vektor.json';
import {
  antwortNachricht,
  basenHash,
  basenVerschluesseln,
  eciesOeffnen,
  pubVon,
  unterschreiben,
  unterschriftVon,
  validatorenHash,
  hashListe,
} from '../quantenS';
import { abholen, bestellungAnzeigen, einloesen, neu, vergessen, type Umgebung } from '../quantenSInhaberin';

const B = bv as any;
const V = iv as any;
const API = 'https://knoten.test/api';
const VAL = V.abschnitte.map((a: any, i: number) => ({ adresse: a.validator, api: `https://v${i + 1}.test/api` }));
const ADR = VAL.map((v: any) => v.adresse);

describe('R8: Pruefvektor des Knotens', () => {
  test('die App verschluesselt Byte fuer Byte wie im Vektor (Go oeffnet genau dieses Chiffrat)', () => {
    const zu = [ethers.getBytes('0x' + B.app_zufall.eph), ethers.getBytes('0x' + B.app_zufall.iv)];
    const c = basenVerschluesseln(pubVon(B.validator_schluessel_nur_test[1]), B.validatoren, B.n, B.x, B.inhaberin, B.basen, () => zu.shift()!);
    expect(c).toBe(B.chiffrat_app);
    expect(validatorenHash(B.validatoren)).toBe(B.validatoren_hash);
  });

  test('die App liest das Chiffrat von Go: genau die Felder des Knotens', () => {
    const roh = JSON.parse(ethers.toUtf8String(eciesOeffnen(B.validator_schluessel_nur_test[1], B.chiffrat_go)));
    expect(roh).toEqual({
      dom: 'aequitas-quanten-s-basen-v1', chain: B.chain_id, an: B.validatoren[1], n: B.n, v: 2, x: B.x,
      validatoren: B.validatoren_hash, inhaberin: B.inhaberin, basen: B.basen,
    });
  });

  test('Antwort mit basen_hash: dieselbe Nachricht, Unterschrift des Validators', () => {
    const a = B.antwort;
    expect(basenHash(B.chiffrat_app)).toBe(a.basen_hash);
    const m = antwortNachricht(a.k, a.x, a.von, a.bis, a.blaetter_hash, a.fuer_inhaberin, a.buendel_hash, a.buendel_sig_hash, a.teile, a.zaehlung, a.basen_hash);
    expect(m).toBe(a.nachricht);
    expect(unterschriftVon(m, a.sig, B.validatoren[1])).toBe(true);
    // Ohne den Hash ist es eine andere Nachricht.
    const ohne = antwortNachricht(a.k, a.x, a.von, a.bis, a.blaetter_hash, a.fuer_inhaberin, a.buendel_hash, a.buendel_sig_hash, a.teile, a.zaehlung);
    expect(unterschriftVon(ohne, a.sig, B.validatoren[1])).toBe(false);
  });

  test('verschluesselt nur an einen Schluessel, der zur Adresse gehoert, und nur Bits der Laenge', () => {
    const z = () => ethers.getBytes('0x' + '33'.repeat(32));
    expect(() => basenVerschluesseln(pubVon(B.validator_schluessel_nur_test[0]), B.validatoren, B.n, B.x, B.inhaberin, B.basen, z)).toThrow('gehoert nicht');
    expect(() => basenVerschluesseln(pubVon(B.validator_schluessel_nur_test[1]), B.validatoren, B.n, B.x, B.inhaberin, B.basen + '0', z)).toThrow('Basen');
    expect(() => basenVerschluesseln(pubVon(B.validator_schluessel_nur_test[1]), B.validatoren, B.n, 3, B.inhaberin, B.basen, z)).toThrow('Nummer');
  });
});

// ------------------------------------------------------------ Ablauf

interface Welt {
  u: Umgebung;
  kette: Record<string, any>;
  speicher: Map<string, string>;
  ablage: Map<string, string>;
  abschnitte: any[];
  zeit: number;
}

function stelle(seed: number) {
  const w = new ethers.Wallet('0x' + seed.toString(16).padStart(2, '0').repeat(32));
  return { adresse: w.address.toLowerCase(), schluessel: w.signingKey.publicKey.slice(2) };
}

function welt(): Welt {
  const st = [stelle(0x31), stelle(0x32)];
  const w: Welt = {
    kette: {
      k: V.k, art: 's', n: V.n, t: 1, v: V.v, tol: 2, inhaber: V.inhaberin, stellen: [st[0].adresse, st[1].adresse],
      gebunden: false, gewaehlt: false, fehl: 0, probe_art: 2, wurzel: V.wurzel, proben: V.proben,
    },
    speicher: new Map(),
    ablage: new Map(),
    abschnitte: V.abschnitte.map((a: any) => ({ ...a.abschnitt })),
    zeit: 0,
    u: undefined as unknown as Umgebung,
  };
  // Zufall: Schluessel, y, dann je Validator ephemerer Schluessel und IV, dann z.
  const zufall: Uint8Array[] = [ethers.getBytes('0x' + V.inhaberin_schluessel_nur_test), Uint8Array.from(V.y.split('').map(Number))];
  for (let i = 0; i < V.v; i++) zufall.push(ethers.getBytes('0x' + (0x41 + i).toString(16).repeat(32)), ethers.getBytes('0x' + (0x61 + i).toString(16).repeat(16)));
  zufall.push(Uint8Array.from([V.z]));
  const fetchFn = (async (url: string, init?: any) => {
    const ok = (o: unknown) => ({ status: 200, ok: true, text: async () => JSON.stringify(o) }) as any;
    if (init?.method === 'POST') {
      const body = JSON.parse(init.body);
      if (url.endsWith('/s_binden')) w.kette = { ...w.kette, gebunden: true, d: body.quanten_w.d };
      if (url.endsWith('/s_waehlen')) w.kette = { ...w.kette, gewaehlt: true, c: Number(body.quanten_w.c) };
      return ok({});
    }
    if (url === `${API}/quanten-w/note?k=${V.k}`) return ok(w.kette);
    for (let i = 0; i < VAL.length; i++) {
      if (url === `${VAL[i].api}/quanten-w/validator/schluessel`) return ok({ schluessel: pubVon(V.abschnitte[i].validator_schluessel_nur_test) });
      if (url === `${VAL[i].api}/quanten-w/validator/fuer-inhaberin?k=${V.k}`) return ok(w.abschnitte[i]);
    }
    return { status: 404, ok: false, text: async () => '' } as any;
  }) as unknown as typeof fetch;
  const map = (m: Map<string, string>) => ({
    lesen: async (k: string) => m.get(k) ?? null,
    schreiben: async (k: string, v: string) => void m.set(k, v),
    loeschen: async (k: string) => void m.delete(k),
  });
  w.u = {
    fetchFn,
    speicher: map(w.speicher),
    ablage: map(w.ablage),
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

/** Wie der Validator: den Hash des Chiffrats in die Antwort und neu unterschreiben. */
function mitHash(w: Welt, chiffrate: string[], aendern: (i: number) => string | undefined = (i) => basenHash(chiffrate[i])) {
  w.abschnitte = V.abschnitte.map((a: any, i: number) => {
    const ab = { ...a.abschnitt };
    const h = aendern(i);
    if (h !== undefined) ab.basen_hash = h;
    const m = antwortNachricht(V.k, ab.x, ab.von, ab.bis, hashListe(ab.blaetter), ab.fuer_inhaberin, ab.buendel_hash, ab.buendel_sig_hash, ab.teile, ab.zaehlung, h ?? '');
    ab.sig = unterschreiben(a.validator_schluessel_nur_test, m);
    return ab;
  });
}

describe('R8: die App bestellt verschluesselt', () => {
  test('Bestellung ohne y; jeder Validator oeffnet seinen Abschnitt; abholen und einloesen wie bisher', async () => {
    const w = welt();
    const best = await neu(w.u, V.n, V.v, (w as any).stellen, VAL);
    expect(best.basen).toBeUndefined();
    expect(best.basen_verschluesselt).toHaveLength(V.v);
    const text = JSON.stringify(best);
    for (let x = 0; x < V.v; x++) {
      const a = V.abschnitte[x].abschnitt;
      const y = V.y.slice(a.von, a.bis);
      const roh = JSON.parse(ethers.toUtf8String(eciesOeffnen(V.abschnitte[x].validator_schluessel_nur_test, best.basen_verschluesselt![x])));
      expect(roh).toEqual({ dom: 'aequitas-quanten-s-basen-v1', chain: 1926, an: ADR[x], n: V.n, v: V.v, x: x + 1, validatoren: validatorenHash(ADR), inhaberin: V.inhaberin, basen: y });
      // An den anderen Validator nicht lesbar.
      expect(() => eciesOeffnen(V.abschnitte[1 - x].validator_schluessel_nur_test, best.basen_verschluesselt![x])).toThrow();
    }
    expect(text).not.toContain(V.inhaberin_schluessel_nur_test);
    // Nach einem Neustart dieselbe Bestellung.
    expect(await bestellungAnzeigen(w.u)).toEqual(best);
    mitHash(w, best.basen_verschluesselt!);
    expect(await abholen(w.u, V.k, VAL)).toEqual({ k: V.k, n: V.n });
    expect(await einloesen(w.u, V.stelle)).toEqual(V.vorlage);
    await vergessen(w.u).catch(() => undefined);
  });

  test('BEFUND, wenn ein Validator nicht das eigene Chiffrat unterschrieben hat (getauscht oder Klartext)', async () => {
    for (const fall of ['fremder Hash', 'ohne Hash'] as const) {
      const w = welt();
      const best = await neu(w.u, V.n, V.v, (w as any).stellen, VAL);
      mitHash(w, best.basen_verschluesselt!, (i) => (i === 1 ? (fall === 'ohne Hash' ? undefined : basenHash('ab' + best.basen_verschluesselt![1])) : basenHash(best.basen_verschluesselt![i])));
      await expect(abholen(w.u, V.k, VAL)).rejects.toThrow('BEFUND: Validator 2');
      expect(JSON.parse(w.speicher.get('aequitas.quantenS.inhaberin.zustand')!).k).toBeUndefined();
    }
  });

  test('Klartext-Bestellung: ein Abschnitt mit basen_hash wird nicht angenommen', async () => {
    const w = welt();
    // Klartext: nur Schluessel und y aus dem Zufall.
    const best = await neu({ ...w.u, zufall: ((q) => (n: number) => q.shift()!)([ethers.getBytes('0x' + V.inhaberin_schluessel_nur_test), Uint8Array.from(V.y.split('').map(Number))]) }, V.n, V.v, (w as any).stellen);
    expect(best.basen).toHaveLength(V.v);
    mitHash(w, ['aa', 'bb']);
    await expect(abholen(w.u, V.k, VAL)).rejects.toThrow('BEFUND');
  });

  test('andere Validatoren als bei der Verschluesselung, getauschte Ablage, fremder Schluessel: abgewiesen', async () => {
    const w = welt();
    const best = await neu(w.u, V.n, V.v, (w as any).stellen, VAL);
    mitHash(w, best.basen_verschluesselt!);
    await expect(abholen(w.u, V.k, [VAL[1], VAL[0]])).rejects.toThrow('an andere Validatoren');
    // Jemand tauscht die Chiffrate in der (ungeschuetzten) Ablage.
    const k = [...w.ablage.keys()][0];
    w.ablage.set(k, JSON.stringify(['ab', 'cd']));
    await expect(bestellungAnzeigen(w.u)).rejects.toThrow('Chiffrate der Bestellung');
    await expect(abholen(w.u, V.k, VAL)).rejects.toThrow('Chiffrate der Bestellung');

    // Ein Validator nennt einen Schluessel, der nicht zu seiner Adresse gehoert: keine Bestellung.
    const w2 = welt();
    const falsch = (async (url: string, init?: any) =>
      url === `${VAL[0].api}/quanten-w/validator/schluessel`
        ? ({ status: 200, ok: true, text: async () => JSON.stringify({ schluessel: pubVon(V.abschnitte[1].validator_schluessel_nur_test) }) } as any)
        : w2.u.fetchFn(url, init)) as unknown as typeof fetch;
    await expect(neu({ ...w2.u, fetchFn: falsch }, V.n, V.v, (w2 as any).stellen, VAL)).rejects.toThrow('gehoert nicht zur Adresse');
    expect(w2.speicher.size).toBe(0);
    expect(w2.ablage.size).toBe(0);
  });

  test('ohne Ablage oder mit falscher Zahl von Validatoren keine verschluesselte Bestellung', async () => {
    const w = welt();
    await expect(neu({ ...w.u, ablage: undefined }, V.n, V.v, (w as any).stellen, VAL)).rejects.toThrow('Ablage');
    await expect(neu(w.u, V.n, V.v, (w as any).stellen, [VAL[0]])).rejects.toThrow('Validatoren zum Verschluesseln');
    expect(w.speicher.size).toBe(0);
  });
});
