// Tresor der Präparatorin (lib/quantenSPraepTresor.ts): Seed statt großer
// Werte, AES-256-GCM in der Ablage, Schlüssel in SecureStore, fail-closed.
jest.mock('expo-secure-store', () => ({}));
jest.mock('expo-crypto', () => ({ getRandomBytes: () => new Uint8Array(0) }));
jest.mock('../config', () => ({ API_BASE: 'https://knoten.test/api' }));
import { ethers } from 'ethers';
import vektor from './vektoren/quanten_s_praep_auftrag_vektor.json';
import type { Speicher } from '../quantenSInhaberin';
import { antwortAufAuftrag, auftragLesen, auftragPruefen, messbitsZiehen, type Bestellung } from '../quantenSPraepAuftrag';
import { FAELLE_MAX, FALL_MAX, PraepTresor, TRESOR_SCHLUESSEL, drbg, type Fall } from '../quantenSPraepTresor';

function speicher(): Speicher & { daten: Map<string, string> } {
  const daten = new Map<string, string>();
  return {
    daten,
    lesen: async (k) => daten.get(k) ?? null,
    schreiben: async (k, v) => void daten.set(k, v),
    loeschen: async (k) => void daten.delete(k),
  };
}

const zaehler = () => drbg('11'.repeat(32)); // Testzufall des Geräts
const ICH = vektor.praeparatoren_schluessel_nur_test[vektor.auftrag.x - 1];
const JETZT = vektor.auftrag.zeit + 10;
const q = auftragLesen(ethers.toUtf8Bytes(JSON.stringify(vektor.auftrag)));
const best: Bestellung = { k: q.k, ausgeber: q.praeger, v: 3, t: 2, zeit: q.zeit - 600, frist: q.zeit + 3000, los: [...q.validatoren] };

function fall(x: Partial<Fall> = {}): Fall {
  const n = vektor.bis - vektor.von;
  return { k: q.k, auftrag: q, seed: '22'.repeat(32), u: '0'.repeat(n), t: '1'.repeat(n), x: '0'.repeat(n), stand: 'gemessen', zeit: JETZT, ...x };
}

describe('drbg', () => {
  it('ist deterministisch, je Seed verschieden, und liefert genau n Byte', () => {
    const a = drbg('aa'.repeat(32));
    const b = drbg('aa'.repeat(32));
    expect(ethers.hexlify(a(100))).toBe(ethers.hexlify(b(100)));
    expect(ethers.hexlify(a(7))).toBe(ethers.hexlify(b(7)));
    expect(ethers.hexlify(drbg('ab'.repeat(32))(32))).not.toBe(ethers.hexlify(drbg('aa'.repeat(32))(32)));
    expect(drbg('aa'.repeat(32))(0)).toHaveLength(0);
  });
  it('wiederholt keinen Block (der Zähler läuft weiter)', () => {
    const r = drbg('aa'.repeat(32))(32 * 8);
    const bloecke = new Set(Array.from({ length: 8 }, (_, i) => ethers.hexlify(r.slice(32 * i, 32 * (i + 1)))));
    expect(bloecke.size).toBe(8);
  });
  it('weist einen Seed in falscher Form ab', () => {
    expect(() => drbg('aa')).toThrow('Seed');
    expect(() => drbg('AA'.repeat(32))).toThrow('Seed');
  });
  it('derselbe Seed ergibt dieselbe Antwort (wie der Dienst bei demselben Auftrag)', () => {
    const g = auftragPruefen(q, ICH, [best], JETZT);
    const n = g.bis - g.von;
    const y = g.y.split('').map(Number);
    const { u, t } = messbitsZiehen(n, drbg('33'.repeat(32)));
    const m = { y, u, t, x: t };
    const a1 = antwortAufAuftrag(ICH, q, g, m, drbg('44'.repeat(32)));
    const a2 = antwortAufAuftrag(ICH, q, g, m, drbg('44'.repeat(32)));
    expect(a2).toEqual(a1);
    expect(antwortAufAuftrag(ICH, q, g, m, drbg('45'.repeat(32))).antwort.blaetter).not.toEqual(a1.antwort.blaetter);
  });
});

