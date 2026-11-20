// Die App als Inhaberin (lib/quantenS.ts) gegen den Pruefvektor des Knotens
// (aequitas x/humanity/keeper/quanten_s_inhaberin_vektor_test.go): dieselben
// Nachrichten, dieselben Unterschriften, dasselbe x aus denselben Chiffraten.
import vektor from './vektoren/quanten_s_inhaberin_vektor.json';
import {
  abschnitt,
  abschnittPruefen,
  annehmen,
  antwortNachricht,
  adresseVon,
  binden,
  bindenNachricht,
  bitsZuHex,
  eciesOeffnen,
  fuerInhaberinOeffnen,
  hashListe,
  hexZuBits,
  kanonisch,
  kNote,
  merkleWurzel,
  probeHashV2,
  pubVon,
  QuantenSFehler,
  unterschreiben,
  unterschriftVon,
  vorlageText,
  wahlNachricht,
  bestuende,
  type PaketAbschnitt,
} from '../quantenS';

const V = vektor as any;
const schl: string = V.inhaberin_schluessel_nur_test;
const abschnitte: PaketAbschnitt[] = V.abschnitte.map((a: any) => a.abschnitt);
const validatoren: string[] = V.abschnitte.map((a: any) => a.validator);
const kopie = <T>(x: T): T => JSON.parse(JSON.stringify(x));

describe('quantenS: wie der Knoten', () => {
  test('Schluessel, Adresse, oeffentlicher Schluessel', () => {
    expect(V.chain_id).toBe(1926);
    expect(adresseVon(schl)).toBe(V.inhaberin);
    expect(pubVon(schl)).toBe(V.inhaberin_pub);
  });

  test('Abschnitte, Blatt-Hash, Nachricht und Unterschrift jedes Validators', () => {
    V.abschnitte.forEach((a: any, i: number) => {
      const ab = a.abschnitt;
      expect(abschnitt(V.n, V.v, i + 1)).toEqual({ von: ab.von, bis: ab.bis });
      expect(hashListe(ab.blaetter)).toBe(a.blaetter_hash);
      expect(antwortNachricht(V.k, ab.x, ab.von, ab.bis, hashListe(ab.blaetter), ab.fuer_inhaberin, ab.buendel_hash, ab.buendel_sig_hash, ab.teile, ab.zaehlung)).toBe(a.nachricht);
      expect(unterschriftVon(a.nachricht, ab.sig, a.validator)).toBe(true);
      expect(() => abschnittPruefen(ab, V.k, V.n, V.v, i + 1, a.validator)).not.toThrow();
    });
  });

  test('x aus fuer_inhaberin (ECIES wie go-ethereum)', () => {
    let x = '';
    V.abschnitte.forEach((a: any) => {
      x += fuerInhaberinOeffnen(schl, a.abschnitt.fuer_inhaberin, V.k, a.abschnitt.von, a.abschnitt.bis);
      expect(fuerInhaberinOeffnen(schl, a.abschnitt.fuer_inhaberin, V.k, a.abschnitt.von, a.abschnitt.bis)).toBe(a.x);
    });
    expect(x).toBe(V.x);
  });

  test('Wurzel und Proben', () => {
    const blaetter = abschnitte.flatMap((a) => a.blaetter);
    expect(merkleWurzel(blaetter)).toBe(V.wurzel);
    for (let s = 0; s < 2; s++) {
      expect(probeHashV2(V.k, s, abschnitte.map((a) => a.teile![s]))).toBe(V.proben[s]);
    }
  });

  test('Bindung, Wahl, Vorlage: dieselben Nachrichten und Unterschriften', () => {
    expect(binden(V.y, V.z)).toBe(V.d);
    expect(bindenNachricht(V.inhaberin, V.k, V.d)).toBe(V.binden_nachricht);
    expect(unterschreiben(schl, V.binden_nachricht)).toBe(V.binden_sig);
    expect(V.c).toBe(String(V.stelle ^ V.z));
    expect(wahlNachricht(V.inhaberin, V.k, V.c)).toBe(V.wahl_nachricht);
    expect(unterschreiben(schl, V.wahl_nachricht)).toBe(V.wahl_sig);
    expect(vorlageText(V.k, V.stelle, V.x)).toBe(V.vorlage_text);
    expect(unterschreiben(schl, V.vorlage_text)).toBe(V.vorlage.vorlage);
    expect(V.vorlage).toEqual({ k: V.k, b: V.stelle, x: V.x, vorlage: V.vorlage.vorlage });
  });

  test('Bits kompakt (SecureStore: hoechstens 2048 Byte je Wert)', () => {
    for (const bits of ['', '1', '0101', '10110', V.x, '1'.repeat(1104)]) {
      expect(hexZuBits(bitsZuHex(bits), bits.length)).toBe(bits);
    }
    expect(bitsZuHex('1'.repeat(1104)).length).toBe(276);
    expect(() => hexZuBits('f', 1)).toThrow(QuantenSFehler); // Rest muss 0 sein
    expect(() => hexZuBits('0', 5)).toThrow(QuantenSFehler); // Laenge
    expect(() => hexZuBits('g', 4)).toThrow(QuantenSFehler);
  });

  test('Tabelle und Urteil wie im Knoten', () => {
    expect(kNote(2, 1, 1)).toBe(552);
    expect(kNote(2, 3, 4)).toBe(1760);
    expect(kNote(4, 3, 4)).toBe(5200);
    expect(kNote(7, 1, 1)).toBe(0);
    expect(bestuende(100, 2, 2)).toBe(true);
    expect(bestuende(100, 3, 2)).toBe(false);
    expect(bestuende(3, 0, 2)).toBe(false); // weniger als 4 Treffer: unentschieden
  });
});

