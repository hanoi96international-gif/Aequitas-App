// B4b-3: die App als Praeparatorin -- Werte, Anteile, Blaetter, Buendel
// (aequitas quanten_s_abschnitt.go). Der Pruefvektor entsteht hier mit festem
// Zufall; der Knoten oeffnet genau diese Buendel
// (aequitas x/humanity/keeper/quanten_s_praep_buendel_vektor_test.go).
// Neu schreiben: AEQUITAS_VEKTOR_SCHREIBEN=1 npx jest quantenSPraeparieren
jest.mock('expo-secure-store', () => ({}));
jest.mock('expo-crypto', () => ({ getRandomBytes: () => new Uint8Array(0) }));
jest.mock('../config', () => ({ API_BASE: 'https://knoten.test/api' }));

import * as fs from 'fs';
import * as path from 'path';
import { ethers } from 'ethers';
import { abschnitt, adresseVon, eciesOeffnen, pubVon, unterschriftVon } from '../quantenS';
import { pruefsumme, zusammensetzen } from '../quantenSStelle';
import {
  P,
  abschnittWerte,
  anteilAus,
  blaetter,
  buendelJson,
  buendelNachricht,
  buendelVersiegeln,
  koeffizienten,
  stellenBit,
  zerlegen,
  zufallUnter,
  type Zufall,
} from '../quantenSPraeparieren';

const PFAD = path.join(__dirname, 'vektoren', 'quanten_s_praep_buendel_vektor.json');

/** Fester Zufall: SHA-256(saat | zaehler), fortlaufend. Nur fuer Tests. */
function festerZufall(saat: string): Zufall {
  let puffer: Uint8Array = new Uint8Array(0);
  let z = 0;
  return (n: number) => {
    while (puffer.length < n) {
      const h = ethers.getBytes(ethers.sha256(ethers.toUtf8Bytes(`${saat}|${z++}`)));
      puffer = ethers.getBytes(ethers.concat([puffer, h]));
    }
    const out = puffer.slice(0, n);
    puffer = puffer.slice(n);
    return out;
  };
}

const SCHL = ['61', '62', '63'].map((b) => b.repeat(32)); // NUR fuer Tests
const K = 'qs-praep-vektor-1';
const N = 10;
const V = 3;
const T = 2;
const X = 2; // die App praepariert Abschnitt 2
const U = [0, 1, 1];
const TW = [1, 1, 0];

function vektorBauen() {
  const z = festerZufall('aequitas-b4b3-vektor');
  const { von, bis } = abschnitt(N, V, X)!;
  const werte = abschnittWerte(U, TW, z);
  const koeff = werte.map((w) => koeffizienten(w, T, V, z));
  const buendel = [];
  for (let e = 1; e <= V; e++) {
    if (e === X) continue;
    const inhalt = { K, von, bis, praeparator: X, empfaenger: e, anteile: koeff.map((k) => anteilAus(k, e)) };
    buendel.push({ empfaenger: e, ...buendelVersiegeln(SCHL[X - 1], pubVon(SCHL[e - 1]), inhalt, z) });
  }
  return {
    hinweis: 'B4b-3: Abschnitt der App als Praeparatorin (lib/quantenSPraeparieren.ts). Schluessel NUR fuer Tests.',
    schluessel_nur_test: SCHL,
    validatoren: SCHL.map(adresseVon),
    k: K, n: N, v: V, t: T, x: X, von, bis, u: U, t_werte: TW,
    werte: werte.map((w) => w.toString(16)),
    koeff: koeff.map((k) => k.map((c) => c.toString(16))),
    blaetter: blaetter(K, von, werte),
    buendel,
  };
}

describe('B4b-3: Pruefvektor', () => {
  const neu = vektorBauen();
  if (process.env.AEQUITAS_VEKTOR_SCHREIBEN === '1') fs.writeFileSync(PFAD, JSON.stringify(neu, null, 1) + '\n');
  const alt = JSON.parse(fs.readFileSync(PFAD, 'utf8'));

  test('mit festem Zufall Byte fuer Byte wie im Vektor (der Knoten oeffnet genau diese Buendel)', () => {
    expect(neu).toEqual(alt);
    expect(neu.von).toBe(3);
    expect(neu.bis).toBe(6);
  });

  test('jeder Empfaenger liest seine Anteile; zwei Anteile ergeben den Wert, die Blaetter passen', () => {
    const an = new Map<number, bigint[]>();
    for (const b of alt.buendel) {
      expect(unterschriftVon(buendelNachricht(K, X, b.empfaenger, b.chiffrat), b.sig, alt.validatoren[X - 1])).toBe(true);
      const roh = JSON.parse(ethers.toUtf8String(eciesOeffnen(SCHL[b.empfaenger - 1], b.chiffrat)));
      expect(Object.keys(roh)).toEqual(['dom', 'k', 'von', 'bis', 'praeparator', 'empfaenger', 'anteile']);
      expect(roh.empfaenger).toBe(b.empfaenger);
      an.set(b.empfaenger, roh.anteile.map((h: string) => BigInt('0x' + h)));
      // Ein fremder Schluessel oeffnet es nicht.
      expect(() => eciesOeffnen(SCHL[X - 1], b.chiffrat)).toThrow();
    }
    alt.werte.forEach((wh: string, i: number) => {
      const w = BigInt('0x' + wh);
      expect(zusammensetzen([{ x: 1, y: an.get(1)![i] }, { x: 3, y: an.get(3)![i] }])).toBe(w);
      expect(pruefsumme(K, alt.von + i, w)).toBe(alt.blaetter[i]);
      expect(zerlegen(w)).toEqual([U[i], TW[i]]);
    });
  });
});

