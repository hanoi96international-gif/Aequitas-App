// Altersbuergschaft (Stufe 3 der Altersprüfung), ohne Ausweis.
//
// Wer bei der Aufnahme nicht sicher genug als erwachsen geschaetzt wird, zeigt
// einen QR-Code. Zwei Menschen, die selbst bei Aequitas registriert sind und
// die Person persoenlich kennen, scannen ihn und unterschreiben: "Ich kenne
// diese Person persoenlich. Sie ist mindestens 18 Jahre alt." Danach geht die
// Aufnahme erneut -- die Vergleichsdienste pruefen Unterschriften und
// Menschsein selbst, und ein klar kindliches Gesicht bleibt abgewiesen.
//
// Die Nachricht muss Zeichen fuer Zeichen der des Coordinators und der
// Vergleichsdienste entsprechen (altersbuergschaft.py, alter_buergschaft.py).

import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { coordinatorCandidates } from './biometricIdentity';

export const BUERGEN_NOETIG = 2;
const QR_PRAEFIX = 'aequitas-alter:';

export function nachricht(anfrage: string, zeit: number): string {
  return (
    'Aequitas: Altersbuergschaft\n' +
    'Ich kenne diese Person persoenlich. Sie ist mindestens 18 Jahre alt und in ihrem Land volljaehrig.\n' +
    `Anfrage: ${anfrage}\n` +
    `Zeit: ${zeit}`
  );
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Die Anfrage dieser Wallet: einmal erzeugt, bis zur Einschreibung behalten. */
export async function anfrageFuer(wallet: string): Promise<string> {
  const key = 'aequitas_altersbuergschaft_' + wallet.toLowerCase().slice(2, 42);
  const da = await SecureStore.getItemAsync(key);
  if (da && /^[0-9a-f]{32}$/.test(da)) return da;
  const neu = hex(await Crypto.getRandomBytesAsync(16));
  await SecureStore.setItemAsync(key, neu);
  return neu;
}

export function qrInhalt(wallet: string, anfrage: string): string {
  return `${QR_PRAEFIX}${wallet.toLowerCase()}:${anfrage}`;
}

export function leseQr(roh: string): { wallet: string; anfrage: string } | null {
  const m = /^aequitas-alter:(0x[0-9a-f]{40}):([0-9a-f]{32})$/.exec(String(roh ?? '').trim().toLowerCase());
  return m ? { wallet: m[1], anfrage: m[2] } : null;
}

type Unterzeichner = { signMessage: (m: string) => Promise<string> };

/** Buergen: unterschreiben und an JEDEN bekannten Coordinator schicken -- die
 *  Person meldet sich bei irgendeinem an. Gibt die hoechste Zahl der Buergen
 *  zurueck oder den Grund der Ablehnung. */
export async function buergen(
  signer: Unterzeichner,
  buerge: string,
  wallet: string,
  anfrage: string,
  jetzt = Math.floor(Date.now() / 1000),
): Promise<{ ok: boolean; buergen: number; grund?: string }> {
  const sig = await signer.signMessage(nachricht(anfrage, jetzt));
  const body = JSON.stringify({ wallet, anfrage, buerge: buerge.toLowerCase(), zeit: jetzt, sig });
  let best = 0;
  let grund: string | undefined;
  let ok = false;
  for (const base of coordinatorCandidates()) {
    try {
      const r = await fetch(base + '/alter/buergschaft', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d?.ok) {
        ok = true;
        best = Math.max(best, Number(d.buergen) || 0);
      } else if (typeof d?.detail === 'string') {
        grund = d.detail.slice(0, 60);
      }
    } catch {
      grund = grund ?? 'netz';
    }
  }
  return ok ? { ok, buergen: best } : { ok, buergen: 0, grund };
}

/** Wie viele Buergen hat die Anfrage? Hoechster Wert ueber alle Coordinatoren. */
export async function stand(anfrage: string): Promise<number> {
  let best = 0;
  for (const base of coordinatorCandidates()) {
    try {
      const r = await fetch(base + '/alter/buergschaft?anfrage=' + anfrage);
      if (r.ok) best = Math.max(best, Number((await r.json())?.buergen) || 0);
    } catch {
      /* naechster */
    }
  }
  return best;
}
