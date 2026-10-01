import { ethers } from 'ethers';
import { CHAIN_ID_DEC, CHAIN_ID_HEX } from './config';
import * as wallet from './wallet';

/** CAIP-2-Kennung der Aequitas-Kette, unter der WalletConnect Anfragen leitet. */
export const AEQUITAS_CAIP = `eip155:${CHAIN_ID_DEC}`;

export const NETZ_NICHT_FREIGEGEBEN =
  'Deine Wallet hat das Aequitas-Netz für diese Verbindung nicht freigegeben. Bitte die Wallet trennen, neu verbinden und dabei „Aequitas Chain“ bestätigen.';

type WcRequest = (args: { method: string; params: unknown[] }, chainId?: string) => Promise<any>;

/**
 * Ketten, die die Wallet fuer diese Sitzung freigegeben hat (CAIP-2), aus
 * `session.namespaces.eip155` des UniversalProvider -- aus `chains` und aus
 * den Konten (`eip155:<kette>:<adresse>`). Liest bei jedem Aufruf neu: Fuegt
 * die Wallet nach wallet_addEthereumChain die Kette per session_update
 * hinzu, steht sie hier. Unbekannte Form -> leere Liste.
 */
export function sitzungsKetten(provider: unknown): string[] {
  const ns = (provider as any)?.session?.namespaces?.eip155;
  const ketten = new Set<string>();
  for (const k of Array.isArray(ns?.chains) ? ns.chains : []) {
    if (typeof k === 'string' && /^eip155:[0-9]+$/.test(k)) ketten.add(k);
  }
  for (const a of Array.isArray(ns?.accounts) ? ns.accounts : []) {
    const m = typeof a === 'string' ? /^(eip155:[0-9]+):0x[0-9a-fA-F]{40}$/.exec(a) : null;
    if (m) ketten.add(m[1]);
  }
  return [...ketten];
}

/** Lehnt die Wallet ab, weil in ihr ein anderes Netz ausgewaehlt ist? */
export function istFalscheKette(e: unknown): boolean {
  const text = String((e as any)?.message ?? e ?? '');
  return /invalid chain ?id|chainid is different|chain mismatch|must match the active chainid/i.test(text);
}

export const NETZ_FEHLT_IN_WALLET =
  'Deine Wallet konnte nicht auf das Aequitas-Netz wechseln. Bitte in der Wallet das Netz hinzufügen (Name: Aequitas Chain, RPC: https://aequitas.digital/rpc, Chain-ID: 1926, Symbol: AEQ), auswählen und erneut versuchen.';

/** Kennt die Wallet die Kette nicht? (EIP-3326: 4902) */
export function istUnbekannteKette(e: unknown): boolean {
  const code = (e as any)?.code ?? (e as any)?.data?.originalError?.code;
  const text = String((e as any)?.message ?? e ?? '');
  return code === 4902 || /unrecognized chain|unknown chain|not been added|try adding the chain|4902/i.test(text);
}

type Senden = (method: string, params: unknown[], weg: string) => Promise<unknown>;

/**
 * Bringt die Wallet auf die Aequitas-Kette -- und legt sie dort an, wenn die
 * Wallet sie nicht kennt.
 *
 * Vorfall 01.10.2026: In MetaMask fehlte das Aequitas-Netz ganz. Ein reiner
 * Wechsel scheitert dann (4902), und MetaMask nimmt jede Anfrage nur fuer
 * das gerade ausgewaehlte Netz an ("Invalid chainId" fuer jeden anderen
 * Leitweg). Darum: je Leitweg (freigegebene Ketten der Sitzung, Aequitas
 * zuerst) erst wechseln; meldet die Wallet "Kette unbekannt", auf demselben
 * Leitweg hinzufuegen (MetaMask wechselt danach selbst). Ein falscher
 * Leitweg -> naechster. Ablehnung durch den Menschen -> sofort Schluss.
 * Hoechstens 8 Leitwege, je hoechstens 2 Anfragen.
 */
export async function walletAufAequitasSchalten(senden: Senden, wege: readonly string[], kette: {
  chainId: string; chainName: string; nativeCurrency: unknown; rpcUrls: string[]; blockExplorerUrls: string[];
}): Promise<void> {
  // EINE Anfrage je Leitweg: wallet_addEthereumChain. Kennt die Wallet das
  // Netz nicht, legt sie es an und wechselt; kennt sie es, bietet sie nur
  // den Wechsel an (EIP-3085, MetaMask). Vorher erst ein Wechsel und dann
  // ein Hinzufuegen -- doppelt so viele Spruenge in die Wallet, und jeder
  // offene Sprung blockiert dort den naechsten.
  for (const weg of wege.slice(0, 8)) {
    try {
      await senden('wallet_addEthereumChain', [kette], weg);
      return;
    } catch (e) {
      if (istAbgelehnt(e)) throw e;
      // Falscher Leitweg (Wallet steht auf einem anderen Netz) oder
      // Ablehnung der Methode: naechster Leitweg.
    }
  }
  throw new Error(NETZ_FEHLT_IN_WALLET);
}