describe('quantenS: Missbrauch', () => {
  test('Chiffrat fuer einen anderen Schluessel, veraendert oder ohne Form', () => {
    expect(() => fuerInhaberinOeffnen(schl, V.falsch_fuer_inhaberin, V.k, 0, 5)).toThrow('nicht fuer diesen Schluessel');
    const c: string = abschnitte[0].fuer_inhaberin;
    const kippen = (i: number) => c.slice(0, i) + (c[i] === '0' ? '1' : '0') + c.slice(i + 1);
    expect(() => eciesOeffnen(schl, kippen(200))).toThrow(QuantenSFehler); // Chiffrat
    expect(() => eciesOeffnen(schl, kippen(c.length - 3))).toThrow(QuantenSFehler); // Tag
    expect(() => eciesOeffnen(schl, kippen(10))).toThrow(QuantenSFehler); // R
    expect(() => eciesOeffnen(schl, 'zz')).toThrow(QuantenSFehler);
    expect(() => eciesOeffnen(schl, '04')).toThrow(QuantenSFehler);
    // Richtiger Schluessel, aber anderes K oder anderer Abschnitt.
    expect(() => fuerInhaberinOeffnen(schl, c, '0'.repeat(64), 0, 5)).toThrow('passt nicht');
    expect(() => fuerInhaberinOeffnen(schl, c, V.k, 0, 4)).toThrow('passt nicht');
  });

  test('Abschnitt: fremder Validator, veraendertes Blatt, Teil, Zaehlung, Form', () => {
    const fall = (f: (a: any) => void, validator = validatoren[0]) => {
      const a = kopie(abschnitte[0]);
      f(a);
      return () => abschnittPruefen(a, V.k, V.n, V.v, 1, validator);
    };
    expect(fall(() => {}, validatoren[1])).toThrow('nicht von Validator 1');
    expect(fall((a) => (a.blaetter[0] = 'ab'.repeat(32)))).toThrow('nicht von Validator 1');
    expect(fall((a) => (a.teile[0] = 'cd'.repeat(32)))).toThrow('nicht von Validator 1');
    expect(fall((a) => (a.zaehlung[1][0] += 1))).toThrow('nicht von Validator 1');
    expect(fall((a) => (a.fuer_inhaberin = V.falsch_fuer_inhaberin))).toThrow('nicht von Validator 1');
    expect(fall((a) => (a.sig = a.sig.slice(0, -2) + '00'))).toThrow('nicht von Validator 1');
    expect(fall((a) => (a.x = 2))).toThrow('nicht die Form');
    expect(fall((a) => a.blaetter.pop())).toThrow('nicht die Form');
    expect(fall((a) => (a.buendel_hash = 'xx'))).toThrow('nicht die Form');
  });

  test('Unterschrift: nur kanonische Form', () => {
    const sig: string = V.binden_sig;
    expect(unterschriftVon(V.binden_nachricht, sig, V.inhaberin)).toBe(true);
    expect(unterschriftVon(V.binden_nachricht, sig.toUpperCase().replace('0X', '0x'), V.inhaberin)).toBe(false);
    expect(unterschriftVon(V.binden_nachricht, sig.slice(0, -2) + '01', V.inhaberin)).toBe(false);
    expect(unterschriftVon(V.binden_nachricht + 'x', sig, V.inhaberin)).toBe(false);
    expect(unterschriftVon(V.binden_nachricht, sig, validatoren[0])).toBe(false);
    // Gespiegelt (s' = N - s, v umgedreht): der Knoten weist sie ab (homestead).
    // ethers 6.17 auch ("non-canonical s"); die App prueft es zusaetzlich selbst
    // wie der Knoten, unabhaengig von der Bibliothek.
    const N = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');
    const s2 = (N - BigInt('0x' + sig.slice(66, 130))).toString(16).padStart(64, '0');
    const gespiegelt = sig.slice(0, 66) + s2 + (sig.endsWith('1b') ? '1c' : '1b');
    expect(() => require('ethers').ethers.verifyMessage(V.binden_nachricht, gespiegelt)).toThrow('non-canonical s');
    expect(kanonisch(gespiegelt)).toBe(false);
    expect(unterschriftVon(V.binden_nachricht, gespiegelt, V.inhaberin)).toBe(false);
    expect(kanonisch('0x' + '0'.repeat(64) + sig.slice(66))).toBe(false); // r = 0
    expect(kanonisch(sig)).toBe(true);
  });
});

