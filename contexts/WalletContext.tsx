import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
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
  openWalletConnect: () => void;
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

  // WalletConnect taking over (or dropping) supersedes/clears local mode display.
  useEffect(() => {
    if (wcState?.isConnected && wcState.address) {
      setMode('walletconnect');
    } else if (mode === 'walletconnect') {
      setMode(localAddress ? 'local' : 'none');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wcState?.isConnected, wcState?.address]);

  const runNetworkSetup = useCallback(async (wc: WCState) => {
    // AppKit's own connect modal may still be open (e.g. showing its broken
    // "network not supported" loop — see ensureAequitasChain's comment) —
    // close it so our own overlay is the one clear thing the user sees,
    // instead of two competing screens stacked on top of each other.
    try {
      wc.close();
    } catch {
      // best-effort — not fatal if AppKit's modal wasn't open or close() no-ops
    }
    setNetworkStatus('pending');
    setNetworkError(null);
    try {
      await withTimeout(wc.ensureNetwork(), 60_000, t('trade.signTimeout'));
      setNetworkStatus('ready');
    } catch (e: any) {
      setNetworkStatus('error');
      setNetworkError(e?.message ?? t('identity.logUnknownError'));
    }
  }, [t]);

  // A fresh WalletConnect connection may land on a wallet that has never
  // added the Aequitas chain (see ensureAequitasChain's own comment for why
  // AppKit's built-in "switch network" screen can never fix that on its
  // own). Drive the switch/add-chain flow ourselves the moment a session
  // connects, instead of waiting for the user to hit — and get stuck on —
  // AppKit's own unsupported-chain loop.
  useEffect(() => {
    if (mode !== 'walletconnect' || !wcState) {
      setNetworkStatus('idle');
      setNetworkError(null);
      return;
    }
    runNetworkSetup(wcState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, wcState]);

  const retryNetworkSetup = useCallback(() => {
    if (wcState) runNetworkSetup(wcState);
  }, [wcState, runNetworkSetup]);

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

  const openWalletConnect = useCallback(() => {
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
