import { ueberweisungsGebuehr, gebuehrProzent, hoechsterBetrag } from '../fee';

// Dieselben Stufen wie ueberweisungsGebuehrFuer in der Kette
// (x/humanity/keeper/ueberweisungsgebuehr.go).
describe('ueberweisungsGebuehr', () => {
  it('0,1 % für ein gewöhnliches Guthaben', () => {
    expect(ueberweisungsGebuehr(100, 1000)).toBe(0.1);
    expect(ueberweisungsGebuehr(25, 1000)).toBe(0.025);
  });

  it('Aufschlag erst ab dem 5-, 10- und 20-fachen des fairen Anteils', () => {
    expect(ueberweisungsGebuehr(100, 4999.99)).toBe(0.1);
    expect(ueberweisungsGebuehr(100, 5000)).toBe(0.2);
    expect(ueberweisungsGebuehr(100, 10_000)).toBe(0.6);
    expect(ueberweisungsGebuehr(100, 20_000)).toBe(1.1);
  });

  it('rundet auf Mikro-AEQ und lehnt Unsinn ab', () => {
    expect(ueberweisungsGebuehr(0.0001234, 1000)).toBe(0);
    expect(ueberweisungsGebuehr(0.001234, 1000)).toBe(0.000001);
    expect(ueberweisungsGebuehr(0, 1000)).toBe(0);
    expect(ueberweisungsGebuehr(-5, 1000)).toBe(0);
    expect(ueberweisungsGebuehr(NaN, 1000)).toBe(0);
  });

  it('Satz in Prozent', () => {
    expect(gebuehrProzent(1000)).toBeCloseTo(0.1, 10);
    expect(gebuehrProzent(25_000)).toBeCloseTo(1.1, 10);
  });
});

describe('hoechsterBetrag', () => {
  it('lässt genau Platz für die Gebühr', () => {
    for (const g of [1000, 999.123456, 5000, 12_345.678901, 0.5, 0.000001]) {
      const b = hoechsterBetrag(g);
      expect(b + ueberweisungsGebuehr(b, g)).toBeLessThanOrEqual(g + 1e-9);
      // ein Mikro-AEQ mehr wäre zu viel (außer die Gebühr rundet auf 0)
      const b2 = b + 0.000001;
      if (b > 0) expect(b2 + ueberweisungsGebuehr(b2, g)).toBeGreaterThan(g - 1e-6);
    }
  });

  it('0 ohne Guthaben', () => {
    expect(hoechsterBetrag(0)).toBe(0);
    expect(hoechsterBetrag(NaN)).toBe(0);
  });
});
