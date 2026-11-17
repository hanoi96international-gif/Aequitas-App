import type { VerlaufEintrag } from '@/lib/api';

// Grundeinkommen und Umlaufabgabe derselben Tagesrunde als EINE Zeile.
//
// Die Kette bucht beides im selben Durchlauf (gleiche Rundenzeit): die
// Abgabe vom Konto in den Topf, den Topf zu gleichen Teilen an alle Menschen.
// Als zwei Zeilen sah das aus wie ein Fehler (+0,166 und -0,166, jeden Tag).
// Die Zeile zeigt das Netto -- wer weniger als den fairen Anteil hat, bekommt
// netto dazu -- und darunter beide Buchungen. Nur Anzeige: die Rohliste
// bleibt unveraendert (Nachladen, Explorer).

export interface TagesrundeZeile {
  art: 'tagesrunde';
  hoehe: number;
  tx_index: number;
  zeit: number;
  richtung: 'ein' | 'aus' | 'neutral';
  /** Betrag des Nettos (immer >= 0), in AEQ. */
  betrag: number;
  erhalten: number;
  abgabe: number;
}

export type VerlaufZeile = VerlaufEintrag | TagesrundeZeile;

export function istTagesrunde(z: VerlaufZeile): z is TagesrundeZeile {
  return z.art === 'tagesrunde' && 'erhalten' in z && 'abgabe' in z;
}

const MIKRO = 1_000_000;
const mikro = (n: number) => (Number.isFinite(n) ? Math.round(n * MIKRO) : NaN);

function istUbi(e: VerlaufEintrag) {
  return e.art === 'ubi_distribution' && e.richtung === 'ein';
}
function istUmlauf(e: VerlaufEintrag) {
  return e.art === 'umlauf' && e.richtung === 'aus';
}

export function tagesrundenZusammenfassen(eintraege: VerlaufEintrag[]): VerlaufZeile[] {
  // Je Rundenzeit: was erhalten, was abgegeben wurde (in Mikro-AEQ, damit
  // 0,166 - 0,166 genau 0 ergibt).
  const runden = new Map<number, { ein: number; aus: number; hatEin: boolean; hatAus: boolean }>();
  for (const e of eintraege) {
    if (!istUbi(e) && !istUmlauf(e)) continue;
    const b = mikro(e.betrag);
    if (!Number.isFinite(b) || b < 0) continue; // Unlesbares nicht verrechnen
    const r = runden.get(e.zeit) ?? { ein: 0, aus: 0, hatEin: false, hatAus: false };
    if (istUbi(e)) {
      r.ein += b;
      r.hatEin = true;
    } else {
      r.aus += b;
      r.hatAus = true;
    }
    runden.set(e.zeit, r);
  }

  const aus: VerlaufZeile[] = [];
  const erledigt = new Set<number>();
  for (const e of eintraege) {
    const r = (istUbi(e) || istUmlauf(e)) && Number.isFinite(mikro(e.betrag)) && mikro(e.betrag) >= 0 ? runden.get(e.zeit) : undefined;
    if (!r || !r.hatEin || !r.hatAus) {
      aus.push(e); // nur eine der beiden Buchungen (oder keine Rundenbuchung): wie bisher
      continue;
    }
    if (erledigt.has(e.zeit)) continue;
    erledigt.add(e.zeit);
    const netto = r.ein - r.aus;
    aus.push({
      art: 'tagesrunde',
      hoehe: e.hoehe,
      tx_index: e.tx_index,
      zeit: e.zeit,
      richtung: netto > 0 ? 'ein' : netto < 0 ? 'aus' : 'neutral',
      betrag: Math.abs(netto) / MIKRO,
      erhalten: r.ein / MIKRO,
      abgabe: r.aus / MIKRO,
    });
  }
  return aus;
}
