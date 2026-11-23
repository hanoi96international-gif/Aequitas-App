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
import { probeTeilHash, pruefsumme, zusammensetzen } from '../quantenSStelle';
import {
  P,
  abschnittWerte,
  anteilOeffnungPakete,
  antwortUnterschreiben,
  fuerInhaberin,
  oeffnungFuerStelle,
  probeV2,
  schluesselPruefen,
  type Empfaenger,
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

// ------------------------------------------------------------ B4b-3b: Stichprobe v2, Pakete, Antwort

const PFAD_ANTWORT = path.join(__dirname, 'vektoren', 'quanten_s_praep_antwort_vektor.json');
const STELLEN_SCHL = ['71', '72'].map((b) => b.repeat(32)); // NUR fuer Tests
const INH_SCHL = '51'.repeat(32); // NUR fuer Tests
const N2 = 24;
const Y2 = [0, 1, 1, 0, 1, 0, 0, 1];
const U2 = [0, 1, 0, 0, 1, 1, 0, 1];
const T2 = [1, 0, 1, 1, 0, 0, 1, 0];
const XM2 = [1, 0, 0, 1, 1, 1, 1, 0]; // Messung der Inhaberin: an Stelle 4 (y = u) ein Fehler

function antwortVektorBauen() {
  const z = festerZufall('aequitas-b4b3b-vektor');
  const { von, bis } = abschnitt(N2, V, X)!;
  const werte = abschnittWerte(U2, T2, z);
  const koeff = werte.map((w) => koeffizienten(w, T, V, z));
  const stellen: [Empfaenger, Empfaenger] = [0, 1].map((b) => ({ adresse: adresseVon(STELLEN_SCHL[b]), pub: pubVon(STELLEN_SCHL[b]) })) as [Empfaenger, Empfaenger];
  const probe = probeV2(K, X, von, Y2, U2, T2, XM2, werte, z);
  const buendel: string[] = [];
  const buendelSig: string[] = [];
  for (let e = 1; e <= V; e++) {
    if (e === X) {
      buendel.push('');
      buendelSig.push('');
      continue;
    }
    const oeffnung = anteilOeffnungPakete(K, X, e, von, bis, werte, koeff, probe.salze, stellen, z);
    const s = buendelVersiegeln(SCHL[X - 1], pubVon(SCHL[e - 1]), { K, von, bis, praeparator: X, empfaenger: e, anteile: koeff.map((k) => anteilAus(k, e)), oeffnung }, z);
    buendel.push(s.chiffrat);
    buendelSig.push(s.sig);
  }
  const fi = fuerInhaberin({ adresse: adresseVon(INH_SCHL), pub: pubVon(INH_SCHL) }, K, von, bis, XM2, z);
  const antwort = antwortUnterschreiben(SCHL[X - 1], {
    k: K, x: X, von, bis, blaetter: blaetter(K, von, werte), fuer_inhaberin: fi, buendel, buendel_sig: buendelSig,
    teile: probe.teile, zaehlung: probe.zaehlung,
  });
  const oeffnungen = [0, 1].map((b) => oeffnungFuerStelle(stellen[b], K, b, X, von, bis, werte, probe.salze[b], z));
  return {
    hinweis: 'B4b-3b: Antwort der App als Praeparatorin mit Stichprobe v2 (lib/quantenSPraeparieren.ts). Schluessel NUR fuer Tests.',
    schluessel_nur_test: SCHL,
    validatoren: SCHL.map(adresseVon),
    stellen_schluessel_nur_test: STELLEN_SCHL,
    stellen: stellen.map((s) => s.adresse),
    inhaberin_schluessel_nur_test: INH_SCHL,
    inhaberin: adresseVon(INH_SCHL),
    k: K, n: N2, v: V, t: T, x: X, von, bis, y: Y2, u: U2, t_werte: T2, x_messung: XM2,
    werte: werte.map((w) => w.toString(16)),
    koeff: koeff.map((k) => k.map((c) => c.toString(16))),
    salze: probe.salze,
    antwort,
    oeffnungen,
  };
}

describe('B4b-3b: Pruefvektor der Antwort', () => {
  const neu = antwortVektorBauen();
  if (process.env.AEQUITAS_VEKTOR_SCHREIBEN === '1') fs.writeFileSync(PFAD_ANTWORT, JSON.stringify(neu, null, 1) + '\n');
  const alt = JSON.parse(fs.readFileSync(PFAD_ANTWORT, 'utf8'));
  const werte = alt.werte.map((h: string) => BigInt('0x' + h));

  test('mit festem Zufall Byte fuer Byte wie im Vektor (der Knoten prueft genau diese Antwort)', () => {
    expect(neu).toEqual(alt);
    expect([alt.von, alt.bis]).toEqual([8, 16]);
  });

  test('Antwort: unterschrieben von der Praeparatorin; Zaehlung und Teil-Hashes passen zu Stichprobe und Stellen-Bits', () => {
    const a = alt.antwort;
    expect(a.validator).toBe(alt.validatoren[X - 1]);
    expect(a.zaehlung).toEqual([0, 1].map((b) => {
      let tr = 0, fe = 0;
      werte.forEach((w: bigint, i: number) => {
        if (stellenBit(w) === b && Y2[i] === U2[i]) {
          tr++;
          if (XM2[i] !== T2[i]) fe++;
        }
      });
      return [tr, fe];
    }));
    expect(a.zaehlung[0][0] + a.zaehlung[1][0]).toBe(Y2.filter((y, i) => y === U2[i]).length);
    expect(a.teile[1]).toBe(probeTeilHash(K, 1, X, alt.salze[1], werte.flatMap((w: bigint, i: number) => (stellenBit(w) === 1 ? [alt.von + i] : []))));
    expect(a.buendel[X - 1]).toBe('');
  });

  test('Inhaberin liest x; jede Stelle liest genau ihre Werte und Pakete', () => {
    const fi = JSON.parse(ethers.toUtf8String(eciesOeffnen(INH_SCHL, alt.antwort.fuer_inhaberin)));
    expect(fi).toEqual({ dom: 'aequitas-quanten-s-fuer-inhaberin-v1', k: K, von: 8, bis: 16, x: XM2.join('') });
    for (const b of [0, 1]) {
      const oe = JSON.parse(ethers.toUtf8String(eciesOeffnen(STELLEN_SCHL[b], alt.oeffnungen[b])));
      expect(oe.salz).toBe(alt.salze[b]);
      for (const wh of Object.values(oe.werte) as string[]) expect(stellenBit(BigInt('0x' + wh))).toBe(b);
      expect(Object.keys(oe.werte).length).toBe(werte.filter((w: bigint) => stellenBit(w) === b).length);
      expect(() => eciesOeffnen(STELLEN_SCHL[1 - b], alt.oeffnungen[b])).toThrow();
    }
  });
});

describe('B4b-3b: Abweisungen', () => {
  const z = festerZufall('abw');
  const st = { adresse: adresseVon(STELLEN_SCHL[0]), pub: pubVon(STELLEN_SCHL[0]) };
  test('Schluessel muss zur Adresse gehoeren', () => {
    expect(schluesselPruefen(st.pub, st.adresse)).toBe(st.pub);
    expect(() => schluesselPruefen(st.pub, adresseVon(STELLEN_SCHL[1]))).toThrow('Adresse');
    expect(() => schluesselPruefen('04' + '00'.repeat(64), st.adresse)).toThrow();
    expect(() => schluesselPruefen('02' + '11'.repeat(32), st.adresse)).toThrow('Form');
    expect(() => fuerInhaberin({ ...st, adresse: adresseVon(SCHL[0]) }, K, 0, 2, [0, 1], z)).toThrow('Adresse');
  });
  test('Laengen, Bits, Salz, Stelle', () => {
    expect(() => probeV2(K, 1, 0, [0], [0, 1], [0, 1], [0, 1], [1n, 2n], z)).toThrow('Laengen');
    expect(() => probeV2(K, 1, 0, [0, 2], [0, 1], [0, 1], [0, 1], [1n, 2n], z)).toThrow('y');
    expect(() => fuerInhaberin(st, K, 0, 3, [0, 1], z)).toThrow('x');
    expect(() => oeffnungFuerStelle(st, K, 2, 1, 0, 1, [4n], null, z)).toThrow('Stelle');
    expect(() => oeffnungFuerStelle(st, K, 0, 1, 0, 1, [4n], 'zz', z)).toThrow('Salz');
    expect(() => anteilOeffnungPakete(K, 1, 2, 0, 1, [4n], [[4n]], ['00'.repeat(32)], [st, st], z)).toThrow('Laengen');
    expect(() => buendelJson({ K, von: 0, bis: 1, praeparator: 1, empfaenger: 2, anteile: [1n], oeffnung: ['ab'] })).toThrow('Pakete');
  });
  test('Antwort: kein Buendel an sich selbst, Teile nur mit Zaehlung', () => {
    const basis = { k: K, x: 1, von: 0, bis: 1, blaetter: ['00'.repeat(32)], fuer_inhaberin: 'ab', buendel: ['', 'cd'], buendel_sig: ['', 'ef'] };
    expect(antwortUnterschreiben(SCHL[0], basis).validator).toBe(adresseVon(SCHL[0]));
    expect(() => antwortUnterschreiben(SCHL[0], { ...basis, buendel: ['x', 'cd'] })).toThrow('selbst');
    expect(() => antwortUnterschreiben(SCHL[0], { ...basis, teile: ['a', 'b'] })).toThrow('zusammen');
  });
});
