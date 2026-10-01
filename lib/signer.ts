import { ethers } from 'ethers';
import { CHAIN_ID_DEC, CHAIN_ID_HEX } from './config';
import * as wallet from './wallet';

/** CAIP-2-Kennung der Aequitas-Kette, unter der WalletConnect Anfragen leitet. */
export const AEQUITAS_CAIP = `eip155:${CHAIN_ID_DEC}`;

export const NETZ_NICHT_FREIGEGEBEN =
  'Deine Wallet kennt das Aequitas-Netz jetzt, hat es aber noch nicht für diese Verbindung freigegeben. Bitte „Erneut versuchen“ tippen und in der Wallet bestätigen.';

type WcRequest = (args: { method: string; params: unknown[] }, chainId?: string) => Promise<any>;

/**
 * Ketten, die die Wallet fuer diese Sitzung freigegeben hat (CAIP-2), aus
 * `session.namespaces.eip155` des UniversalProvider -- aus `chains` und aus
 * den Konten (`eip155:<kette>:<adresse>`). Liest bei jedem Aufruf neu: Fuegt
 * die Wallet nach wallet_addEthereumChain die Kette per session_update
 * hinzu, steht sie hier. Unbekannte Form -> leere Liste.
 */
export function sitzungsKetten(provider: unknown): string[] {
  return kettenDerSitzung((provider as any)?.session);
}

