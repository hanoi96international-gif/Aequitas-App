import { aeqText, holeQuantenWStand, holeQuantenWUeberblick, kennungGueltig, leseQuantenWStand, leseQuantenWUeberblick } from '../quantenW';
import { API_BASE } from '../config';

const K = 'ab'.repeat(32);
const ADR = (c: string) => '0x' + c.repeat(40);

// Antworten wie der Knoten sie schreibt (quantenWNoteAnsicht /
// quantenWSTokenAnsichtLocked).
const noteW = () => ({
  k: K, n: 400, t: 3, validatoren: [ADR('1'), ADR('2'), ADR('3'), ADR('4')], tol: 4, k_note: 160,
  frei: 380, fehl: 1, gesperrt: false, zaehl: 2, wert_mikro: 10_000_000, aktiv: false,
  anfrage: { Von: ADR('5'), Index: 1, K: 160, Stellen: [1, 2], Basen: [0, 1], Pfand: 1, Zeit: 1, Gezogen: 2, Antwort: [0, 1], AntwortZeit: 3, EinloesenAn: ADR('6'), Offen: 64, Treffer: 30, Fehler: 0 },
});
const tokenS = () => ({
  k: K, art: 's', n: 64, t: 3, v: 4, tol: 4, inhaber: ADR('7'), stellen: [ADR('8'), ADR('9')], gebunden: true, gewaehlt: false,
  fehl: 0, wert_mikro: 5_000_000, aktiv: true, anmeldung: { b: 1, stelle: ADR('9'), probe: [3, 5, 9], offen: 0, zeit: 7 },
});

function antwort(status: number, body: unknown) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, text: async () => text } as unknown as Response;
}

describe('Kennung', () => {
  it('nur 64 Zeichen 0-9, a-f', () => {
    expect(kennungGueltig(K)).toBe(true);
    for (const falsch of ['', 'ab', K + 'a', K.slice(1) + 'g', K.toUpperCase(), ' ' + K.slice(1)]) {
      expect(kennungGueltig(falsch)).toBe(false);
    }
  });
});

