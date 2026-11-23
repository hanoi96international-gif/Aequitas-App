// Hülle der Nachrichten über den Briefkasten (lib/quantenSHuelle.ts):
// unterschreiben, dann verschlüsseln; öffnen prüft alles; Zusammensetzer
// begrenzt und gegen Wiederholung.
import { ethers } from 'ethers';
import { INHALT_MAX } from '../briefkasten';
import { adresseVon, eciesVerschluesseln, pubVon, unterschreiben } from '../quantenS';
import {
  ALTER_MAX,
  GESEHEN_MAX,
  OFFEN_BYTES_MAX,
  OFFEN_MAX,
  TEILE_MAX,
  TEIL_NUTZLAST,
  Zusammensetzer,
  einpacken,
  huelleNachricht,
  oeffnen,
  type Teil,
} from '../quantenSHuelle';

const A = '71'.repeat(32); // Absenderin
const B = '72'.repeat(32); // Empfängerin
const C = '73'.repeat(32); // Dritte
const an = (k: string) => ({ adresse: adresseVon(k), pub: pubVon(k) });
const JETZT = 1_795_400_000;

/** Fester Zufall für Tests (nie im Betrieb). */
function festerZufall(saat: string) {
  let n = 0;
  return (len: number) => {
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i += 32) {
      const h = ethers.getBytes(ethers.sha256(ethers.toUtf8Bytes(`${saat}|${n++}`)));
      out.set(h.slice(0, Math.min(32, len - i)), i);
    }
    return out;
  };
}

function nutzlast(n: number, saat = 'n'): Uint8Array {
  return festerZufall(saat)(n);
}

const sha = (b: Uint8Array) => ethers.sha256(b).slice(2);

/** Eine Hülle von Hand bauen (für Fälschungen): Felder überschreibbar, Unterschrift von schl. */
function handHuelle(schl: string, empfPub: string, x: Record<string, unknown> = {}, ohneSig = false) {
  const stueck = nutzlast(100);
  const h: Record<string, unknown> = {
    v: 1, art: 'antwort', von: adresseVon(A), an: adresseVon(B), id: 'ab'.repeat(16), zeit: JETZT,
    teil: 0, teile: 1, gesamt: sha(stueck), nutzlast: ethers.hexlify(stueck).slice(2), ...x,
  };
  if (!ohneSig) {
    h.sig = unterschreiben(schl, huelleNachricht(h.art as 'antwort', h.von as string, h.an as string, h.id as string, h.zeit as number,
      h.teil as number, h.teile as number, h.gesamt as string, sha(ethers.getBytes('0x' + h.nutzlast))));
  }
  return eciesVerschluesseln(empfPub, ethers.toUtf8Bytes(JSON.stringify(h)), festerZufall('hand'));
}

describe('einpacken und öffnen', () => {
  it('bringt eine kleine Nachricht in einem Brief an', () => {
    const n = nutzlast(500);
    const briefe = einpacken(A, an(B), 'antwort', n, JETZT, festerZufall('a'));
    expect(briefe).toHaveLength(1);
    const t = oeffnen(B, briefe[0], JETZT + 10);
    expect(t.von).toBe(adresseVon(A));
    const z = new Zusammensetzer();
    const m = z.hinzu(t, JETZT + 10);
    expect(m && ethers.hexlify(m.nutzlast)).toBe(ethers.hexlify(n));
    expect(m?.art).toBe('antwort');
  });

  it('zerlegt große Nachrichten und setzt sie in jeder Reihenfolge zusammen', () => {
    const n = nutzlast(2 * TEIL_NUTZLAST + 123);
    const briefe = einpacken(A, an(B), 'buendel', n, JETZT, festerZufall('b'));
    expect(briefe).toHaveLength(3);
    const z = new Zusammensetzer();
    expect(z.hinzu(oeffnen(B, briefe[2], JETZT), JETZT)).toBeNull();
    expect(z.hinzu(oeffnen(B, briefe[0], JETZT), JETZT)).toBeNull();
    const m = z.hinzu(oeffnen(B, briefe[1], JETZT), JETZT);
    expect(m && ethers.hexlify(m.nutzlast)).toBe(ethers.hexlify(n));
    expect(z.stand()).toEqual({ offen: 0, bytes: 0, gesehen: 1 });
  });

  it('ein voller Teil passt in einen Brief', () => {
    const briefe = einpacken(A, an(B), 'auftrag', nutzlast(TEIL_NUTZLAST), JETZT, festerZufall('c'));
    expect(briefe[0].length / 2).toBeLessThanOrEqual(INHALT_MAX);
  });

  it('packt nicht ein: leer, zu groß, unbekannte Art, falscher Schlüssel des Empfängers', () => {
    expect(() => einpacken(A, an(B), 'antwort', new Uint8Array(0), JETZT, festerZufall('d'))).toThrow('leer');
    expect(() => einpacken(A, an(B), 'antwort', new Uint8Array(TEILE_MAX * TEIL_NUTZLAST + 1), JETZT, festerZufall('d'))).toThrow('höchstens');
    expect(() => einpacken(A, an(B), 'x' as 'antwort', nutzlast(1), JETZT, festerZufall('d'))).toThrow('Art');
    expect(() => einpacken(A, { adresse: adresseVon(B), pub: pubVon(C) }, 'antwort', nutzlast(1), JETZT, festerZufall('d'))).toThrow('Adresse');
  });
});

