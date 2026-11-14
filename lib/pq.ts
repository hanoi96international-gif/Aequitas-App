// Quantenschutz der Wallet (Kette: pq_zusage.go, docs/QUANTENSICHERHEIT.md
// Stufe 2).
//
// Die Wallet hinterlegt EINMAL den SHA-256 ihres ML-DSA-65-Schluessels
// (FIPS 204). Heute bewirkt das nichts; bricht spaeter ein Quantenrechner die
// heutigen Wallet-Schluessel (secp256k1), ist genau diese Zusage der Beweis,
// wem die Wallet gehoert.
//
// DER SCHLUESSEL kommt aus der Seed-Phrase, ueber einen eigenen Weg:
//   xi = HMAC-SHA256("aequitas-mldsa65-v1", BIP-39-Seed), dann FIPS-204-Keygen.
// NIE aus dem secp256k1-Schluessel -- den kann ein Quantenrechner ableiten,
// den BIP-39-Seed nicht. Der Mensch muss nichts Neues sichern.
//
// Die App speichert die Seed-Phrase nicht (nur den Wallet-Schluessel). Darum
// entsteht der Hash, wenn die Phrase ohnehin da ist (Anlegen, Import), und
// wird bis zur Hinterlegung gemerkt -- er ist nicht geheim (Hash eines
// oeffentlichen Schluessels). Wer die Wallet schon hat, gibt die Phrase dafuer
// einmal ein; sie wird sofort wieder verworfen.
import * as SecureStore from 'expo-secure-store';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { ethers } from 'ethers';
import { API_BASE } from './config';
import type { AequitasSigner } from './signer';

const CHAIN = 1926;
const ABLEITUNG = 'aequitas-mldsa65-v1';
const HASH = /^[0-9a-f]{64}$/;
const ADRESSE = /^0x[0-9a-f]{40}$/;
const MERK = 'aequitas_pq_hash_';

/** ML-DSA-Seed (32 Byte) aus der Seed-Phrase -- byte-gleich mit dem Pruefvektor der Kette. */
export function pqSeed(phrase: string): Uint8Array {
  const seed = ethers.Mnemonic.fromPhrase(phrase.trim().toLowerCase()).computeSeed();
  return ethers.getBytes(ethers.computeHmac('sha256', ethers.toUtf8Bytes(ABLEITUNG), seed));
}

/** SHA-256 des oeffentlichen ML-DSA-65-Schluessels (1.952 Byte), klein-hex ohne 0x. */
export function pqHash(phrase: string): string {
  const { publicKey } = ml_dsa65.keygen(pqSeed(phrase));
  if (publicKey.length !== 1952) throw new Error('ML-DSA-65: falsche Schluessellaenge');
  return ethers.sha256(publicKey).slice(2);
}

/** Was die Wallet unterschreibt -- Byte fuer Byte wie pqZusageNachricht in der Kette. */
export function zusageNachricht(wallet: string, hash: string, zeit: number): string {
  return `aequitas-pq-zusage-v1|chain:${CHAIN}|${wallet.toLowerCase()}|${hash}|${zeit}`;
}

/**
 * Hash zu einer Phrase, nur wenn die Phrase genau diese Wallet ergibt (sonst
 * hinterlegte jemand die Zusage einer fremden Phrase fuer seine Wallet).
 */
export function pqHashFuerWallet(phrase: string, wallet: string): string | null {
  try {
    const w = ethers.Wallet.fromPhrase(phrase.trim().toLowerCase());
    if (w.address.toLowerCase() !== wallet.toLowerCase()) return null;
    return pqHash(phrase);
  } catch {
    return null;
  }
}

/** Beim Anlegen/Import mit Phrase: Hash fuer spaeter merken. Fehler sind still (dann fragt die App spaeter nach der Phrase). */
export async function pqHashMerken(phrase: string, wallet: string): Promise<void> {
  try {
    const h = pqHashFuerWallet(phrase, wallet);
    if (h) await SecureStore.setItemAsync(MERK + wallet.toLowerCase(), h);
  } catch {
    /* spaeter per Phrase */
  }
}

export async function pqHashGemerkt(wallet: string): Promise<string | null> {
  try {
    const h = await SecureStore.getItemAsync(MERK + wallet.toLowerCase());
    return h && HASH.test(h) ? h : null;
  } catch {
    return null;
  }
}

export async function pqHashVergessen(wallet: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(MERK + wallet.toLowerCase());
  } catch {
    /* egal */
  }
}

export interface PQStand {
  /** Ab wann die Kette Zusagen annimmt (0 = Knoten kennt sie noch nicht). */
  ab: number;
  /** Seit wann eine Zusage hinterlegt ist (0 = keine). */
  seit: number;
  /** Der hinterlegte Hash ('' = keiner). */
  hash: string;
}

const zahl = (x: unknown) => (typeof x === 'number' && Number.isSafeInteger(x) && x >= 0 ? x : 0);

/** Stand beim Knoten (steht in /api/umzug) -- null bei Fehler. */
export async function pqStand(wallet: string, fetchFn: typeof fetch = fetch): Promise<PQStand | null> {
  try {
    const r = await fetchFn(`${API_BASE}/umzug?wallet=${encodeURIComponent(wallet.toLowerCase())}`);
    if (!r.ok) return null;
    const j: any = await r.json();
    const hash = typeof j?.pq_hash === 'string' && HASH.test(j.pq_hash) ? j.pq_hash : '';
    return { ab: zahl(j?.pq_zusage_ab), seit: hash ? zahl(j?.pq_zusage_seit) : 0, hash };
  } catch {
    return null;
  }
}

export interface PQErgebnis {
  ok: boolean;
  meldung?: string;
}

/** Die Zusage hinterlegen (unterschrieben mit der Wallet, EIP-191). */
export async function zusageHinterlegen(
  signer: AequitasSigner,
  hash: string,
  fetchFn: typeof fetch = fetch,
  jetztS: () => number = () => Math.floor(Date.now() / 1000),
): Promise<PQErgebnis> {
  const wallet = signer.address.toLowerCase();
  if (!HASH.test(hash) || !ADRESSE.test(wallet)) return { ok: false, meldung: 'form' };
  const zeit = jetztS();
  const text = zusageNachricht(wallet, hash, zeit);
  let sig: string;
  try {
    sig = ethers.Signature.from(await signer.signMessage(text)).serialized.toLowerCase();
    if (ethers.verifyMessage(text, sig).toLowerCase() !== wallet) return { ok: false, meldung: 'unterschrift' };
  } catch {
    return { ok: false, meldung: 'unterschrift' };
  }
  try {
    const r = await fetchFn(`${API_BASE}/pq/zusage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet, pq_hash: hash, zeit, sig }),
    });
    if (r.ok) return { ok: true };
    let t = `HTTP ${r.status}`;
    try {
      const j: any = await r.json();
      if (typeof j?.error === 'string') t = j.error;
    } catch {
      /* Statuscode reicht */
    }
    return { ok: false, meldung: t.slice(0, 200) };
  } catch (e: any) {
    return { ok: false, meldung: String(e?.message ?? e).slice(0, 200) };
  }
}

/** Antwort der Kette "schon eine Zusage" (pq_fest). */
export function zusageSchonDa(meldung: string | undefined): boolean {
  return !!meldung && meldung.includes('pq_fest');
}
