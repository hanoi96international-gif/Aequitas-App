// Inhalt eines gescannten QR-Codes: eine reine Adresse oder ein Zahlungslink
// nach EIP-681 ("ethereum:0x...@1926?value=<wei>"), wie ihn eine Kasse zeigt.
import { ethers } from 'ethers';
import { CHAIN_ID_DEC } from './config';

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
  if (m[2] && Number(m[2]) !== CHAIN_ID_DEC) ziel.fremdeKette = true;
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
