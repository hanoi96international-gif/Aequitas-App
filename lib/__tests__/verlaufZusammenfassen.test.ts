import { tagesrundenZusammenfassen } from '../verlaufZusammenfassen';
import type { VerlaufEintrag } from '../api';

const e = (p: Partial<VerlaufEintrag>): VerlaufEintrag => ({
  hoehe: 1, tx_index: 0, richtung: 'ein', art: 'transfer', betrag: 1, zeit: 1000, ...p,
});

describe('tagesrundenZusammenfassen', () => {
  it('fasst Grundeinkommen und Abgabe derselben Runde zu einer Zeile zusammen (Netto 0)', () => {
    const z = tagesrundenZusammenfassen([
      e({ art: 'ubi_distribution', richtung: 'ein', betrag: 0.166, zeit: 2000, hoehe: 9, tx_index: 1 }),
      e({ art: 'umlauf', richtung: 'aus', betrag: 0.166, zeit: 2000, hoehe: 9, tx_index: 0 }),
      e({ art: 'transfer', richtung: 'aus', betrag: 2, zeit: 1500, hoehe: 7 }),
    ]);
    expect(z).toHaveLength(2);
    expect(z[0]).toMatchObject({ art: 'tagesrunde', richtung: 'neutral', betrag: 0, erhalten: 0.166, abgabe: 0.166, zeit: 2000 });
    expect(z[1]).toMatchObject({ art: 'transfer', betrag: 2 });
  });

  it('zeigt das Netto mit Richtung: unter dem fairen Anteil mehr erhalten, darueber mehr abgegeben', () => {
    const plus = tagesrundenZusammenfassen([
      e({ art: 'umlauf', richtung: 'aus', betrag: 0.05, zeit: 3000 }),
      e({ art: 'ubi_distribution', richtung: 'ein', betrag: 0.166667, zeit: 3000 }),
    ]);
    expect(plus).toHaveLength(1);
    expect(plus[0]).toMatchObject({ art: 'tagesrunde', richtung: 'ein', betrag: 0.116667 });
    const minus = tagesrundenZusammenfassen([
      e({ art: 'ubi_distribution', richtung: 'ein', betrag: 0.1, zeit: 3000 }),
      e({ art: 'umlauf', richtung: 'aus', betrag: 0.4, zeit: 3000 }),
    ]);
    expect(minus[0]).toMatchObject({ art: 'tagesrunde', richtung: 'aus', betrag: 0.3 });
  });

  it('laesst einzelne Buchungen, andere Runden und andere Arten unveraendert', () => {
    const roh = [
      e({ art: 'ubi_distribution', richtung: 'ein', betrag: 0.166, zeit: 2000 }),
      e({ art: 'umlauf', richtung: 'aus', betrag: 0.166, zeit: 1000 }), // andere Runde
      e({ art: 'umlauf', richtung: 'ein', betrag: 0.166, zeit: 2000 }), // falsche Richtung
      e({ art: 'register_human', richtung: 'ein', betrag: 1000, zeit: 2000 }),
    ];
    expect(tagesrundenZusammenfassen(roh)).toEqual(roh);
  });

  it('verrechnet keine unlesbaren Betraege', () => {
    const roh = [
      e({ art: 'ubi_distribution', richtung: 'ein', betrag: Number.NaN, zeit: 2000 }),
      e({ art: 'umlauf', richtung: 'aus', betrag: 0.166, zeit: 2000 }),
    ];
    expect(tagesrundenZusammenfassen(roh)).toEqual(roh);
  });

  it('fasst ueber Seitengrenzen hinweg zusammen (Liste nach dem Nachladen)', () => {
    const seite1 = [e({ art: 'umlauf', richtung: 'aus', betrag: 0.2, zeit: 5000, hoehe: 50 })];
    const seite2 = [e({ art: 'ubi_distribution', richtung: 'ein', betrag: 0.2, zeit: 5000, hoehe: 49 })];
    const z = tagesrundenZusammenfassen([...seite1, ...seite2]);
    expect(z).toHaveLength(1);
    expect(z[0]).toMatchObject({ art: 'tagesrunde', richtung: 'neutral', hoehe: 50 });
  });
});
