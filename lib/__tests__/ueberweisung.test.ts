import { fehlerArt, freierRest, gebuehrFuer, hoechstbetrag, imGleichgewicht, type WirtschaftKonto } from '../ueberweisung';

const mensch = (rest: number): WirtschaftKonto => ({ art: 'mensch', guthaben: 0, aktiv: true, gebuehrenfrei_rest_monat: rest });

describe('Gebuehr wie die Kette (gebuehrMitWirtschaft)', () => {
  it('ist im gebuehrenfreien Monatsrest 0', () => {
    expect(gebuehrFuer(400, mensch(1000))).toBe(0);
    expect(gebuehrFuer(1000, mensch(1000))).toBe(0);
  });
  it('berechnet 0,1 % nur auf den Teil ueber dem Rest', () => {
    expect(gebuehrFuer(1500, mensch(1000))).toBeCloseTo(0.5, 6);
    expect(gebuehrFuer(10, mensch(0))).toBeCloseTo(0.01, 6);
  });
  it('rechnet ohne Auskunft mit 0,1 % auf alles (lieber zu hoch)', () => {
    expect(gebuehrFuer(100, null)).toBeCloseTo(0.1, 6);
    expect(freierRest({ art: 'frei', guthaben: 0, aktiv: true })).toBe(0);
    expect(freierRest({ ...mensch(500), aktiv: false })).toBe(0);
  });
  it('rundet auf Mikro-AEQ', () => {
    expect(gebuehrFuer(0.0001234, mensch(0))).toBe(0);
    expect(gebuehrFuer(1.2345678, mensch(0))).toBe(0.001235);
  });
});

describe('Gleichgewicht: keine Gebuehr, nur wenn der Knoten es meldet', () => {
  const gg = (k: WirtschaftKonto, v: unknown) => ({ ...k, gleichgewicht: v }) as WirtschaftKonto;
  it('kostet nichts und erlaubt das ganze Guthaben', () => {
    expect(gebuehrFuer(5000, gg(mensch(0), true))).toBe(0);
    expect(gebuehrFuer(5000, gg({ art: 'unternehmen', guthaben: 0, aktiv: true }, true))).toBe(0);
    expect(hoechstbetrag(1234.5678919, gg(mensch(0), true))).toBe(1234.567891);
  });
  it('Missbrauch/Fehler: alles ausser einem echten true laesst die Gebuehr stehen', () => {
    for (const v of [false, 'true', 1, null, undefined, {}]) {
      expect(imGleichgewicht(gg(mensch(0), v))).toBe(false);
      expect(gebuehrFuer(100, gg(mensch(0), v))).toBeCloseTo(0.1, 6);
    }
    expect(imGleichgewicht(null)).toBe(false);
    expect(gebuehrFuer(100, null)).toBeCloseTo(0.1, 6);
  });
});

describe('Hoechstbetrag samt Gebuehr', () => {
  it('ist das ganze Guthaben, solange es im freien Rest liegt', () => {
    expect(hoechstbetrag(800, mensch(1000))).toBe(800);
  });
  it('passt mit Gebuehr genau ins Guthaben', () => {
    for (const [g, rest] of [[2000, 1000], [1234.567891, 0], [5000, 300], [0.5, 0]] as const) {
      const b = hoechstbetrag(g, mensch(rest));
      expect(b + gebuehrFuer(b, mensch(rest))).toBeLessThanOrEqual(g + 1e-9);
      expect(b + 0.000001 + gebuehrFuer(b + 0.000001, mensch(rest))).toBeGreaterThan(g - 1e-9);
    }
  });
  it('ist 0 ohne Guthaben', () => {
    expect(hoechstbetrag(0, mensch(1000))).toBe(0);
  });
});

describe('Fehlerarten', () => {
  it.each([
    [{ code: 'ACTION_REJECTED', message: 'user rejected action' }, 'abgebrochen'],
    [{ message: 'Zeitüberschreitung — keine Antwort' }, 'zeitueberschreitung'],
    [{ code: 'INSUFFICIENT_FUNDS', message: 'insufficient funds' }, 'guthaben'],
    [{ message: 'could not coalesce error', info: { error: { message: 'nonce too low: 3 (next allowed 5)' } } }, 'nonce'],
    [{ message: 'recipient is a free address and may hold at most 1000 AEQ' }, 'freieAdresseVoll'],
    [{ message: 'server busy: earlier transfers of this sender are still being written' }, 'beschaeftigt'],
    [{ code: 'NETWORK_ERROR', message: 'network error' }, 'netz'],
    [{ message: 'etwas Unerwartetes' }, 'unbekannt'],
  ])('%j -> %s', (e, art) => {
    expect(fehlerArt(e)).toBe(art);
  });
});
