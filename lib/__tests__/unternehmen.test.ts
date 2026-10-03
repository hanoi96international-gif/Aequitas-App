import { ethers } from 'ethers';
import { leseZahlungsziel } from '../zahlungslink';
import {
  austretenNachricht,
  buergschaftNachricht,
  csv,
  eroeffnenNachricht,
  KATEGORIEN,
  neuerSchluessel,
  ausPhrase,
  normName,
  normText,
  normWebseite,
  suchen,
  tagesliste,
  verzeichnisLesen,
  verzeichnisNachricht,
  wellKnownPasst,
  wellKnownUrl,
  zahlungEingegangen,
  zahlungslink,
  type KassenEintrag,
} from '../unternehmen';

const U = '0xb200000000000000000000000000000000000001';
const M = '0xa100000000000000000000000000000000000001';

describe('Nachrichten wie die Kette (wirtschaft_api.go, unternehmen_verzeichnis.go)', () => {
  // Dieselben Zeichenketten pinnt TestUnternehmenNachrichtenFuerDieApp in der Kette.
  it('eroeffnen', () => {
    expect(eroeffnenNachricht(U, M, 'Bäckerei Sonne', 'lebensmittel', 1800000000)).toBe(
      'Aequitas: Unternehmenskonto eroeffnen\nUnternehmen: ' + U + '\nVerantwortlich: ' + M +
        '\nName: Bäckerei Sonne\nKategorie: lebensmittel\nZeit: 1800000000',
    );
  });
  it('verzeichnis, buergschaft, austreten', () => {
    expect(verzeichnisNachricht(U, M, 'Rosenheim', 'bis 20 %', 'https://laden.de', 1800000000)).toBe(
      'Aequitas: Verzeichniseintrag\nUnternehmen: ' + U + '\nVerantwortlich: ' + M +
        '\nOrt: Rosenheim\nAnnahme: bis 20 %\nWebseite: https://laden.de\nZeit: 1800000000',
    );
    expect(buergschaftNachricht(U, M, 1800000000)).toBe(
      'Aequitas: Buergschaft fuer ein Unternehmen\nUnternehmen: ' + U + '\nMensch: ' + M + '\nZeit: 1800000000',
    );
    expect(austretenNachricht(U, M, 1800000000)).toBe(
      'Aequitas: Als Verantwortliche austreten\nUnternehmen: ' + U + '\nVerantwortlich: ' + M + '\nZeit: 1800000000',
    );
  });
  it('Kategorien wie die Kette', () => {
    expect(KATEGORIEN).toHaveLength(12);
    expect(KATEGORIEN).toContain('lebensmittel');
  });
});

describe('Normalisieren wie die Kette', () => {
  it('Name', () => {
    expect(normName('  Café | Bar\n ')).toBe('Café   Bar');
    expect(normName('x'.repeat(70))).toHaveLength(60);
  });
  it('Text', () => {
    expect(normText(' Zeile\nZwei ', 60)).toBe('Zeile Zwei');
    expect(normText('a|b', 60)).toBe('a b');
  });
  it('Webseite nur https://host', () => {
    expect(normWebseite('HTTPS://Laden.DE/')).toBe('https://laden.de');
    expect(normWebseite('')).toBe('');
    for (const s of ['http://laden.de', 'https://laden.de/x', 'https://laden.de:443', 'https://a@laden.de', 'javascript:alert(1)']) {
      expect(normWebseite(s)).toBeNull();
    }
    expect(wellKnownUrl('https://laden.de')).toBe('https://laden.de/.well-known/aequitas.txt');
    expect(wellKnownUrl('http://laden.de')).toBeNull();
  });
  it('well-known: Adresse als eigenes Wort, nicht als Teil', () => {
    expect(wellKnownPasst('Unser Konto: ' + U.toUpperCase().replace('0X', '0x') + '\n', U)).toBe(true);
    expect(wellKnownPasst(U + 'ff', U)).toBe(false);
    expect(wellKnownPasst('nichts', U)).toBe(false);
  });
});

describe('Schluessel', () => {
  it('Phrase stellt dieselbe Adresse wieder her', () => {
    const k = neuerSchluessel();
    expect(k.phrase.split(' ')).toHaveLength(12);
    expect(ausPhrase('  ' + k.phrase.toUpperCase() + ' ').address.toLowerCase()).toBe(k.adresse);
    expect(() => ausPhrase('falsch falsch falsch')).toThrow();
  });
  it('Unterschrift des Unternehmens laesst sich pruefen wie auf der Kette', async () => {
    const k = neuerSchluessel();
    const msg = eroeffnenNachricht(k.adresse, M, 'Laden', 'handel', 1800000000);
    const sig = await k.wallet.signMessage(msg);
    expect(ethers.verifyMessage(msg, sig).toLowerCase()).toBe(k.adresse);
  });
});

