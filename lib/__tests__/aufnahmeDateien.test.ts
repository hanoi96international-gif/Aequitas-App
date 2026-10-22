/**
 * Pruefung 21.10.2026, MEDIUM-1: keine Aufnahmedatei bleibt auf einem
 * Fehlerweg im Cache liegen. Erst der Sammler (lib/aufnahmeDateien.ts), dann
 * dass der Aufnahme-Bildschirm JEDE Datei bei ihm meldet und auf jedem
 * Ausgang loescht.
 */
import * as fs from 'fs';
import * as path from 'path';
import { AufnahmeDateien, AUFNAHME_DATEIEN_MAX } from '../aufnahmeDateien';

describe('AufnahmeDateien', () => {
  it('loescht alles Gemerkte genau einmal, auch wenn es mehrfach gemeldet wurde', async () => {
    const geloescht: string[] = [];
    const d = new AufnahmeDateien(async (u) => { geloescht.push(u); });
    expect(d.merke('file:///a.jpg')).toBe('file:///a.jpg');
    d.merke('file:///a.jpg');
    d.merke('file:///b.mp4');
    d.merke(null);
    d.merke(undefined);
    d.merke('');
    expect(d.anzahl()).toBe(2);
    await d.alleVerwerfen();
    expect(geloescht).toEqual(['file:///a.jpg', 'file:///b.mp4']);
    await d.alleVerwerfen(); // idempotent
    expect(geloescht).toHaveLength(2);
    expect(d.anzahl()).toBe(0);
  });

  it('sofort: loescht nur diese und vergisst sie', async () => {
    const geloescht: string[] = [];
    const d = new AufnahmeDateien(async (u) => { geloescht.push(u); });
    d.merke('file:///snap.jpg');
    d.merke('file:///solo.mp4');
    await d.sofort('file:///snap.jpg', null);
    expect(geloescht).toEqual(['file:///snap.jpg']);
    await d.alleVerwerfen();
    expect(geloescht).toEqual(['file:///snap.jpg', 'file:///solo.mp4']);
  });

  it('ein Fehler beim Loeschen haelt die anderen nicht auf und wirft nicht', async () => {
    const geloescht: string[] = [];
    const d = new AufnahmeDateien(async (u) => {
      if (u.endsWith('a.jpg')) throw new Error('weg');
      geloescht.push(u);
    });
    d.merke('file:///a.jpg');
    d.merke('file:///b.jpg');
    await expect(d.alleVerwerfen()).resolves.toBeUndefined();
    expect(geloescht).toEqual(['file:///b.jpg']);
  });

  it('begrenzt: ueber der Grenze wird die aelteste sofort geloescht', async () => {
    const geloescht: string[] = [];
    const d = new AufnahmeDateien(async (u) => { geloescht.push(u); });
    for (let i = 0; i <= AUFNAHME_DATEIEN_MAX; i++) d.merke(`file:///${i}.jpg`);
    await Promise.resolve();
    expect(d.anzahl()).toBe(AUFNAHME_DATEIEN_MAX);
    expect(geloescht).toEqual(['file:///0.jpg']);
  });
});

describe('Aufnahme-Bildschirm: jede Datei gemeldet, jeder Ausgang loescht', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'biometric-capture.tsx'), 'utf8');

  it('jede gespeicherte Momentaufnahme und jedes Video geht durch den Sammler', () => {
    const gespeichert = src.match(/saveToTemporaryFileAsync\(/g) ?? [];
    const gemeldet = src.match(/dateien\.current\.merke\('file:\/\/' \+ \(await snapshot\.saveToTemporaryFileAsync\(/g) ?? [];
    expect(gespeichert.length).toBeGreaterThan(0);
    expect(gemeldet.length).toBe(gespeichert.length);
    const videos = src.match(/'file:\/\/' \+ videoPath/g) ?? [];
    const videosGemeldet = src.match(/dateien\.current\.merke\('file:\/\/' \+ videoPath\)/g) ?? [];
    expect(videos.length).toBe(2); // eigene und gemeinsame Aufnahme
    expect(videosGemeldet.length).toBe(videos.length);
  });

  it('beim Ergebnis (jeder Fehlerweg endet dort) und beim Schliessen wird alles geloescht', () => {
    expect(src).toMatch(/if \(step === 'result'\) \{\s*zwSoloRef\.current = null;\s*dateien\.current\.alleVerwerfen\(\)/);
    expect(src).toMatch(/useEffect\(\(\) => \(\) => \{\s*dateien\.current\.alleVerwerfen\(\)/);
  });

  it('Momentaufnahmen der Positionspruefung werden sofort geloescht', () => {
    const check = src.slice(src.indexOf('async function checkFacePosition'), src.indexOf('async function checkFacePosition') + 1600);
    expect(check).toMatch(/dateien\.current\.sofort\(snapUri\)/);
    const zw = src.slice(src.indexOf('async function checkZwilling'), src.indexOf('async function startZwillingCapture'));
    expect(zw).toMatch(/dateien\.current\.sofort\(p\.uri\)/);
  });

  it('ein verworfenes Standbild der gemeinsamen Aufnahme wird geloescht', () => {
    const start = src.slice(src.indexOf('async function startZwillingCapture'), src.indexOf('async function submit('));
    expect(start).toMatch(/if \(p\.status !== 'ok' \|\| !p\.uri\) \{\s*await dateien\.current\.sofort\(p\.uri\);/);
  });

  it('submit: kein stilles Return mehr -- jeder fruehe Ausgang fuehrt zum Ergebnis', () => {
    const submit = src.slice(src.indexOf('async function submit('));
    expect(submit).not.toMatch(/if \(!finalFaceUri \|\| !consent \|\| !address \|\| !signer\) return;/);
    expect(submit).toMatch(/if \(!finalFaceUri \|\| !consent \|\| !address \|\| !signer\) \{[^}]*setStep\('result'\);/);
    expect(submit).toMatch(/if \(!serie\) \{[\s\S]*?setStep\('result'\);/);
    // Der catch (z. B. registrierungsVorpruefung wirft) endet im Ergebnis.
    expect(submit).toMatch(/\} catch \(e: any\) \{[\s\S]*?setStep\('result'\);/);
  });
});
