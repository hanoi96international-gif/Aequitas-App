/**
 * V8-REGISTRIERUNG: die App unterschreibt per EIP-712 genau das, was jeder
 * Knoten beim Nachspielen prueft (pruefeRegistrierungV8, vertrag_v8.go), und
 * unterschreibt gar nicht, wenn die Lage unklar ist.
 */
import { ethers } from 'ethers';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn() }));
jest.mock('expo-crypto', () => ({ getRandomBytesAsync: jest.fn() }));
jest.mock('../wallet', () => ({ signMessage: jest.fn(), signTypedData: jest.fn(), sendAEQ: jest.fn() }));

const A = 'https://a.example/api';
const KENNUNG = 'aequitas-1926-1790000000';
const ALICE = new ethers.Wallet('0x' + '11'.repeat(32));
const MALLORY = new ethers.Wallet('0x' + '22'.repeat(32));

const BEWEIS = {
  pA: ['1', '2'],
  pB: [['1', '2'], ['3', '4']],
  pC: ['1', '2'],
  pubSignals: ['1001', '2001'],
  zkNullifier: '2001',
  circuitVersion: 3,
  bioHashKey: 'k',
};

function signerFuer(w: ethers.Wallet, adresse = w.address) {
  return {
    address: adresse,
    kind: 'local' as const,
    signMessage: jest.fn((m: string) => w.signMessage(ethers.getBytes(m))),
    signTypedData: jest.fn((d: any, t: any, m: any) => w.signTypedData(d, t, m)),
    sendTransaction: jest.fn(),
  };
}

// rpc: was /rpc auf eth_chainId antwortet (lib/ketteLive.ts).
function knoten(status: Record<string, unknown>, beweis: Record<string, unknown> = BEWEIS, rpc: unknown = '0x786') {
  const bodies: Record<string, any> = {};
  const calls: string[] = [];
  (global as any).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push(url);
    if (url.endsWith('/rpc')) {
      const text = JSON.stringify({ jsonrpc: '2.0', id: 1, result: rpc });
      return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) } as any;
    }
    const pfad = url.slice(A.length);
    if (init?.body) bodies[pfad] = JSON.parse(String(init.body));
    const json =
      pfad === '/status' ? { chain_evm_id: 1926, ...status }
      : pfad === '/prove' ? beweis
      : { success: true };
    return { ok: true, status: 200, json: async () => json } as any;
  });
  return { bodies, calls };
}

async function registriere(signer: any, gespeichert: string | null = KENNUNG) {
  let ergebnis: unknown;
  await jest.isolateModulesAsync(async () => {
    require('../api')._setApiCandidatesForTest([A]);
    const { proveAndRegister, _setVorpruefungWarteForTest } = require('../identity');
    _setVorpruefungWarteForTest(async () => {});
    ergebnis = await proveAndRegister(signer, { bio: '5', salt: '7' }, 'timeout', undefined, gespeichert);
  });
  return ergebnis;
}

describe('proveAndRegister unter V8', () => {
  afterEach(() => { jest.resetModules(); (global as any).fetch = undefined; });

  it('unterschreibt EIP-712 mit Salt, Frist und Nonce 0 und schickt die Frist mit', async () => {
    const { bodies } = knoten({ netz_kennung: KENNUNG, register_vertrag: 'v8' });
    const signer = signerFuer(ALICE);
    const vorher = Math.floor(Date.now() / 1000);
    await registriere(signer);

    expect(signer.signMessage).not.toHaveBeenCalled();
    const reg = bodies['/register'];
    expect(reg.deadline).toBeGreaterThanOrEqual(vorher + 29 * 60);
    expect(reg.deadline).toBeLessThanOrEqual(vorher + 24 * 60 * 60);

    // Dieselbe Rechnung wie der Knoten: Digest aus festen Werten + Salt.
    const { registerV8Digest, registerV8Nachricht } = require('@/src/domain/registerV8');
    const digest = registerV8Digest(KENNUNG, registerV8Nachricht(ALICE.address, BEWEIS.pubSignals, reg.deadline), 1926);
    expect(ethers.recoverAddress(digest, reg.signature)).toBe(ALICE.address);
    const [domain, , message] = signer.signTypedData.mock.calls[0];
    expect(domain.salt).toBe(ethers.keccak256(ethers.toUtf8Bytes(KENNUNG)));
    expect(message.nonce).toBe(0n);
  });

  it('eine fremde Wallet hinter der Adresse: nichts geht raus', async () => {
    const { calls } = knoten({ netz_kennung: KENNUNG, register_vertrag: 'v8' });
    await expect(registriere(signerFuer(MALLORY, ALICE.address))).rejects.toThrow('nicht von dieser Wallet');
    expect(calls.some((u) => u.endsWith('/register'))).toBe(false);
  });

  it('Nullifier passt nicht zu pubSignals[1]: keine Unterschrift', async () => {
    knoten({ netz_kennung: KENNUNG, register_vertrag: 'v8' }, { ...BEWEIS, zkNullifier: '9999' });
    const signer = signerFuer(ALICE);
    await expect(registriere(signer)).rejects.toThrow('Nullifier');
    expect(signer.signTypedData).not.toHaveBeenCalled();
  });

  it.each([
    ['unbekannter Vertrag', { netz_kennung: KENNUNG, register_vertrag: 'v9' }, KENNUNG],
    ['V8 ohne Netzkennung', { register_vertrag: 'v8' }, KENNUNG],
    ['ungueltige Kennung', { netz_kennung: 'aequitas-1-1', register_vertrag: 'v8' }, KENNUNG],
    ['Neustart nicht bestaetigt', { netz_kennung: 'aequitas-1926-1800000000', register_vertrag: 'v8' }, KENNUNG],
    ['fremde Kette', { chain_evm_id: 1, netz_kennung: KENNUNG, register_vertrag: 'v8' }, KENNUNG],
  ])('%s: weder Beweis noch Unterschrift', async (_name, status, gespeichert) => {
    const { calls } = knoten(status);
    const signer = signerFuer(ALICE);
    await expect(registriere(signer, gespeichert)).rejects.toThrow();
    expect(calls.some((u) => u.endsWith('/prove'))).toBe(false);
    expect(signer.signTypedData).not.toHaveBeenCalled();
    expect(signer.signMessage).not.toHaveBeenCalled();
  });
});

