// P5c: die Annahmestelle weist eine Fälschung nach (lib/quantenSStelleNachweis.ts,
// Stoff aus lib/quantenSStelle.ts). Gegen einen nachgebauten Knoten, der
// Anmelden und Offenlegen so prüft wie quanten_s_faelschung.go (Unterschrift der
// Stelle mit den Fehlversuchen, je Stelle w gegen Blatt und Wurzel, Teile ab dem
// Stand der Kette), mit den Missbrauchsfällen. Der Prüfvektor entsteht hier; der
// Knoten prüft ihn mit eigenem Code (quanten_s_faelschung_vektor_test.go).
jest.mock('expo-secure-store', () => ({}));
jest.mock('expo-crypto', () => ({ getRandomBytes: () => new Uint8Array(0) }));
jest.mock('../config', () => ({ API_BASE: 'https://knoten.test/api' }));

import fs from 'fs';
import path from 'path';
import { ethers } from 'ethers';
import { adresseVon, bestuende, merklePfade, merklePruefen, merkleWurzel, unterschreiben, unterschriftVon, vorlageText } from '../quantenS';
import type { Speicher, Umgebung } from '../quantenSInhaberin';
import { drbg } from '../quantenSPraepTresor';
import { NACHWEIS, NACHWEISE, NACHWEISE_MAX, NACHWEIS_MAX, nachweisLaden, nachweisSichern, nachweiseGesichert, pruefsumme, type NachweisStoff } from '../quantenSStelle';
import { TEIL, faelschungAnmeldenNachricht, lageAus, nachweisFuehren, nachweisLage, nachweiseAufraeumen } from '../quantenSStelleNachweis';

const API = 'https://knoten.test/api';
const PFAD = path.join(__dirname, 'vektoren', 'quanten_s_faelschung_vektor.json');
const SCHL = '5e'.repeat(32); // Stelle B (nur Test)
const INH = '6f'.repeat(32); // Inhaberin (nur Test)
const ICH = adresseVon(SCHL);
const N = 200;
const B: 0 | 1 = 1;
const C: 0 | 1 = 0;
const ENDE = 1_900_000_000;
const BIS = ENDE + 7 * 86400;

function speicher(): Speicher & { daten: Map<string, string> } {
  const daten = new Map<string, string>();
  return { daten, lesen: async (k) => daten.get(k) ?? null, schreiben: async (k, v) => void daten.set(k, v), loeschen: async (k) => void daten.delete(k) };
}

/** Ein Token wie aus einer Ausgabe: Werte mit Stellen-Bit, Blätter, Wurzel; die Vorlage der Inhaberin besteht B's Stichprobe. */
function stoffBauen(K = ethers.sha256(ethers.toUtf8Bytes('p5c-token')).slice(2)): NachweisStoff {
  const z = drbg('17'.repeat(32));
  const werte: bigint[] = [];
  const d: number[] = [];
  for (let i = 0; i < N; i++) {
    const salz = BigInt(ethers.hexlify(z(16))) >> 5n; // w < 2^126 wie im Knoten (quantenWSalzBits + 2)
    const r = z(1)[0];
    werte.push((salz << 3n) | (BigInt((r >> 2) & 1) << 2n) | (BigInt((r >> 1) & 1) << 1n) | BigInt(r & 1));
    d.push(z(1)[0] & 1);
  }
  const blaetter = werte.map((w, i) => pruefsumme(K, i, w));
  const probe = werte.map((w, i) => [w, i] as const).filter(([w]) => Number((w >> 2n) & 1n) === B).map(([, i]) => i);
  const x = werte.map((w, i) => ((d[i] ^ B ^ C) === Number(w & 1n) ? Number((w >> 1n) & 1n) : z(1)[0] & 1)).join('');
  return {
    k: K, b: B, stelle: ICH, n: N, x, vorlage: unterschreiben(INH, vorlageText(K, B, x)), probe, d: d.join(''), c: C, tol: 2,
    blaetter, wurzel: merkleWurzel(blaetter), vorab: 'besteht', werte: probe.map((i) => werte[i]), salze: ['aa'.repeat(32), 'bb'.repeat(32)],
  };
}

interface Knoten {
  u: Umgebung;
  ablage: ReturnType<typeof speicher>;
  sicht: Record<string, unknown> | null;
  posts: { art: string; body: any }[];
  uhr: { t: number };
  pfandAn?: string;
}

