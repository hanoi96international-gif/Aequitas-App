import { bestaetigungPruefen, formularFelder, LAENDER, REGIONEN } from '../altersregel';
import { flagge, hatRegionen, LAENDER_LISTE, laenderFuer, landName, passt, regelFuer, REGIONEN_LISTE } from '../laender';

describe('Laenderliste', () => {
  it('hat jedes Land genau einmal und jedes Land mit abweichendem Mindestalter', () => {
    const codes = LAENDER_LISTE.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.length).toBeGreaterThanOrEqual(249);
    for (const c of [...Object.keys(LAENDER), ...Object.keys(REGIONEN), 'DE', 'AT', 'CH']) {
      expect(codes).toContain(c);
    }
  });

  it('hat fuer jeden Landesteil mit eigener Regel einen Eintrag in der Auswahl', () => {
    for (const [land, teile] of Object.entries(REGIONEN)) {
      const auswahl = (REGIONEN_LISTE[land] ?? []).map((e) => e.code);
      for (const r of Object.keys(teile)) expect(auswahl).toContain(r);
    }
  });

  it('nennt Laender in der Sprache der App und findet sie auch englisch/deutsch', () => {
    expect(landName('DE', 'de')).toBe('Deutschland');
    expect(landName('DE', 'en')).toBe('Germany');
    expect(landName('ZZ', 'de')).toBe('ZZ');
    const de = laenderFuer('de');
    const ch = de.find((e) => e.code === 'CH')!;
    expect(passt(ch, 'schweiz')).toBe(true);
    expect(passt(ch, 'Switzerland')).toBe(true);
    expect(passt(ch, 'ch')).toBe(true);
    expect(passt(de.find((e) => e.code === 'AT')!, 'osterreich')).toBe(true); // ohne Umlaut
    expect(flagge('DE')).toBe('🇩🇪');
  });
});

describe('Regel fuer den Text', () => {
  it('nennt das Mindestalter des Landes oder fragt nach dem Landesteil', () => {
    expect(regelFuer('DE')).toEqual({ art: 'fest', n: 18 });
    expect(regelFuer('SG')).toEqual({ art: 'fest', n: 21 });
    expect(regelFuer('US')).toEqual({ art: 'region', min: 18, max: 21 });
    expect(regelFuer('US', 'MS')).toEqual({ art: 'fest', n: 21 });
    expect(regelFuer('US', 'TX')).toEqual({ art: 'fest', n: 18 });
    expect(regelFuer('CA', 'BC')).toEqual({ art: 'fest', n: 19 });
    expect(regelFuer('')).toEqual({ art: 'keins' });
    expect(hatRegionen('US')).toBe(true);
    expect(hatRegionen('DE')).toBe(false);
  });
});

describe('Bestaetigung statt Geburtsdatum', () => {
  it('gilt nur mit Land, Landesteil (USA/Kanada) und Haken', () => {
    expect(bestaetigungPruefen('DE', '', true)).toEqual({ ok: true, mindestalter: 18 });
    expect(bestaetigungPruefen('SG', '', true)).toEqual({ ok: true, mindestalter: 21 });
    expect(bestaetigungPruefen('US', 'MS', true)).toEqual({ ok: true, mindestalter: 21 });
    expect(bestaetigungPruefen('DE', '', false)).toEqual({ ok: false, grund: 'fehlt' });
    expect(bestaetigungPruefen('', '', true)).toEqual({ ok: false, grund: 'fehlt' });
    expect(bestaetigungPruefen('US', '', true)).toEqual({ ok: false, grund: 'ungueltig' });
    expect(bestaetigungPruefen('Deutschland', '', true)).toEqual({ ok: false, grund: 'ungueltig' });
  });

  it('schickt Land und die bestaetigte Zahl -- kein Geburtsdatum', () => {
    expect(formularFelder({ land: 'de', alterBestaetigt: 18 })).toEqual([
      ['land', 'DE'],
      ['alter_bestaetigt', '18'],
    ]);
    const mitRegion = formularFelder({ land: 'US', region: 'ms', alterBestaetigt: 21 });
    expect(mitRegion).toContainEqual(['region', 'MS']);
    expect(mitRegion.map(([k]) => k)).not.toContain('geburtsjahr');
  });
});