/** Hat der Mensch in der Wallet abgelehnt? (EIP-1193 4001) */
export function istAbgelehnt(e: unknown): boolean {
  const code = (e as any)?.code;
  const text = String((e as any)?.message ?? e ?? '');
  return code === 4001 || /user (rejected|denied)|rejected by user|abgelehnt/i.test(text);
}

/**
 * Uniform signing interface so screens don't care whether the active wallet
 * is our own in-app SecureStore-backed key or a WalletConnect session.
 */
export interface AequitasSigner {
  address: string;
  kind: 'local' | 'walletconnect';
  /** MetaMask-personal_sign-compatible: plain text -> UTF-8, "0x..." hex -> raw bytes. */
  signMessage(message: string): Promise<string>;
  /** EIP-712 (eth_signTypedData_v4). `types` ohne EIP712Domain; Werte duerfen bigint sein. */
  signTypedData(domain: ethers.TypedDataDomain, types: Record<string, readonly ethers.TypedDataField[]>, message: Record<string, unknown>): Promise<string>;
  /** Sends a native AEQ transfer, returns the tx hash. */
  sendTransaction(params: { to: string; value: bigint }): Promise<string>;
}

export function localWalletSigner(address: string): AequitasSigner {
  return {
    address,
    kind: 'local',
    signMessage: (message: string) => wallet.signMessage(message),
    signTypedData: (domain, types, message) => wallet.signTypedData(domain, types, message),
    sendTransaction: ({ to, value }) => wallet.sendAEQ(to, value),
  };
}

/**
 * `freigegebeneKetten` liefert die Ketten, die die Wallet fuer diese Sitzung
 * freigegeben hat (WalletConnect-Namespaces, live -- ein session_update der
 * Wallet landet dort).
 *
 * Kettengebundene Anfragen (EIP-712 mit chainId, Ueberweisung) gehen
 * ausdruecklich ueber die Aequitas-Kette. Vorher liefen alle Anfragen ueber
 * den Routing-Anker eip155:1 (walletconnect.ts); MetaMask Mobile nimmt diese
 * Routing-Kette als aktives Netz und lehnte die V8-Unterschrift ab ("active
 * chainId is different than the one provided") -- und eine Ueberweisung
 * haette es auf Ethereum statt auf Aequitas ausgefuehrt. Fehlt die
 * Aequitas-Kette in der Sitzung, wird nichts gesendet (fail-closed).
 */
export function walletConnectSigner(
  address: string,
  request: WcRequest,
  freigegebeneKetten: () => readonly string[],
  // Schaltet die Wallet SELBST auf die Aequitas-Kette (walletconnect.ts,
  // walletAufAequitas). Fehlt sie, wird nicht nachgeholfen.
  walletWechseln?: () => Promise<void>
): AequitasSigner {
  const aufAequitas = async (args: { method: string; params: unknown[] }) => {
    if (!freigegebeneKetten().includes(AEQUITAS_CAIP)) {
      throw new Error(NETZ_NICHT_FREIGEGEBEN);
    }
    try {
      return await request(args, AEQUITAS_CAIP);
    } catch (e) {
      // Vorfall 01.10.2026 (MetaMask Mobile): "Invalid chainId". Die Kette
      // ist fuer die Sitzung freigegeben, aber in MetaMask ist ein anderes
      // Netz ausgewaehlt; MetaMask lehnt dann jede Anfrage fuer 1926 ab.
      // Einmal wechseln, einmal wiederholen -- nicht mehr.
      if (!walletWechseln || !istFalscheKette(e)) throw e;
      await walletWechseln();
      return request(args, AEQUITAS_CAIP);
    }
  };
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
    // getPayload fuegt EIP712Domain hinzu und schreibt bigints als
    // Dezimaltext -- genau das JSON, das eth_signTypedData_v4 erwartet.
    // Die App unterschreibt nur Domaenen der Aequitas-Kette; eine andere
    // chainId ist ein Fehler im Aufrufer und geht nicht an die Wallet.
    signTypedData: async (domain, types, message) => {
      let kette: bigint | null = null;
      try {
        kette = domain.chainId === undefined || domain.chainId === null ? null : BigInt(domain.chainId);
      } catch {
        kette = null;
      }
      if (kette !== BigInt(CHAIN_ID_DEC)) {
        throw new Error(`EIP-712-Domaene muss chainId ${CHAIN_ID_DEC} tragen`);
      }
      const payload = ethers.TypedDataEncoder.getPayload(domain, types as any, message);
      return aufAequitas({ method: 'eth_signTypedData_v4', params: [address, JSON.stringify(payload)] });
    },
    // chainId im Auftrag: steht die Wallet trotzdem auf einem anderen Netz,
    // lehnt sie ab, statt dort zu senden.
    sendTransaction: async ({ to, value }) => {
      const hexValue = '0x' + value.toString(16);
      return aufAequitas({
        method: 'eth_sendTransaction',
        params: [{ from: address, to, value: hexValue, chainId: CHAIN_ID_HEX }],
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
