import { ethers } from 'ethers';
import * as wallet from './wallet';

/**
 * Uniform signing interface so screens don't care whether the active wallet
 * is our own in-app SecureStore-backed key or a WalletConnect session.
 */
export interface AequitasSigner {
  address: string;
  kind: 'local' | 'walletconnect';
  /** MetaMask-personal_sign-compatible: plain text -> UTF-8, "0x..." hex -> raw bytes. */
  signMessage(message: string): Promise<string>;
  /** Sends a native AEQ transfer, returns the tx hash. */
  sendTransaction(params: { to: string; value: bigint }): Promise<string>;
}

export function localWalletSigner(address: string): AequitasSigner {
  return {
    address,
    kind: 'local',
    signMessage: (message: string) => wallet.signMessage(message),
    sendTransaction: ({ to, value }) => wallet.sendAEQ(to, value),
  };
}

export function walletConnectSigner(
  address: string,
  request: (args: { method: string; params: unknown[] }) => Promise<any>
): AequitasSigner {
  return {
    address,
    kind: 'walletconnect',
    // FIX (Monster Audit follow-up, 2026-07-12, P2): used to forward `message`
    // straight through as personal_sign's params[0] regardless of whether it
    // was plain text or an already-hex-encoded digest — unlike localWalletSigner
    // (see wallet.ts's signMessage, which explicitly disambiguates the two).
    // Per EIP-1193/JSON-RPC, personal_sign's first param is meant to be a
    // 0x-hex byte string; ethers' own JsonRpcSigner.signMessage always
    // hex-encodes before sending, and this interface's own doc comment
    // claims the same "MetaMask-personal_sign-compatible" contract — so this
    // path's correctness for plain-text messages (every trade.tsx/wallet.tsx
    // signed-message string) rested entirely on the connected wallet's own
    // leniency in guessing a non-hex params[0] is UTF-8 text, not on spec
    // compliance. Mirrors wallet.ts's exact isHex check: an already-"0x..."
    // message (e.g. identity.ts's messageHash) is passed through as-is (it's
    // already the correct byte representation); plain text is hex-encoded
    // first.
    signMessage: (message: string) => {
      const isHex = /^0x[0-9a-fA-F]+$/.test(message);
      const hexMessage = isHex ? message : ethers.hexlify(ethers.toUtf8Bytes(message));
      return request({ method: 'personal_sign', params: [hexMessage, address] });
    },
    sendTransaction: async ({ to, value }) => {
      const hexValue = '0x' + value.toString(16);
      return request({
        method: 'eth_sendTransaction',
        params: [{ from: address, to, value: hexValue }],
      });
    },
  };
}

/**
 * WalletConnect's request() can hang forever with no error and no rejection
 * if the relay socket doesn't recover after the app backgrounds (to let the
 * user confirm in their external wallet) and foregrounds again — nothing in
 * @reown/appkit-react-native or @walletconnect/core listens for that
 * transition to force a reconnect. Without this, a stalled response looks to
 * the user like "I confirmed and nothing happened" with zero feedback.
 * Racing every signer call against a timeout turns that silent hang into a
 * visible, retryable error instead.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, timeoutMessage: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(timeoutMessage)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}
