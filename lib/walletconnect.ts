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
// Persisted once wallet_addEthereumChain has ever succeeded, so a returning
// connection can be recognized without guessing from wallet state alone.
const CHAIN_SETUP_DONE_KEY = 'aequitas_chain_setup_done_v1';

export async function ensureAequitasChain(request: WcRequest): Promise<void> {
  const AsyncStorage = require('@react-native-async-storage/async-storage').default;
  const setUpBefore = (await AsyncStorage.getItem(CHAIN_SETUP_DONE_KEY)) === '1';

  // Real-device report: even a RETURNING connection (wallet already has the
  // chain added and active) re-ran the full switch/add/switch dance below
  // every single time, each step its own round trip to the external wallet
  // app — this is the "have to select the Aequitas chain again" complaint.
  // eth_chainId is a read-only EIP-1193 query wallets answer immediately
  // with no approval prompt, so checking it first turns the already-set-up
  // case into a single cheap call instead of up to three round trips. Only
  // worth trying once this flow has actually completed successfully before
  // — on a genuine first-ever connection it's guaranteed to mismatch, so
  // skipping it entirely below saves that wasted round trip on the
  // already-friction-heaviest path.
  if (setUpBefore) {
    try {
      const current = await request({ method: 'eth_chainId', params: [] });
      if (typeof current === 'string' && current.toLowerCase() === CHAIN_ID_HEX.toLowerCase()) {
        return;
      }
    } catch {
      // Some wallets/relays may not answer this either — fall through to
      // the normal switch/add flow below, same as any other failure here.
    }

    try {
      await request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_ID_HEX }] });
      return;
    } catch {
      // The wallet apparently lost the chain since last time (reset,
      // reinstalled, different account) — fall through and add it again,
      // same as a genuine first-ever connection below.
    }
  }

  // Real-device report: "when connecting for the first time, everything
  // must complete in one go" — not the repeated app <-> MetaMask
  // round-tripping this flow used to do. On a genuine first connection the
  // wallet cannot possibly already have this custom chain, so trying
  // wallet_switchEthereumChain first (as AppKit's own broken flow does, and
  // as this function used to unconditionally do too) is a guaranteed,
  // wasted round trip: per EIP-3326 a wallet that's never heard of a
  // chainId rejects it instantly (see this function's top comment).
  // wallet_addEthereumChain is the ONE request that can actually succeed
  // here, and MetaMask (the wallet this flow is built and tested against)
  // switches to the newly added chain automatically as part of approving
  // it — so this single call, and the single approval screen it shows, is
  // the entire first-time setup. No follow-up confirmatory switch call: on
  // a wallet that doesn't auto-switch after adding, that call would just be
  // yet another app-switch round trip the user would experience as more of
  // exactly the back-and-forth being fixed here.
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

  await AsyncStorage.setItem(CHAIN_SETUP_DONE_KEY, '1');
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