describe('PraepTresor', () => {
  it('speichert verschlüsselt und liest denselben Fall zurück', async () => {
    const geheim = speicher();
    const ablage = speicher();
    const tr = new PraepTresor(geheim, ablage, zaehler());
    await tr.speichern(fall());
    expect(await tr.liste()).toEqual([q.k]);
    expect(await tr.laden(q.k)).toEqual(fall());
    // In der Ablage steht nichts im Klartext.
    const roh = [...ablage.daten.values()].join('');
    expect(roh).not.toContain('22'.repeat(32));
    expect(roh).not.toContain(q.praeger);
    expect(geheim.daten.get(TRESOR_SCHLUESSEL)).toMatch(/^[0-9a-f]{64}$/);
    await tr.speichern(fall({ stand: 'beantwortet' }));
    expect((await tr.laden(q.k))?.stand).toBe('beantwortet');
    expect(await tr.liste()).toEqual([q.k]);
  });

  it('weist ein verändertes Chiffrat ab', async () => {
    const ablage = speicher();
    const tr = new PraepTresor(speicher(), ablage, zaehler());
    await tr.speichern(fall());
    const key = 'aequitas.quantenS.praep.fall.' + q.k;
    const c = ablage.daten.get(key)!;
    ablage.daten.set(key, c.slice(0, -2) + (c.endsWith('00') ? '01' : '00'));
    await expect(tr.laden(q.k)).rejects.toThrow('verändert');
  });

  it('ein Fall gilt nicht unter einem anderen K (Zusatzdaten)', async () => {
    const ablage = speicher();
    const tr = new PraepTresor(speicher(), ablage, zaehler());
    await tr.speichern(fall());
    const anderesK = 'cd'.repeat(32);
    ablage.daten.set('aequitas.quantenS.praep.fall.' + anderesK, ablage.daten.get('aequitas.quantenS.praep.fall.' + q.k)!);
    await expect(tr.laden(anderesK)).rejects.toThrow('verändert');
  });

  it('ohne Schlüssel wird nichts gelesen (kein neuer Schlüssel beim Lesen)', async () => {
    const geheim = speicher();
    const tr = new PraepTresor(geheim, speicher(), zaehler());
    await tr.speichern(fall());
    geheim.daten.delete(TRESOR_SCHLUESSEL);
    await expect(tr.laden(q.k)).rejects.toThrow('Schlüssel fehlt');
    expect(geheim.daten.has(TRESOR_SCHLUESSEL)).toBe(false);
  });

  it('mit einem fremden Schlüssel wird nichts gelesen', async () => {
    const geheim = speicher();
    const tr = new PraepTresor(geheim, speicher(), zaehler());
    await tr.speichern(fall());
    geheim.daten.set(TRESOR_SCHLUESSEL, '99'.repeat(32));
    await expect(tr.laden(q.k)).rejects.toThrow('fremder Schlüssel');
  });

  it('begrenzt die Zahl der Fälle', async () => {
    const tr = new PraepTresor(speicher(), speicher(), zaehler());
    for (let i = 0; i < FAELLE_MAX; i++) {
      const k = i.toString(16).padStart(64, '0');
      await tr.speichern(fall({ k, auftrag: { ...q, k } }));
    }
    const k = 'ff'.repeat(32);
    await expect(tr.speichern(fall({ k, auftrag: { ...q, k } }))).rejects.toThrow('zu viele');
    await tr.loeschen('0'.repeat(64));
    await expect(tr.speichern(fall({ k, auftrag: { ...q, k } }))).resolves.toBeUndefined();
  });

  it('begrenzt die Größe eines Falls', async () => {
    const n = FALL_MAX;
    const tr = new PraepTresor(speicher(), speicher(), zaehler());
    await expect(tr.speichern(fall({ u: '0'.repeat(n), t: '0'.repeat(n), x: '0'.repeat(n) }))).rejects.toThrow('zu groß');
  });

  it.each([
    ['Auftrag zu anderem K', { auftrag: { ...q, k: 'ab'.repeat(32).replace(/^ab/, 'cd') } }, 'anderem K'],
    ['Seed groß geschrieben', { seed: 'AA'.repeat(32) }, 'Seed'],
    ['ungleiche Längen', { x: '0' }, 'Längen'],
    ['unbekannter Stand', { stand: 'fertig' as Fall['stand'] }, 'Stand'],
    ['Zeit 0', { zeit: 0 }, 'Zeit'],
  ])('speichert keinen kaputten Fall: %s', async (_n, x, grund) => {
    const tr = new PraepTresor(speicher(), speicher(), zaehler());
    await expect(tr.speichern(fall(x))).rejects.toThrow(grund);
  });

  it('weist eine beschädigte Liste ab', async () => {
    const ablage = speicher();
    ablage.daten.set('aequitas.quantenS.praep.faelle', '["x"]');
    await expect(new PraepTresor(speicher(), ablage, zaehler()).liste()).rejects.toThrow('Liste');
  });

  it('löscht einen Fall', async () => {
    const tr = new PraepTresor(speicher(), speicher(), zaehler());
    await tr.speichern(fall());
    await tr.loeschen(q.k);
    expect(await tr.laden(q.k)).toBeNull();
    expect(await tr.liste()).toEqual([]);
  });
});

