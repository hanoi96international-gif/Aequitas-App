/**
 * Chain-ID-Wechsel 1926 -> 19260930 (Chain-Repo docs/CHAIN_ID_WECHSEL.md):
 * die App signiert nur mit der ID, die der Knoten live meldet, und nur mit
 * einer der beiden IDs des Netzes. Alles andere: nicht signieren.
 */
import {
  AEQUITAS_CAIPS,
  caipAusHex,
  chainCaip,
  chainIdAusHex,
  chainIdHex,
  domaeneTraegt,
  inWechselPause,
  istAequitasCaip,
  passtZurUhr,
  istAequitasChainId,
  kettenAngabenFuer,
  kettenStandAusStatus,
} from '../kette';
import { KETTE_NICHT_BESTAETIGT, WECHSEL_PAUSE_MELDUNG, rpcChainId, signierChainId } from '../ketteLive';
import { UHR_TOLERANZ_S } from '../kette';

const AB = 1_800_000_000;

describe('feste Liste: genau 1926 oder 19260930', () => {
  it('nimmt nur die beiden Zahlen an', () => {
    expect(istAequitasChainId(1926)).toBe(true);
    expect(istAequitasChainId(19260930)).toBe(true);
    for (const x of [0, 1, 1925, 1927, 19260929, 19260931, -1926, 1926.0000001, NaN, Infinity, '1926', '0x786', 1926n, null, undefined, {}, [1926]]) {
      expect(istAequitasChainId(x)).toBe(false);
    }
  });
  it('eth_chainId-Hex: nur die beiden, streng geformt', () => {
    expect(chainIdAusHex('0x786')).toBe(1926);
    expect(chainIdAusHex('0x125e602')).toBe(19260930);
    expect(chainIdAusHex('0x125E602')).toBe(19260930);
    for (const x of ['0x1', '0x787', '0x125e603', '786', '0x', '0x0786x', ' 0x786', '0x786 ', '0x' + '0'.repeat(20) + '786', 1926, null, undefined]) {
      expect(chainIdAusHex(x)).toBeNull();
    }
  });
  it('Hex und CAIP nur fuer IDs der Liste', () => {
    expect(chainIdHex(1926)).toBe('0x786');
    expect(chainIdHex(19260930)).toBe('0x125e602');
    expect(chainCaip(19260930)).toBe('eip155:19260930');
    expect(() => chainIdHex(1)).toThrow();
    expect(() => chainCaip(1)).toThrow();
    expect(AEQUITAS_CAIPS).toEqual(['eip155:1926', 'eip155:19260930']);
    expect(istAequitasCaip('eip155:19260930')).toBe(true);
    expect(istAequitasCaip('eip155:1')).toBe(false);
    expect(istAequitasCaip('eip155:19260')).toBe(false);
    expect(caipAusHex('0x125e602')).toBe('eip155:19260930');
    expect(caipAusHex('0x1')).toBeNull();
    expect(() => kettenAngabenFuer(5)).toThrow();
    expect(kettenAngabenFuer(19260930).chainId).toBe('0x125e602');
  });
  it('EIP-712-Domaene traegt genau die ID', () => {
    expect(domaeneTraegt(1926, 1926)).toBe(true);
    expect(domaeneTraegt('19260930', 19260930)).toBe(true);
    expect(domaeneTraegt(19260930n, 19260930)).toBe(true);
    expect(domaeneTraegt(1926, 19260930)).toBe(false);
    expect(domaeneTraegt(undefined, 1926)).toBe(false);
    expect(domaeneTraegt('kaputt', 1926)).toBe(false);
  });
});