describe('proveAndRegister beim Chain-ID-Wechsel', () => {
  afterEach(() => { jest.resetModules(); (global as any).fetch = undefined; });

  it('nach dem Stichtag: V8-Domaene mit der live gemeldeten 19260930, Netzkennung bleibt 1926', async () => {
    const { bodies } = knoten({ chain_evm_id: 19260930, chain_id_wechsel_ab: 1_700_000_000, netz_kennung: KENNUNG, register_vertrag: 'v8' }, BEWEIS, '0x125e602');
    const signer = signerFuer(ALICE);
    await registriere(signer);
    const [domain] = signer.signTypedData.mock.calls[0];
    expect(domain.chainId).toBe(19260930);
    expect(domain.salt).toBe(ethers.keccak256(ethers.toUtf8Bytes(KENNUNG)));
    const { registerV8Digest, registerV8Nachricht } = require('@/src/domain/registerV8');
    const reg = bodies['/register'];
    const digest = registerV8Digest(KENNUNG, registerV8Nachricht(ALICE.address, BEWEIS.pubSignals, reg.deadline), 19260930);
    expect(ethers.recoverAddress(digest, reg.signature)).toBe(ALICE.address);
  });

  it('V7 nach dem Stichtag: personal_sign ueber die neue ID', async () => {
    knoten({ chain_evm_id: 19260930, chain_id_wechsel_ab: 1_700_000_000, netz_kennung: KENNUNG, register_vertrag: 'v7' }, BEWEIS, '0x125e602');
    const signer = signerFuer(ALICE);
    await registriere(signer);
    const nullifier = BigInt(BEWEIS.zkNullifier).toString(16).padStart(64, '0');
    const erwartet = ethers.solidityPackedKeccak256(
      ['uint256', 'address', 'string', 'uint256', 'bytes32'],
      [19260930, '0x20D271028f32577FCd07b4583A8e0E4eBBdB4F78', 'register', BEWEIS.pubSignals[0], '0x' + nullifier],
    );
    expect(signer.signMessage).toHaveBeenCalledWith(erwartet);
  });

  it.each([
    ['RPC meldet eine fremde ID', { netz_kennung: KENNUNG, register_vertrag: 'v8' }, '0x1'],
    ['RPC und Status uneinig', { netz_kennung: KENNUNG, register_vertrag: 'v8' }, '0x125e602'],
    ['RPC ohne Ergebnis', { netz_kennung: KENNUNG, register_vertrag: 'v8' }, null],
    ['neue ID ohne Stichtag (widerspruechlich)', { chain_evm_id: 19260930, netz_kennung: KENNUNG, register_vertrag: 'v8' }, '0x125e602'],
  ])('%s: keine Unterschrift', async (_name, status, rpc) => {
    const { calls } = knoten(status, BEWEIS, rpc);
    const signer = signerFuer(ALICE);
    await expect(registriere(signer)).rejects.toThrow();
    expect(signer.signTypedData).not.toHaveBeenCalled();
    expect(signer.signMessage).not.toHaveBeenCalled();
    expect(calls.some((u) => u.endsWith('/register'))).toBe(false);
  });
});

describe('proveAndRegister unter V7 (laufende Kette)', () => {
  afterEach(() => { jest.resetModules(); (global as any).fetch = undefined; });

  it('bleibt personal_sign ohne Frist', async () => {
    const { bodies } = knoten({ netz_kennung: KENNUNG, register_vertrag: 'v7' });
    const signer = signerFuer(ALICE);
    await registriere(signer);
    expect(signer.signTypedData).not.toHaveBeenCalled();
    expect(signer.signMessage).toHaveBeenCalledTimes(1);
    expect(bodies['/register'].deadline).toBeUndefined();
  });

  it('aelterer Knoten ohne register_vertrag gilt als V7', async () => {
    const { bodies } = knoten({});
    const signer = signerFuer(ALICE);
    await registriere(signer, null);
    expect(signer.signMessage).toHaveBeenCalledTimes(1);
    expect(bodies['/register'].deadline).toBeUndefined();
  });
});
