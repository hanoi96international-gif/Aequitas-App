// Geraetebericht 15.11.2026: der Einwilligungsschritt der Registrierung war
// eine feste, mittig gesetzte View. Mit Lebensnachweis- und Alterstext ist er
// laenger als ein Handy-Bildschirm -- der Text lief oben unter die
// Statusleiste, "Weiter" unten aus dem Bild, niemand kam weiter.
import { readFileSync } from 'fs';
import { join } from 'path';

const quelle = readFileSync(join(__dirname, '..', '..', 'app', 'biometric-capture.tsx'), 'utf8');

describe('Einwilligung der Registrierung', () => {
  it('liegt in einer ScrollView, damit "Weiter" immer erreichbar ist', () => {
    const start = quelle.indexOf("{step === 'consent' && !zwUngueltig && (");
    expect(start).toBeGreaterThan(0);
    const ende = quelle.indexOf("biometricConsentConfirmBtn", start);
    expect(ende).toBeGreaterThan(start);
    const zweig = quelle.slice(start, ende);
    expect(zweig).toContain('<ScrollView');
    expect(zweig).not.toMatch(/^\s*<View style=\{S\.content\}>/m);
  });

  it('zeigt den Altershinweis nicht im Debug-Stil (gelb, 10 px, monospace)', () => {
    expect(quelle).toContain("<Text style={S.alterHinweis}>{t('identity.alterHinweis')}</Text>");
  });
});