/** Ein Knoten im Speicher: Ansicht des beendeten Tokens; prüft Anmelden und Offenlegen wie der echte. */
function knoten(s: NachweisStoff, sicht: Record<string, unknown> | null): Knoten {
  const ablage = speicher();
  const w: Knoten = { u: null as unknown as Umgebung, ablage, sicht, posts: [], uhr: { t: (ENDE + 3600) * 1000 } };
  const antwort = (status: number, o: unknown) => ({ ok: status === 200, status, text: async () => JSON.stringify(o) }) as unknown as Response;
  let treffer = 0;
  let fehlerZahl = 0;
  const fetchFn = (async (url: string, init?: RequestInit) => {
    if (url === `${API}/quanten-w/note?k=${s.k}`) return w.sicht === null ? antwort(404, { error: 'unknown note' }) : antwort(200, { k: s.k, ...w.sicht });
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (url === `${API}/quanten-w/s_faelschung_anmelden`) {
      w.posts.push({ art: 'anmelden', body });
      const q = body.quanten_w;
      const fehl = w.sicht?.nachweis_fehl as number;
      if (body.zeit !== 0 || body.wallet !== ICH || q.b !== String(B) || q.x !== s.x || q.vorlage !== s.vorlage) return antwort(409, { error: 'rejected: quanten_w_form' });
      if (!unterschriftVon(faelschungAnmeldenNachricht(ICH, s.k, q.b, q.x, q.probe, fehl), q.wallet_sig, ICH)) return antwort(409, { error: 'rejected: quanten_w_unterschrift' });
      if (!unterschriftVon(vorlageText(s.k, B, q.x), q.vorlage, adresseVon(INH))) return antwort(409, { error: 'rejected: quanten_w_s_vorlage' });
      w.sicht = { ...w.sicht, nachweis_angemeldet: w.uhr.t / 1000, nachweis_offen: 0 };
      treffer = 0;
      fehlerZahl = 0;
      return antwort(200, { ok: true, gerechnet: {} });
    }
    if (url === `${API}/quanten-w/s_faelschung_offenlegen`) {
      w.posts.push({ art: 'offenlegen', body });
      const q = body.quanten_w;
      if (body.wallet !== '' || body.zeit !== 0 || w.sicht?.nachweis_offen === undefined) return antwort(409, { error: 'rejected: quanten_w_form' });
      if (q.ab !== w.sicht.nachweis_offen || q.offen.length < 1 || q.offen.length > TEIL) return antwort(409, { error: 'rejected: quanten_w_regel Teil' });
      q.offen.forEach((o: any, j: number) => {
        const i = s.probe[q.ab + j];
        if (!Array.isArray(o.anteile) || o.anteile.length !== 0 || !/^[0-9a-f]{1,32}$/.test(o.w)) throw new Error('Form');
        const wert = BigInt('0x' + o.w);
        if (!merklePruefen(s.wurzel, pruefsumme(s.k, i, wert), i, o.pfad, s.n)) throw new Error(`Stelle ${i}: Pfad`);
        if ((Number(s.d[i]) ^ B ^ C) === Number(wert & 1n)) {
          treffer++;
          if (Number(s.x[i]) !== Number((wert >> 1n) & 1n)) fehlerZahl++;
        }
      });
      const offen = q.ab + q.offen.length;
      if (offen < s.probe.length) {
        w.sicht = { ...w.sicht, nachweis_offen: offen };
        return antwort(200, { ok: true, gerechnet: { urteil: 'teil' } });
      }
      const { nachweis_angemeldet: _a, nachweis_offen: _o, ...rest } = w.sicht as Record<string, unknown>;
      if (bestuende(treffer, fehlerZahl, s.tol)) {
        w.sicht = { k: s.k, tot: true, urteil: 'eingeloest', ende: ENDE };
        return antwort(200, { ok: true, gerechnet: { urteil: 'faelschung', pfand: 11_000_000, pfand_an: w.pfandAn ?? ICH } });
      }
      w.sicht = { ...rest, nachweis_fehl: (rest.nachweis_fehl as number) + 1 };
      return antwort(200, { ok: true, gerechnet: { urteil: 'abgewiesen' } });
    }
    return antwort(404, { error: 'unbekannt' });
  }) as unknown as typeof fetch;
  w.u = {
    fetchFn, speicher: speicher(), ablage, zufall: drbg('29'.repeat(32)), apiBasis: API,
    warten: async (ms) => void (w.uhr.t += ms), jetzt: () => w.uhr.t,
  };
  return w;
}

const tot = (mehr: Record<string, unknown> = {}) => ({ tot: true, urteil: 'eingeloest', ende: ENDE, nachweis_bis: BIS, nachweis_stelle: B, nachweis_fehl: 0, ...mehr });

