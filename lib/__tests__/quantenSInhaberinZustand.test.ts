// Zustand der Inhaberin ohne die Grenze von SecureStore (B4b-4c-2b′,
// lib/quantenSInhaberin.ts): mit Ablage liegt er AES-256-GCM-verschlüsselt dort,
// im SecureStore nur der Anker (Schlüssel, Platz, Hash). Angriffe: Chiffrat
// getauscht, alter Stand zurückgespielt, Anker verändert; Abbruch zwischen
// Platz und Anker; alter Zustand im SecureStore wird übernommen.
jest.mock('expo-secure-store', () => ({}));
jest.mock('expo-crypto', () => ({ getRandomBytes: () => new Uint8Array(0) }));
jest.mock('../config', () => ({ API_BASE: 'https://knoten.test/api' }));

import { adresseVon, hexZuBits, pubVon } from '../quantenS';
import { ZUSTAND_MAX_SECURESTORE, neu, vergessen, zustandAnzeigen, zustandLesen, zustandSchreiben, type Speicher, type Umgebung } from '../quantenSInhaberin';
import { drbg } from '../quantenSPraepTresor';

const ANKER = 'aequitas.quantenS.inhaberin.anker';
const ALT = 'aequitas.quantenS.inhaberin.zustand';
const CT = 'aequitas.quantenS.inhaberin.zustand.';

function stelle(b: string) {
  const s = b.repeat(32);
  return { adresse: adresseVon(s), schluessel: pubVon(s) };
}
const STELLEN: [ReturnType<typeof stelle>, ReturnType<typeof stelle>] = [stelle('31'), stelle('32')];

function karte(): Speicher & { m: Map<string, string> } {
  const m = new Map<string, string>();
  return { m, lesen: async (k) => m.get(k) ?? null, schreiben: async (k, v) => void m.set(k, v), loeschen: async (k) => void m.delete(k) };
}

function welt(mitAblage = true, saat = '2f') {
  const speicher = karte();
  const ablage = karte();
  const u: Umgebung = {
    fetchFn: (async () => ({ status: 404, ok: false, text: async () => '' })) as unknown as typeof fetch,
    speicher,
    ...(mitAblage ? { ablage } : {}),
    zufall: drbg(saat.repeat(32)),
    apiBasis: 'https://knoten.test/api',
    warten: async () => {},
    jetzt: () => 1_800_000_000_000,
  };
  return { u, speicher, ablage };
}

