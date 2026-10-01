import { CHAIN_ID_DEC, CHAIN_ID_HEX, NATIVE_CURRENCY, RPC_URL, WALLETCONNECT_PROJECT_ID, WEBAPP } from './config';
import { AEQUITAS_CAIP, NETZ_NICHT_FREIGEGEBEN, sitzungsKetten, walletAufAequitasSchalten, walletConnectSigner, type AequitasSigner } from './signer';
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
      // There's no equivalent flag for the network-picker row or "Send" --
      // those stay, they're just not ones a user should ever need to touch
      // since ensureAequitasChain already handles the real chain setup.
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

export function useWalletConnect() {
  // Only ever rendered from WalletConnectBridge, itself only mounted when
  // appKit is truthy (see WalletContext.tsx) — by that point this require()
  // has already succeeded once (appKit's own IIFE above), so this just
  // returns the cached module, never re-runs the risky import.
  const { useAppKit, useAccount, useProvider } = getAppKitModules();
  const { open, close, disconnect } = useAppKit();
  const { address, isConnected } = useAccount();
  const { provider } = useProvider();

  // Routing-Kette jeder Anfrage ohne eigene Vorgabe: die Aequitas-Kette,
  // sobald die Wallet sie fuer die Sitzung freigegeben hat, sonst
  // anchorNetwork (siehe dessen Kommentar) -- damit ensureAequitasChain und
  // personal_sign auch vor der Freigabe gueltig geleitet werden. MetaMask
  // Mobile nimmt die Routing-Kette als aktives Netz; ueber den Anker
  // bliebe die Wallet auf Ethereum. Kettengebundene Anfragen legen die
  // Aequitas-Kette selbst fest (walletConnectSigner).
  const ketten = () => sitzungsKetten(provider);
  const rawRequest: WcRequest | null = provider
    ? (args, chainId) =>
        provider.request(args, chainId ?? (ketten().includes(AEQUITAS_CAIP) ? AEQUITAS_CAIP : anchorNetwork.caipNetworkId))
    : null;

  // wallet_switchEthereumChain DIREKT an die Wallet.
  //
  // Vorfall 01.10.2026: Der UniversalProvider (@walletconnect/universal-
  // provider, handleSwitchChain) beantwortet einen Wechsel auf eine Kette,
  // die in der Sitzung freigegeben ist, SELBST -- er setzt nur seine eigene
  // Standardkette, die Anfrage erreicht MetaMask nie. Ebenso eth_chainId: das
  // ist die Standardkette des Providers, nicht das Netz in der Wallet.
  // MetaMask blieb so auf Ethereum und lehnte die Unterschrift fuer 1926 mit
  // "Invalid chainId" ab. Hier geht der Wechsel ueber den SignClient an die
  // Wallet. Geleitet wird er nacheinander ueber jede freigegebene Kette
  // (zuerst Aequitas), denn MetaMask nimmt Anfragen nur fuer das gerade
  // ausgewaehlte Netz an -- und welches das ist, laesst sich vorher nicht
  // erfragen. Hoechstens so viele Versuche, wie die Sitzung Ketten hat;
  // lehnt der Mensch ab, sofort Schluss.
  const walletAufAequitas = async () => {
    const p: any = provider;
    const topic = p?.session?.topic;
    const kette = {
      chainId: CHAIN_ID_HEX,
      chainName: 'Aequitas Chain',
      nativeCurrency: NATIVE_CURRENCY,
      rpcUrls: [RPC_URL],
      blockExplorerUrls: [WEBAPP],
    };
    const senden = p?.client?.request && topic
      ? (method: string, params: unknown[], weg: string) => p.client.request({ topic, chainId: weg, request: { method, params } })
      : (method: string, params: unknown[], weg: string) => rawRequest!({ method, params }, weg);
    // MetaMask nimmt eine Anfrage nur ueber das Netz an, das sie gerade
    // ausgewaehlt hat. Am wahrscheinlichsten: Hat sie Aequitas fuer die
    // Verbindung freigegeben, steht sie auch darauf; sonst steht sie auf
    // Ethereum (dem Anker). Diesen Leitweg zuerst, die uebrigen danach.
    const alle = ketten();
    const zuerst = alle.includes(AEQUITAS_CAIP) ? AEQUITAS_CAIP : anchorNetwork.caipNetworkId;
    const wege = [zuerst, ...alle.filter((k) => k !== zuerst)];
    await walletAufAequitasSchalten(senden, wege, kette);
    // MetaMask gibt das neue Netz der Verbindung per session_update frei;
    // das kann einen Moment dauern. Hoechstens 10 s warten.
    for (let i = 0; i < 20 && !ketten().includes(AEQUITAS_CAIP); i++) {
      await new Promise((r) => setTimeout(r, 500));
    }
  };

  const signer: AequitasSigner | null =
    isConnected && address && rawRequest ? walletConnectSigner(address, rawRequest, ketten, walletAufAequitas) : null;

  // Beim Verbinden: IMMER direkt an die Wallet (walletAufAequitas). Frueher
  // fragte der Weg fuer "noch nicht freigegeben" zuerst eth_chainId und
  // wechselte dann nur -- beides beantwortet bzw. leitet der Provider selbst,
  // und eine Wallet ohne Aequitas-Netz lehnte den Wechsel ab ("Switch
  // declined", Vorfall 01.10.2026). Kennt die Wallet das Netz schon und steht
  // darauf, kommt keine Abfrage.
  //
  // Pro Verbindung (Sitzungs-Topic) nur einmal: sonst spraenge MetaMask bei
  // jedem App-Start auf. Steht die Wallet spaeter doch auf einem anderen
  // Netz, holt das der Unterschriftsweg nach (walletConnectSigner).
  const ensureNetwork = async () => {
    if (!rawRequest) throw new Error('No active WalletConnect provider');
    const topic: string | undefined = (provider as any)?.session?.topic;
    const merker = topic && /^[0-9a-f]{64}$/.test(topic) ? `aequitas_netz_ok_${topic}` : null;
    const AsyncStorage = require('@react-native-async-storage/async-storage').default; // eslint-disable-line @typescript-eslint/no-require-imports
    if (merker && ketten().includes(AEQUITAS_CAIP)) {
      try {
        if ((await AsyncStorage.getItem(merker)) === '1') return;
      } catch {
        // ohne Merker einfach einrichten
      }
    }
    await walletAufAequitas();
    if (!ketten().includes(AEQUITAS_CAIP)) throw new Error(NETZ_NICHT_FREIGEGEBEN);
    if (merker) {
      try {
        await AsyncStorage.setItem(merker, '1');
      } catch {
        // nur Bequemlichkeit
      }
    }
  };

  return { open, close, disconnect, address, isConnected, signer, ensureNetwork };
}