describe('Kasse', () => {
  it('Zahlungslink liest die Kundenseite zurueck', () => {
    const link = zahlungslink(U, '12.5');
    const z = leseZahlungsziel(link)!;
    expect(z.adresse.toLowerCase()).toBe(U);
    expect(z.betrag).toBe('12.5');
    expect(z.fremdeKette).toBeUndefined();
    expect(() => zahlungslink(U, '0')).toThrow();
  });
  const e = (zeit: number, betrag: number, richtung: KassenEintrag['richtung'] = 'ein'): KassenEintrag => ({
    zeit, betrag, richtung, gegenkonto: M, tx: '0xabc',
  });
  it('erkennt den Eingang genau dieses Betrags nach dem Start', () => {
    const l = [e(100, 12.5), e(200, 12.4), e(300, 12.5, 'aus')];
    expect(zahlungEingegangen(l, 12.5, 150)).toBeNull();
    expect(zahlungEingegangen(l, 12.5, 50)?.zeit).toBe(100);
    expect(zahlungEingegangen(l, 12.4, 150)?.zeit).toBe(200);
  });
  it('Tagesliste und CSV', () => {
    const tag = Date.UTC(2026, 9, 2) / 1000;
    const l = [e(tag + 10, 5), e(tag + 20, 2, 'aus'), e(tag - 10, 9), e(tag + 30, 1, 'neutral')];
    expect(tagesliste(l, '2026-10-02')).toHaveLength(3);
    const c = csv(tagesliste(l, '2026-10-02'));
    expect(c.split('\n')[0]).toBe('datum;betrag_aeq;gegenkonto;transaktion');
    expect(c).toContain(';5.000000;');
    expect(c).toContain(';-2.000000;');
    expect(c.trim().split('\n')).toHaveLength(3); // neutral faellt heraus
    expect(csv([{ ...e(tag, 1), gegenkonto: 'a;b"c' }])).toContain('"a;b""c"');
  });
});

describe('Verzeichnis', () => {
  it('liest nur, was es lesen soll', () => {
    const l = verzeichnisLesen({
      unternehmen: [
        { adresse: U, name: 'B', kategorie: 'handel', kundschaft_90_tage: 3, buergen_anzahl: 2,
          verzeichnis: { ort: 'Rosenheim', annahme: 'bis 20 %', webseite: 'https://laden.de' },
          weitergabe: { weitergabe: 0.4, ausstieg: 0.1 } },
        { adresse: '0x' + 'c'.repeat(40), name: 'A', verzeichnis: { webseite: 'javascript:x' }, kundschaft_90_tage: 9 },
        { adresse: 'kaputt', name: 'X' },
      ],
    });
    expect(l).toHaveLength(2);
    expect(l[0].name).toBe('A'); // mehr Kundschaft zuerst
    expect(l[0].webseite).toBe('');
    expect(l[1]).toMatchObject({ ort: 'Rosenheim', annahme: 'bis 20 %', buergen: 2, weitergabe: 0.4, ausstieg: 0.1 });
    expect(verzeichnisLesen(null)).toEqual([]);
    expect(suchen(l, 'rosen')).toHaveLength(1);
  });
});

describe('Webseite pruefen: fremde Antworten bleiben klein', () => {
  const { begrenztLesen, webseiteBestaetigt } = jest.requireActual('../unternehmen');
  const ohneStream = (text: string, laenge?: string | null) =>
    ({ ok: true, body: undefined, headers: new Headers(laenge === null ? {} : { 'content-length': laenge ?? String(text.length) }), text: jest.fn(async () => text) }) as any;
  const mitStream = (stuecke: string[]) => {
    const enc = new TextEncoder();
    let i = 0;
    const cancel = jest.fn(async () => undefined);
    return {
      cancel,
      res: {
        ok: true,
        headers: new Headers(),
        body: { getReader: () => ({ read: async () => (i < stuecke.length ? { done: false, value: enc.encode(stuecke[i++]) } : { done: true }), cancel }) },
        text: jest.fn(),
      } as any,
    };
  };

  it('ohne Stream: nur mit Content-Length bis 4 KiB, sonst wird nichts gelesen', async () => {
    expect(await begrenztLesen(ohneStream(U), 4096)).toBe(U);
    const gross = ohneStream('x', '99999999');
    expect(await begrenztLesen(gross, 4096)).toBeNull();
    expect(gross.text).not.toHaveBeenCalled();
    const ohneLaenge = ohneStream(U, null);
    expect(await begrenztLesen(ohneLaenge, 4096)).toBeNull();
    expect(ohneLaenge.text).not.toHaveBeenCalled();
    expect(await begrenztLesen(ohneStream(U, 'abc'), 4096)).toBeNull();
  });

  it('ohne Stream: falsche Content-Length hilft nicht', async () => {
    expect(await begrenztLesen(ohneStream('y'.repeat(5000), '10'), 4096)).toBeNull();
  });

  it('mit Stream: bricht nach 4 KiB ab und gibt den Stream frei', async () => {
    const klein = mitStream(['aequitas: ', U]);
    expect(await begrenztLesen(klein.res, 4096)).toBe('aequitas: ' + U);
    const endlos = mitStream(Array(100).fill('z'.repeat(1000)));
    expect(await begrenztLesen(endlos.res, 4096)).toBeNull();
    expect(endlos.cancel).toHaveBeenCalled();
  });

  it('webseiteBestaetigt: riesige Antwort heisst nicht bestaetigt', async () => {
    const alt = global.fetch;
    global.fetch = jest.fn(async () => ohneStream(U + ' '.repeat(10), '99999999')) as any;
    try {
      expect(await webseiteBestaetigt('https://laden.example', U)).toBe(false);
      global.fetch = jest.fn(async () => ohneStream(U)) as any;
      expect(await webseiteBestaetigt('https://laden.example', U)).toBe(true);
    } finally {
      global.fetch = alt;
    }
  });
});
