/**
 * vendor/decode-uri-component: Ersatz fuer 0.2.2 (GHSA-vcc3-ghjq-m6fr,
 * GHSA-qr28-fpjm-wq7f). Gleiche Ergebnisse wie 0.2.2 bei gueltiger und den
 * ueblichen kaputten Eingaben, und lineare Laufzeit bei boesartigen.
 */
const decode = require('../../vendor/decode-uri-component');

describe('decode-uri-component (Ersatz)', () => {
  it.each([
    ['abc', 'abc'],
    ['a+b', 'a b'],
    ['%20', ' '],
    ['%C3%A4%C3%B6%C3%BC', 'äöü'],
    ['%F0%9F%98%80', '😀'],
    ['0x%E2%82%AC', '0x€'],
    ['%', '%'],
    ['%%', '%%'],
    ['%E0%A4%A', '%E0%A4%A'],
    ['test%C2%A0%C2', 'test %C2'],
    ['%ab%C2%A0', '%ab '],
    ['%E2%82%AC%E2%82', '€%E2%82'],
    ['/umzug?wallet=0x%41%42', '/umzug?wallet=0xAB'],
  ])('%s -> %s', (roh, soll) => {
    expect(decode(roh)).toBe(soll);
  });

  it('kein String: TypeError wie 0.2.2', () => {
    expect(() => decode(undefined as any)).toThrow(TypeError);
  });

  it('boesartige Eingaben in linearer Zeit', () => {
    for (const roh of ['%E0'.repeat(50000), '%C2%A0%E0'.repeat(20000), '%' + 'ab%'.repeat(40000), '%FF'.repeat(60000)]) {
      const t0 = Date.now();
      const aus = decode(roh);
      expect(typeof aus).toBe('string');
      expect(Date.now() - t0).toBeLessThan(1500);
    }
  });
});
