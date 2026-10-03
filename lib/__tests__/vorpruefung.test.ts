/**
 * Vorfall 01.10.2026: Ein frisch gestarteter Knoten lieferte einen Status
 * ohne Chain-ID; die App hatte das Gesicht schon eingeschrieben und brach dann
 * ab. registrierungsVorpruefung laeuft jetzt VOR der Einschreibung, wiederholt
 * eine unklare Antwort begrenzt und schliesst danach ab (fail-closed).
 */
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn() }));
jest.mock('expo-crypto', () => ({ getRandomBytesAsync: jest.fn() }));
jest.mock('../wallet', () => ({ signMessage: jest.fn(), signTypedData: jest.fn(), sendAEQ: jest.fn() }));

const A = 'https://a.example/api';
const KENNUNG = 'aequitas-1926-1790000000';
const GUT = { chain_evm_id: 1926, netz_kennung: KENNUNG, register_vertrag: 'v8' };
const NOTSTAND_ALT = { height: 5 }; // Stand vor dem Knoten-Fix: nur die Hoehe

async function pruefe(antworten: unknown[], gespeichert: string | null = null) {
  let aufrufe = 0;
  const pausen: number[] = [];
  (global as any).fetch = jest.fn(async () => {
    const a = antworten[Math.min(aufrufe, antworten.length - 1)];
    aufrufe++;
    if (a instanceof Error) throw a;
    return { ok: true, status: 200, json: async () => a } as any;
  });
  let ergebnis: unknown;
  let fehler: unknown;
  await jest.isolateModulesAsync(async () => {
    require('../api')._setApiCandidatesForTest([A]);
    const { registrierungsVorpruefung } = require('../identity');
    try {
      ergebnis = await registrierungsVorpruefung(gespeichert, async (ms: number) => { pausen.push(ms); });
    } catch (e) {
      fehler = e;
    }
  });
  return { ergebnis, fehler, aufrufe, pausen };
}

describe('registrierungsVorpruefung', () => {
  it('wartet einen Notstand nach dem Neustart ab und laesst dann zu', async () => {
    const r = await pruefe([NOTSTAND_ALT, NOTSTAND_ALT, GUT]);
    expect(r.fehler).toBeUndefined();
    expect(r.ergebnis).toEqual({ vertrag: 'v8', kennung: KENNUNG });
    expect(r.aufrufe).toBe(3);
  });

  it('schliesst nach der festen Zahl an Versuchen ab (fail-closed)', async () => {
    const r = await pruefe([NOTSTAND_ALT]);
    expect(String(r.fehler)).toMatch(/Netz nicht bestätigt/);
    expect(r.aufrufe).toBe(4);
    expect(r.pausen.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(10_000);
  });

  it('fremde Kette bleibt abgelehnt, auch nach Wiederholung', async () => {
    const r = await pruefe([{ ...GUT, chain_evm_id: 1 }]);
    expect(r.fehler).toBeDefined();
    expect(r.ergebnis).toBeUndefined();
  });

  it('ein Netzwechsel wird nicht wiederholt, sondern sofort abgelehnt', async () => {
    const r = await pruefe([{ ...GUT, netz_kennung: 'aequitas-1926-1800000000' }], KENNUNG);
    expect(String(r.fehler)).toMatch(/Netz nicht bestätigt/);
    expect(r.aufrufe).toBe(1);
  });

  it('V8 ohne Netzkennung wird nicht zugelassen', async () => {
    const r = await pruefe([{ chain_evm_id: 1926, register_vertrag: 'v8' }]);
    expect(String(r.fehler)).toMatch(/keine Netzkennung/);
  });

  it('nicht erreichbarer Knoten: wiederholt, dann Abbruch', async () => {
    const r = await pruefe([new Error('offline')]);
    expect(String(r.fehler)).toMatch(/nicht erreichbar|Netz/);
    expect(r.ergebnis).toBeUndefined();
  });
});
