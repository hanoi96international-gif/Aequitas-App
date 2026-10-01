/**
 * Nachbau des Geraetebefunds 1.8.8 (01.10.2026) mit der Form, die AppKit
 * 2.0.5 wirklich liefert (Quelltext WalletConnectConnector.getProvider,
 * useAccount): useProvider() gibt eine KOPIE des UniversalProvider mit
 * eingefrorener `session`; useAccount() hat keine Adresse, solange MetaMask
 * die Aequitas-Kette nicht freigegeben hat. Der SignClient (`client`) ist
 * echt und live -- wie MetaMask Mobile antwortet (wallet_addEthereumChain
 * ueber eine freigegebene Kette -> Netz anlegen -> session_update mit 1926).
 */
import React from 'react';
// react-test-renderer liegt mit jest-expo bei; Typen dazu sind kein Paket
// des Projekts (keine neue Abhaengigkeit nur fuer einen Test).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer: any = require('react-test-renderer');
const { act } = TestRenderer;

const ADRESSE = '0x52908400098527886e0f7030069857d2e4169ee7';
const TOPIC = 'a'.repeat(64);

type Ereignis = (e: any) => void;
function falscherSignClient(kettenAnfang: string[]) {
  const hoerer: Record<string, Set<Ereignis>> = {};
  const nsVon = (ketten: string[]) => ({ eip155: { chains: ketten, accounts: ketten.map((k) => `${k}:${ADRESSE}`), methods: [], events: [] } });
  let sitzung = { topic: TOPIC, namespaces: nsVon(kettenAnfang) };
  const emit = (name: string, e: any) => hoerer[name]?.forEach((h) => h(e));
  const client = {
    session: { get: (t: string) => { if (t !== TOPIC) throw new Error('No matching key'); return sitzung; } },
    on: (n: string, h: Ereignis) => { (hoerer[n] ??= new Set()).add(h); },
    off: (n: string, h: Ereignis) => { hoerer[n]?.delete(h); },
    request: jest.fn(async ({ topic, chainId, request }: any) => {
      // Wie der echte SignClient: Leitweg muss in der Sitzung sein.
      if (topic !== TOPIC || !sitzung.namespaces.eip155.chains.includes(chainId)) throw new Error('Missing or invalid. request() chainId');
      if (request.method === 'wallet_addEthereumChain') {
        // MetaMask: anlegen, wechseln, fuer die Verbindung freigeben.
        sitzung = { ...sitzung, namespaces: nsVon([...sitzung.namespaces.eip155.chains, 'eip155:1926']) };
        setTimeout(() => emit('session_update', { topic: TOPIC, params: { namespaces: sitzung.namespaces } }), 50);
        return null;
      }
      if (request.method === 'eth_signTypedData_v4') return '0xsig';
      return null;
    }),
  };
  return { client, anfangsSitzung: sitzung };
}

let mockSzenario: ReturnType<typeof falscherSignClient>;

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}), clear: jest.fn(async () => {}), getAllKeys: jest.fn(async () => []), multiGet: jest.fn(async () => []), removeItem: jest.fn(async () => {}) },
}));
jest.mock('@reown/appkit-react-native', () => ({
  useAppKit: () => ({ open: jest.fn(), close: jest.fn(), disconnect: jest.fn() }),
  // AppKit: aktive Kette 1926, kein Konto dort -> keine Adresse.
  useAccount: () => ({ address: undefined, isConnected: false }),
  // KOPIE wie WalletConnectConnector.getProvider('eip155'): session eingefroren.
  useProvider: () => ({ provider: { client: mockSzenario.client, session: mockSzenario.anfangsSitzung, request: jest.fn() } }),
}), { virtual: true });
jest.mock('@reown/appkit-ethers-react-native', () => ({ EthersAdapter: class {} }), { virtual: true });

// eslint-disable-next-line import/first
import { useWalletConnect } from '../walletconnect';

function rendere() {
  const ref: { wc?: ReturnType<typeof useWalletConnect> } = {};
  function Sonde() {
    ref.wc = useWalletConnect();
    return null;
  }
  let r: any;
  act(() => { r = TestRenderer.create(<Sonde />); });
  return { ref, unmount: () => act(() => r.unmount()) };
}

describe('useWalletConnect mit MetaMask ohne Aequitas-Netz (Vorfall 1.8.8)', () => {
  it('erkennt die Verbindung trotz fehlender AppKit-Adresse', () => {
    mockSzenario = falscherSignClient(['eip155:1']);
    const { ref, unmount } = rendere();
    expect(ref.wc!.isConnected).toBe(true);
    expect(ref.wc!.address).toBe('0x52908400098527886E0F7030069857D2E4169EE7');
    unmount();
  });

  it('legt das Netz automatisch an: genau eine Anfrage, ueber die freigegebene Kette, Freigabe live erkannt', async () => {
    mockSzenario = falscherSignClient(['eip155:1']);
    const { ref, unmount } = rendere();
    await act(async () => { await ref.wc!.ensureNetwork(); });
    expect(mockSzenario.client.request).toHaveBeenCalledTimes(1);
    const arg = mockSzenario.client.request.mock.calls[0][0];
    expect(arg.chainId).toBe('eip155:1');
    expect(arg.request.method).toBe('wallet_addEthereumChain');
    expect(arg.request.params[0]).toMatchObject({ chainId: '0x786', chainName: 'Aequitas Chain', rpcUrls: [expect.stringMatching(/^https:\/\//)] });
    // Die AppKit-Kopie kennt 1926 bis heute nicht -- gelesen wurde live.
    expect(mockSzenario.anfangsSitzung.namespaces.eip155.chains).toEqual(['eip155:1']);
    unmount();
  });

  it('danach geht die V8-Unterschrift ueber die Aequitas-Kette', async () => {
    mockSzenario = falscherSignClient(['eip155:1']);
    const { ref, unmount } = rendere();
    await act(async () => { await ref.wc!.ensureNetwork(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 80)); });
    const sig = await ref.wc!.signer!.signTypedData(
      { name: 'Aequitas', version: '8', chainId: 1926, verifyingContract: '0x20D271028f32577FCd07b4583A8e0E4eBBdB4F78' },
      { Register: [{ name: 'x', type: 'uint256' }] },
      { x: 1n },
    );
    expect(sig).toBe('0xsig');
    const letzte = mockSzenario.client.request.mock.calls.at(-1)![0];
    expect(letzte.chainId).toBe('eip155:1926');
    expect(letzte.request.method).toBe('eth_signTypedData_v4');
    unmount();
  });

  it('Netz schon freigegeben: keine Anfrage beim Verbinden', async () => {
    mockSzenario = falscherSignClient(['eip155:1', 'eip155:1926']);
    const { ref, unmount } = rendere();
    await act(async () => { await ref.wc!.ensureNetwork(); });
    expect(mockSzenario.client.request).not.toHaveBeenCalled();
    unmount();
  });
});
