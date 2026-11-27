/**
 * lib/quantenS3Beweis.ts: Mehrfach-Beweis gleich wie Knoten und Spezifikation
 * (s_kette.py --vektor-s3-beweis); jede Verfälschung abgewiesen.
 */
import { mehrfachPruefen } from '../quantenS3Beweis';

const vektor = require('./vektoren/quanten_s3_beweis_vektor.json');

describe('Mehrfach-Beweis', () => {
  it('jeder Fall der Spezifikation besteht', () => {
    expect(vektor.faelle.length).toBeGreaterThanOrEqual(8);
    for (const f of vektor.faelle) expect(mehrfachPruefen(f.wurzel, f.n, f.idx, f.blaetter, f.beweis)).toBe(true);
  });

  it('jede Verfälschung abgewiesen', () => {
    const f = vektor.faelle.find((x: { n: number }) => x.n === 1000);
    const { wurzel, n, idx, blaetter, beweis } = f;
    const kippen = (h: string) => (h[0] === '0' ? '1' : '0') + h.slice(1);
    expect(beweis.length).toBeGreaterThan(2);
    expect(mehrfachPruefen(wurzel, n, idx, blaetter, beweis.slice(0, -1))).toBe(false);
    expect(mehrfachPruefen(wurzel, n, idx, blaetter, [...beweis, beweis[0]])).toBe(false);
    expect(mehrfachPruefen(wurzel, n, idx, blaetter, [kippen(beweis[0]), ...beweis.slice(1)])).toBe(false);
    expect(mehrfachPruefen(wurzel, n, [idx[0] + (idx[1] - idx[0] > 1 ? 1 : 0) || 1, ...idx.slice(1)], blaetter, beweis)).toBe(false);
    expect(mehrfachPruefen(wurzel, n, [idx[1], idx[0], ...idx.slice(2)], [blaetter[1], blaetter[0], ...blaetter.slice(2)], beweis)).toBe(false);
    expect(mehrfachPruefen(wurzel, n + 1, idx, blaetter, beweis)).toBe(false);
    expect(mehrfachPruefen(wurzel, n, idx, [kippen(blaetter[0]), ...blaetter.slice(1)], beweis)).toBe(false);
    expect(mehrfachPruefen(kippen(wurzel), n, idx, blaetter, beweis)).toBe(false);
    expect(mehrfachPruefen(wurzel, n, [], [], beweis)).toBe(false);
    expect(mehrfachPruefen(wurzel, (1 << 26) + 1, idx, blaetter, beweis)).toBe(false);
    expect(mehrfachPruefen(wurzel, n, idx, blaetter.slice(1), beweis)).toBe(false);
    expect(mehrfachPruefen(wurzel, n, idx, blaetter, ['zz'.repeat(32), ...beweis.slice(1)])).toBe(false);
  });
});