describe('kettenStandAusStatus (/api/status)', () => {
  it('schlafend: 1926, Stichtag 0', () => {
    expect(kettenStandAusStatus({ chain_evm_id: 1926, chain_id_wechsel_ab: 0 })).toEqual({ chainId: 1926, wechselAb: 0 });
    // Knoten vor dem Wechsel-PR ohne das Feld.
    expect(kettenStandAusStatus({ chain_evm_id: 1926 })).toEqual({ chainId: 1926, wechselAb: 0 });
  });
  it('geplant und nach dem Stichtag', () => {
    expect(kettenStandAusStatus({ chain_evm_id: 1926, chain_id_wechsel_ab: AB })).toEqual({ chainId: 1926, wechselAb: AB });
    expect(kettenStandAusStatus({ chain_evm_id: 19260930, chain_id_wechsel_ab: AB })).toEqual({ chainId: 19260930, wechselAb: AB });
  });
  it('Missbrauch: fremde ID, Text statt Zahl, kaputter Stichtag, neue ID ohne Stichtag', () => {
    for (const s of [
      { chain_evm_id: 1 },
      { chain_evm_id: '1926' },
      { chain_evm_id: 1927, chain_id_wechsel_ab: AB },
      { chain_evm_id: 1926, chain_id_wechsel_ab: -1 },
      { chain_evm_id: 1926, chain_id_wechsel_ab: '1800000000' },
      { chain_evm_id: 1926, chain_id_wechsel_ab: 1.5 },
      { chain_evm_id: 1926, chain_id_wechsel_ab: 2 ** 60 },
      { chain_evm_id: 19260930 },
      { chain_evm_id: 19260930, chain_id_wechsel_ab: 0 },
      null, undefined, 1926, [], [{ chain_evm_id: 1926 }],
    ]) {
      expect(kettenStandAusStatus(s)).toBeNull();
    }
  });
  it('passtZurUhr: Toleranz 300 s um den Stichtag', () => {
    expect(UHR_TOLERANZ_S).toBe(300);
    expect(passtZurUhr({ chainId: 1926, wechselAb: 0 }, AB * 2)).toBe(true);
    expect(passtZurUhr({ chainId: 1926, wechselAb: AB }, AB + 299)).toBe(true);
    expect(passtZurUhr({ chainId: 1926, wechselAb: AB }, AB + 300)).toBe(false);
    expect(passtZurUhr({ chainId: 19260930, wechselAb: AB }, AB - 300)).toBe(true);
    expect(passtZurUhr({ chainId: 19260930, wechselAb: AB }, AB - 301)).toBe(false);
    expect(passtZurUhr({ chainId: 19260930, wechselAb: 0 }, AB)).toBe(false);
    expect(passtZurUhr({ chainId: 1926, wechselAb: AB }, NaN)).toBe(false);
  });

  it('Pause vor dem Stichtag nur fuer 1926, nur wenn geplant', () => {
    const alt = { chainId: 1926, wechselAb: AB };
    expect(inWechselPause(alt, AB - 601)).toBe(false);
    expect(inWechselPause(alt, AB - 600)).toBe(true);
    expect(inWechselPause(alt, AB + 5)).toBe(true); // Knoten meldet noch 1926: Uhren uneins -> nicht senden
    expect(inWechselPause({ chainId: 19260930, wechselAb: AB }, AB - 300)).toBe(false);
    expect(inWechselPause({ chainId: 1926, wechselAb: 0 }, AB)).toBe(false);
  });
});

