import { adresseKurz, holeValidatorStand, leseValidatorStand } from '../validatorStand';
import { API_BASE } from '../config';

const W = '0x0be8b961cbf6564bd1931b0803d35c0659e0d016';
const K1 = '0x3066639af1653325100c1074a9696612dbdc42dc';
const K2 = '0x' + '7c'.repeat(20);

function schluessel(over: Record<string, unknown> = {}) {
  return { signing_address: K1, kette: true, ueberholt: false, knoten: true, erzeuger: true, bloecke_heute: 3600, bloecke_gesamt: 6000, letzter_block: 1794771000, ...over };
}

function antwortJson(over: Record<string, unknown> = {}) {
  return { wallet: W, eingetragen: true, erzeuger: true, tag_beginn: 1794697200, schluessel: [schluessel()], stand: 1794771010, ...over };
}

function antwort(status: number, body: unknown) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, text: async () => text } as unknown as Response;
}

describe('leseValidatorStand', () => {
  it('reads a registered block producer with today and total blocks', () => {
    const s = leseValidatorStand(antwortJson(), W);
    expect(s).toEqual(expect.objectContaining({ wallet: W, eingetragen: true, erzeuger: true, bloeckeHeute: 3600, bloeckeGesamt: 6000, letzterBlock: 1794771000 }));
    expect(s?.schluessel[0].adresse).toBe(K1);
  });

  it('reads "not registered" when the node says so with no key', () => {
    const s = leseValidatorStand(antwortJson({ eingetragen: false, erzeuger: false, schluessel: [] }), W);
    expect(s).toEqual(expect.objectContaining({ eingetragen: false, erzeuger: false, bloeckeHeute: 0, bloeckeGesamt: 0 }));
  });

  it('sums only valid keys: an overtaken chain binding does not count', () => {
    const s = leseValidatorStand(
      antwortJson({
        schluessel: [
          schluessel(),
          schluessel({ signing_address: K2, knoten: false, kette: true, ueberholt: true, erzeuger: false, bloecke_heute: 5, bloecke_gesamt: 9 }),
        ],
      }),
      W,
    );
    expect(s?.bloeckeHeute).toBe(3600);
    expect(s?.bloeckeGesamt).toBe(6000);
  });

  it('refuses an answer for another wallet', () => {
    expect(leseValidatorStand(antwortJson({ wallet: K2 }), W)).toBeNull();
  });

  it('refuses "registered" without a valid key and "producer" without a producing key', () => {
    expect(leseValidatorStand(antwortJson({ schluessel: [] }), W)).toBeNull();
    expect(leseValidatorStand(antwortJson({ schluessel: [schluessel({ kette: true, ueberholt: true, knoten: false })] }), W)).toBeNull();
    expect(leseValidatorStand(antwortJson({ schluessel: [schluessel({ erzeuger: false })] }), W)).toBeNull();
    expect(leseValidatorStand(antwortJson({ eingetragen: false }), W)).toBeNull();
  });

  it('refuses malformed numbers, addresses and too many keys', () => {
    for (const bad of [
      { bloecke_heute: -1 },
      { bloecke_gesamt: 1.5 },
      { bloecke_heute: 10, bloecke_gesamt: 9 },
      { letzter_block: '1' },
      { signing_address: '0x123' },
      { signing_address: K1.toUpperCase() },
      { kette: 'true' },
    ]) {
      expect(leseValidatorStand(antwortJson({ schluessel: [schluessel(bad)] }), W)).toBeNull();
    }
    expect(leseValidatorStand(antwortJson({ schluessel: Array.from({ length: 9 }, () => schluessel()) }), W)).toBeNull();
    expect(leseValidatorStand(antwortJson({ tag_beginn: -5 }), W)).toBeNull();
    expect(leseValidatorStand(null, W)).toBeNull();
  });
});

describe('holeValidatorStand', () => {
  it('asks the node for exactly this wallet', async () => {
    const f = jest.fn().mockResolvedValue(antwort(200, antwortJson()));
    const r = await holeValidatorStand(W.toUpperCase().replace('0X', '0x'), f as any);
    expect(r.ok).toBe(true);
    expect(f).toHaveBeenCalledWith(`${API_BASE}/validator-stand?wallet=${W}`, expect.anything());
  });

  it('never contacts the node for an invalid wallet', async () => {
    const f = jest.fn();
    expect(await holeValidatorStand('0x123', f as any)).toEqual({ ok: false, fehler: 'adresse' });
    expect(f).not.toHaveBeenCalled();
  });

  it('turns every failure into "not readable", never into "not registered"', async () => {
    for (const f of [
      jest.fn().mockResolvedValue(antwort(503, { error: 'busy' })),
      jest.fn().mockResolvedValue(antwort(200, 'kein json')),
      jest.fn().mockResolvedValue(antwort(200, JSON.stringify({ ...antwortJson(), x: 'y'.repeat(9000) }))),
      jest.fn().mockRejectedValue(new Error('offline')),
    ]) {
      expect(await holeValidatorStand(W, f as any)).toEqual({ ok: false, fehler: 'nicht_lesbar' });
    }
  });
});

describe('adresseKurz', () => {
  it('shortens a signing address', () => {
    expect(adresseKurz(K1)).toBe('0x3066…42dc');
  });
});
