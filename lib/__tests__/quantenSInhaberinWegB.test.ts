// Inhaberin in Weg B (B4b-4c-2b, lib/quantenSInhaberin.ts neuWegB): y je
// Abschnitt an den Schlüssel der Gelosten aus dem Register, in Losreihenfolge.
// Jede Geloste öffnet genau ihren Abschnitt mit dem Code der Präparatorin
// (basenOeffnen); Fälschungen des Knotens werden abgewiesen.
jest.mock('expo-secure-store', () => ({}));
jest.mock('expo-crypto', () => ({ getRandomBytes: () => new Uint8Array(0) }));
jest.mock('../config', () => ({ API_BASE: 'https://knoten.test/api' }));

import { ethers } from 'ethers';
import { abschnitt, adresseVon, basenHash, hexZuBits, pubVon } from '../quantenS';
import { neuWegB, zustandAnzeigen, zustandLesen, type Umgebung } from '../quantenSInhaberin';
import { basenOeffnen } from '../quantenSPraepAuftrag';
import { drbg } from '../quantenSPraepTresor';

const API = 'https://knoten.test/api';
const K = 'c4'.repeat(32);
const JETZT = 1_800_000_000;
const N = 40;
const SCHL = [0x61, 0x62, 0x63, 0x64, 0x65].map((b) => b.toString(16).repeat(32));
const LOS = SCHL.map(adresseVon);
const FREMD = '77'.repeat(32);

function stelle(seed: number) {
  const s = seed.toString(16).padStart(2, '0').repeat(32);
  return { adresse: adresseVon(s), schluessel: pubVon(s) };
}
const STELLEN: [ReturnType<typeof stelle>, ReturnType<typeof stelle>] = [stelle(0x31), stelle(0x32)];

interface Opt {
  aktiv?: boolean;
  register?: (eintraege: Record<string, unknown>[]) => void;
  bestellung?: (b: Record<string, unknown>) => void;
  doppelt?: boolean;
}

function welt(opt: Opt = {}) {
  const speicher = new Map<string, string>();
  const ablage = new Map<string, string>();
  const fetchFn = (async (url: string) => {
    if (url !== `${API}/quanten-w/praeparatoren`) return { status: 404, ok: false, text: async () => '' } as unknown as Response;
    const eintraege: Record<string, unknown>[] = [...SCHL, FREMD].map((s) => ({ konto: adresseVon(s), pub: pubVon(s), gemeldet: 1, im_los_ab: 2 }));
    opt.register?.(eintraege);
    const b: Record<string, unknown> = { k: K, ausgeber: adresseVon('99'.repeat(32)), v: 5, t: 3, zeit: JETZT - 900, frist: JETZT + 1000, los: LOS };
    opt.bestellung?.(b);
    const roh = { aktiv: opt.aktiv ?? true, vorlauf: 86400, nachlauf: 1, praeparatoren: eintraege, bestellungen: opt.doppelt ? [b, { ...b, ausgeber: adresseVon('98'.repeat(32)) }] : [b] };
    return { status: 200, ok: true, text: async () => JSON.stringify(roh) } as unknown as Response;
  }) as unknown as typeof fetch;
  const u: Umgebung = {
    fetchFn,
    speicher: { lesen: async (k) => speicher.get(k) ?? null, schreiben: async (k, v) => void speicher.set(k, v), loeschen: async (k) => void speicher.delete(k) },
    ablage: { lesen: async (k) => ablage.get(k) ?? null, schreiben: async (k, v) => void ablage.set(k, v), loeschen: async (k) => void ablage.delete(k) },
    zufall: drbg('2b'.repeat(32)),
    apiBasis: API,
    warten: async () => {},
    jetzt: () => JETZT * 1000,
  };
  return { u, speicher, ablage };
}

