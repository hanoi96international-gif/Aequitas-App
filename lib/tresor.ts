// Der Tresor: die quantensichere Adresse der Wallet (Kette: pq_ueberweisung.go,
// docs/QUANTENSICHERHEIT.md Stufe 3).
//
//   - Adresse = "0x" + letzte 20 Byte von SHA-256("aequitas-pq-adresse-v1" ||
//     oeffentlicher ML-DSA-65-Schluessel). Derselbe Schluessel wie beim
//     Quantenschutz (lib/pq.ts) -- aus der Seed-Phrase, nie aus dem
//     secp256k1-Schluessel.
//   - Hinein: eine gewoehnliche Ueberweisung an die Tresor-Adresse.
//   - Heraus: nur mit einer ML-DSA-65-Unterschrift ueber
//     "aequitas-pq-ueberweisung-v1|chain:1926|<von>|<an>|<wei>|<nonce>".
//     Ein Quantenrechner, der den Wallet-Schluessel bricht, kommt an den
//     Tresor nicht heran.
//
// Der ML-DSA-Seed liegt wie der Wallet-Schluessel im sicheren Speicher des
// Geraets, nur mit Biometrie/Geraetesperre lesbar. Er entsteht, wenn die
// Seed-Phrase ohnehin da ist (Anlegen, Import) oder sie einmal eingegeben wird.
import * as SecureStore from 'expo-secure-store';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { ethers } from 'ethers';
import { API_BASE } from './config';
import { pqSeed } from './pq';

const CHAIN = 1926;
const DOMAENE_ADRESSE = 'aequitas-pq-adresse-v1';
const SEED_SCHLUESSEL = 'aequitas_pq_seed_v1';
const ADRESSE_MERK = 'aequitas_pq_tresor_';
const ADRESSE = /^0x[0-9a-f]{40}$/;
const SEED_HEX = /^[0-9a-f]{64}$/;
/** Hoechstens 10^30 Wei, wie die Kette (pqWeiStellen). */
const WEI_MAX = 10n ** 30n;

/** Tresor-Adresse zu einem oeffentlichen ML-DSA-65-Schluessel -- byte-gleich mit pqAdresseAusSchluessel. */
export function tresorAdresseAusSchluessel(pub: Uint8Array): string {
  if (pub.length !== 1952) throw new Error('ML-DSA-65: falsche Schluessellaenge');
  const h = ethers.getBytes(ethers.sha256(ethers.concat([ethers.toUtf8Bytes(DOMAENE_ADRESSE), pub])));
  return ethers.hexlify(h.slice(12));
}

export function tresorSchluessel(seed: Uint8Array) {
  return ml_dsa65.keygen(seed);
}

/** Was der Tresor-Schluessel unterschreibt -- Byte fuer Byte wie pqUeberweisungNachricht. */
export function tresorNachricht(von: string, an: string, wei: string, nonce: string): string {
  return `aequitas-pq-ueberweisung-v1|chain:${CHAIN}|${von.toLowerCase()}|${an.toLowerCase()}|${wei}|${nonce}`;
}

/** tx_hash der Kette: SHA-256 der Nachricht. */
export function tresorTxHash(nachricht: string): string {
  return ethers.sha256(ethers.toUtf8Bytes(nachricht));
}

/**
 * Seed aus der Phrase sicher ablegen -- nur, wenn die Phrase genau diese
 * Wallet ergibt. Gibt die Tresor-Adresse zurueck (oder null).
 */