describe('Merkle-Pfade (quantenWMerklePfad / quantenWMerklePruefen)', () => {
  test('jeder Pfad passt zur Wurzel, für gerade und ungerade Ebenen', () => {
    for (const n of [1, 2, 3, 5, 8, 13, 37]) {
      const bl = Array.from({ length: n }, (_, i) => ethers.sha256(ethers.toUtf8Bytes(`b${n}-${i}`)).slice(2));
      const wurzel = merkleWurzel(bl);
      const pf = merklePfade(bl, bl.map((_, i) => i));
      for (let i = 0; i < n; i++) {
        expect(merklePruefen(wurzel, bl[i], i, pf.get(i)!, n)).toBe(true);
        // Gegenprobe: anderes Blatt, andere Stelle, verkürzter Pfad
        if (n > 1) {
          expect(merklePruefen(wurzel, bl[(i + 1) % n], i, pf.get(i)!, n)).toBe(false);
          expect(merklePruefen(wurzel, bl[i], i, pf.get(i)!.slice(1), n)).toBe(false);
        }
      }
    }
  });
});

describe('Stoff sichern und lesen (fail-closed)', () => {
  test('Hin und zurück; die Werte liegen nur verschlüsselt in der Ablage', async () => {
    const s = stoffBauen();
    const w = knoten(s, null);
    expect(await nachweisSichern(w.u, SCHL, s)).toBe(true);
    const roh = w.ablage.daten.get(NACHWEIS + s.k)!;
    expect(roh).not.toContain(s.werte[0].toString(16));
    expect(await nachweiseGesichert(w.u)).toEqual([s.k]);
    const l = await nachweisLaden(w.u, SCHL, s.k);
    expect(l).toEqual(s);
  });

  test('fremder Schlüssel, verfälschtes Blatt, verfälschte Wurzel: abgewiesen', async () => {
    const s = stoffBauen();
    const w = knoten(s, null);
    await nachweisSichern(w.u, SCHL, s);
    await expect(nachweisLaden(w.u, '71'.repeat(32), s.k)).rejects.toThrow('Form');
    const o = JSON.parse(w.ablage.daten.get(NACHWEIS + s.k)!);
    for (const [name, aendern] of [
      ['Blatt', (x: any) => { x.blaetter[s.probe[0]] = '00'.repeat(32); }],
      ['Wurzel', (x: any) => { x.wurzel = '11'.repeat(32); }],
      ['Feld zu viel', (x: any) => { x.extra = 1; }],
      ['Stichprobe unsortiert', (x: any) => { x.probe = [...x.probe].reverse(); }],
    ] as const) {
      const k = JSON.parse(JSON.stringify(o));
      aendern(k);
      w.ablage.daten.set(NACHWEIS + s.k, JSON.stringify(k));
      await expect(nachweisLaden(w.u, SCHL, s.k)).rejects.toThrow(/Nachweis im Geraet/);
      void name;
    }
  });

  test('ein Wert, der nicht zu seinem Blatt passt: abgewiesen (auch wenn die Blätter die Wurzel ergeben)', async () => {
    const s = stoffBauen();
    const w = knoten(s, null);
    await nachweisSichern(w.u, SCHL, { ...s, werte: s.werte.map((v, j) => (j === 3 ? v ^ 2n : v)) });
    await expect(nachweisLaden(w.u, SCHL, s.k)).rejects.toThrow('passt nicht zu ihrem Blatt');
  });

  test('Grenzen: zu groß wird nicht gesichert; höchstens NACHWEISE_MAX, der älteste fällt heraus', async () => {
    const s = stoffBauen();
    const w = knoten(s, null);
    expect(await nachweisSichern(w.u, SCHL, { ...s, x: s.x, vorlage: s.vorlage + 'a'.repeat(NACHWEIS_MAX) })).toBe(false);
    expect(await nachweiseGesichert(w.u)).toEqual([]);
    const ks: string[] = [];
    for (let i = 0; i <= NACHWEISE_MAX; i++) {
      const k = ethers.sha256(ethers.toUtf8Bytes(`k${i}`)).slice(2);
      ks.push(k);
      await nachweisSichern(w.u, SCHL, { ...s, k });
    }
    expect(await nachweiseGesichert(w.u)).toEqual(ks.slice(1));
    expect(w.ablage.daten.has(NACHWEIS + ks[0])).toBe(false);
    expect(JSON.parse(w.ablage.daten.get(NACHWEISE)!).length).toBe(NACHWEISE_MAX);
  });
});