describe('B4b-4c-2b: Inhaberin verschlüsselt an die Gelosten', () => {
  test('Gutfall: je Geloste genau ihr Abschnitt, in Losreihenfolge; Fremde lesen nichts', async () => {
    const w = welt();
    const best = await neuWegB(w.u, N, K.toUpperCase(), STELLEN);
    expect(best.basen).toBeUndefined();
    expect(best.basen_verschluesselt).toHaveLength(5);
    const z = (await zustandLesen(w.u))!;
    expect(z.wegB).toBe(K);
    expect(z.verschluesseltAn).toEqual(LOS);
    expect((await zustandAnzeigen(w.u))!.wegB).toBe(true); // die Seite zeigt dann "Paket abholen" (4c-3c)
    expect(z.basenHash).toEqual(best.basen_verschluesselt!.map(basenHash));
    const y = hexZuBits(z.y, N);
    for (let x = 1; x <= 5; x++) {
      const a = abschnitt(N, 5, x)!;
      const c = best.basen_verschluesselt![x - 1];
      expect(basenOeffnen(SCHL[x - 1], c, N, LOS, x, best.inhaberin)).toBe(y.slice(a.von, a.bis));
      // Eine andere Geloste und ein Fremder öffnen es nicht.
      expect(() => basenOeffnen(SCHL[x % 5], c, N, LOS, x, best.inhaberin)).toThrow();
      expect(() => basenOeffnen(FREMD, c, N, LOS, x, best.inhaberin)).toThrow();
    }
    // Keine zweite Bestellung über die erste.
    await expect(neuWegB(w.u, N, K, STELLEN)).rejects.toThrow('schon eine Bestellung');
  });

  test('Missbrauch: der Knoten setzt für eine Geloste einen fremden Schlüssel ein -- nichts verschlüsselt', async () => {
    const w = welt({ register: (e) => void (e[2].pub = pubVon(FREMD)) });
    await expect(neuWegB(w.u, N, K, STELLEN)).rejects.toThrow('Register: Form');
    expect(w.speicher.size + w.ablage.size).toBe(0);
  });

  const faelle: [string, Opt, string][] = [
    ['Geloste fehlt im Register', { register: (e) => void e.splice(1, 1) }, 'nicht (eindeutig) im Register'],
    ['Geloste doppelt im Register', { register: (e) => void e.push({ ...e[0] }) }, 'nicht (eindeutig) im Register'],
    ['K nicht bestellt', { bestellung: (b) => void (b.k = 'd5'.repeat(32)) }, 'nicht bestellt'],
    ['noch nicht gelost', { bestellung: (b) => void delete b.los }, 'noch nicht gelost'],
    ['verfallen', { bestellung: (b) => void (b.frist = JETZT - 1) }, 'verfallen'],
    ['Los doppelt', { bestellung: (b) => void (b.los = [LOS[0], LOS[0], LOS[1], LOS[2], LOS[3]]) }, 'Register: Form'],
    ['Los kürzer als v', { bestellung: (b) => void (b.los = LOS.slice(0, 4)) }, 'Register: Form'],
    ['Weg B schläft', { aktiv: false }, 'nicht aktiv'],
    ['K zweimal bestellt (verschiedene Lose möglich)', { doppelt: true }, 'nicht bestellt'],
  ];
  test.each(faelle)('Missbrauch: %s -- abgewiesen, nichts gespeichert', async (_, opt, grund) => {
    const w = welt(opt);
    await expect(neuWegB(w.u, N, K, STELLEN)).rejects.toThrow(grund);
    expect(w.speicher.size + w.ablage.size).toBe(0);
  });

  test('Eingaben: K-Form, n, ohne Ablage', async () => {
    await expect(neuWegB(welt().u, N, 'xyz', STELLEN)).rejects.toThrow('K: 64');
    await expect(neuWegB(welt().u, 4, K, STELLEN)).rejects.toThrow('n oder v');
    const w = welt();
    delete w.u.ablage;
    await expect(neuWegB(w.u, N, K, STELLEN)).rejects.toThrow('Ablage');
    // 2b′: mit Ablage liegt der Zustand verschlüsselt dort -- auch das größte n passt (vorher SecureStore, 2048 Byte).
    const g = welt();
    await neuWegB(g.u, 16384, K, STELLEN);
    expect((await zustandLesen(g.u))!.n).toBe(16384);
    for (const wert of g.speicher.values()) expect(wert.length).toBeLessThanOrEqual(2048);
  });

  test('der Schlüssel aus dem Register wird gegen die Adresse geprüft (pubPasst), Groß-/Kleinschreibung zählt', async () => {
    const w = welt({ register: (e) => void (e[0].pub = (e[0].pub as string).toUpperCase()) });
    await expect(neuWegB(w.u, N, K, STELLEN)).rejects.toThrow('Register: Form');
    expect(ethers.isHexString('0x' + pubVon(SCHL[0]))).toBe(true);
  });
});
