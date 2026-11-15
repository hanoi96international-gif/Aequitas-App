import {
  AUFTRAG_FORM,
  achtStellen,
  liquiditaetAbNachricht,
  liquiditaetNachricht,
  mindestAchtStellen,
  tauschNachricht,
} from '../auftrag';

// Dieselben Vektoren wie in aequitas-chain
// (x/humanity/keeper/auftrag_v2_vektor_test.go). Weicht ein Zeichen ab,
// scheitert jede Unterschrift am Knoten.
const W = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01';

describe('Nachrichtenform 2 (Tausch, Liquiditaet)', () => {
  it('Form ist 2', () => {
    expect(AUFTRAG_FORM).toBe(2);
  });

  it('Tausch wie der Knoten', () => {
    expect(tauschNachricht(W, 'aeq_to_tusd', 12.5, 12.37500001, 42, 1794748500)).toBe(
      'aequitas-tausch-v2|chain:1926|0xabcdef0123456789abcdef0123456789abcdef01|aeq_to_tusd|12.50000000|min:12.37500001|nonce:42|ts:1794748500',
    );
  });

  it('Betrag mit Gleichstand an der 9. Stelle wird vorher gerundet', () => {
    // 2^-9: roh ergaebe Go "%.8f" 0.00195312, toFixed(8) 0.00195313.
    const betrag = achtStellen(0.001953125);
    expect(betrag).toBe(0.00195313);
    expect(tauschNachricht(W, 'tusd_to_aeq', betrag, 0, 1, 1794748501)).toBe(
      'aequitas-tausch-v2|chain:1926|0xabcdef0123456789abcdef0123456789abcdef01|tusd_to_aeq|0.00195313|min:0.00000000|nonce:1|ts:1794748501',
    );
  });

  it('Liquiditaet einlegen und abziehen wie der Knoten', () => {
    expect(liquiditaetNachricht(W, 100, 99.8003, 3, 1794748500)).toBe(
      'aequitas-liquiditaet-v2|chain:1926|0xabcdef0123456789abcdef0123456789abcdef01|100.00000000|99.80030000|nonce:3|ts:1794748500',
    );
    expect(liquiditaetAbNachricht(W, 0.12345678, 4, 1794748500)).toBe(
      'aequitas-liquiditaet-ab-v2|chain:1926|0xabcdef0123456789abcdef0123456789abcdef01|0.12345678|nonce:4|ts:1794748500',
    );
  });

  it('Mindestbetrag wird abgerundet, nie ueber das Akzeptierte', () => {
    expect(mindestAchtStellen(9.999999999)).toBe(9.99999999);
    expect(mindestAchtStellen(1.000000009)).toBe(1);
    for (const x of [0.1 * 0.99, 123.456789123 * 0.99, 1e-9, 7]) {
      const m = mindestAchtStellen(x);
      expect(m).toBeLessThanOrEqual(x);
      expect(Number(m.toFixed(8))).toBe(m);
    }
  });

  it('Ungueltige Werte ergeben 0 (keine NaN/Infinity in der Unterschrift)', () => {
    for (const x of [NaN, Infinity, -Infinity, -1, 0]) {
      expect(achtStellen(x)).toBe(0);
      expect(mindestAchtStellen(x)).toBe(0);
    }
  });

  it('Andere Wallet, Kette oder Grenze ergibt eine andere Nachricht', () => {
    const a = tauschNachricht(W, 'aeq_to_tusd', 1, 0.99, 1, 1);
    expect(tauschNachricht('0x' + '1'.repeat(40), 'aeq_to_tusd', 1, 0.99, 1, 1)).not.toBe(a);
    expect(tauschNachricht(W, 'aeq_to_tusd', 1, 0, 1, 1)).not.toBe(a);
    expect(a).toContain('|chain:1926|');
  });
});
