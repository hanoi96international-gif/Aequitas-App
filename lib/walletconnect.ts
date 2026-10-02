import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { CHAIN_ID_DEC, CHAIN_ID_HEX, NATIVE_CURRENCY, RPC_URL, WALLETCONNECT_PROJECT_ID, WEBAPP } from './config';
import {
  AEQUITAS_CAIP,
  WALLET_ANTWORTET_NICHT,
  adresseDerSitzung,
  aequitasNetzEinrichten,
  istAbgelehnt,
  kettenDerSitzung,
  walletConnectSigner,
  withTimeout,
  type AequitasSigner,
  type KettenAngaben,
} from './signer';
import type { AppKitNetwork, Storage } from '@reown/appkit-react-native';

type WcRequest = (args: { method: string; params: unknown[] }, chainId?: string) => Promise<any>;


export const aequitasNetwork: AppKitNetwork = {
  id: CHAIN_ID_DEC,
  name: 'Aequitas Chain',
  nativeCurrency: NATIVE_CURRENCY,
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: 'Aequitas Explorer', url: WEBAPP } },
  chainNamespace: 'eip155',
  caipNetworkId: `eip155:${CHAIN_ID_DEC}`,
};

/**
 * Root cause of the "Invalid chainId" error thrown INSTANTLY (no relay/wallet
 * round trip at all -- confirmed via on-device logcat, `{ context: 'client'
 * }, 'Invalid chainId'` fires ~200ms after the deep-link into MetaMask, far
 * too fast to be a real response) on every single WalletConnect request this
 * app sends, including the very first wallet_addEthereumChain call of a fresh
 * connection: confirmed by reading `@walletconnect/sign-client`'s own source
 * (isValidRequest -> isValidNamespacesChainId) that EVERY outgoing request is
 * validated CLIENT-SIDE against the chains already present in the session's
 * approved namespaces, before it's ever sent to the wallet -- regardless of
 * method, so this applies to wallet_addEthereumChain/wallet_switchEthereumChain
 * exactly like any other call. AppKit's own EthersAdapter.switchNetwork (see
 * the installed SDK's src/adapter.ts) passes this same chainId as request()'s
 * second argument, scoped to whichever network is being switched TO -- which
 * only works because AppKit's typical usage lists several wallet-recognized
 * chains in `networks`, all of which got negotiated into the session up
 * front. This app's `networks` used to list ONLY Aequitas Chain, a chain no
 * wallet has ever heard of -- so the session could never negotiate ANY chain
 * our own raw requests could validly be routed through, dooming literally
 * every request (add-chain included) before it left the device. Ethereum
 * mainnet is added below purely as that missing, universally-wallet-known
 * routing anchor; the app has no mainnet functionality and never surfaces it
 * as something to use.
 */
const anchorNetwork: AppKitNetwork = {
  id: 1,
  name: 'Ethereum',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://cloudflare-eth.com'] } },
  chainNamespace: 'eip155',
  caipNetworkId: 'eip155:1',
};

/**
 * Null when no WalletConnect project ID is configured, OR when ANYTHING in
 * this chain fails — including, as of this fix, the package imports
 * themselves.
 *
 * FIX (real-device crash, production builds only: "TypeError: Cannot read
 * property 'ErrorBoundary' of undefined" inside expo-router's
 * ContextNavigator/getQualifiedRouteComponent): every @reown/@walletconnect
 * package used to be imported with static top-level `import` statements —
 * in THIS file, but also effectively in app/_layout.tsx, since Metro
 * evaluates a module's imports before its own body runs. app/_layout.tsx is
 * the ROOT route expo-router loads first, before any error boundary exists
 * to catch a failure (the three fixes below it — createAppKit's own
 * try/catch, globalErrorHandler.ts's unhandled-rejection guard, and
 * WalletConnectErrorBoundary — each cover a DIFFERENT failure mode of this
 * same SDK, but all three only guard code that runs AFTER these imports
 * already succeeded). If any of these comparatively young, native-heavy
 * SDKs throws during its own top-level module evaluation in a production
 * Hermes bundle, that throw has no error boundary to land in — Metro's
 * require() for app/_layout.tsx itself comes back unusable, and
 * expo-router's root-route loader crashes the entire app on launch with no
 * usable error message. require()'ing everything lazily here, inside the
 * SAME try/catch that already guarded createAppKit()'s own call, closes the
 * one remaining gap: a failure anywhere in this chain — import or call —
 * now degrades to local-wallet-only instead of an unrecoverable crash.
 */