describe('öffnen weist ab', () => {
  const zuB = pubVon(B);

  it('was an jemand anderen ging (nicht entschlüsselbar)', () => {
    const [brief] = einpacken(A, an(C), 'antwort', nutzlast(10), JETZT, festerZufall('e'));
    expect(() => oeffnen(B, brief, JETZT)).toThrow();
  });

  it('weitergereicht: C packt eine Hülle an C für B neu ein', () => {
    // Die Unterschrift von A nennt C als Empfänger; B erkennt das.
    expect(() => oeffnen(B, handHuelle(A, zuB, { an: adresseVon(C) }), JETZT)).toThrow('nicht an mich');
  });

  it.each([
    ['fremde Unterschrift (C gibt sich als A aus)', () => handHuelle(C, zuB), 'Unterschrift'],
    ['Nutzlast nach der Unterschrift verändert', () => handHuelleMitTausch(nutzlast(100, 'anders')), 'Unterschrift'],
    ['unbekannte Art', () => handHuelle(A, zuB, { art: 'geld' }), 'Art'],
    ['Version 2', () => handHuelle(A, zuB, { v: 2 }), 'Version'],
    ['fremdes Feld', () => handHuelle(A, zuB, { extra: 1 }), 'Felder'],
    ['Zeit zu alt', () => handHuelle(A, zuB, { zeit: JETZT - ALTER_MAX - 1 }), 'Zeit'],
    ['Zeit in der Zukunft', () => handHuelle(A, zuB, { zeit: JETZT + 301 }), 'Zeit'],
    ['Teil hinter der Teilezahl', () => handHuelle(A, zuB, { teil: 1, teile: 1 }), 'Teil'],
    ['zu viele Teile (voller Teil, sonst alles gültig)', () => handHuelle(A, zuB, { teile: TEILE_MAX + 1, nutzlast: 'ab'.repeat(TEIL_NUTZLAST) }), 'Teil'],
    ['genau TEILE_MAX Teile gehen bis zur Unterschrift', () => handHuelle(C, zuB, { teile: TEILE_MAX, nutzlast: 'ab'.repeat(TEIL_NUTZLAST) }), 'Unterschrift'],
    ['kurzer Teil vor dem letzten', () => handHuelle(A, zuB, { teil: 0, teile: 2 }), 'Teilgröße'],
    ['Nutzlast groß geschrieben', () => handHuelle(A, zuB, { nutzlast: 'AB' }), 'Nutzlast'],
    ['id zu kurz', () => handHuelle(A, zuB, { id: 'ab' }), 'id'],
    ['ohne Unterschrift', () => handHuelle(A, zuB, {}, true), 'Felder'],
  ])('%s', (_n, bau, grund) => {
    expect(() => oeffnen(B, bau(), JETZT)).toThrow(grund);
  });

  it('kein Hex oder zu groß', () => {
    expect(() => oeffnen(B, 'zz', JETZT)).toThrow('Form');
    expect(() => oeffnen(B, 'ab'.repeat(INHALT_MAX + 1), JETZT)).toThrow('Form');
  });
});

/** Unterschrift über die alte Nutzlast, danach die Nutzlast getauscht. */
function handHuelleMitTausch(neu: Uint8Array) {
  const alt = nutzlast(100);
  const h = {
    v: 1, art: 'antwort', von: adresseVon(A), an: adresseVon(B), id: 'cd'.repeat(16), zeit: JETZT, teil: 0, teile: 1,
    gesamt: sha(alt), nutzlast: ethers.hexlify(neu).slice(2),
    sig: unterschreiben(A, huelleNachricht('antwort', adresseVon(A), adresseVon(B), 'cd'.repeat(16), JETZT, 0, 1, sha(alt), sha(alt))),
  };
  return eciesVerschluesseln(pubVon(B), ethers.toUtf8Bytes(JSON.stringify(h)), festerZufall('tausch'));
}