describe('Lage aus der Kette', () => {
  test('nur die eigene Stelle, nur in der Frist, nur eingelöst, höchstens zwei Fehlversuche', () => {
    expect(lageAus(null, B, ENDE)).toEqual({ art: 'vorbei' });
    expect(lageAus({ k: 'x', gebunden: true }, B, ENDE)).toEqual({ art: 'laeuft' });
    expect(lageAus(tot(), B, BIS)).toEqual({ art: 'moeglich', bis: BIS, fehl: 0 });
    expect(lageAus(tot(), B, BIS + 1)).toEqual({ art: 'vorbei' });
    expect(lageAus(tot({ nachweis_stelle: 0 }), B, ENDE)).toEqual({ art: 'vorbei' });
    expect(lageAus(tot({ urteil: 'tot' }), B, ENDE)).toEqual({ art: 'vorbei' });
    expect(lageAus(tot({ nachweis_fehl: 3 }), B, ENDE)).toEqual({ art: 'vorbei' });
    expect(lageAus({ tot: true, urteil: 'eingeloest', ende: ENDE }, B, ENDE)).toEqual({ art: 'vorbei' });
    expect(lageAus(tot({ nachweis_angemeldet: ENDE + 5, nachweis_offen: 64 }), B, BIS + 99)).toEqual({ art: 'angemeldet', bis: BIS, fehl: 0, offen: 64 });
  });
});

describe('Nachweis führen', () => {
  test('Gutfall: anmelden (Fehlversuche in der Unterschrift), in Teilen offenlegen, Pfand an diese Stelle, Stoff weg', async () => {
    const s = stoffBauen();
    expect(s.probe.length).toBeGreaterThan(TEIL);
    const w = knoten(s, { gebunden: true });
    await nachweisSichern(w.u, SCHL, s);
    expect(await nachweisLage(w.u, SCHL, s.k)).toEqual({ art: 'laeuft' });
    await expect(nachweisFuehren(w.u, SCHL, s.k)).rejects.toThrow('läuft noch');
    expect(w.posts).toEqual([]);
    w.sicht = tot({ nachweis_fehl: 1 });
    const erg = await nachweisFuehren(w.u, SCHL, s.k);
    expect(erg).toEqual({ k: s.k, urteil: 'faelschung', pfand: 11_000_000 });
    expect(w.posts.map((p) => p.art)).toEqual(['anmelden', ...Array(Math.ceil(s.probe.length / TEIL)).fill('offenlegen')]);
    expect(w.posts[1].body.quanten_w.ab).toBe(0);
    expect(w.posts[2].body.quanten_w.ab).toBe(TEIL);
    expect(await nachweiseGesichert(w.u)).toEqual([]);
  });

  test('unterbrochen: setzt beim Stand der Kette fort, meldet nicht neu an', async () => {
    const s = stoffBauen();
    const w = knoten(s, tot({ nachweis_angemeldet: ENDE + 10, nachweis_offen: 0 }));
    await nachweisSichern(w.u, SCHL, s);
    // Den ersten Teil hat schon ein früherer Lauf eingereicht (wie der Knoten ihn zählt).
    w.sicht = tot({ nachweis_angemeldet: ENDE + 10, nachweis_offen: TEIL });
    // Der Knoten zählt die Treffer des ersten Teils hier nicht mit -- für das Urteil reicht der Rest.
    const erg = await nachweisFuehren(w.u, SCHL, s.k);
    expect(erg.urteil).toBe('faelschung');
    expect(w.posts.map((p) => p.art)).not.toContain('anmelden');
    expect(w.posts[0].body.quanten_w.ab).toBe(TEIL);
  });

  test('besteht die Vorlage nicht: kein Versuch (er kostete nur einen Fehlversuch)', async () => {
    const s = stoffBauen();
    const w = knoten(s, tot());
    await nachweisSichern(w.u, SCHL, { ...s, vorab: 'abgewiesen' });
    await expect(nachweisFuehren(w.u, SCHL, s.k)).rejects.toThrow('bestand die Stichprobe');
    const x2 = s.x.split('').map((b, i) => (s.probe.includes(i) ? String(1 - Number(b)) : b)).join('');
    await nachweisSichern(w.u, SCHL, { ...s, x: x2 });
    await expect(nachweisFuehren(w.u, SCHL, s.k)).rejects.toThrow('bestand die Stichprobe');
    expect(w.posts).toEqual([]);
  });

  test('nicht angeboten (andere Stelle, Frist vorbei, schon drei Fehlversuche, ohne Stoff): kein Versuch', async () => {
    const s = stoffBauen();
    for (const sicht of [tot({ nachweis_stelle: 0 }), tot({ nachweis_fehl: 3 }), { tot: true, urteil: 'eingeloest', ende: ENDE }, null]) {
      const w = knoten(s, sicht);
      await nachweisSichern(w.u, SCHL, s);
      await expect(nachweisFuehren(w.u, SCHL, s.k)).rejects.toThrow('nicht (mehr) an');
      expect(w.posts).toEqual([]);
    }
    const w = knoten(s, tot());
    w.uhr.t = (BIS + 1) * 1000;
    await nachweisSichern(w.u, SCHL, s);
    await expect(nachweisFuehren(w.u, SCHL, s.k)).rejects.toThrow('nicht (mehr) an');
    const leer = knoten(s, tot());
    await expect(nachweisFuehren(leer.u, SCHL, s.k)).rejects.toThrow('kein Stoff');
  });

  test('BEFUND, wenn das Pfand an jemand anderen ginge', async () => {
    const s = stoffBauen();
    const w = knoten(s, tot());
    w.pfandAn = adresseVon('72'.repeat(32));
    await nachweisSichern(w.u, SCHL, s);
    await expect(nachweisFuehren(w.u, SCHL, s.k)).rejects.toThrow('BEFUND');
    expect(await nachweiseGesichert(w.u)).toEqual([s.k]); // der Stoff bleibt
  });

  test('Aufräumen: vorbei wird gelöscht, laufende bleiben, mögliche werden genannt', async () => {
    const s = stoffBauen();
    const w = knoten(s, { gebunden: true });
    await nachweisSichern(w.u, SCHL, s);
    expect(await nachweiseAufraeumen(w.u, SCHL)).toEqual([]);
    expect(await nachweiseGesichert(w.u)).toEqual([s.k]);
    w.sicht = tot();
    expect(await nachweiseAufraeumen(w.u, SCHL)).toEqual([{ k: s.k, lage: { art: 'moeglich', bis: BIS, fehl: 0 } }]);
    w.sicht = { tot: true, urteil: 'eingeloest', ende: ENDE }; // an dieser Stelle eingelöst oder Frist vorbei
    expect(await nachweiseAufraeumen(w.u, SCHL)).toEqual([]);
    expect(await nachweiseGesichert(w.u)).toEqual([]);
  });
});

