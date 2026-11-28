// Fairer Anteil und Netto im Monat (lib/fairerAnteil.ts): nur Anzeige, streng
// gelesen -- eine kaputte oder fremde Antwort zeigt nichts statt Falschem.
import { anteilProzent, leseRegeln, nettoMonat, zweiStellen } from '../fairerAnteil';
import type { WirtschaftKonto } from '../ueberweisung';

const REGELN = { fairer_anteil: 1000, grundeinkommen_30_tage: { je_mensch: 5, in_fairen_anteilen: 0.005 } };
const MENSCH: WirtschaftKonto = { art: 'mensch', guthaben: 920, aktiv: true, gleichgewicht: true, abgabe_pro_monat_bei_diesem_stand: 4.6 };

describe('fairer Anteil', () => {
  test('liest die Regeln der Kette', () => {
    expect(leseRegeln(REGELN)).toEqual({ fairerAnteil: 1000, grundeinkommen30: 5 });
    expect(leseRegeln({ fairer_anteil: 1000, grundeinkommen_30_tage: { je_mensch: null } })).toEqual({ fairerAnteil: 1000, grundeinkommen30: null });
    expect(leseRegeln({ fairer_anteil: 1000 })).toEqual({ fairerAnteil: 1000, grundeinkommen30: null });
  });

  test.each([
    ['kein Objekt', null],
    ['Liste', [1000]],
    ['fairer Anteil fehlt', {}],
    ['fairer Anteil 0 (Teilen durch 0)', { fairer_anteil: 0 }],
    ['fairer Anteil negativ', { fairer_anteil: -1000 }],
    ['fairer Anteil als Text', { fairer_anteil: '1000' }],
    ['fairer Anteil unendlich', { fairer_anteil: Infinity }],
    ['fairer Anteil riesig', { fairer_anteil: 1e13 }],
  ])('weist ab: %s', (_n, d) => {
    expect(leseRegeln(d)).toBeNull();
  });

  test('ein unlesbares Grundeinkommen zaehlt als unbekannt, nicht als 0', () => {
    for (const je of [-5, '5', NaN, 1e13]) {
      expect(leseRegeln({ fairer_anteil: 1000, grundeinkommen_30_tage: { je_mensch: je } })!.grundeinkommen30).toBeNull();
    }
  });

  test('Anteil in ganzen Prozent', () => {
    const r = leseRegeln(REGELN);
    expect(anteilProzent(920, r)).toBe(92);
    expect(anteilProzent(0, r)).toBe(0);
    expect(anteilProzent(25_000, r)).toBe(2500);
    expect(anteilProzent(1004.9, r)).toBe(100);
    expect(anteilProzent(920, null)).toBeNull();
    expect(anteilProzent(NaN, r)).toBeNull();
    expect(anteilProzent(-1, r)).toBeNull();
  });

  test('Netto: unter dem fairen Anteil kommt dazu, darüber geht ab', () => {
    const r = leseRegeln(REGELN);
    expect(nettoMonat(r, MENSCH)).toEqual({ grundeinkommen: 5, abgabe: 4.6, netto: 0.4 });
    expect(nettoMonat(r, { ...MENSCH, guthaben: 3000, abgabe_pro_monat_bei_diesem_stand: 15 })!.netto).toBe(-10);
    expect(nettoMonat(r, { ...MENSCH, abgabe_pro_monat_bei_diesem_stand: undefined })!.netto).toBe(5);
  });

  test.each([
    ['Unternehmen (bekommt kein Grundeinkommen)', { ...MENSCH, art: 'unternehmen' }],
    ['freie Adresse', { ...MENSCH, art: 'frei' }],
    ['nicht aktiv', { ...MENSCH, aktiv: false }],
    ['vor dem Gleichgewicht (andere Regeln)', { ...MENSCH, gleichgewicht: false }],
    ['Gleichgewicht unbekannt', { ...MENSCH, gleichgewicht: undefined }],
    ['Abgabe negativ', { ...MENSCH, abgabe_pro_monat_bei_diesem_stand: -3 }],
    ['Abgabe unendlich', { ...MENSCH, abgabe_pro_monat_bei_diesem_stand: Infinity }],
  ] as [string, WirtschaftKonto][])('kein Netto: %s', (_n, k) => {
    expect(nettoMonat(leseRegeln(REGELN), k)).toBeNull();
  });

  test('kein Netto ohne Konto, ohne Regeln oder ohne berechnetes Grundeinkommen', () => {
    expect(nettoMonat(leseRegeln(REGELN), null)).toBeNull();
    expect(nettoMonat(null, MENSCH)).toBeNull();
    expect(nettoMonat(leseRegeln({ fairer_anteil: 1000 }), MENSCH)).toBeNull();
  });

  test('zwei Stellen für die Anzeige', () => {
    expect(zweiStellen(4.833333)).toBe('4.83');
    expect(zweiStellen(5)).toBe('5');
    expect(zweiStellen(0.4)).toBe('0.4');
    expect(zweiStellen(NaN)).toBe('—');
  });
});
