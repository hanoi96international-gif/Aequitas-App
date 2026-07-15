import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as localWallet from '../lib/wallet';
import { localWalletSigner, withTimeout, type AequitasSigner } from '../lib/signer';
import { appKit, resetWalletConnectStorage, useWalletConnect } from '../lib/walletconnect';
import { getBalance, getStatus, type BalanceResponse, type ChainStatus } from '../lib/api';
import { useLanguage } from './LanguageContext';

type WalletMode = 'none' | 'local' | 'walletconnect';
export type NetworkStatus = 'idle' | 'pending' | 'ready' | 'error';

interface WCState {
  open: () => void;
  close: () => void;
  disconnect: () => void;
  address: string | undefined;
  isConnected: boolean;
  signer: AequitasSigner | null;
  ensureNetwork: () => Promise<void>;
}

interface WalletContextValue {
  mode: WalletMode;
  address: string | null;
  signer: AequitasSigner | null;
  balance: BalanceResponse | null;
  status: ChainStatus | null;
  hydrating: boolean;
  walletConnectAvailable: boolean;
  networkStatus: NetworkStatus;
  networkError: string | null;
  createLocalWallet: (mnemonic: string) => Promise<{ address: string; mnemonic?: string }>;
  importLocalWallet: (secret: string) => Promise<void>;
  openWalletConnect: () => Promise<void>;
  disconnectWallet: () => Promise<void>;
  refreshBalance: () => Promise<void>;
  retryNetworkSetup: () => void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

function WalletConnectBridge({ onChange }: { onChange: (s: WCState) => void }) {
  const wc = useWalletConnect();
  useEffect(() => {
    onChange(wc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wc.address, wc.isConnected]);
  return null;
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const { t } = useLanguage();
  const [mode, setMode] = useState<WalletMode>('none');
  const [localAddress, setLocalAddress] = useState<string | null>(null);
  const [wcState, setWcState] = useState<WCState | null>(null);
  const [balance, setBalance] = useState<BalanceResponse | null>(null);
  const [status, setStatus] = useState<ChainStatus | null>(null);
  const [hydrating, setHydrating] = useState(true);
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus>('idle');
  const [networkError, setNetworkError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const stored = await localWallet.getStoredAddress();
        if (stored) {
          setLocalAddress(stored);
          setMode('local');
        }
      } catch (err) {
        // SecureStore unavailable/failed on this device — fall through to
        // the onboarding flow instead of leaving hydrating stuck true
        // forever (Navigation() renders nothing while hydrating).
        console.error('getStoredAddress failed', err);
      } finally {
        setHydrating(false);
      }
    })();
  }, []);

  // Guards against a stale runNetworkSetup call's result landing after a
  // newer one already did — see the AppState effect below, which can start a
  // fresh attempt while an old one (from before the app backgrounded) is
  // still technically in flight.
  const setupGenRef = useRef(0);

  const runNetworkSetup = useCallback(async (wc: WCState) => {
    const gen = ++setupGenRef.current;
    // AppKit's own connect modal may still be open (e.g. showing its broken
    // "network not supported" loop — see ensureAequitasChain's comment) —
    // close it so our own overlay is the one clear thing the user sees,
    // instead of two competing screens stacked on top of each other.
    //
    // FIX (race condition, real-device report: AppKit's broken "Select
    // network" screen — the exact one ensureAequitasChain exists to bypass
    // — was still reachable/tappable after connecting): close() used to
    // only fire from a SEPARATE effect that waited for `mode` to become
    // 'walletconnect' first, which only happened after THIS effect's own
    // trigger effect had already run and scheduled a state update — an
    // extra render cycle during which AppKit's modal, already mid-
    // transition into its own network-selector sub-screen, was still the
    // only interactive thing on screen. Calling close() directly from the
    // same effect that detects the connection (see the trigger effect
    // below, which now calls this immediately) removes that gap. A second,
    // delayed close() call covers the case where AppKit was still
    // animating into that sub-screen at the moment of the first call.
    try {
      wc.close();
    } catch {
      // best-effort — not fatal if AppKit's modal wasn't open or close() no-ops
    }
    setTimeout(() => {
      try {
        wc.close();
      } catch {
        // best-effort, see above
      }
    }, 400);
    setNetworkStatus('pending');
    setNetworkError(null);
    try {
      await withTimeout(wc.ensureNetwork(), 60_000, t('trade.signTimeout'));
      if (gen !== setupGenRef.current) return;
      setNetworkStatus('ready');
    } catch (e: any) {
      if (gen !== setupGenRef.current) return;
      setNetworkStatus('error');
      setNetworkError(e?.message ?? t('identity.logUnknownError'));
    }
  }, [t]);

  // WalletConnect taking over (or dropping) supersedes/clears local mode
  // display, AND — combined into the same effect, not a separate one keyed
  // off `mode` — immediately drives the switch/add-chain flow ourselves the
  // moment a session connects (see runNetworkSetup's comment for why this
  // used to be split across two effects and what race that caused). A
  // fresh WalletConnect connection may land on a wallet that has never
  // added the Aequitas chain; AppKit's built-in "switch network" screen can
  // never fix that on its own (see ensureAequitasChain's own comment), so
  // waiting for the user to hit it means watching it fail.
  useEffect(() => {
    if (wcState?.isConnected && wcState.address) {
      setMode('walletconnect');
      runNetworkSetup(wcState);
    } else {
      setNetworkStatus('idle');
      setNetworkError(null);
      if (mode === 'walletconnect') {
        setMode(localAddress ? 'local' : 'none');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wcState?.isConnected, wcState?.address]);

  const retryNetworkSetup = useCallback(() => {
    if (wcState) runNetworkSetup(wcState);
  }, [wcState, runNetworkSetup]);

  // Real-device report: network setup reliably times out on the FIRST
  // attempt (which spans the app backgrounding for the user to approve in
  // MetaMask and foregrounding again), then reliably succeeds the moment the
  // user notices the error and manually taps retry. See withTimeout's own
  // comment in lib/signer.ts: the WalletConnect relay socket doesn't
  // recover on its own across that background/foreground transition, so the
  // original request can hang until its timeout fires regardless of how
  // long that timeout is — a fresh request issued after foregrounding is
  // what actually succeeds, not a longer wait. Firing that same retry
  // automatically the moment the app comes back to the foreground removes
  // the need for the user to notice the error and tap the button themselves.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && wcState && (networkStatus === 'pending' || networkStatus === 'error')) {
        runNetworkSetup(wcState);
      }
    });
    return () => sub.remove();
  }, [wcState, networkStatus, runNetworkSetup]);

  const address = mode === 'walletconnect' ? wcState?.address ?? null : localAddress;

  const signer: AequitasSigner | null = useMemo(() => {
    if (mode === 'walletconnect') return wcState?.signer ?? null;
    if (mode === 'local' && localAddress) return localWalletSigner(localAddress);
    return null;
  }, [mode, localAddress, wcState?.signer]);

  const refreshBalance = useCallback(async () => {
    if (!address) return;
    try {
      const [b, s] = await Promise.all([getBalance(address), getStatus()]);
      setBalance(b);
      setStatus(s);
    } catch {
      // transient network/API failure — next poll tick will retry
    }
  }, [address]);

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (!address) {
      setBalance(null);
      return;
    }
    refreshBalance();
    pollRef.current = setInterval(refreshBalance, 10_000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [address, refreshBalance]);

  const createLocalWallet = useCallback(async (mnemonic: string) => {
    const info = await localWallet.persistMnemonic(mnemonic);
    setLocalAddress(info.address);
    setMode('local');
    return info;
  }, []);

  const importLocalWallet = useCallback(async (secret: string) => {
    const info = await localWallet.importWallet(secret);
    setLocalAddress(info.address);
    setMode('local');
  }, []);

  const disconnectWallet = useCallback(async () => {
    if (mode === 'walletconnect') {
      // Best-effort tell the wallet/relay first, then unconditionally wipe
      // local WalletConnect storage — see resetWalletConnectStorage's own
      // comment for why the SDK's disconnect() alone isn't reliable enough
      // to guarantee a clean slate for the next connection.
      try {
        await wcState?.disconnect();
      } catch {
        // storage wipe below still runs even if the SDK-side disconnect itself failed
      }
      await resetWalletConnectStorage();
      // FIX (Monster Audit follow-up, 2026-07-12, P1): this used to
      // unconditionally set mode to 'none', leaving localAddress (a
      // still-valid local wallet, if one exists alongside the WalletConnect
      // session — this app supports both at once, see the mode-switching
      // useEffect above) populated but orphaned: address reads localAddress
      // whenever mode isn't 'walletconnect', but signer requires mode to be
      // exactly 'local' or 'walletconnect' — so the UI showed a connected
      // address with a null signer, and every `if (!signer) return` guard
      // (Send, Swap, Faucet, liquidity, Prove Humanity) silently no-opped.
      // Falling back to 'local' when a local wallet still exists matches the
      // exact behavior the automatic wcState-change effect above already
      // uses when a WalletConnect session drops on its own.
      setMode(localAddress ? 'local' : 'none');
    } else if (mode === 'local') {
      await localWallet.deleteWallet();
      setLocalAddress(null);
      setMode('none');
    }
    setBalance(null);
  }, [mode, wcState, localAddress]);

  const openWalletConnect = useCallback(async () => {
    // Real-device report: repeated connection attempts fail with
    // MetaMask's own "Connection declined... can be declined if a
    // previous request is still active" -- exactly the wedged-session
    // symptom resetWalletConnectStorage's own comment documents (a stuck
    // unresolved request in the persisted wc@2:* keys that the SDK's own
    // disconnect() doesn't reliably clear). This button is only ever
    // reachable from onboarding, i.e. only when there's no active
    // connection to protect -- so wiping storage unconditionally right
    // before opening removes any chance of stale state from an earlier
    // attempt blocking this one, instead of leaving the user to
    // rediscover "just retry a few times" on their own each time.
    await resetWalletConnectStorage();
    wcState?.open();
  }, [wcState]);

  const value: WalletContextValue = {
    mode,
    address,
    signer,
    balance,
    status,
    hydrating,
    walletConnectAvailable: appKit != null,
    networkStatus,
    networkError,
    createLocalWallet,
    importLocalWallet,
    openWalletConnect,
    disconnectWallet,
    refreshBalance,
    retryNetworkSetup,
  };

  return (
    <WalletContext.Provider value={value}>
      {children}
      {appKit && <WalletConnectBridge onChange={setWcState} />}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used within a WalletProvider');
  return ctx;
}