/** Wie sitzungsKetten, aber direkt aus einer Sitzung (SignClient-Store). */
export function kettenDerSitzung(sitzung: unknown): string[] {
  const ns = (sitzung as any)?.namespaces?.eip155;
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

/**
 * Adresse des verbundenen Kontos aus der Sitzung (erstes gueltiges
 * eip155-Konto, mit Pruefsumme), sonst null.
 *
 * Vorfall 01.10.2026 (1.8.8 am Geraet): AppKit meldet eine Adresse nur fuer
 * das Konto auf SEINER aktiven Kette -- das ist die Aequitas-Kette
 * (defaultNetwork). Kennt MetaMask das Netz noch nicht, gibt sie es bei der
 * Verbindung nicht frei; AppKit hat dann keine Adresse, die App hielt die
 * Wallet fuer nicht verbunden und startete die Netzeinrichtung nie. Die
 * Sitzung selbst traegt das Konto aber auf jeder freigegebenen Kette.
 */
export function adresseDerSitzung(sitzung: unknown): string | null {
  const konten = (sitzung as any)?.namespaces?.eip155?.accounts;
  for (const a of Array.isArray(konten) ? konten : []) {
    const m = typeof a === 'string' ? /^eip155:[0-9]+:(0x[0-9a-fA-F]{40})$/.exec(a) : null;
    if (!m) continue;
    try {
      return ethers.getAddress(m[1].toLowerCase());
    } catch {
      // ungueltig -> naechstes Konto
    }
  }
  return null;
}

/** Lehnt die Wallet ab, weil in ihr ein anderes Netz ausgewaehlt ist? */
export function istFalscheKette(e: unknown): boolean {
  const text = String((e as any)?.message ?? e ?? '');
  return /invalid chain ?id|chainid is different|chain mismatch|must match the active chainid/i.test(text);
}

export const NETZ_FEHLT_IN_WALLET =
  'Deine Wallet hat das Aequitas-Netz nicht angelegt. Bitte „Erneut versuchen“ tippen und in der Wallet „Netzwerk hinzufügen“ bestätigen.';

/** Kennt die Wallet die Kette nicht? (EIP-3326: 4902) */
export function istUnbekannteKette(e: unknown): boolean {
  const code = (e as any)?.code ?? (e as any)?.data?.originalError?.code;
  const text = String((e as any)?.message ?? e ?? '');
  return code === 4902 || /unrecognized chain|unknown chain|not been added|try adding the chain|4902/i.test(text);
}

type Senden = (method: string, params: unknown[], weg: string) => Promise<unknown>;

export type KettenAngaben = {
  chainId: string; chainName: string; nativeCurrency: unknown; rpcUrls: string[]; blockExplorerUrls: string[];
};

export const WALLET_ANTWORTET_NICHT =
  'Deine Wallet antwortet nicht. Bitte MetaMask öffnen, offene Anfragen bestätigen oder ablehnen und dann erneut versuchen.';

/** Kurzer, sicherer Auszug einer Wallet-Fehlermeldung fuer die Anzeige. */
function walletMeldung(e: unknown): string {
  const text = String((e as any)?.message ?? e ?? '').replace(/\s+/g, ' ').trim();
  return text.length > 160 ? text.slice(0, 160) + '…' : text;
}

/**
 * Schickt wallet_addEthereumChain an die Wallet -- je Leitweg eine Anfrage,
 * bis eine gelingt.
 *
 * Leitweg = die Kette, ueber die WalletConnect die Anfrage zustellt. Sie muss
 * in der Sitzung freigegeben sein (der SignClient prueft das vor dem Senden).
 * MetaMask Mobile (WalletConnect2Session.handleRequest) schaltet bei einer
 * freigegebenen Leitweg-Kette selbst dorthin und reicht die Anfrage an
 * wallet_addEthereumChain weiter: fehlt das Netz, zeigt sie "Netzwerk
 * hinzufuegen", legt es an, wechselt und gibt es fuer die Verbindung frei
 * (session_update). Kennt sie das Netz schon, bietet sie den Wechsel an.
 * Aeltere Fassungen nehmen nur den gerade gewaehlten Leitweg an ("Invalid
 * chainId") -- dann der naechste Leitweg.
 *
 * `fertig`: meldet die Sitzung die Aequitas-Kette schon, waehrend die Antwort
 * noch aussteht (Antwort ging beim Wechsel zwischen den Apps verloren), gilt
 * die Einrichtung als gelungen.
 *
 * Grenzen: hoechstens 8 Leitwege, je Anfrage hoechstens `zeitJeAnfrageMs`.
 * Antwortet die Wallet nicht, KEINE weitere Anfrage (sie stuende dort nur
 * hinten an, "previous request is still active"). Ablehnung durch den
 * Menschen -> sofort Schluss.
 */
export async function walletAufAequitasSchalten(
  senden: Senden,
  wege: readonly string[],
  kette: KettenAngaben,
  zeitJeAnfrageMs = 90_000,
  fertig?: () => boolean,
): Promise<void> {
  let letzterFehler: unknown = null;
  for (const weg of wege.slice(0, 8)) {
    let zeitUm = false;
    try {
      await new Promise<void>((resolve, reject) => {
        let erledigt = false;
        const ende = (f: () => void) => {
          if (erledigt) return;
          erledigt = true;
          clearTimeout(t);
          if (pruefer) clearInterval(pruefer);
          f();
        };
        const t = setTimeout(() => ende(() => { zeitUm = true; reject(new Error(WALLET_ANTWORTET_NICHT)); }), zeitJeAnfrageMs);
        const pruefer = fertig ? setInterval(() => { if (fertig()) ende(resolve); }, 500) : null;
        senden('wallet_addEthereumChain', [kette], weg).then(
          () => ende(resolve),
          (e) => ende(() => reject(e)),
        );
      });
      return;
    } catch (e) {
      if (zeitUm || istAbgelehnt(e)) throw e;
      // Falscher Leitweg oder Fehler der Wallet: naechster Leitweg.
      letzterFehler = e;
    }
  }
  const grund = letzterFehler ? walletMeldung(letzterFehler) : '';
  throw new Error(grund ? `${NETZ_FEHLT_IN_WALLET} (Wallet: ${grund})` : NETZ_FEHLT_IN_WALLET);
}

/** Wartet hoechstens `ms`, bis `bedingung()` wahr ist. */
async function warteBis(bedingung: () => boolean, ms: number, schrittMs = 250): Promise<boolean> {
  const ende = Date.now() + ms;
  while (!bedingung()) {
    if (Date.now() >= ende) return false;
    await new Promise((r) => setTimeout(r, schrittMs));
  }
  return true;
}

export const KEINE_KETTE_IN_SITZUNG =
  'Die Wallet-Verbindung enthält kein Netz. Bitte die Wallet trennen und neu verbinden.';

/**
 * Richtet das Aequitas-Netz in der verbundenen Wallet ein -- automatisch,
 * ohne Handarbeit des Menschen ausser dem Bestaetigen in der Wallet.
 *
 * 1. Ist die Aequitas-Kette in der Sitzung freigegeben: fertig, keine Anfrage
 *    (die Wallet kennt das Netz; kettengebundene Anfragen gehen ueber 1926,
 *    MetaMask schaltet dafuer selbst um).
 * 2. Sonst wallet_addEthereumChain ueber die freigegebenen Ketten (zuerst die,
 *    die die Wallet zuletzt als aktiv gemeldet hat).
 * 3. Auf die Freigabe in der Sitzung warten (session_update der Wallet).
 * 4. Bleibt sie aus: einmal wallet_switchEthereumChain (die Wallet kennt das
 *    Netz jetzt), wieder warten. Danach fail-closed mit klarer Meldung.
 *
 * `ketten` muss die LIVE-Sitzung lesen (SignClient-Store), keine Kopie.
 */
export async function aequitasNetzEinrichten(o: {
  senden: Senden;
  ketten: () => readonly string[];
  walletKette?: () => string | null;
  kette: KettenAngaben;
  zeitJeAnfrageMs?: number;
  freigabeWarteMs?: number;
}): Promise<void> {
  const da = () => o.ketten().includes(AEQUITAS_CAIP);
  if (da()) return;
  const alle = o.ketten();
  if (alle.length === 0) throw new Error(KEINE_KETTE_IN_SITZUNG);
  const aktiv = o.walletKette?.() ?? null;
  const wege = aktiv && alle.includes(aktiv) ? [aktiv, ...alle.filter((k) => k !== aktiv)] : [...alle];
  const zeit = o.zeitJeAnfrageMs ?? 90_000;
  const warte = o.freigabeWarteMs ?? 15_000;

  await walletAufAequitasSchalten(o.senden, wege, o.kette, zeit, da);
  if (await warteBis(da, warte)) return;

  // Netz angelegt, aber (noch) nicht fuer die Verbindung freigegeben.
  let letzterFehler: unknown = null;
  for (const weg of wege.slice(0, 8)) {
    try {
      await withTimeout(o.senden('wallet_switchEthereumChain', [{ chainId: o.kette.chainId }], weg), zeit, WALLET_ANTWORTET_NICHT);
      letzterFehler = null;
      break;
    } catch (e) {
      if (istAbgelehnt(e) || (e as any)?.message === WALLET_ANTWORTET_NICHT) throw e;
      letzterFehler = e;
    }
  }
  if (await warteBis(da, warte)) return;
  const grund = letzterFehler ? walletMeldung(letzterFehler) : '';
  throw new Error(grund ? `${NETZ_NICHT_FREIGEGEBEN} (Wallet: ${grund})` : NETZ_NICHT_FREIGEGEBEN);
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
  // Richtet das Aequitas-Netz in der Wallet ein (walletconnect.ts,
  // aequitasNetzEinrichten). Fehlt sie, wird nicht nachgeholfen.
  walletWechseln?: () => Promise<void>,
  // Schaltet eine Wallet, die das Netz schon freigegeben hat, aber auf
  // einem anderen steht, dorthin um (wallet_switchEthereumChain). Ohne
  // Angabe: walletWechseln.
  walletUmschalten?: () => Promise<void>
): AequitasSigner {
  const umschalten = walletUmschalten ?? walletWechseln;
  const aufAequitas = async (args: { method: string; params: unknown[] }) => {
    if (!freigegebeneKetten().includes(AEQUITAS_CAIP)) {
      // Noch nicht freigegeben (Vorfall 01.10.2026: neue Verbindung, Netz in
      // MetaMask unbekannt): erst die Wallet auf Aequitas bringen -- das
      // wartet auch auf ihre Freigabe --, dann neu pruefen. Fail-closed.
      if (walletWechseln) await walletWechseln();
      if (!freigegebeneKetten().includes(AEQUITAS_CAIP)) throw new Error(NETZ_NICHT_FREIGEGEBEN);
      return request(args, AEQUITAS_CAIP);
    }
    try {
      return await request(args, AEQUITAS_CAIP);
    } catch (e) {
      // Vorfall 01.10.2026 (MetaMask Mobile): "Invalid chainId". Die Kette
      // ist fuer die Sitzung freigegeben, aber in MetaMask ist ein anderes
      // Netz ausgewaehlt; MetaMask lehnt dann jede Anfrage fuer 1926 ab.
      // Einmal wechseln, einmal wiederholen -- nicht mehr.
      if (!umschalten || !istFalscheKette(e)) throw e;
      await umschalten();
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
