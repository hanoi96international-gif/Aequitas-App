import { CHAIN_ID_DEC, CHAIN_ID_HEX, NATIVE_CURRENCY, RPC_URL, WALLETCONNECT_PROJECT_ID, WEBAPP } from './config';
import { walletConnectSigner, type AequitasSigner } from './signer';
import type { AppKitNetwork, Storage } from '@reown/appkit-react-native';

type WcRequest = (args: { method: string; params: unknown[] }) => Promise<any>;

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
    require('@walletconnect/react-native-compat');
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
      networks: [aequitasNetwork],
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
  const AsyncStorage = require('@react-native-async-storage/async-storage').default;
  await AsyncStorage.clear();
}

/**
 * Gets the connected wallet onto the Aequitas chain, for wallets (MetaMask
 * foremost) that have never heard of it before.
 *
 * Root cause this works around (confirmed by reading the installed SDK's own
 * source, `@reown/appkit-ethers-react-native/src/adapter.ts`): AppKit's
 * built-in network-switch flow — the screen that appears when you tap
 * "Aequitas Chain" in its connect modal — ONLY ever sends
 * `wallet_switchEthereumChain`. It has no fallback to
 * `wallet_addEthereumChain`. Per EIP-3326, a wallet that has never seen a
 * chainId rejects `wallet_switchEthereumChain` for it INSTANTLY with error
 * 4902 and — critically — without ever showing the user any prompt at all.
 * That is exactly "got redirected to MetaMask, then nothing happened": there
 * was nothing for MetaMask to show, and the app has no code path that tries
 * anything else, so it just loops on the same "network not supported"
 * screen forever.
 *
 * `wallet_addEthereumChain` (EIP-3085) is the one request a wallet CAN act
 * on for a totally unknown chain — MetaMask (both extension and mobile, the
 * latter over WalletConnect exactly like this) shows its native "Add this
 * network" approval screen for it. Both methods are already declared in
 * this app's WalletConnect session namespace (AppKit's own
 * `DEFAULT_METHODS.eip155` includes both), so sending `wallet_addEthereumChain`
 * ourselves needs no session/pairing changes — only this explicit call,
 * which nothing in the SDK makes on its own.
 */
export async function ensureAequitasChain(request: WcRequest): Promise<void> {
  try {
    await request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_ID_HEX }] });
    return;
  } catch {
    // Expected on a wallet that has never added this chain — fall through
    // to add it. Any other switch failure (e.g. the wallet really did
    // reject) will also surface below, from the add or the final re-switch.
  }

  await request({
    method: 'wallet_addEthereumChain',
    params: [
      {
        chainId: CHAIN_ID_HEX,
        chainName: 'Aequitas Chain',
        nativeCurrency: NATIVE_CURRENCY,
        rpcUrls: [RPC_URL],
        blockExplorerUrls: [WEBAPP],
      },
    ],
  });

  // MetaMask switches to a chain automatically as part of approving the add,
  // but send an explicit follow-up so we don't silently continue against
  // the wrong chain if a particular wallet needs it as a separate step —
  // and so a genuine failure here (rather than being swallowed) surfaces to
  // the caller as a real, retryable error.
  await request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_ID_HEX }] });
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

  const rawRequest: WcRequest | null = provider ? (args) => provider.request(args) : null;

  const signer: AequitasSigner | null =
    isConnected && address && rawRequest ? walletConnectSigner(address, rawRequest) : null;

  const ensureNetwork = async () => {
    if (!rawRequest) throw new Error('No active WalletConnect provider');
    await ensureAequitasChain(rawRequest);
  };

  return { open, close, disconnect, address, isConnected, signer, ensureNetwork };
}