export async function tresorEinrichten(phrase: string, wallet: string): Promise<string | null> {
  let w: ethers.HDNodeWallet;
  try {
    w = ethers.Wallet.fromPhrase(phrase.trim().toLowerCase());
  } catch {
    return null;
  }
  if (w.address.toLowerCase() !== wallet.toLowerCase()) return null;
  const seed = pqSeed(phrase);
  const adresse = tresorAdresseAusSchluessel(tresorSchluessel(seed).publicKey);
  const kannBio = SecureStore.canUseBiometricAuthentication();
  await SecureStore.setItemAsync(SEED_SCHLUESSEL, ethers.hexlify(seed).slice(2), {
    requireAuthentication: kannBio,
    authenticationPrompt: 'Quantensicheren Tresor sichern',
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  await SecureStore.setItemAsync(ADRESSE_MERK + wallet.toLowerCase(), adresse);
  return adresse;
}

/** Die Tresor-Adresse dieser Wallet (oeffentlich, ohne Biometrie) -- null, wenn noch nicht eingerichtet. */
export async function tresorAdresse(wallet: string): Promise<string | null> {
  try {
    const a = await SecureStore.getItemAsync(ADRESSE_MERK + wallet.toLowerCase());
    return a && ADRESSE.test(a) ? a : null;
  } catch {
    return null;
  }
}

async function seedLaden(): Promise<Uint8Array | null> {
  const roh = await SecureStore.getItemAsync(SEED_SCHLUESSEL, {
    requireAuthentication: SecureStore.canUseBiometricAuthentication(),
    authenticationPrompt: 'Aus dem Tresor senden',
  });
  return roh && SEED_HEX.test(roh) ? ethers.getBytes('0x' + roh) : null;
}

export interface TresorStand {
  /** Ab wann die Kette PQ-Ueberweisungen annimmt (0 = Knoten kennt sie nicht). */
  ab: number;
  nonce: string;
  guthaben: number;
}

/** Stand einer Tresor-Adresse beim Knoten -- null bei Fehler. */
export async function tresorStand(adresse: string, fetchFn: typeof fetch = fetch): Promise<TresorStand | null> {
  if (!ADRESSE.test(adresse)) return null;
  try {
    const r = await fetchFn(`${API_BASE}/pq/stand?adresse=${adresse}`);
    if (!r.ok) return null;
    const j: any = await r.json();
    const ab = typeof j?.ueberweisung_ab === 'number' && Number.isSafeInteger(j.ueberweisung_ab) && j.ueberweisung_ab > 0 ? j.ueberweisung_ab : 0;
    const nonce = typeof j?.nonce === 'string' && /^(0|[1-9][0-9]{0,18})$/.test(j.nonce) ? j.nonce : '0';
    const guthaben = typeof j?.guthaben === 'number' && Number.isFinite(j.guthaben) && j.guthaben >= 0 ? j.guthaben : 0;
    return { ab, nonce, guthaben };
  } catch {
    return null;
  }
}

export interface TresorErgebnis {
  ok: boolean;
  txHash?: string;
  meldung?: string;
}

/**
 * Aus dem Tresor senden: Nonce holen, mit dem ML-DSA-Schluessel
 * unterschreiben, einreichen. seed/stand nur fuer Tests von aussen.
 */
export async function ausTresorSenden(
  an: string,
  wei: bigint,
  opts: { seed?: Uint8Array; fetchFn?: typeof fetch } = {},
): Promise<TresorErgebnis> {
  const fetchFn = opts.fetchFn ?? fetch;
  const ziel = an.trim().toLowerCase();
  if (!ADRESSE.test(ziel)) return { ok: false, meldung: 'adresse' };
  if (wei <= 0n || wei > WEI_MAX) return { ok: false, meldung: 'betrag' };
  const seed = opts.seed ?? (await seedLaden());
  if (!seed) return { ok: false, meldung: 'kein_tresor' };
  const { publicKey, secretKey } = tresorSchluessel(seed);
  const von = tresorAdresseAusSchluessel(publicKey);
  if (von === ziel) return { ok: false, meldung: 'selbst' };
  const stand = await tresorStand(von, fetchFn);
  if (!stand) return { ok: false, meldung: 'netz' };
  const w = wei.toString();
  const text = tresorNachricht(von, ziel, w, stand.nonce);
  // Deterministisch (FIPS 204 erlaubt es): keine Zufallsquelle noetig.
  const sig = ml_dsa65.sign(ethers.toUtf8Bytes(text), secretKey, { extraEntropy: false });
  if (!ml_dsa65.verify(sig, ethers.toUtf8Bytes(text), publicKey)) return { ok: false, meldung: 'unterschrift' };
  try {
    const r = await fetchFn(`${API_BASE}/pq/ueberweisung`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        von,
        an: ziel,
        wei: w,
        nonce: Number(stand.nonce),
        pub: ethers.hexlify(publicKey).slice(2),
        sig: ethers.hexlify(sig).slice(2),
      }),
    });
    let j: any = null;
    try {
      j = await r.json();
    } catch {
      /* Statuscode reicht */
    }
    if (!r.ok) {
      const t = typeof j?.error === 'string' ? j.error : `HTTP ${r.status}`;
      return { ok: false, meldung: t.slice(0, 200) };
    }
    return { ok: true, txHash: tresorTxHash(text) };
  } catch (e: any) {
    return { ok: false, meldung: String(e?.message ?? e).slice(0, 200) };
  }
}