describe('Zusammensetzer', () => {
  const teil = (x: Partial<Teil> = {}): Teil => {
    const stueck = x.stueck ?? new Uint8Array([1, 2, 3]);
    return { art: 'antwort', von: adresseVon(A), id: 'ef'.repeat(16), zeit: JETZT, teil: 0, teile: 1, gesamt: sha(stueck), stueck, ...x };
  };

  it('weist eine Wiederholung ab, auch nach einem Neustart', () => {
    const z = new Zusammensetzer();
    expect(z.hinzu(teil(), JETZT)).not.toBeNull();
    expect(() => z.hinzu(teil(), JETZT)).toThrow('schon erhalten');
    const neu = new Zusammensetzer(z.gesehenListe());
    expect(() => neu.hinzu(teil(), JETZT)).toThrow('schon erhalten');
  });

  it('vergisst erst nach ALTER_MAX (dann weist oeffnen ab)', () => {
    const z = new Zusammensetzer();
    z.hinzu(teil(), JETZT);
    z.aufraeumen(JETZT + ALTER_MAX);
    expect(z.stand().gesehen).toBe(1);
    z.aufraeumen(JETZT + ALTER_MAX + 1);
    expect(z.stand().gesehen).toBe(0);
  });

  it('dieselbe Kennung eines anderen Absenders ist eine andere Nachricht', () => {
    const z = new Zusammensetzer();
    z.hinzu(teil(), JETZT);
    expect(z.hinzu(teil({ von: adresseVon(C) }), JETZT)).not.toBeNull();
  });

  it('weist doppelte und widersprüchliche Teile ab', () => {
    const z = new Zusammensetzer();
    const g = '11'.repeat(32);
    expect(z.hinzu(teil({ teile: 2, gesamt: g }), JETZT)).toBeNull();
    expect(() => z.hinzu(teil({ teile: 2, gesamt: g }), JETZT)).toThrow('doppelt');
    expect(() => z.hinzu(teil({ teil: 1, teile: 3, gesamt: g }), JETZT)).toThrow('passt nicht');
    expect(() => z.hinzu(teil({ teil: 1, teile: 2, gesamt: '22'.repeat(32) }), JETZT)).toThrow('passt nicht');
    expect(() => z.hinzu(teil({ teil: 1, teile: 2, gesamt: g, art: 'auftrag' }), JETZT)).toThrow('passt nicht');
  });

  it('prüft am Ende den Gesamt-Hash', () => {
    const z = new Zusammensetzer();
    expect(() => z.hinzu(teil({ gesamt: '33'.repeat(32) }), JETZT)).toThrow('Gesamt-Hash');
    expect(z.stand().offen).toBe(0);
  });

  it('begrenzt unfertige Nachrichten', () => {
    const z = new Zusammensetzer();
    for (let i = 0; i < OFFEN_MAX; i++) z.hinzu(teil({ id: i.toString(16).padStart(32, '0'), teile: 2 }), JETZT);
    expect(() => z.hinzu(teil({ id: 'ff'.repeat(16), teile: 2 }), JETZT)).toThrow('unfertige');
  });

  it('begrenzt die Byte in unfertigen Nachrichten', () => {
    const z = new Zusammensetzer();
    const gross = new Uint8Array(TEIL_NUTZLAST);
    let i = 0;
    expect(() => {
      // je Kennung nur TEILE_MAX - 1 Teile: keine Nachricht wird fertig.
      for (; i < OFFEN_BYTES_MAX / TEIL_NUTZLAST + 1; i++) {
        z.hinzu(teil({ teil: i % (TEILE_MAX - 1), teile: TEILE_MAX, stueck: gross, id: Math.floor(i / (TEILE_MAX - 1)).toString(16).padStart(32, '0'), gesamt: '44'.repeat(32) }), JETZT);
      }
    }).toThrow('Byte');
    expect(z.stand().bytes).toBeLessThanOrEqual(OFFEN_BYTES_MAX);
  });

  it('weist ab, wenn die Liste der erledigten Kennungen voll ist (nie vergessen)', () => {
    const voll: [string, number][] = Array.from({ length: GESEHEN_MAX }, (_, i) => [`${adresseVon(C)}|${i.toString(16).padStart(32, '0')}`, JETZT]);
    const z = new Zusammensetzer(voll);
    expect(() => z.hinzu(teil(), JETZT)).toThrow('erledigte');
    expect(z.stand().gesehen).toBe(GESEHEN_MAX);
  });

  it('liest keine kaputte gespeicherte Liste', () => {
    expect(() => new Zusammensetzer([['x', 1]])).toThrow('Form');
    expect(() => new Zusammensetzer(Array.from({ length: GESEHEN_MAX + 1 }, () => [`${adresseVon(C)}|${'00'.repeat(16)}`, 1] as [string, number]))).toThrow('zu lang');
  });
});