describe('signierChainId: live, beide Quellen, fail-closed', () => {
  const quellen = (status: unknown, rpc: number | null, jetzt = AB - 3600) => ({
    status: async () => status,
    rpc: async () => rpc,
    jetztS: () => jetzt,
  });

  it('vor dem Stichtag 1926, danach 19260930', async () => {
    await expect(signierChainId(quellen({ chain_evm_id: 1926, chain_id_wechsel_ab: 0 }, 1926))).resolves.toBe(1926);
    await expect(signierChainId({ ueberweisung: true, ...quellen({ chain_evm_id: 19260930, chain_id_wechsel_ab: AB }, 19260930, AB + 1) })).resolves.toBe(19260930);
  });
  it('Knoten unerreichbar: wirft, kein Rueckfall auf 1926', async () => {
    await expect(signierChainId({ status: async () => { throw new Error('Network request failed'); }, rpc: async () => 1926 })).rejects.toThrow(KETTE_NICHT_BESTAETIGT);
    await expect(signierChainId({ status: async () => ({ chain_evm_id: 1926 }), rpc: async () => { throw new Error('x'); } })).rejects.toThrow(KETTE_NICHT_BESTAETIGT);
    await expect(signierChainId(quellen({ chain_evm_id: 1926 }, null))).rejects.toThrow(KETTE_NICHT_BESTAETIGT);
  });
  it('Status und RPC uneinig (z. B. ein Knoten noch alt, einer schon neu): wirft', async () => {
    await expect(signierChainId(quellen({ chain_evm_id: 1926, chain_id_wechsel_ab: AB }, 19260930))).rejects.toThrow(KETTE_NICHT_BESTAETIGT);
    await expect(signierChainId(quellen({ chain_evm_id: 19260930, chain_id_wechsel_ab: AB }, 1926))).rejects.toThrow(KETTE_NICHT_BESTAETIGT);
  });
  it('fremde ID vom Knoten: wirft', async () => {
    await expect(signierChainId(quellen({ chain_evm_id: 1 }, 1926))).rejects.toThrow(KETTE_NICHT_BESTAETIGT);
  });
  it('Missbrauch gegen die Uhr: 1926 nach dem Stichtag, 19260930 weit davor -- fuer JEDE Unterschrift abgelehnt', async () => {
    for (const ueberweisung of [false, true]) {
      // Ein Knoten meldet nach dem Stichtag noch 1926 (veraltet/gefaelscht).
      await expect(signierChainId({ ueberweisung, ...quellen({ chain_evm_id: 1926, chain_id_wechsel_ab: AB }, 1926, AB + 300) })).rejects.toThrow(KETTE_NICHT_BESTAETIGT);
      await expect(signierChainId({ ueberweisung, ...quellen({ chain_evm_id: 1926, chain_id_wechsel_ab: AB }, 1926, AB + 86_400) })).rejects.toThrow(KETTE_NICHT_BESTAETIGT);
      // Ein Knoten meldet die neue ID lange vor dem Stichtag (Vorab-Signatur).
      await expect(signierChainId({ ueberweisung, ...quellen({ chain_evm_id: 19260930, chain_id_wechsel_ab: AB }, 19260930, AB - 301) })).rejects.toThrow(KETTE_NICHT_BESTAETIGT);
      await expect(signierChainId({ ueberweisung, ...quellen({ chain_evm_id: 19260930, chain_id_wechsel_ab: AB }, 19260930, AB - 30 * 86_400) })).rejects.toThrow(KETTE_NICHT_BESTAETIGT);
    }
    // Innerhalb der Toleranz: Uhren duerfen etwas abweichen.
    await expect(signierChainId(quellen({ chain_evm_id: 1926, chain_id_wechsel_ab: AB }, 1926, AB + 299))).resolves.toBe(1926);
    await expect(signierChainId(quellen({ chain_evm_id: 19260930, chain_id_wechsel_ab: AB }, 19260930, AB - 300))).resolves.toBe(19260930);
  });

  it('Gesamtgrenze: haengt eine Quelle, wird nicht signiert', async () => {
    await expect(signierChainId({ status: () => new Promise(() => {}), rpc: async () => 1926, fristMs: 50 })).rejects.toThrow(KETTE_NICHT_BESTAETIGT);
    await expect(signierChainId({ status: async () => ({ chain_evm_id: 1926 }), rpc: () => new Promise(() => {}), fristMs: 50 })).rejects.toThrow(KETTE_NICHT_BESTAETIGT);
  });

  it('Ueberweisung in der Pause: wirft mit Hinweis; andere Unterschriften laufen weiter', async () => {
    const q = quellen({ chain_evm_id: 1926, chain_id_wechsel_ab: AB }, 1926, AB - 100);
    await expect(signierChainId({ ueberweisung: true, ...q })).rejects.toThrow(WECHSEL_PAUSE_MELDUNG);
    await expect(signierChainId(q)).resolves.toBe(1926);
  });
});