describe('P5c: Prüfvektor für den Knoten', () => {
  function vektorBauen() {
    const s = stoffBauen();
    const fehl = 1;
    const nachricht = faelschungAnmeldenNachricht(ICH, s.k, String(B), s.x, s.probe, fehl);
    const pfade = merklePfade(s.blaetter, s.probe);
    const teile = [];
    for (let ab = 0; ab < s.probe.length; ab += TEIL) {
      const offen = [];
      for (let j = ab; j < Math.min(ab + TEIL, s.probe.length); j++) offen.push({ anteile: [], pfad: pfade.get(s.probe[j]), w: s.werte[j].toString(16) });
      teile.push(JSON.stringify({ wallet: '', zeit: 0, quanten_w: { k: s.k, ab, offen } }));
    }
    return {
      k: s.k, n: s.n, b: B, c: C, d: s.d, tol: s.tol, wallet: ICH, inhaberin: adresseVon(INH), x: s.x, probe: s.probe, vorlage: s.vorlage, fehl,
      wurzel: s.wurzel, nachricht, wallet_sig: unterschreiben(SCHL, nachricht),
      koerper_anmelden: JSON.stringify({ wallet: ICH, zeit: 0, quanten_w: { k: s.k, b: String(B), x: s.x, probe: s.probe, vorlage: s.vorlage, salze: s.salze, wallet_sig: unterschreiben(SCHL, nachricht) } }),
      koerper_offenlegen: teile,
    };
  }
  const neu = vektorBauen();
  if (process.env.AEQUITAS_VEKTOR_SCHREIBEN === '1') fs.writeFileSync(PFAD, JSON.stringify(neu, null, 1) + '\n');
  const alt = JSON.parse(fs.readFileSync(PFAD, 'utf8'));

  test('Byte für Byte wie im Vektor (der Knoten prüft genau ihn)', () => {
    expect(neu).toEqual(alt);
    expect(unterschriftVon(alt.nachricht, alt.wallet_sig, alt.wallet)).toBe(true);
    expect(alt.koerper_offenlegen.length).toBeGreaterThan(1);
  });
});
