// Vorfall 21.10.2026: die Gesichtsaufnahme ging ohne Bildserie an den
// Coordinator (Video aus einem noch leeren React-State gelesen), jeder
// Versuch endete mit liveness_failed und kostete einen Platz der Tagesgrenze.
import * as fs from 'fs';
import * as path from 'path';
import { bildserieFuerUpload } from '../biometricIdentity';

describe('bildserieFuerUpload', () => {
  it('nimmt das Video, wenn es da ist', () => {
    expect(bildserieFuerUpload('file:///v.mp4', [])).toEqual({ faceBurstUris: [], faceBurstVideoUri: 'file:///v.mp4' });
  });
  it('faellt auf Einzelbilder zurueck', () => {
    expect(bildserieFuerUpload(null, ['a', 'b'])).toEqual({ faceBurstUris: ['a', 'b'] });
  });
  it('ohne Video und ohne Bilder: nichts hochladen', () => {
    expect(bildserieFuerUpload(null, [])).toBeNull();
    expect(bildserieFuerUpload(undefined, [])).toBeNull();
    expect(bildserieFuerUpload('', [])).toBeNull();
  });
});

describe('Aufnahme-Bildschirm', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'biometric-capture.tsx'), 'utf8');
  it('reicht das Video ausdruecklich an submit weiter (nicht ueber den State)', () => {
    expect(src).toMatch(/await submit\(snapshotFaceUri, frames, imu, videoUri\)/);
  });
  it('liest die Bildserie nirgends mehr direkt aus burstVideoUri', () => {
    expect(src).not.toMatch(/faceBurstVideoUri:\s*burstVideoUri/);
    // Je Ablauf einmal: Registrierung, Zwillings-Registrierung, Nachziehen,
    // Zweitpruefung, Lebensnachweis.
    expect(src.match(/\.\.\.serie,/g)?.length).toBe(5);
  });
});
