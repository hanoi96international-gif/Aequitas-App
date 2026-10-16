// Inhalt eines gescannten QR-Codes: eine reine Adresse oder ein Zahlungslink
// nach EIP-681 ("ethereum:0x...@<chainId>?value=<wei>"), wie ihn eine Kasse zeigt.
// Zum Netz gehoeren beide Chain-IDs, 1926 und 19260930 (Wechsel, lib/kette.ts):
// ein vor dem Stichtag gedruckter Code bleibt lesbar. Gezahlt wird ohnehin mit
// der ID, die der Knoten beim Senden meldet.
import { ethers } from 'ethers';
import { istAequitasChainId } from './kette';

export interface Zahlungsziel {
  adresse: string;
  /** Betrag in AEQ, falls der Code einen enthaelt. */
  betrag?: string;
  /** Der Code nennt eine andere Chain -- nicht zahlen. */
  fremdeKette?: boolean;
}

export function leseZahlungsziel(roh: string): Zahlungsziel | null {
  const text = String(roh ?? '').trim();
  const m = /^(?:ethereum:)?(?:pay-)?(0x[0-9a-fA-F]{40})(?:@(\d+))?(?:\/[^?]*)?(?:\?(.*))?$/.exec(text);
  if (!m || !ethers.isAddress(m[1])) return null;
  const ziel: Zahlungsziel = { adresse: ethers.getAddress(m[1]) };
  // Genau eine der beiden IDs, ohne fuehrende Nullen; alles andere: nicht zahlen.
  if (m[2] && !(m[2].length <= 12 && istAequitasChainId(Number(m[2])) && String(Number(m[2])) === m[2])) ziel.fremdeKette = true;
  if (m[3]) {
    const params = new URLSearchParams(m[3]);
    const wert = params.get('value');
    if (wert && /^\d+(?:\.\d+)?(?:e\d+)?$/i.test(wert)) {
      try {
        const wei = /^\d+$/.test(wert) ? BigInt(wert) : BigInt(Math.round(Number(wert)));
        if (wei > 0n) ziel.betrag = ethers.formatEther(wei).replace(/\.0$/, '');
      } catch {
        /* Betrag unlesbar: nur die Adresse uebernehmen */
      }
    }
  }
  return ziel;
}
