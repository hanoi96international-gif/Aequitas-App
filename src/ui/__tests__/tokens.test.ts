import { palettes } from '../tokens';

// WCAG 2.x relative Leuchtdichte und Kontrast.
function lum(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
function kontrast(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

describe.each(['light', 'dark'] as const)('Kontrast %s', (scheme) => {
  const p = palettes[scheme];
  const flaechen = { bg: p.bg, surface: p.surface, surfaceRaised: p.surfaceRaised };
  it.each(['text', 'textSecondary', 'textTertiary', 'accent', 'positive', 'negative', 'warning'] as const)(
    '%s ist auf allen Flaechen lesbar (AA 4,5:1)',
    (vorder) => {
      for (const [name, flaeche] of Object.entries(flaechen)) {
        const k = kontrast(p[vorder], flaeche);
        if (k < 4.5) throw new Error(`${vorder} auf ${name}: ${k.toFixed(2)}:1`);
      }
    },
  );
  it('Schrift auf dem Akzent (Hauptknopf) ist lesbar', () => {
    expect(kontrast(p.textOnAccent, p.accent)).toBeGreaterThanOrEqual(4.5);
  });
  it('Signaltexte auf ihren weichen Flaechen (Banner) sind lesbar', () => {
    expect(kontrast(p.positive, p.positiveSoft)).toBeGreaterThanOrEqual(4.5);
    expect(kontrast(p.negative, p.negativeSoft)).toBeGreaterThanOrEqual(4.5);
    expect(kontrast(p.warning, p.warningSoft)).toBeGreaterThanOrEqual(4.5);
    expect(kontrast(p.accent, p.infoSoft)).toBeGreaterThanOrEqual(4.5);
  });
});