describe('B4b-4c-2b′: Zustand der Inhaberin verschlüsselt in der Ablage', () => {
  test('großes n passt; SecureStore hält nur den Anker; y steht nirgends im Klartext', async () => {
    const w = welt();
    await neu(w.u, 16384, 16, STELLEN);
    const z = (await zustandLesen(w.u))!;
    expect(z.n).toBe(16384);
    expect([...w.speicher.m.keys()].sort()).toEqual([ANKER, 'aequitas.quantenS.inhaberin.schluessel']);
    for (const v of w.speicher.m.values()) expect(v.length).toBeLessThanOrEqual(ZUSTAND_MAX_SECURESTORE);
    expect([...w.ablage.m.keys()]).toEqual([CT + 0]);
    const y = hexZuBits(z.y, z.n);
    expect(w.ablage.m.get(CT + 0)!).not.toContain(z.y);
    expect(y).toHaveLength(16384);
  });

  test('jedes Schreiben wechselt den Platz; der alte wird gelöscht', async () => {
    const w = welt();
    await neu(w.u, 64, 2, STELLEN);
    expect(JSON.parse(w.speicher.m.get(ANKER)!).platz).toBe(0);
    // vergessen ist erlaubt (kein Token angenommen); danach neu: wieder Platz 0, neuer Schlüssel.
    const key1 = JSON.parse(w.speicher.m.get(ANKER)!).key;
    await vergessen(w.u);
    expect(w.speicher.m.size + w.ablage.m.size).toBe(0);
    await neu(w.u, 64, 2, STELLEN);
    expect(JSON.parse(w.speicher.m.get(ANKER)!).key).not.toBe(key1);
  });

  test('Missbrauch: Chiffrat getauscht, alter Stand zurückgespielt, Anker verändert -- abgewiesen', async () => {
    const w = welt();
    await neu(w.u, 64, 2, STELLEN);
    const ct0 = w.ablage.m.get(CT + 0)!;
    const anker0 = w.speicher.m.get(ANKER)!;
    const z = (await zustandLesen(w.u))!;
    // 1. Bit im Chiffrat gekippt.
    w.ablage.m.set(CT + 0, (ct0[0] === '0' ? '1' : '0') + ct0.slice(1));
    await expect(zustandLesen(w.u)).rejects.toThrow('ausgetauscht');
    // 2. Fremdes Chiffrat (andere Welt) mit passendem Hash im Anker, aber falschem Schlüssel.
    const f = welt(true, '3e');
    await neu(f.u, 64, 2, STELLEN);
    w.ablage.m.set(CT + 0, f.ablage.m.get(CT + 0)!);
    w.speicher.m.set(ANKER, JSON.stringify({ ...JSON.parse(anker0), hash: JSON.parse(f.speicher.m.get(ANKER)!).hash }));
    await expect(zustandLesen(w.u)).rejects.toThrow('ausgetauscht');
    // 3. Anker kaputt.
    w.speicher.m.set(ANKER, '{"key":"00","platz":0}');
    await expect(zustandLesen(w.u)).rejects.toThrow('Anker');
    w.speicher.m.set(ANKER, JSON.stringify({ ...JSON.parse(anker0), key: '00' }));
    await expect(zustandLesen(w.u)).rejects.toThrow('Anker');
    w.speicher.m.set(ANKER, JSON.stringify({ ...JSON.parse(anker0), mehr: 1 }));
    await expect(zustandLesen(w.u)).rejects.toThrow('Anker');
    // 4. Wieder heil: liest genau den alten Stand.
    w.ablage.m.set(CT + 0, ct0);
    w.speicher.m.set(ANKER, anker0);
    expect(await zustandLesen(w.u)).toEqual(z);
  });

  test('Missbrauch: alter Stand wird zurückgespielt -- der Hash im Anker passt nicht', async () => {
    const w = welt();
    await neu(w.u, 64, 2, STELLEN);
    const alt0 = w.ablage.m.get(CT + 0)!;
    // Ein zweites Schreiben (wie beim Abholen oder Einlösen).
    const z = (await zustandLesen(w.u))!;
    await zustandSchreiben(w.u, { ...z, z: 1 });
    expect(JSON.parse(w.speicher.m.get(ANKER)!).platz).toBe(1);
    expect(w.ablage.m.has(CT + 0)).toBe(false);
    // Der Angreifer legt den alten Stand in den neuen Platz.
    w.ablage.m.set(CT + 1, alt0);
    await expect(zustandLesen(w.u)).rejects.toThrow('ausgetauscht');
    // Noch einmal geschrieben: wieder Platz 0 -- jetzt passt der alte Stand sogar zum Platz (gleicher Schlüssel,
    // gleiche Domäne). Nur der Hash im Anker hält ihn auf.
    await zustandSchreiben(w.u, { ...z, z: 0 });
    expect(JSON.parse(w.speicher.m.get(ANKER)!).platz).toBe(0);
    w.ablage.m.set(CT + 0, alt0);
    await expect(zustandLesen(w.u)).rejects.toThrow('ausgetauscht');
  });

  test('Abbruch zwischen neuem Platz und Anker: der alte Stand gilt weiter', async () => {
    const w = welt();
    await neu(w.u, 64, 2, STELLEN);
    const z = (await zustandLesen(w.u))!;
    const schreiben = w.speicher.schreiben;
    w.u.speicher = { ...w.speicher, schreiben: async (k, v, g) => (k === ANKER ? Promise.reject(new Error('Absturz')) : schreiben(k, v, g)) };
    await expect(zustandSchreiben(w.u, { ...z, z: 1 })).rejects.toThrow('Absturz');
    w.u.speicher = w.speicher;
    expect(await zustandLesen(w.u)).toEqual(z);
  });

  test('alter Zustand im SecureStore wird gelesen und beim nächsten Schreiben übernommen', async () => {
    const a = welt(false);
    await neu(a.u, 64, 2, STELLEN);
    const roh = a.speicher.m.get(ALT)!;
    const w = welt();
    w.speicher.m.set(ALT, roh);
    w.speicher.m.set('aequitas.quantenS.inhaberin.schluessel', a.speicher.m.get('aequitas.quantenS.inhaberin.schluessel')!);
    const z = (await zustandLesen(w.u))!;
    expect(z).toEqual(JSON.parse(roh));
    expect((await zustandAnzeigen(w.u))!.n).toBe(64);
    await zustandSchreiben(w.u, { ...z, z: 0 });
    expect(w.speicher.m.has(ALT)).toBe(false);
    expect((await zustandLesen(w.u))!.z).toBe(0);
  });

  test('defekter Zufall: kein Zustand mit kurzem Schlüssel oder Nonce', async () => {
    for (const kaputt of [32, 12]) {
      const w = welt();
      const z0 = w.u.zufall;
      w.u.zufall = (n) => (n === kaputt ? z0(n).slice(1) : z0(n));
      await expect(zustandSchreiben(w.u, { n: 64, v: 2, y: '00'.repeat(8), stellen: [STELLEN[0].adresse, STELLEN[1].adresse], stellenSchluessel: [STELLEN[0].schluessel, STELLEN[1].schluessel] })).rejects.toThrow('Zufall');
      expect(w.speicher.m.size + w.ablage.m.size).toBe(0);
    }
  });

  test('ohne Ablage bleibt die Grenze von SecureStore', async () => {
    const w = welt(false);
    await expect(neu(w.u, 16384, 16, STELLEN)).rejects.toThrow('n zu gross fuer den Speicher dieses Geraets');
    expect(w.speicher.m.size).toBe(0); // abgewiesen, bevor etwas geschrieben wird
    await neu(w.u, 64, 2, STELLEN);
    expect(w.speicher.m.has(ALT)).toBe(true);
    expect(w.speicher.m.has(ANKER)).toBe(false);
  });
});