describe('leseQuantenWStand', () => {
  it('Note W: alles Noetige, die Anfrage nur als Zusammenfassung', () => {
    const s = leseQuantenWStand(noteW(), K);
    expect(s).toEqual({
      art: 'w', k: K, aktiv: false, n: 400, t: 3, v: 4, tol: 4, kNote: 160, frei: 380, fehl: 1,
      gesperrt: false, wertMikro: 10_000_000, anfrage: { k: 160, offen: 64, einloesen: true },
    });
    const ohne = { ...noteW(), anfrage: null };
    expect(leseQuantenWStand(ohne, K)).toMatchObject({ art: 'w', anfrage: null });
    const pruefen = noteW();
    pruefen.anfrage.EinloesenAn = '';
    expect(leseQuantenWStand(pruefen, K)).toMatchObject({ anfrage: { einloesen: false } });
  });

  it('Token S und tote Note', () => {
    expect(leseQuantenWStand(tokenS(), K)).toEqual({
      art: 's', k: K, aktiv: true, n: 64, t: 3, v: 4, tol: 4, inhaber: ADR('7'), gebunden: true, gewaehlt: false,
      fehl: 0, wertMikro: 5_000_000, anmeldung: { probe: 3, offen: 0 }, stichprobeNachBindung: false,
    });
    // Stichprobe v2: der Knoten nennt probe_art 2 (sonst fehlt das Feld).
    expect(leseQuantenWStand({ ...tokenS(), probe_art: 2 }, K)).toMatchObject({ art: 's', stichprobeNachBindung: true });
    // Ein aelterer Knoten meldet v nicht: dann leer, nicht geraten.
    const alt: any = tokenS();
    delete alt.v;
    expect(leseQuantenWStand(alt, K)).toMatchObject({ art: 's', t: 3, v: null });
    // Ein einziger Validator (t = v = 1, wie beim ersten Token im Hauptnetz).
    expect(leseQuantenWStand({ ...tokenS(), t: 1, v: 1 }, K)).toMatchObject({ t: 1, v: 1 });
    expect(leseQuantenWStand({ k: K, tot: true, aktiv: true }, K)).toEqual({ art: 'tot', k: K, aktiv: true, urteil: null });
    // Urteil der Kette (R10): nur eingeloest/tot; alles andere nie als Erfolg.
    expect(leseQuantenWStand({ k: K, tot: true, aktiv: true, urteil: 'eingeloest' }, K)).toMatchObject({ urteil: 'eingeloest' });
    expect(leseQuantenWStand({ k: K, tot: true, aktiv: true, urteil: 'tot' }, K)).toMatchObject({ urteil: 'tot' });
    expect(leseQuantenWStand({ k: K, tot: true, aktiv: true, urteil: 'echt' }, K)).toMatchObject({ urteil: null });
    expect(leseQuantenWStand({ k: K, tot: true, aktiv: true, urteil: 1 }, K)).toMatchObject({ urteil: null });
  });

  // Missbrauch: ein Knoten (oder etwas dazwischen), das etwas anderes
  // liefert, bekommt keine halbe Anzeige.
  it.each([
    ['andere Kennung', (j: any) => { j.k = 'cd'.repeat(32); }],
    ['aktiv fehlt', (j: any) => { delete j.aktiv; }],
    ['n zu gross', (j: any) => { j.n = 16385; }],
    ['n negativ', (j: any) => { j.n = -1; }],
    ['t null', (j: any) => { j.t = 0; }],
    ['Bruchzahl', (j: any) => { j.frei = 1.5; }],
    ['frei groesser als n', (j: any) => { j.frei = 401; }],
    ['k_note groesser als n', (j: any) => { j.k_note = 401; }],
    ['Wert als Text', (j: any) => { j.wert_mikro = '10'; }],
    ['Wert negativ', (j: any) => { j.wert_mikro = -1; }],
    ['zu viele Fehlversuche', (j: any) => { j.fehl = 4; }],
    ['Validator keine Adresse', (j: any) => { j.validatoren[1] = 'niemand'; }],
    ['weniger Validatoren als t', (j: any) => { j.validatoren = [ADR('1'), ADR('2')]; }],
    ['zu viele Validatoren', (j: any) => { j.validatoren = Array(65).fill(ADR('1')); }],
    ['offen groesser als k', (j: any) => { j.anfrage.Offen = 161; }],
    ['Anfrage ohne Ziel-Feld', (j: any) => { delete j.anfrage.EinloesenAn; }],
    ['unbekannte Art', (j: any) => { j.art = 'x'; }],
  ])('Note W: %s', (_name, kaputt) => {
    const j = noteW();
    kaputt(j);
    expect(leseQuantenWStand(j, K)).toBeNull();
  });

  it.each([
    ['Inhaber keine Adresse', (j: any) => { j.inhaber = '0x12'; }],
    ['gebunden kein Wahrheitswert', (j: any) => { j.gebunden = 1; }],
    ['Stichprobe groesser als n', (j: any) => { j.anmeldung.probe = Array(65).fill(1); }],
    ['offen groesser als die Stichprobe', (j: any) => { j.anmeldung.offen = 4; }],
    ['weniger Validatoren als t', (j: any) => { j.v = 2; }],
    ['zu viele Validatoren', (j: any) => { j.v = 65; }],
    ['Validatoren als Text', (j: any) => { j.v = '4'; }],
    ['Validatoren leer', (j: any) => { j.v = null; }],
    // Nur probe_art 2 kennt die Kette; alles andere wird nicht als v2 gezeigt.
    ['probe_art 1', (j: any) => { j.probe_art = 1; }],
    ['probe_art 0 ausdruecklich', (j: any) => { j.probe_art = 0; }],
    ['probe_art als Text', (j: any) => { j.probe_art = '2'; }],
    ['probe_art wahr', (j: any) => { j.probe_art = true; }],
    ['probe_art leer', (j: any) => { j.probe_art = null; }],
  ])('Token S: %s', (_name, kaputt) => {
    const j = tokenS();
    kaputt(j);
    expect(leseQuantenWStand(j, K)).toBeNull();
  });

  it('kein Objekt', () => {
    for (const x of [null, undefined, 1, 'x', []]) expect(leseQuantenWStand(x, K)).toBeNull();
  });
});

