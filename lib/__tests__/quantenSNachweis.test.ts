// Der Nachweis nach dem Ende (lib/quantenSNachweis.ts) gegen den Pruefvektor
// des Knotens: dieselbe Nachricht, dieselbe Unterschrift, derselbe Bericht wie
// quantenSNachweisePruefen -- und jede Faelschung faellt auf.
jest.mock('expo-secure-store', () => ({}));
jest.mock('expo-crypto', () => ({ getRandomBytes: () => new Uint8Array(0) }));
jest.mock('../config', () => ({ API_BASE: 'https://knoten.test/api' }));

import vektor from './vektoren/quanten_s_stelle_vektor.json';
import { unterschreiben } from '../quantenS';
import type { Umgebung } from '../quantenSInhaberin';
import { nachweisAbwarten, nachweisLesen, nachweisNachricht, nachweisePruefen, type Nachweis } from '../quantenSNachweis';

const V = vektor as any;
const VAL = [V.validator];
const WURZEL = V.stand.wurzel;
const PROBEN = V.stand.proben;
const kopie = (): Nachweis => JSON.parse(JSON.stringify(V.nachweis));
const VAL_SCHL = '61'.repeat(32); // nur Test (wie im Vektor)

describe('Nachweis nach dem Ende: wie der Knoten', () => {
  it('Unterschrift ueber dieselbe Nachricht, Bericht genau wie im Knoten', () => {
    const n = nachweisLesen(kopie());
    expect(unterschreiben(VAL_SCHL, nachweisNachricht(n))).toBe(V.nachweis.sig);
    expect(nachweisePruefen(V.k, VAL, [n], WURZEL, PROBEN)).toEqual(V.nachweis_bericht);
  });

  it('ohne Soll nur in sich geprueft und so gekennzeichnet', () => {
    expect(nachweisePruefen(V.k, VAL, [kopie()], null, null).wurzel_gegen).toBe('');
  });

  const neu = (n: Nachweis) => ({ ...n, sig: unterschreiben(VAL_SCHL, nachweisNachricht(n)) });
  const faelle: [string, (n: Nachweis) => Nachweis, string][] = [
    ['Wert veraendert', (n) => ({ ...n, werte: ['4', ...n.werte.slice(1)] }), 'nicht von Validator'],
    ['Wert veraendert, neu unterschrieben', (n) => neu({ ...n, werte: ['4', ...n.werte.slice(1)] }), 'nicht die Wurzel'],
    ['Salz veraendert, neu unterschrieben', (n) => neu({ ...n, salze: [n.salze[0], 'ab'.repeat(32)] }), 'Proben'],
    ['fremde Unterschrift', (n) => ({ ...n, sig: unterschreiben('62'.repeat(32), nachweisNachricht(n)) }), 'nicht von Validator'],
    ['x zu kurz, neu unterschrieben', (n) => neu({ ...n, x_inhaberin: n.x_inhaberin.slice(1) }), 'Laengen'],
    ['Bindung zu kurz, neu unterschrieben', (n) => neu({ ...n, d: n.d!.slice(1) }), 'Bindung oder Wahl'],
    ['anderes K', (n) => ({ ...n, k: 'ab'.repeat(32) }), 'passen nicht'],
  ];
  it.each(faelle)('%s: abgewiesen', (_w, machen, meldung) => {
    expect(() => nachweisePruefen(V.k, VAL, [machen(kopie())], WURZEL, PROBEN)).toThrow(meldung);
  });

  it('BEFUND: der Validator erfindet eine stimmige andere Praeparation', () => {
    // In sich stimmig (Wurzel und Proben passend neu), aber nicht die der Ausgabe.
    const n = kopie();
    const anders = { ...n, werte: n.werte.map((w, i) => (i === 0 ? (BigInt('0x' + w) ^ 2n).toString(16) : w)) };
    const ohne = (() => {
      try {
        nachweisePruefen(V.k, VAL, [neu(anders)], null, null);
        return '';
      } catch (e: any) {
        return e.message;
      }
    })();
    expect(ohne).toContain('nicht die Wurzel'); // selbst die eigene Wurzel passt nicht mehr
    expect(() => nachweisePruefen(V.k, VAL, [kopie()], '00'.repeat(32), PROBEN)).toThrow('BEFUND');
    expect(() => nachweisePruefen(V.k, VAL, [kopie()], WURZEL, [PROBEN[1], PROBEN[0]])).toThrow('BEFUND');
  });

  it('auch ohne Soll: Salze, die nicht die eigenen Proben ergeben, fallen auf', () => {
    const n = kopie();
    expect(() => nachweisePruefen(V.k, VAL, [neu({ ...n, salze: ['cd'.repeat(32), n.salze[1]] })], null, null)).toThrow('die der Validator nennt');
  });

  it('streng gelesen: unbekanntes Feld oder fehlende Pflicht', () => {
    expect(() => nachweisLesen({ ...kopie(), extra: 1 })).toThrow('Felder');
    const { sig: _s, ...ohneSig } = kopie();
    expect(() => nachweisLesen(ohneSig)).toThrow('Felder');
  });

  it('nachweisAbwarten: fragt nach, bis der Validator offenlegt, dann gegen die Kette', async () => {
    let anfragen = 0;
    let zeit = 0;
    const u: Umgebung = {
      fetchFn: (async () => {
        anfragen++;
        return anfragen < 3
          ? ({ status: 404, ok: false, text: async () => '{"error":"kein Nachweis"}' } as any)
          : ({ status: 200, ok: true, text: async () => JSON.stringify(V.nachweis) } as any);
      }) as any,
      speicher: { lesen: async () => null, schreiben: async () => {}, loeschen: async () => {} },
      zufall: () => new Uint8Array(0),
      apiBasis: 'https://knoten.test/api',
      warten: async (ms) => void (zeit += ms),
      jetzt: () => zeit,
    };
    const ber = await nachweisAbwarten(u, V.k, [{ adresse: V.validator, api: 'https://c1.test/api' }], WURZEL, PROBEN, 60_000);
    expect(ber.wurzel_gegen).toBe('kette');
    expect([ber.treffer_stelle, ber.fehler_stelle]).toEqual([V.treffer, V.fehler]);
    anfragen = -1e9; // nie offengelegt
    zeit = 0;
    await expect(nachweisAbwarten(u, V.k, [{ adresse: V.validator, api: 'https://c1.test/api' }], WURZEL, PROBEN, 30_000)).rejects.toThrow('legt (noch) nicht offen');
  });
});