export const appKit = (() => {
  if (!WALLETCONNECT_PROJECT_ID) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- bewusst spaet geladen (siehe Kommentar ueber appKit)
    require('@walletconnect/react-native-compat');
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- bewusst spaet geladen (siehe Kommentar ueber appKit)
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    const { createAppKit, EthersAdapter } = getAppKitModules();

    const asyncStorageAdapter: Storage = {
      getKeys: async () => [...(await AsyncStorage.getAllKeys())],
      getEntries: async () => {
        const keys = await AsyncStorage.getAllKeys();
        const pairs = await AsyncStorage.multiGet(keys);
        return pairs.map(([k, v]: [string, string | null]) => [k, v ? JSON.parse(v) : undefined]);
      },
      getItem: async (key: string) => {
        const v = await AsyncStorage.getItem(key);
        return v ? JSON.parse(v) : undefined;
      },
      setItem: async (key: string, value: unknown) => {
        await AsyncStorage.setItem(key, JSON.stringify(value));
      },
      removeItem: async (key: string) => {
        await AsyncStorage.removeItem(key);
      },
    };

    return createAppKit({
      projectId: WALLETCONNECT_PROJECT_ID,
      networks: [aequitasNetwork, anchorNetwork],
      defaultNetwork: aequitasNetwork,
      adapters: [new EthersAdapter()],
      storage: asyncStorageAdapter,
      metadata: {
        name: 'Aequitas',
        description: 'Aequitas — Decentralized Human Currency',
        url: WEBAPP,
        icons: [WEBAPP + '/favicon.png'],
        redirect: { native: 'aequitasapp://' },
      },
      // onramp ("Buy Crypto") has no fiat on-ramp behind it for AEQ -- it's
      // dead, confusing clutter in AppKit's own account menu. swaps is off
      // for the same reason (single-chain app, nothing to swap against).
      // There's no equivalent flag for the network-picker row or "Send";
      // patches/@reown+appkit-react-native+*.patch disables both (the row
      // no longer opens AppKit's switch-only network view, "Send" is gone --
      // sending goes through the app's own chain-checked screen).
      // aequitasNetzEinrichten (lib/signer.ts) does the real chain setup.
      features: { onramp: false, swaps: false },
    });
  } catch (err) {
    console.error('WalletConnect/AppKit setup failed — continuing without it', err);
    return null;
  }
})();

// Split out so both this module and _layout.tsx's <AppKit/> render can
// share one lazy require() of the (heavy, optional) SDK without either one
// risking a top-level import.
function getAppKitModules() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const appkit = require('@reown/appkit-react-native');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ethersAdapter = require('@reown/appkit-ethers-react-native');
  return { ...appkit, EthersAdapter: ethersAdapter.EthersAdapter };
}

/**
 * Wipes every AsyncStorage key this app has — safe because AsyncStorage in
 * this app is used exclusively by createAppKit()'s `storage` adapter above
 * (grep confirms nothing else in the codebase touches AsyncStorage; the
 * local wallet lives in expo-secure-store, untouched by this).
 *
 * Why this exists: a WalletConnect session that accumulates unresolved
 * requests (e.g. a `personal_sign` whose response the SDK failed to route
 * back to the caller — confirmed on-device via logcat: "emitting
 * session_request:<id> without any listeners" for BOTH old and freshly-sent
 * requests) leaves the connected wallet app permanently rejecting new
 * requests for that same session with `-32002 "already pending... please
 * wait"`. The SDK's own disconnect() doesn't reliably clear that — the
 * persisted `wc@2:*` keys keep replaying the stuck request on every app
 * boot. A full storage wipe + fresh pairing is the only reliable way back to
 * a working state once a session gets into this wedged condition.
 */
