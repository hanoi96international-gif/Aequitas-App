import { leseZahlungsziel } from '../zahlungslink';

const A = '0x1111111111111111111111111111111111111111';

describe('QR-Inhalt lesen', () => {
  it('nimmt eine reine Adresse', () => {
    expect(leseZahlungsziel(A)).toEqual({ adresse: A });
  });
  it('liest EIP-681 mit Betrag in Wei', () => {
    expect(leseZahlungsziel(`ethereum:${A}@1926?value=2500000000000000000`)).toEqual({ adresse: A, betrag: '2.5' });
  });
  it('liest wissenschaftliche Schreibweise', () => {
    expect(leseZahlungsziel(`ethereum:${A}?value=1e18`)).toEqual({ adresse: A, betrag: '1' });
  });
  it('warnt bei fremder Chain', () => {
    expect(leseZahlungsziel(`ethereum:${A}@1`)?.fremdeKette).toBe(true);
  });
  it('lehnt Unsinn ab', () => {
    expect(leseZahlungsziel('hallo')).toBeNull();
    expect(leseZahlungsziel('0x123')).toBeNull();
  });
});
