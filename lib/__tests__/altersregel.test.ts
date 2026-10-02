import { formularFelder, landAusGeraet, mindestalter, pruefen, volleJahre } from '../altersregel';

const OKT_2026 = new Date(Date.UTC(2026, 9, 15));

const p = (jahr: string, monat: string, land: string, region?: string) =>
  pruefen({ jahr, monat, land, region }, OKT_2026);

describe('altersregel', () => {
  it('Erwachsener besteht', () => {
    expect(p('1990', '5', 'DE')).toEqual({ ok: true, mindestalter: 18 });
  });

  it('Siebzehnjaehriger kommt nicht zur Kamera', () => {
    expect(p('2009', '1', 'DE')).toEqual({ ok: false, grund: 'zu_jung', mindestalter: 18 });
  });

  it('im Geburtsmonat gilt der Geburtstag als nicht erreicht', () => {
    expect(volleJahre(2008, 10, OKT_2026)).toBe(17);
    expect(p('2008', '10', 'DE').ok).toBe(false);
    expect(p('2008', '9', 'DE').ok).toBe(true);
  });

  it.each([
    ['KR', 19], ['TH', 20], ['NZ', 20], ['SG', 21], ['ID', 21], ['DE', 18], ['XX', 18],
  ])('Mindestalter %s = %i', (land, grenze) => {
    expect(mindestalter(land as string)).toBe(grenze);
    const jahr = String(2026 - (grenze as number));
    expect(p(jahr, '1', land as string).ok).toBe(true);
    expect(p(String(Number(jahr) + 1), '1', land as string).ok).toBe(false);
  });

  it('Landesteile; ohne Landesteil der hoechste Wert', () => {
    expect(mindestalter('US', 'MS')).toBe(21);
    expect(mindestalter('US', 'CA')).toBe(18);
    expect(mindestalter('US')).toBe(21);
    expect(mindestalter('CA')).toBe(19);
  });

  it('fehlende Angaben', () => {
    expect(p('', '5', 'DE')).toEqual({ ok: false, grund: 'fehlt' });
    expect(p('1990', '', 'DE')).toEqual({ ok: false, grund: 'fehlt' });
    expect(p('1990', '5', ' ')).toEqual({ ok: false, grund: 'fehlt' });
  });

  it.each([
    ['1990', '0', 'DE'], ['1990', '13', 'DE'], ['1899', '5', 'DE'], ['2027', '5', 'DE'],
    ['90', '5', 'DE'], ['1990.5', '5', 'DE'], ['1990', '5', 'DEU'], ['1990', '5', 'D1'],
  ])('unsinnig: %s/%s/%s', (jahr, monat, land) => {
    expect(p(jahr, monat, land)).toEqual({ ok: false, grund: 'ungueltig' });
  });

  it('Formularfelder fuer den Coordinator', () => {
    expect(formularFelder({ geburtsjahr: 1990, geburtsmonat: 5, land: 'de' })).toEqual([
      ['geburtsjahr', '1990'], ['geburtsmonat', '5'], ['land', 'DE'],
    ]);
    expect(formularFelder({ geburtsjahr: 1990, geburtsmonat: 5, land: 'US', region: 'ms' })).toContainEqual(['region', 'MS']);
  });

  it('Land aus dem Geraet ist zwei Buchstaben oder leer', () => {
    expect(landAusGeraet()).toMatch(/^([A-Z]{2})?$/);
  });
});
