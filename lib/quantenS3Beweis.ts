// Weg C, C2b-2b-3c Teil 2 (forschung/quantengeld/WEG_C.md): Mehrfach-Beweis.
// Gleich wie der Knoten (quanten_s3_beweis.go) und die Spezifikation
// (s_kette.s3_mehrfach_pruefen, Prüfvektor --vektor-s3-beweis).
//
// Über eine Leitung geht die Wurzel über ALLE N Pulse. Die Annahmestelle
// bekommt nur die n Blätter des Tokens (Stelle j = Puls teil[j]) und EINEN
// Beweis, dass sie an genau diesen Pulsen in der Wurzel der Kette stehen.
// Öffentlich: Sie fragt nie einzelne Pfade an, ihre geheime Stichprobe bleibt
// geheim. Streng: genau die Hashes des Beweises, keiner zu viel oder zu wenig.

import { sha256 } from '@noble/hashes/sha256';
import { hexToBytes } from '@noble/hashes/utils';

/** Wie quantenS3PulsMax. */
export const N_PULS_MAX = 1 << 26;
/** Wie quantenS3BeweisMax. */
export const BEWEIS_MAX = 1 << 21;
const HEX64 = /^[0-9a-f]{64}$/;

function knoten(a: Uint8Array, b: Uint8Array): Uint8Array {
  const x = new Uint8Array(65);
  x[0] = 1;
  x.set(a, 1);
  x.set(b, 33);
  return sha256(x);
}

function gleich(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

/**
 * Prüft, dass die Blätter (Hex) an den aufsteigenden Indizes in der Wurzel über
 * n Blätter stehen. false bei jeder Abweichung, nie eine Ausnahme.
 */
export function mehrfachPruefen(wurzelHex: string, n: number, idx: number[], blaetterHex: string[], beweisHex: string[]): boolean {
  if (!Number.isSafeInteger(n) || n < 1 || n > N_PULS_MAX || idx.length === 0 || idx.length !== blaetterHex.length || beweisHex.length > BEWEIS_MAX) return false;
  if (!HEX64.test(wurzelHex) || !blaetterHex.every((h) => HEX64.test(h)) || !beweisHex.every((h) => HEX64.test(h))) return false;
  for (let j = 0; j < idx.length; j++) {
    if (!Number.isSafeInteger(idx[j]) || idx[j] < 0 || idx[j] >= n || (j > 0 && idx[j] <= idx[j - 1])) return false;
  }
  let ebene: { i: number; h: Uint8Array }[] = idx.map((i, j) => ({ i, h: hexToBytes(blaetterHex[j]) }));
  let groesse = n;
  let z = 0;
  while (groesse > 1) {
    const neu: { i: number; h: Uint8Array }[] = [];
    for (let j = 0; j < ebene.length; j++) {
      const { i, h } = ebene[j];
      const s = i ^ 1;
      if (i % 2 === 0 && j + 1 < ebene.length && ebene[j + 1].i === s) {
        neu.push({ i: i / 2, h: knoten(h, ebene[j + 1].h) });
        j++;
        continue;
      }
      let nachbar: Uint8Array;
      if (s < groesse) {
        if (z >= beweisHex.length) return false;
        nachbar = hexToBytes(beweisHex[z++]);
      } else {
        nachbar = h; // verdoppeltes letztes Blatt
      }
      neu.push({ i: Math.floor(i / 2), h: i % 2 === 0 ? knoten(h, nachbar) : knoten(nachbar, h) });
    }
    ebene = neu;
    groesse = Math.floor((groesse + 1) / 2);
  }
  return z === beweisHex.length && ebene.length === 1 && ebene[0].i === 0 && gleich(ebene[0].h, hexToBytes(wurzelHex));
}