export async function resetWalletConnectStorage(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- bewusst spaet geladen (siehe Kommentar ueber appKit)
  const AsyncStorage = require('@react-native-async-storage/async-storage').default;
  await AsyncStorage.clear();
}

const AEQUITAS_KETTE: KettenAngaben = {
  chainId: CHAIN_ID_HEX,
  chainName: 'Aequitas Chain',
  nativeCurrency: NATIVE_CURRENCY,
  rpcUrls: [RPC_URL],
  blockExplorerUrls: [WEBAPP],
};

export function useWalletConnect() {
  // Only ever rendered from WalletConnectBridge, itself only mounted when
  // appKit is truthy (see WalletContext.tsx) — by that point this require()
  // has already succeeded once (appKit's own IIFE above), so this just
  // returns the cached module, never re-runs the risky import.
  const { useAppKit, useAccount, useProvider } = getAppKitModules();
  const { open, close, disconnect } = useAppKit();
  const konto = useAccount();
  const { provider } = useProvider();

  // LIVE-Sitzung statt AppKit-Kopie.
  //
  // Vorfall 01.10.2026 (1.8.8 am Geraet, Quelltext von AppKit 2.0.5 und
  // MetaMask Mobile nachgelesen):
  // - useProvider() liefert fuer WalletConnect eine KOPIE des
  //   UniversalProvider (`{ ...provider }`, WalletConnectConnector.getProvider).
  //   Deren `session` aendert sich nie -- die Freigabe der Aequitas-Kette per
  //   session_update kam dort nie an, das Warten darauf lief immer ins Leere.
  //   Der SignClient (`client`) ist dagegen derselbe; sein Sitzungsspeicher
  //   ist live.
  // - useAccount() meldet nur das Konto auf AppKits aktiver Kette (Aequitas).
  //   Hat MetaMask das Netz noch nicht, fehlt es in der Sitzung -> keine
  //   Adresse -> die App hielt die Wallet fuer nicht verbunden und begann
  //   die Netzeinrichtung nie (AppKit-Fenster blieb auf dem Startbildschirm).
  //   Die Adresse kommt darum aus der Sitzung selbst.
  const p: any = provider;
  const client: any = p?.client ?? null;
  const topic: string | undefined = typeof p?.session?.topic === 'string' ? p.session.topic : undefined;
  const liveRef = useRef<{ client: any; topic?: string; provider: any }>({ client, topic, provider: p });
  liveRef.current = { client, topic, provider: p };
  // Kette, die die Wallet zuletzt als aktiv gemeldet hat (chainChanged).
  const walletKetteRef = useRef<string | null>(null);

  const sitzung = () => {
    const { client: c, topic: t } = liveRef.current;
    if (!c?.session?.get || !t) return undefined;
    try {
      return c.session.get(t);
    } catch {
      return undefined; // Sitzung beendet
    }
  };
  const ketten = () => kettenDerSitzung(sitzung());

  // Bei jeder Aenderung der Sitzung neu zeichnen (Freigabe, Kontowechsel,
  // Trennen) und die aktive Kette der Wallet mitschreiben.
  const [, setStand] = useState(0);
  useEffect(() => {
    if (!client?.on) return;
    const neu = () => setStand((n) => (n + 1) % 1_000_000);
    const ereignis = (e: any) => {
      if (e?.topic !== liveRef.current.topic) return;
      const name = e?.params?.event?.name;
      const kette = e?.params?.chainId;
      if (name === 'chainChanged' && typeof kette === 'string' && /^eip155:[0-9]{1,12}$/.test(kette)) {
        walletKetteRef.current = kette;
      }
      neu();
    };
    client.on('session_update', neu);
    client.on('session_delete', neu);
    client.on('session_event', ereignis);
    return () => {
      client.off?.('session_update', neu);
      client.off?.('session_delete', neu);
      client.off?.('session_event', ereignis);
    };
  }, [client]);

  const sitzungsAdresse = adresseDerSitzung(sitzung());
  const address: string | undefined = konto.address || sitzungsAdresse || undefined;
  const isConnected = !!address && (!!konto.isConnected || !!sitzungsAdresse);

  // Anfrage an die Wallet ueber den SignClient: genau diese Kette als
  // Leitweg, keine Sonderbehandlung durch den UniversalProvider (der
  // beantwortet wallet_switchEthereumChain/eth_chainId sonst selbst). Der
  // SignClient prueft Kette und Methode gegen die Sitzung und oeffnet die
  // Wallet-App (Deep Link).
  const senden = (method: string, params: unknown[], weg: string) => {
    const { client: c, topic: t, provider: prov } = liveRef.current;
    if (c?.request && t) return c.request({ topic: t, chainId: weg, request: { method, params } });
    if (prov?.request) return prov.request({ method, params }, weg);
    return Promise.reject(new Error('No active WalletConnect provider'));
  };
  // Ohne eigene Vorgabe: Aequitas, wenn freigegeben, sonst die zuletzt aktive
  // bzw. erste freigegebene Kette (personal_sign ist kettenunabhaengig).
  const standardWeg = () => {
    const alle = ketten();
    if (alle.includes(AEQUITAS_CAIP)) return AEQUITAS_CAIP;
    const w = walletKetteRef.current;
    return w && alle.includes(w) ? w : alle[0] ?? AEQUITAS_CAIP;
  };
  const rawRequest: WcRequest | null = provider
    ? (args, chainId) => senden(args.method, args.params, chainId ?? standardWeg())
    : null;

  const einrichten = () =>
    aequitasNetzEinrichten({
      senden,
      ketten,
      walletKette: () => walletKetteRef.current,
      kette: AEQUITAS_KETTE,
    });

  // Wallet hat Aequitas freigegeben, steht aber auf einem anderen Netz und
  // lehnt ab (aeltere MetaMask): einmal ausdruecklich umschalten.
  const umschalten = async () => {
    const alle = ketten();
    const w = walletKetteRef.current;
    const wege = [...new Set([...(w && alle.includes(w) ? [w] : []), AEQUITAS_CAIP, ...alle])].filter((k) => alle.includes(k));
    let letzter: unknown = null;
    for (const weg of wege.slice(0, 8)) {
      try {
        await withTimeout(senden('wallet_switchEthereumChain', [{ chainId: CHAIN_ID_HEX }], weg), 90_000, WALLET_ANTWORTET_NICHT);
        return;
      } catch (e) {
        if (istAbgelehnt(e) || (e as any)?.message === WALLET_ANTWORTET_NICHT) throw e;
        letzter = e;
      }
    }
    if (letzter) throw letzter;
  };

  // Rueckkehr aus der Wallet: ist die Relay-Verbindung im Hintergrund
  // abgerissen, neu aufbauen -- sonst kommt die Antwort der Wallet (und ihr
  // session_update) erst mit der naechsten eigenen Anfrage an.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st !== 'active') return;
      const relayer = liveRef.current.client?.core?.relayer;
      if (relayer && relayer.connected === false && typeof relayer.transportOpen === 'function') {
        relayer.transportOpen().catch(() => {});
      }
    });
    return () => sub.remove();
  }, []);

  const signer: AequitasSigner | null =
    isConnected && address && rawRequest ? walletConnectSigner(address, rawRequest, ketten, einrichten, umschalten) : null;

  // Beim Verbinden: Netz einrichten. Ist Aequitas in der Sitzung schon
  // freigegeben, geht KEINE Anfrage an die Wallet (kein Aufspringen von
  // MetaMask bei jedem App-Start).
  const ensureNetwork = async () => {
    if (!liveRef.current.provider) throw new Error('No active WalletConnect provider');
    await einrichten();
  };

  return { open, close, disconnect, address, isConnected, signer, ensureNetwork, topic };
}
