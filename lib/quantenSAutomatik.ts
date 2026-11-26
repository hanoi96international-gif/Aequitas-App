// Quantengeld Weg B: Automatik für den Pilot.
//
// Ohne sie muss jede Präparatorin bei jedem Schritt (Auftrag, Bestätigung,
// Öffnung) selbst „Briefkasten prüfen“ tippen, und der Ausgeber jeden
// Zwischenschritt. Die Automatik macht das, solange die Seite offen ist.
//
// Grenzen (Launch-Maßstab):
// - Nie zwei Runden gleichzeitig: eine Schleife, ein Schritt nach dem anderen.
// - Fester Abstand zwischen zwei Runden (AUTO_ABSTAND_MS) und höchstens
//   AUTO_MAX_RUNDEN je Einschalten; danach aus.
// - Nach AUTO_MAX_FEHLER Fehlern in Folge aus (kein Hämmern auf Knoten/IBM).
// - Nur mit schon entsperrter Wallet (walletNurEntsperrt): die Automatik
//   fragt nie selbst nach Biometrie. Ist die Wallet gesperrt, endet sie.
// - Was Wert bindet (Ausgeben, Bestellen), macht die Automatik NIE. Sie hält
//   an und sagt, dass ein Mensch bestätigen muss.

import type { WalletSchluessel } from './quantenSPraepAblauf';
import type { AusgeberUmgebung, AusgeberZustand } from './quantenSAusgeber';
import { losStand, zustandLesen } from './quantenSAusgeber';
import { bestaetigungenAnfordern, paketSenden } from './quantenSAusgeberRunde';
import { QuantenSFehler } from './quantenS';

export const AUTO_ABSTAND_MS = 90_000;
export const AUTO_MAX_RUNDEN = 80; // 80 · 90 s = 2 h
export const AUTO_MAX_FEHLER = 3;

export type AutoEnde = 'gestoppt' | 'fertig' | 'grenze' | 'fehler' | 'bestaetigen';

export interface AutomatikOptionen {
  /** Ein Schritt; 'weiter' = noch einmal, sonst endet die Automatik mit diesem Grund. */
  schritt: () => Promise<'weiter' | 'fertig' | 'bestaetigen'>;
  abstandMs?: number;
  maxRunden?: number;
  maxFehler?: number;
  warten?: (ms: number, abbruch: AbortSignal) => Promise<void>;
  /** Nach jeder Runde (Fehler als Text). */
  meldung?: (r: { runde: number; fehler?: string }) => void;
}

function wartenStandard(ms: number, abbruch: AbortSignal): Promise<void> {
  return new Promise((ok) => {
    if (abbruch.aborted) return ok();
    const t = setTimeout(ok, ms);
    abbruch.addEventListener('abort', () => {
      clearTimeout(t);
      ok();
    }, { once: true });
  });
}

/**
 * Startet die Schleife. stop() beendet sie nach dem laufenden Schritt (ein
 * laufender Schritt wird nicht abgebrochen: er ist fortsetzbar und sichert
 * vor jedem Senden). fertig löst mit dem Grund auf.
 */
export function automatikStarten(o: AutomatikOptionen): { stop: () => void; fertig: Promise<AutoEnde> } {
  const abstand = Math.max(10_000, o.abstandMs ?? AUTO_ABSTAND_MS);
  const maxRunden = Math.min(AUTO_MAX_RUNDEN, Math.max(1, o.maxRunden ?? AUTO_MAX_RUNDEN));
  const maxFehler = Math.max(1, o.maxFehler ?? AUTO_MAX_FEHLER);
  const warten = o.warten ?? wartenStandard;
  const ab = new AbortController();
  const fertig = (async (): Promise<AutoEnde> => {
    let fehlerInFolge = 0;
    for (let runde = 1; runde <= maxRunden; runde++) {
      if (ab.signal.aborted) return 'gestoppt';
      try {
        const r = await o.schritt();
        fehlerInFolge = 0;
        o.meldung?.({ runde });
        if (r !== 'weiter') return r;
      } catch (e: any) {
        fehlerInFolge++;
        o.meldung?.({ runde, fehler: String(e?.message ?? e).slice(0, 200) });
        if (e instanceof WalletGesperrt || fehlerInFolge >= maxFehler) return 'fehler';
      }
      if (ab.signal.aborted) return 'gestoppt';
      if (runde < maxRunden) await warten(abstand, ab.signal);
    }
    return ab.signal.aborted ? 'gestoppt' : 'grenze';
  })();
  return { stop: () => ab.abort(), fertig };
}

export class WalletGesperrt extends QuantenSFehler {
  constructor() {
    super('Wallet gesperrt – Automatik aus (bitte einmal von Hand entsperren)');
  }
}

/** Eine Wallet, die nur einen schon entsperrten Schlüssel liefert und nie nachfragt. */
export function walletNurEntsperrt(entsperrt: () => { privateKey: string } | null): WalletSchluessel {
  return {
    entsperren: async () => {
      const s = entsperrt();
      if (!s) throw new WalletGesperrt();
      return s;
    },
  };
}

/**
 * Ein Schritt des Ausgebers. Nur was keinen Wert bindet:
 * - bestellt/eingereicht: den Stand des Loses abfragen, bis gelost (dann
 *   'fertig': K geht von Hand an die Inhaberin).
 * - beauftragt: Briefkasten, bis alle Antworten da sind.
 * - beantwortet: einmal Bestätigungen anfordern, dann Briefkasten.
 * - bestaetigt: Ende 'bestaetigen' -- Ausgeben bestätigt ein Mensch.
 * - ausgegeben: einmal das Paket senden, dann 'fertig'.
 * Jeder andere Stand: 'fertig' (nichts zu tun, was die Automatik darf).
 */
export function ausgeberSchritt(
  u: AusgeberUmgebung,
  wallet: WalletSchluessel,
  briefkasten: () => Promise<unknown>,
  lesen: (u: AusgeberUmgebung) => Promise<AusgeberZustand | null> = zustandLesen,
  los: (u: AusgeberUmgebung) => Promise<{ stand: string }> = losStand,
): () => Promise<'weiter' | 'fertig' | 'bestaetigen'> {
  // Je K höchstens einmal je Einschalten (keine Flut im Briefkasten der Gelosten).
  const angefordert = new Set<string>();
  const paketGesendet = new Set<string>();
  return async () => {
    const z = await lesen(u);
    if (!z) return 'fertig';
    switch (z.stand) {
      case 'bestellt':
      case 'eingereicht': {
        // Los abwarten (bindet keinen Wert; die Kette lost).
        const r = await los(u);
        return r.stand === 'gelost' ? 'fertig' : r.stand === 'verworfen' || r.stand === 'verfallen' ? 'fertig' : 'weiter';
      }
      case 'beauftragt':
        await briefkasten();
        return 'weiter';
      case 'beantwortet':
        if (!angefordert.has(z.k)) {
          await bestaetigungenAnfordern(u, wallet);
          angefordert.add(z.k);
          return 'weiter';
        }
        await briefkasten();
        return 'weiter';
      case 'bestaetigt':
        return 'bestaetigen';
      case 'ausgegeben':
        if (!paketGesendet.has(z.k)) {
          await paketSenden(u, wallet);
          paketGesendet.add(z.k);
        }
        return 'fertig';
      default:
        return 'fertig';
    }
  };
}