describe('B4b-3: Bausteine', () => {
  test('Werte: Basis und Wert unten, Stellen-Bits genau zur Haelfte, Salz 123 Bit', () => {
    for (const n of [1, 2, 7, 64]) {
      const u = Array.from({ length: n }, (_, i) => i % 2);
      const t = Array.from({ length: n }, (_, i) => (i >> 1) % 2);
      const w = abschnittWerte(u, t, festerZufall(`w${n}`));
      expect(w.map(zerlegen)).toEqual(u.map((ui, i) => [ui, t[i]]));
      expect(w.filter((x) => stellenBit(x) === 1).length).toBe(n - Math.floor(n / 2));
      expect(w.every((x) => x >= 0n && x < 1n << 126n)).toBe(true);
    }
    expect(() => abschnittWerte([0, 2], [0, 0], festerZufall('x'))).toThrow('Basen');
    expect(() => abschnittWerte([0], [0, 1], festerZufall('x'))).toThrow('Abschnitt');
    expect(() => abschnittWerte([], [], festerZufall('x'))).toThrow('Abschnitt');
  });

  test('Shamir: je t Anteile ergeben den Wert, t-1 nicht', () => {
    const z = festerZufall('shamir');
    const w = 123456789n;
    const k = koeffizienten(w, 3, 5, z);
    const a = [1, 2, 3, 4, 5].map((x) => ({ x, y: anteilAus(k, x) }));
    expect(zusammensetzen([a[0], a[2], a[4]])).toBe(w);
    expect(zusammensetzen([a[1], a[3], a[4]])).toBe(w);
    expect(zusammensetzen([a[0], a[1]])).not.toBe(w);
    expect(() => koeffizienten(P, 2, 3, z)).toThrow('Teilen');
    expect(() => koeffizienten(1n, 4, 3, z)).toThrow('Teilen');
    expect(() => anteilAus(k, 0)).toThrow('Validator');
  });

  test('Zufall: gleichverteilt durch Verwerfen, schlechter Zufall bricht ab', () => {
    expect(zufallUnter(1n, () => new Uint8Array(0))).toBe(0n);
    expect(() => zufallUnter(5n, () => new Uint8Array([0xff]))).toThrow('Grenze');
    expect(() => zufallUnter(5n, () => new Uint8Array(2))).toThrow('Zufall');
    expect(() => zufallUnter(0n, festerZufall('z'))).toThrow('Grenze');
  });

  test('Buendel: Anteile passen zum Abschnitt, nie an sich selbst, Unterschrift bindet das Chiffrat', () => {
    const b = { K, von: 3, bis: 5, praeparator: 2, empfaenger: 1, anteile: [1n, 2n] };
    expect(() => buendelJson({ ...b, anteile: [1n] })).toThrow('Anteile');
    expect(() => buendelJson({ ...b, anteile: [1n, P] })).toThrow('Anteile');
    expect(() => buendelJson({ ...b, empfaenger: 2 })).toThrow('selbst');
    const s = buendelVersiegeln(SCHL[1], pubVon(SCHL[0]), b, festerZufall('b'));
    const adr = adresseVon(SCHL[1]);
    expect(unterschriftVon(buendelNachricht(K, 2, 1, s.chiffrat), s.sig, adr)).toBe(true);
    // Getauschtes Chiffrat, anderer Empfaenger oder anderes K: Unterschrift passt nicht.
    const anders = s.chiffrat.slice(0, -2) + (s.chiffrat.endsWith('00') ? '01' : '00');
    expect(unterschriftVon(buendelNachricht(K, 2, 1, anders), s.sig, adr)).toBe(false);
    expect(unterschriftVon(buendelNachricht(K, 2, 3, s.chiffrat), s.sig, adr)).toBe(false);
    expect(unterschriftVon(buendelNachricht(K + 'x', 2, 1, s.chiffrat), s.sig, adr)).toBe(false);
  });
});