describe('holeQuantenWStand', () => {
  it('fragt nur mit gueltiger Kennung, klein geschrieben', async () => {
    const f = jest.fn(async () => antwort(200, noteW()));
    expect(await holeQuantenWStand('xyz', f as any)).toEqual({ ok: false, grund: 'eingabe' });
    expect(f).not.toHaveBeenCalled();
    const r = await holeQuantenWStand('  ' + K.toUpperCase() + ' ', f as any);
    expect(r.ok).toBe(true);
    expect(f).toHaveBeenCalledWith(`${API_BASE}/quanten-w/note?k=${K}`, expect.anything());
  });

  it('unbekannt, Netzfehler, kaputte und zu grosse Antwort', async () => {
    expect(await holeQuantenWStand(K, (async () => antwort(404, { error: 'unknown note' })) as any)).toEqual({ ok: false, grund: 'unbekannt' });
    expect(await holeQuantenWStand(K, (async () => antwort(500, 'x')) as any)).toEqual({ ok: false, grund: 'netz' });
    expect(await holeQuantenWStand(K, (async () => { throw new Error('offline'); }) as any)).toEqual({ ok: false, grund: 'netz' });
    expect(await holeQuantenWStand(K, (async () => antwort(200, '{kaputt')) as any)).toEqual({ ok: false, grund: 'netz' });
    expect(await holeQuantenWStand(K, (async () => antwort(200, { ...noteW(), n: 0 })) as any)).toEqual({ ok: false, grund: 'netz' });
    const gross = JSON.stringify({ ...noteW(), fuell: 'x'.repeat(300 * 1024) });
    expect(await holeQuantenWStand(K, (async () => antwort(200, gross)) as any)).toEqual({ ok: false, grund: 'netz' });
  });
});

describe('aeqText', () => {
  it('vier Nachkommastellen', () => {
    expect(aeqText(10_000_000)).toBe('10.0000 AEQ');
    expect(aeqText(1)).toBe('0.0000 AEQ');
  });
});

describe('leseQuantenWUeberblick', () => {
  const gut = () => ({
    aktiv: true, noten_w: 0, token_s: 1, beendet: 2, eingeloest: 1, tot: 1, urteil_offen: 0, topf_mikro: 1_000_000, stand: 1795370000,
    zuletzt: [{ k: K, urteil: 'eingeloest', ende: 1795369000 }, { k: 'cd'.repeat(32), urteil: 'tot', ende: 1795368000 }],
  });
  test('Gutfall', () => {
    expect(leseQuantenWUeberblick(gut())).toEqual({
      aktiv: true, notenW: 0, tokenS: 1, beendet: 2, eingeloest: 1, tot: 1, urteilOffen: 0, topfMikro: 1_000_000, stand: 1795370000,
      zuletzt: [{ k: K, urteil: 'eingeloest', ende: 1795369000 }, { k: 'cd'.repeat(32), urteil: 'tot', ende: 1795368000 }],
    });
  });
  test.each([
    ['fremdes Urteil in der Liste', (j: any) => { j.zuletzt[0].urteil = 'echt'; }],
    ['K nicht in Form', (j: any) => { j.zuletzt[0].k = 'xyz'; }],
    ['zu lange Liste', (j: any) => { j.zuletzt = Array(6).fill(j.zuletzt[0]); }],
    ['Summe passt nicht (mehr Erfolge behauptet)', (j: any) => { j.eingeloest = 5; }],
    ['negative Zahl', (j: any) => { j.token_s = -1; }],
    ['Bruchzahl', (j: any) => { j.tot = 0.5; j.eingeloest = 1.5; }],
    ['aktiv fehlt', (j: any) => { delete j.aktiv; }],
    ['kein Objekt', () => 'x'],
    ['Liste kein Array', (j: any) => { j.zuletzt = {}; }],
  ])('%s: nichts anzeigen', (_name, aendern) => {
    const j: any = gut();
    const ersatz = (aendern as (j: any) => unknown)(j);
    expect(leseQuantenWUeberblick(ersatz === undefined ? j : ersatz)).toBeNull();
  });
  test('holen: 404 (aelterer Knoten), zu gross, Netzfehler -> null', async () => {
    const antwort = (status: number, text: string) => (async () => ({ ok: status === 200, status, text: async () => text })) as unknown as typeof fetch;
    expect(await holeQuantenWUeberblick(antwort(404, ''))).toBeNull();
    expect(await holeQuantenWUeberblick(antwort(200, 'x'.repeat(20000)))).toBeNull();
    expect(await holeQuantenWUeberblick((async () => { throw new Error('netz'); }) as unknown as typeof fetch)).toBeNull();
    expect(await holeQuantenWUeberblick(antwort(200, JSON.stringify(gut())))).toMatchObject({ eingeloest: 1 });
  });
});