describe('PraepTresor: Bestätigung im Fall (B4b-4c-1f)', () => {
  const b = (x: Record<string, unknown> = {}) => ({ sig: '0x' + 'ab'.repeat(65), anteile: Array(q.n).fill('1f'), oeffnungen: { '1': ['aa', 'bb'], '3': ['cc', 'dd'] }, ...x });
  it('speichert und liest eine Bestätigung', async () => {
    const tr = new PraepTresor(speicher(), speicher(), zaehler());
    await tr.speichern(fall({ stand: 'bestaetigt', bestaetigung: b() as never }));
    expect((await tr.laden(q.k))?.bestaetigung?.oeffnungen['3']).toEqual(['cc', 'dd']);
  });
  it.each([
    ['bestätigt ohne Bestätigung', { stand: 'bestaetigt' }, 'passen nicht'],
    ['Bestätigung beim Stand gemessen', { bestaetigung: b() }, 'passen nicht'],
    ['Unterschrift falsch', { stand: 'bestaetigt', bestaetigung: b({ sig: '0x12' }) }, 'Unterschrift'],
    ['zu wenige Anteile', { stand: 'bestaetigt', bestaetigung: b({ anteile: ['1f'] }) }, 'Anteile'],
    ['Anteil zu lang', { stand: 'bestaetigt', bestaetigung: b({ anteile: Array(q.n).fill('f'.repeat(65)) }) }, 'Anteile'],
    ['Paket an Nummer 0', { stand: 'bestaetigt', bestaetigung: b({ oeffnungen: { '0': ['aa', 'bb'] } }) }, 'Pakete'],
    ['Paket an Nummer über v', { stand: 'bestaetigt', bestaetigung: b({ oeffnungen: { '4': ['aa', 'bb'] } }) }, 'Pakete'],
    ['nur ein Paket', { stand: 'bestaetigt', bestaetigung: b({ oeffnungen: { '1': ['aa'] } }) }, 'Pakete'],
    ['fremdes Feld', { stand: 'bestaetigt', bestaetigung: b({ extra: 1 }) }, 'Felder'],
    ['Sichtung mit negativer Höhe', { stand: 'bestaetigt', bestaetigung: b(), sichtung: { schl: 'ab'.repeat(32), hoehe: -1 } }, 'Sichtung'],
    ['Sichtung mit Bruch', { stand: 'bestaetigt', bestaetigung: b(), sichtung: { schl: 'ab'.repeat(32), hoehe: 1.5 } }, 'Sichtung'],
    ['Sichtung mit kurzem Schlüssel', { stand: 'bestaetigt', bestaetigung: b(), sichtung: { schl: 'ab', hoehe: 1 } }, 'Sichtung'],
    ['Sichtung mit fremdem Feld', { stand: 'bestaetigt', bestaetigung: b(), sichtung: { schl: 'ab'.repeat(32), hoehe: 1, x: 1 } }, 'Sichtung'],
    ['Sichtung ohne Bestätigung', { sichtung: { schl: 'ab'.repeat(32), hoehe: 1 } }, 'Felder'],
  ])('weist ab: %s', async (_n, x, grund) => {
    const tr = new PraepTresor(speicher(), speicher(), zaehler());
    await expect(tr.speichern(fall(x as Partial<Fall>))).rejects.toThrow(grund);
  });
});
