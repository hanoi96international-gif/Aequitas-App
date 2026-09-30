import { formatAmount, fromChain, fromWei, MAX_INPUT_MICRO, parseAmount, toPlainString, toWei } from '../amount';

describe('parseAmount', () => {
  it('liest Punkt und Komma exakt', () => {
    expect(parseAmount('1')).toBe(1_000_000n);
    expect(parseAmount('0.1')).toBe(100_000n);
    expect(parseAmount('0,000001')).toBe(1n);
    expect(parseAmount('12.5')).toBe(12_500_000n);
  });
  it('0.1 + 0.2 ist exakt 0.3 (kein float)', () => {
    expect(parseAmount('0.1')! + parseAmount('0.2')!).toBe(parseAmount('0.3'));
  });
  it('lehnt Unsinn, Vorzeichen, zu viele Stellen und Ueberlauf ab', () => {
    for (const bad of ['', 'abc', '-1', '1.0000001', '1e6', '1,000.00', ' . ', 'NaN', '99999999999999999']) {
      expect(parseAmount(bad)).toBeNull();
    }
    expect(parseAmount('1000000000000001')).toBeNull(); // > MAX_INPUT
    expect(parseAmount('1000000000000000')).toBe(MAX_INPUT_MICRO);
  });
});

describe('fromChain', () => {
  it('rundet wie NewDecimal auf das naechste Mikro', () => {
    expect(fromChain('1.0000005')).toBe(1_000_001n);
    expect(fromChain('1.0000004')).toBe(1_000_000n);
    expect(fromChain(0.3)).toBe(300_000n);
    expect(fromChain('-2.5')).toBe(-2_500_000n);
  });
  it('liefert null fuer ungueltige Werte', () => {
    expect(fromChain(null)).toBeNull();
    expect(fromChain(Number.NaN)).toBeNull();
    expect(fromChain('1,5')).toBeNull();
  });
});

describe('Wei', () => {
  it('rechnet verlustfrei hin und abgerundet zurueck', () => {
    expect(toWei(1n)).toBe(10n ** 12n);
    expect(fromWei(toWei(123_456_789n))).toBe(123_456_789n);
    expect(fromWei(10n ** 12n - 1n)).toBe(0n); // nie mehr anzeigen, als da ist
  });
});

describe('Anzeige', () => {
  it('formatiert je Sprache, exakt auch bei grossen Betraegen', () => {
    expect(formatAmount(1_234_567_890_000n, { locale: 'de-DE' })).toBe('1.234.567,89');
    expect(formatAmount(1_234_567_890_000n, { locale: 'en-US' })).toBe('1,234,567.89');
    expect(formatAmount(MAX_INPUT_MICRO, { locale: 'en-US' })).toBe('1,000,000,000,000,000.00');
    expect(formatAmount(1n, { locale: 'en-US' })).toBe('0.000001');
    expect(formatAmount(-500_000n, { locale: 'en-US', signed: true })).toBe('−0.50');
    expect(formatAmount(500_000n, { locale: 'en-US', signed: true })).toBe('+0.50');
  });
  it('toPlainString fuer Signaturtexte ohne Trenner', () => {
    expect(toPlainString(1_234_567_890_000n)).toBe('1234567.890000');
    expect(toPlainString(5n, 2)).toBe('0.00');
  });
});
