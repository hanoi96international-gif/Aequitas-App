import { holeRunde, leseRunde } from '../wirtschaftRunde';

// Antwort, wie wirtschaft_runde.go (rundeAuswerten) sie liefert.
const gut = () => ({
  zeit: 1795377600,
  bloecke: { von: 7362, bis: 7362 },
  vollstaendig: true,
  abgaben: { konten: 3, summe: 0.168, summe_mikro: 168000 },
  grundeinkommen: { menschen: 1, summe: 0.166, summe_mikro: 166000, je_mensch_kleinster: 0.166, je_mensch_groesster: 0.166 },
  probe_menschen_mal_anteil: { menschen_mal_anteil_mikro: 166000, ausgezahlt_mikro: 166000, gleich: true },
  rest_nach: 0.002,
  topf_vor_auszahlung: 0.168,
  vorrunde: 1795291200,
  rest_vorrunde: 0.001,
  andere_zufluesse: -0.001,
  rechnung: '…',
  hinweis: '…',
});

describe('leseRunde', () => {
  it('liest eine vollstaendige Runde', () => {
    expect(leseRunde(gut())).toEqual({
      zeit: 1795377600, von: 7362, bis: 7362, vollstaendig: true,
      abgabenKonten: 3, abgabenSumme: 0.168, menschen: 1, grundeinkommenSumme: 0.166,
      jeMenschKleinster: 0.166, jeMenschGroesster: 0.166, probeGleich: true,
      restNach: 0.002, topfVorAuszahlung: 0.168, restVorrunde: 0.001, andereZufluesse: -0.001,
    });
  });

  it('laesst fehlende Teile der Rechnung leer (ohne Vorrunde, ohne Endstand)', () => {
    const d: any = gut();
    delete d.rest_vorrunde;
    delete d.andere_zufluesse;
    delete d.rest_nach;
    delete d.topf_vor_auszahlung;
    delete d.probe_menschen_mal_anteil;
    const r = leseRunde(d)!;
    expect(r.restVorrunde).toBeNull();
    expect(r.andereZufluesse).toBeNull();
    expect(r.restNach).toBeNull();
    expect(r.probeGleich).toBeNull();
  });

  it('weist unpassende Antworten ganz ab, statt halb anzuzeigen', () => {
    const kaputt: Array<(d: any) => void> = [
      (d) => { d.zeit = 0; },
      (d) => { d.zeit = 'x'; },
      (d) => { d.bloecke.bis = 1; }, // bis < von
      (d) => { d.abgaben.summe = -1; },
      (d) => { d.grundeinkommen.menschen = 1.5; },
      (d) => { d.grundeinkommen.summe = Number.NaN; },
      (d) => { d.grundeinkommen.je_mensch_groesster = 0.1; }, // < kleinster
      (d) => { d.vollstaendig = 'ja'; },
      (d) => { delete d.abgaben; },
    ];
    for (const f of kaputt) {
      const d = gut();
      f(d);
      expect(leseRunde(d)).toBeNull();
    }
    expect(leseRunde(null)).toBeNull();
    expect(leseRunde([])).toBeNull();
    // Ein unlesbares optionales Feld wird leer, nicht falsch.
    const d: any = gut();
    d.rest_vorrunde = 'viel';
    expect(leseRunde(d)!.restVorrunde).toBeNull();
  });
});

describe('holeRunde', () => {
  const antwort = (status: number, body: string) =>
    jest.fn(async () => ({ ok: status === 200, status, text: async () => body }) as unknown as Response);

  it('fragt mit der Blockhoehe und liest die Antwort', async () => {
    const f = antwort(200, JSON.stringify(gut()));
    const r = await holeRunde(7362, f as unknown as typeof fetch);
    expect(r?.menschen).toBe(1);
    expect((f.mock.calls[0] as unknown[])[0]).toMatch(/\/wirtschaft\/runde\?hoehe=7362$/);
  });

  it('gibt null bei 404, altem Knoten, Uebergroesse, kaputtem JSON oder falscher Hoehe', async () => {
    expect(await holeRunde(7362, antwort(404, '{}') as unknown as typeof fetch)).toBeNull();
    expect(await holeRunde(7362, antwort(200, 'x'.repeat(20000)) as unknown as typeof fetch)).toBeNull();
    expect(await holeRunde(7362, antwort(200, '{kaputt') as unknown as typeof fetch)).toBeNull();
    const nie = jest.fn();
    expect(await holeRunde(0, nie as unknown as typeof fetch)).toBeNull();
    expect(await holeRunde(1.5, nie as unknown as typeof fetch)).toBeNull();
    expect(nie).not.toHaveBeenCalled();
  });
});
