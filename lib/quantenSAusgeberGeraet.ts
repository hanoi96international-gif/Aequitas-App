// Quantengeld Weg B (4c-3b): der Ausgeber im echten Gerät -- dieselbe Umgebung
// wie die Präparatorin (lib/quantenSPraepGeraet.ts), denn runde() ist der
// einzige Leser des Briefkastens je Wallet: Antworten und Bestätigungen an den
// Ausgeber kommen dort an, Aufträge an die Präparatorin auch.
//
// Die Bestellung der Inhaberin kommt als Text (bei v = 7, n = 2822 ~12 KB:
// zu groß für einen QR-Code). Hier wird nur Größe und Form gelesen; was sie
// enthält, prüft beauftragen()/rahmenPruefen() vollständig.

import type { Bestellung } from './quantenS';
import { QuantenSFehler } from './quantenS';
import type { Messer, PraepUmgebung, RundenBericht, WalletSchluessel } from './quantenSPraepAblauf';
import { runde } from './quantenSPraepAblauf';
import { ibmMesser, ibmZugangLesen } from './quantenSPraepIbm';
import { praepKnoten, praepUmgebung } from './quantenSPraepGeraet';

/** Höchstgröße der eingefügten Bestellung (Zeichen), vor dem Parsen geprüft. */
export const BESTELLUNG_TEXT_MAX = 64 * 1024;

/** Die Bestellung der Inhaberin aus eingefügtem Text: Größe vor dem Parsen, nur Weg B (Basen verschlüsselt). */
export function bestellungAusText(text: string): Bestellung {
  if (typeof text !== 'string' || text.length > BESTELLUNG_TEXT_MAX) throw new QuantenSFehler('Bestellung der Inhaberin: zu groß');
  let o: unknown;
  try {
    o = JSON.parse(text.trim());
  } catch {
    throw new QuantenSFehler('Bestellung der Inhaberin: kein JSON');
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new QuantenSFehler('Bestellung der Inhaberin: Form');
  const b = o as Record<string, unknown>;
  const erlaubt = ['n', 'basen_verschluesselt', 'inhaberin', 'inhaberin_schluessel', 'stellen'];
  if (Object.keys(b).some((k) => !erlaubt.includes(k))) throw new QuantenSFehler('Bestellung der Inhaberin: Form (Basen nur verschlüsselt, Weg B)');
  if (!Array.isArray(b.basen_verschluesselt) || !b.basen_verschluesselt.every((c) => typeof c === 'string')) throw new QuantenSFehler('Bestellung der Inhaberin: Form');
  if (!Array.isArray(b.stellen) || b.stellen.length !== 2) throw new QuantenSFehler('Bestellung der Inhaberin: Annahmestellen');
  return b as unknown as Bestellung;
}

/** Ohne IBM-Zugang: Aufträge an diese Wallet werden abgelehnt (der Ausgeber sendet sie später noch einmal). */
const OHNE_IBM: Messer = {
  messen: async () => {
    throw new QuantenSFehler('kein IBM-Zugang im Gerät');
  },
};

/**
 * Den Briefkasten als Ausgeber abarbeiten (Antworten, Bestätigungen). Mit
 * IBM-Zugang beantwortet dieselbe Runde auch Aufträge an diese Wallet als
 * Präparatorin; ohne ihn werden sie abgelehnt, nie ungemessen beantwortet.
 */
export async function ausgeberBriefkasten(
  wallet: WalletSchluessel,
  u: PraepUmgebung = praepUmgebung(),
  knoten: string[] = praepKnoten(),
  warten: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<RundenBericht> {
  const zugang = await ibmZugangLesen(u.geheim);
  const messer = zugang ? ibmMesser(zugang, { fetchFn: u.fetchFn, jetzt: u.jetzt, warten }) : OHNE_IBM;
  return runde(u, wallet, messer, knoten);
}