describe('rpcChainId (eth_chainId)', () => {
  const antwort = (body: string, ok = true) => ({ ok, status: ok ? 200 : 500, text: async () => body });
  afterEach(() => { (global as any).fetch = undefined; });

  it('liest und prueft die Antwort', async () => {
    (global as any).fetch = jest.fn(async () => antwort('{"jsonrpc":"2.0","id":1,"result":"0x125e602"}'));
    await expect(rpcChainId(['https://a.example/rpc'])).resolves.toBe(19260930);
    const [, init] = (global as any).fetch.mock.calls[0];
    expect(JSON.parse(init.body).method).toBe('eth_chainId');
  });
  it('fremde ID, kaputtes JSON, Fehlerstatus, uebergrosse Antwort: null', async () => {
    for (const r of [
      antwort('{"result":"0x1"}'),
      antwort('kaputt'),
      antwort('{"result":"0x786"}', false),
      antwort('{"result":"0x786","x":"' + 'a'.repeat(5000) + '"}'),
      antwort('{"error":{"code":-32601}}'),
    ]) {
      (global as any).fetch = jest.fn(async () => r);
      await expect(rpcChainId(['https://a.example/rpc'])).resolves.toBeNull();
    }
  });
  it('uebergrosse Antwort: content-length vorab, Strom wird abgebrochen', async () => {
    const text = jest.fn(async () => '{"result":"0x786"}');
    (global as any).fetch = jest.fn(async () => ({ ok: true, status: 200, headers: { get: (k: string) => (k === 'content-length' ? '999999' : null) }, text }));
    await expect(rpcChainId(['https://a.example/rpc'])).resolves.toBeNull();
    expect(text).not.toHaveBeenCalled(); // gar nicht erst gelesen
    for (const cl of ['-1', 'x', '1e9']) {
      (global as any).fetch = jest.fn(async () => ({ ok: true, status: 200, headers: { get: () => cl }, text }));
      await expect(rpcChainId(['https://a.example/rpc'])).resolves.toBeNull();
    }
    // Ohne content-length, als Strom: Abbruch nach 4 KB, nie bis zum Ende.
    let gelesen = 0;
    const cancel = jest.fn(async () => {});
    const block = new Uint8Array(1024).fill(0x20);
    (global as any).fetch = jest.fn(async () => ({
      ok: true, status: 200, headers: { get: () => null }, text,
      body: { getReader: () => ({ read: async () => { gelesen++; return { done: false, value: block }; }, cancel }) },
    }));
    await expect(rpcChainId(['https://a.example/rpc'])).resolves.toBeNull();
    expect(cancel).toHaveBeenCalled();
    expect(gelesen).toBe(5);
    // Strom in Ordnung: wird gelesen.
    const bytes = Uint8Array.from(Buffer.from('{"result":"0x125e602"}'));
    let einmal = false;
    (global as any).fetch = jest.fn(async () => ({
      ok: true, status: 200, headers: { get: () => null },
      body: { getReader: () => ({ read: async () => (einmal ? { done: true } : ((einmal = true), { done: false, value: bytes })), cancel }) },
    }));
    await expect(rpcChainId(['https://a.example/rpc'])).resolves.toBe(19260930);
  });

  it('haengende Antwort: Zeitgrenze gilt auch fuer das Lesen des Bodys', async () => {
    (global as any).fetch = jest.fn(async () => ({ ok: true, status: 200, headers: { get: () => null }, text: () => new Promise(() => {}) }));
    const t0 = Date.now();
    await expect(rpcChainId(['https://a.example/rpc'], 50)).resolves.toBeNull();
    expect(Date.now() - t0).toBeLessThan(2000);
    // Kopfzeilen kommen nie: naechster Knoten, dann null.
    (global as any).fetch = jest.fn(() => new Promise(() => {}));
    await expect(rpcChainId(['https://a.example/rpc', 'https://b.example/rpc'], 50)).resolves.toBeNull();
    expect((global as any).fetch).toHaveBeenCalledTimes(2);
  });

  it('Netzfehler: naechster Knoten; alle weg: null; hoechstens 4 Knoten', async () => {
    (global as any).fetch = jest.fn(async (url: string) => {
      if (url.includes('a.')) throw new Error('Network request failed');
      return antwort('{"result":"0x786"}');
    });
    await expect(rpcChainId(['https://a.example/rpc', 'https://b.example/rpc'])).resolves.toBe(1926);
    (global as any).fetch = jest.fn(async () => { throw new Error('Network request failed'); });
    await expect(rpcChainId(Array.from({ length: 10 }, (_, i) => `https://k${i}.example/rpc`))).resolves.toBeNull();
    expect((global as any).fetch).toHaveBeenCalledTimes(4);
  });
});
