/**
 * lib/quantenSAutomatik.ts: Grenzen der Schleife, gesperrte Wallet, und dass
 * die Automatik des Ausgebers nie etwas tut, was Wert bindet.
 */
jest.mock('../quantenSAusgeberRunde', () => ({
  bestaetigungenAnfordern: jest.fn(async () => ({ gesendet: [1, 2] })),
  paketSenden: jest.fn(async () => ({ briefe: 3 })),
  ausgeben: jest.fn(async () => ({ stand: 'ausgegeben' })),
  auftraegeSenden: jest.fn(),
}));
jest.mock('../quantenSAusgeber', () => ({ zustandLesen: jest.fn(), losStand: jest.fn(), bestellen: jest.fn() }));
const mockRunde = jest.requireMock('../quantenSAusgeberRunde');
const mockAusgeber = jest.requireMock('../quantenSAusgeber');

import {
  AUTO_MAX_RUNDEN,
  ausgeberSchritt,
  automatikStarten,
  walletNurEntsperrt,
  WalletGesperrt,
} from '../quantenSAutomatik';

const sofort = async () => {};
const u = {} as any;

beforeEach(() => jest.clearAllMocks());

describe('Schleife', () => {
  it('höchstens AUTO_MAX_RUNDEN, auch wenn mehr verlangt sind', async () => {
    let n = 0;
    const a = automatikStarten({ schritt: async () => (n++, 'weiter'), maxRunden: 10_000, warten: sofort });
    expect(await a.fertig).toBe('grenze');
    expect(n).toBe(AUTO_MAX_RUNDEN);
  });

  it('nie zwei Schritte gleichzeitig', async () => {
    let laufend = 0;
    let max = 0;
    const a = automatikStarten({
      schritt: async () => {
        laufend++;
        max = Math.max(max, laufend);
        await new Promise((r) => setTimeout(r, 1));
        laufend--;
        return 'weiter';
      },
      maxRunden: 5,
      warten: sofort,
    });
    await a.fertig;
    expect(max).toBe(1);
  });

  it('Abstand nie unter 10 s (kein Hämmern)', async () => {
    const abstaende: number[] = [];
    const a = automatikStarten({ schritt: async () => 'weiter', abstandMs: 1, maxRunden: 3, warten: async (ms) => void abstaende.push(ms) });
    await a.fertig;
    expect(abstaende).toEqual([10_000, 10_000]);
  });

  it('nach drei Fehlern in Folge aus; ein Erfolg setzt zurück', async () => {
    const folge = ['f', 'f', 'ok', 'f', 'f', 'f', 'ok'];
    let i = 0;
    const meldungen: (string | undefined)[] = [];
    const a = automatikStarten({
      schritt: async () => {
        if (folge[i++] === 'f') throw new Error('Knoten weg');
        return 'weiter';
      },
      warten: sofort,
      meldung: (m) => meldungen.push(m.fehler),
    });
    expect(await a.fertig).toBe('fehler');
    expect(i).toBe(6);
    expect(meldungen[5]).toBe('Knoten weg');
  });

  it('gesperrte Wallet: sofort aus, ohne Wiederholung', async () => {
    let n = 0;
    const w = walletNurEntsperrt(() => null);
    const a = automatikStarten({
      schritt: async () => {
        n++;
        await w.entsperren();
        return 'weiter';
      },
      warten: sofort,
    });
    expect(await a.fertig).toBe('fehler');
    expect(n).toBe(1);
  });

  it('stop beendet beim Warten', async () => {
    let n = 0;
    const a = automatikStarten({ schritt: async () => (n++, 'weiter'), abstandMs: 60_000 });
    await new Promise((r) => setTimeout(r, 5));
    a.stop();
    expect(await a.fertig).toBe('gestoppt');
    expect(n).toBe(1);
  });

  it('endet mit dem Grund des Schritts', async () => {
    expect(await automatikStarten({ schritt: async () => 'bestaetigen', warten: sofort }).fertig).toBe('bestaetigen');
    expect(await automatikStarten({ schritt: async () => 'fertig', warten: sofort }).fertig).toBe('fertig');
  });
});

describe('walletNurEntsperrt', () => {
  it('fragt nie nach, liefert nur den entsperrten Schlüssel', async () => {
    await expect(walletNurEntsperrt(() => null).entsperren()).rejects.toBeInstanceOf(WalletGesperrt);
    await expect(walletNurEntsperrt(() => ({ privateKey: '0xab' })).entsperren()).resolves.toEqual({ privateKey: '0xab' });
  });
});

describe('Schritt des Ausgebers', () => {
  const wallet = walletNurEntsperrt(() => ({ privateKey: '0x' + '11'.repeat(32) }));
  const mitStand = (stand: string) => async () => ({ k: 'k1', stand }) as any;

  it('bestätigt: hält an, gibt NIE selbst aus', async () => {
    const briefkasten = jest.fn(async () => {});
    const s = ausgeberSchritt(u, wallet, briefkasten, mitStand('bestaetigt'));
    expect(await s()).toBe('bestaetigen');
    expect(await s()).toBe('bestaetigen');
    expect(mockRunde.ausgeben).not.toHaveBeenCalled();
    expect(mockAusgeber.bestellen).not.toHaveBeenCalled();
    expect(briefkasten).not.toHaveBeenCalled();
  });

  it('beauftragt: Briefkasten, weiter', async () => {
    const briefkasten = jest.fn(async () => {});
    const s = ausgeberSchritt(u, wallet, briefkasten, mitStand('beauftragt'));
    expect(await s()).toBe('weiter');
    expect(briefkasten).toHaveBeenCalledTimes(1);
  });

  it('beantwortet: Bestätigungen nur einmal anfordern, dann Briefkasten', async () => {
    const briefkasten = jest.fn(async () => {});
    const s = ausgeberSchritt(u, wallet, briefkasten, mitStand('beantwortet'));
    for (let i = 0; i < 4; i++) expect(await s()).toBe('weiter');
    expect(mockRunde.bestaetigungenAnfordern).toHaveBeenCalledTimes(1);
    expect(briefkasten).toHaveBeenCalledTimes(3);
  });

  it('ausgegeben: Paket genau einmal, dann fertig', async () => {
    const s = ausgeberSchritt(u, wallet, jest.fn(), mitStand('ausgegeben'));
    expect(await s()).toBe('fertig');
    expect(await s()).toBe('fertig');
    expect(mockRunde.paketSenden).toHaveBeenCalledTimes(1);
  });

  it('bestellt: Los abwarten bis gelost', async () => {
    mockAusgeber.losStand.mockResolvedValueOnce({ stand: 'warten' }).mockResolvedValueOnce({ stand: 'gelost' });
    const s = ausgeberSchritt(u, wallet, jest.fn(), mitStand('bestellt'), mockAusgeber.losStand);
    expect(await s()).toBe('weiter');
    expect(await s()).toBe('fertig');
  });

  it('gelost (Bestellung der Inhaberin fehlt) und kein Zustand: nichts tun', async () => {
    for (const z of [mitStand('gelost'), async () => null]) {
      const briefkasten = jest.fn();
      expect(await ausgeberSchritt(u, wallet, briefkasten, z as any)()).toBe('fertig');
      expect(briefkasten).not.toHaveBeenCalled();
    }
    expect(mockRunde.bestaetigungenAnfordern).not.toHaveBeenCalled();
    expect(mockRunde.paketSenden).not.toHaveBeenCalled();
  });
});