describe('quantenS: annehmen gegen die Kette', () => {
  const bestellung = {
    n: V.n,
    basen: [V.y.slice(0, 5), V.y.slice(5)],
    inhaberin: V.inhaberin,
    inhaberin_schluessel: V.inhaberin_pub,
    stellen: [
      { adresse: '0x' + '1'.repeat(40), schluessel: '' },
      { adresse: '0x' + '2'.repeat(40), schluessel: '' },
    ] as any,
  };
  const stand = () =>
    ({
      k: V.k, art: 's', n: V.n, t: 1, v: V.v, tol: 2, inhaber: V.inhaberin, stellen: [bestellung.stellen[0].adresse, bestellung.stellen[1].adresse],
      gebunden: false, gewaehlt: false, fehl: 0, probe_art: 2, wurzel: V.wurzel, proben: V.proben,
    }) as Record<string, unknown>;
  const lauf = (o: Partial<Parameters<typeof annehmen>[0]> = {}) =>
    annehmen({ schluessel: schl, bestellung, validatoren, K: V.k, stand: stand(), abschnitte: kopie(abschnitte), ...o });

  // Ein Validator unterschreibt seinen (veraenderten) Abschnitt selbst --
  // nur mit den Test-Schluesseln des Vektors moeglich.
  const neuUnterschrieben = (i: number, f: (a: PaketAbschnitt) => void): PaketAbschnitt[] => {
    const ab = kopie(abschnitte);
    f(ab[i]);
    const a = ab[i];
    a.sig = unterschreiben(
      V.abschnitte[i].validator_schluessel_nur_test,
      antwortNachricht(V.k, a.x, a.von, a.bis, hashListe(a.blaetter), a.fuer_inhaberin, a.buendel_hash, a.buendel_sig_hash, a.teile, a.zaehlung),
    );
    return ab;
  };

  test('Gutfall: x wie im Vektor, Zaehlungen je Stelle', () => {
    const erg = lauf();
    expect(erg.x).toBe(V.x);
    expect(erg.treffer).toEqual([3 + 4, 2 + 3]);
    expect(erg.fehler).toEqual([0, 0]);
  });

  test('vom Validator unterschrieben, aber die ehrliche Vorlage bestuende nicht', () => {
    const ab = neuUnterschrieben(1, (a) => (a.zaehlung![1] = [a.zaehlung![1][0], 2]));
    expect(() => lauf({ abschnitte: ab })).toThrow('BEFUND: nach den Zaehlungen der Validatoren bestuende die ehrliche Vorlage an Stelle 1 nicht');
  });

  test('vom Validator unterschrieben, aber Blatt, Teil oder Form passen nicht zur Kette', () => {
    expect(() => lauf({ abschnitte: neuUnterschrieben(0, (a) => (a.blaetter[2] = 'ef'.repeat(32))) })).toThrow('ergeben nicht die Wurzel');
    expect(() => lauf({ abschnitte: neuUnterschrieben(1, (a) => (a.teile![0] = '12'.repeat(32))) })).toThrow('Probe 0 passt nicht');
    expect(() => lauf({ abschnitte: neuUnterschrieben(0, (a) => (a.teile = null)) })).toThrow('Teil-Hashes oder Zaehlung fehlen');
    expect(() => lauf({ abschnitte: neuUnterschrieben(0, (a) => (a.zaehlung![0] = [6, 0])) })).toThrow('Teil-Hash oder Zaehlung'); // mehr Treffer als Stellen
    expect(() => lauf({ abschnitte: neuUnterschrieben(0, (a) => (a.zaehlung![0] = [2, 3])) })).toThrow('Teil-Hash oder Zaehlung'); // mehr Fehler als Treffer
    // Ein fremdes Chiffrat (fuer einen anderen Schluessel), vom Validator unterschrieben.
    expect(() => lauf({ abschnitte: neuUnterschrieben(0, (a) => (a.fuer_inhaberin = V.falsch_fuer_inhaberin)) })).toThrow('nicht fuer diesen Schluessel');
  });

  test('Abweichungen der Kette', () => {
    const mit = (f: (s: Record<string, unknown>) => void) => {
      const s = stand();
      f(s);
      return () => lauf({ stand: s });
    };
    expect(() => lauf({ stand: null })).toThrow('nicht auf der Kette');
    expect(mit((s) => (s.probe_art = undefined))).toThrow('Stichprobe v2');
    expect(mit((s) => (s.inhaber = validatoren[0]))).toThrow('jemand anderem');
    expect(mit((s) => (s.n = 12))).toThrow('n oder v');
    expect(mit((s) => (s.v = 3))).toThrow('n oder v');
    expect(mit((s) => (s.t = 3))).toThrow('Schwelle');
    expect(mit((s) => (s.tol = 7))).toThrow('Schwelle');
    expect(mit((s) => (s.stellen = [bestellung.stellen[1].adresse, bestellung.stellen[0].adresse]))).toThrow('Annahmestellen');
    expect(mit((s) => (s.wurzel = '00'.repeat(32)))).toThrow('Wurzel');
    expect(mit((s) => (s.proben = [V.proben[1], V.proben[0]]))).toThrow('Probe 0');
    expect(mit((s) => (s.gebunden = true))).toThrow('BEFUND');
    expect(mit((s) => (s.fehl = 1))).toThrow('BEFUND');
    expect(mit((s) => (s.tot = true))).toThrow('tot');
  });

  test('Eingaben der App', () => {
    expect(() => lauf({ K: 'kein K' })).toThrow('K');
    expect(() => lauf({ validatoren: [validatoren[0]] })).toThrow('n oder v');
    expect(() => lauf({ validatoren: [validatoren[1], validatoren[0]] })).toThrow('nicht von Validator 1');
    expect(() => lauf({ schluessel: '52'.repeat(32) })).toThrow('gehoert nicht zur Bestellung');
    expect(() => lauf({ abschnitte: kopie(abschnitte).slice(0, 1) })).toThrow('1 Abschnitte fuer 2');
  });
});
