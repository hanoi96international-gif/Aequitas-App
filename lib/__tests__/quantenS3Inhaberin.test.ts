/**
 * lib/quantenS3Inhaberin.ts (Weg C, C2b-2b-3c): die App als Inhaberin über
 * eine Quantenleitung -- Abschnitte, Meldung und Teilmenge gleich wie Knoten
 * und Spezifikation (s_kette.py --vektor-s3-sender, --vektor-s3-meldung),
 * Melden und Ziehen. Der Prüfvektor quanten_s3_inhaberin_vektor.json entsteht
 * hier; der Knoten nimmt genau diese Körper mit seinem Code an
 * (quanten_s3_inhaberin_vektor_test.go).
 */
import * as fs from 'fs';
import * as path from 'path';
import { ethers } from 'ethers';
import {
  abschnittPulse,
  kodieren,
  meldenBauen,
  meldenNachricht,
  meldungHash,
  meldungPruefenAbschnitte,
  S3Vormerkung,
  teilmengeAbschnitte,
  teilNachZiehen,
  vormerkungLesen,
  ziehenBauen,
  ziehRunde,
  zeitDerRunde,
} from '../quantenS3Inhaberin';
import { EmpfaengerMessung, empfaengerLesen, empfaengerNachbau, teilmenge } from '../quantenSEmpfaenger';
import { adresseVon, unterschriftVon } from '../quantenS';

const sender = require('./vektoren/quanten_s3_sender_vektor.json');
const meldungVektor = require('./vektoren/quanten_s3_meldung_vektor.json');

// Echte quicknet-Runde (wie quantenSAusgeber.test.ts): der Knoten prüft sie mit dem echten Schlüssel.
const ECHT_RUNDE = 1000000;
const ECHT_SIG = '83ad29e4c409f9470fc2ef02f90214df49e02b441a1a241a82d622d9f608ef98fd8b11a029f1bee9d9e83b45088abe72';
const SCHL = '5c'.repeat(32); // NUR für Tests
const ICH = adresseVon(SCHL);
const AUSGEBER = '0x' + '12'.repeat(20);
const MELDEZEIT = zeitDerRunde(ECHT_RUNDE) - 600;

function messung(k: string, nPuls: number, pulse: number[]): EmpfaengerMessung {
  return { k, nPuls, pulse, basen: new Uint8Array(pulse.length), bits: new Uint8Array(pulse.length) };
}

function ansicht(o: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    k: 'cd'.repeat(32), art: 's3', von: AUSGEBER, inhaber: ICH, leitung: 'leitung-test', theta: 20, frei: 50_000, gamma: 200_000,
    n_puls: 3000, sender: 3, wurzel: '5a'.repeat(32), deckung: 2_000_000, pfand: 1_000_000, zeit: MELDEZEIT - 100,
    frist: MELDEZEIT - 100 + 3600, gemeldet: 0, ...o,
  };
}

function zufallsquelle(saat: number) {
  let s = saat >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('gleich wie Knoten und Spezifikation', () => {
  it('Abschnitte und Teilmenge je Abschnitt (s_kette.py --vektor-s3-sender)', () => {
    expect(sender.faelle.length).toBeGreaterThanOrEqual(6);
    for (const f of sender.faelle) {
      for (let x = 1; x <= f.v; x++) expect(abschnittPulse(sender.n_puls, f.v, x)).toEqual(f.abschnitte[x - 1]);
      expect(teilmengeAbschnitte(sender.k, sender.lambda, sender.zufall, 5, 6, sender.n_puls, f.v, f.n_max)).toEqual(f.teil);
      if (f.v === 1) expect(teilmenge(sender.k, sender.lambda, sender.zufall, 5, 6, f.n_max)).toEqual(f.teil);
    }
  });

  it('Meldung je Abschnitt (gleiche Urteile)', () => {
    for (const m of sender.meldungen) {
      const ok = (() => {
        try {
          meldungPruefenAbschnitte(messung(sender.k, sender.n_puls, m.lambda), m.gamma_det_ppm, m.v);
          return true;
        } catch {
          return false;
        }
      })();
      expect(ok).toBe(m.ok);
    }
  });

  it('Kodierung (s_kette.py --vektor-s3-meldung)', () => {
    for (const g of meldungVektor.gut) expect(kodieren(g.lambda)).toBe(g.text);
    expect(() => kodieren([])).toThrow();
    expect(() => kodieren([3, 3])).toThrow();
    expect(() => kodieren([1 << 26])).toThrow();
  });

  it('ziehRunde wie quantenS3ZiehRunde', () => {
    expect(ziehRunde(MELDEZEIT)).toBe(ECHT_RUNDE);
    expect(ziehRunde(MELDEZEIT + 1)).toBe(ECHT_RUNDE + 1);
    expect(ziehRunde(MELDEZEIT - 3)).toBe(ECHT_RUNDE - 1);
  });
});

describe('Vormerkung streng lesen', () => {
  const K = 'cd'.repeat(32);
  it('Gutfall', () => {
    const v = vormerkungLesen(ansicht(), K);
    expect(v.sender).toBe(3);
    expect(v.inhaber).toBe(ICH);
  });
  it.each([
    ['andere Art', { art: 's' }],
    ['anderes K', { k: 'ef'.repeat(32) }],
    ['Sender 0', { sender: 0 }],
    ['Sender über 64', { sender: 65 }],
    ['gamma 0', { gamma: 0 }],
    ['Inhaberin keine Adresse', { inhaber: 'anna' }],
    ['Leitung ohne Präfix', { leitung: 'satz-x' }],
    ['gemeldet ohne Hash', { gemeldet: 5 }],
    ['Runde passt nicht zur Meldezeit', { gemeldet: 5, meldung: 'ab'.repeat(32), meldung_zeit: MELDEZEIT, runde: ECHT_RUNDE + 1 }],
    ['gezogen ohne Meldung', { gezogen: 10 }],
  ])('%s: abgewiesen', (_name, o) => {
    expect(() => vormerkungLesen(ansicht(o), K)).toThrow();
  });
});

describe('melden', () => {
  const K = 'cd'.repeat(32);
  const v = (): S3Vormerkung => vormerkungLesen(ansicht(), K);
  const gut = () => {
    const pulse: number[] = [];
    for (let x = 0; x < 3; x++) for (let i = 0; i < 250; i++) pulse.push(x * 1000 + i * 4);
    return messung(K, 3000, pulse);
  };

  it('Gutfall: Körper genau mit diesen Feldern, Unterschrift über den Hash', () => {
    const m = meldenBauen(SCHL, v(), gut(), MELDEZEIT);
    const o = JSON.parse(m.koerper);
    expect(Object.keys(o).sort()).toEqual(['quanten_w', 'wallet', 'zeit']);
    expect(Object.keys(o.quanten_w).sort()).toEqual(['k', 'meldung', 'wallet_sig']);
    expect(o.wallet).toBe(ICH);
    expect(o.zeit).toBe(0);
    expect(o.quanten_w.meldung).toBe(m.text);
    expect(unterschriftVon(meldenNachricht(ICH, K, meldungHash(m.text)), o.quanten_w.wallet_sig, ICH)).toBe(true);
  });

  it('fremde Inhaberin, schon gemeldet, verfallen, andere Messung: abgewiesen', () => {
    expect(() => meldenBauen('6d'.repeat(32), v(), gut(), MELDEZEIT)).toThrow('anderen Inhaberin');
    expect(() => meldenBauen(SCHL, vormerkungLesen(ansicht({ gemeldet: 1, meldung: 'ab'.repeat(32), meldung_zeit: MELDEZEIT, runde: ECHT_RUNDE }), K), gut(), MELDEZEIT))
      .toThrow('schon gemeldet');
    expect(() => meldenBauen(SCHL, v(), gut(), v().frist + 1)).toThrow('verfallen');
    expect(() => meldenBauen(SCHL, v(), messung(K, 2999, gut().pulse.filter((p) => p < 2999)), MELDEZEIT)).toThrow('passt nicht');
    expect(() => meldenBauen(SCHL, v(), messung('ef'.repeat(32), 3000, gut().pulse), MELDEZEIT)).toThrow('passt nicht');
  });

  it('Angriff: fast nur Pulse von Sender 1 und 3 (im Bund) -- die App meldet das nicht', () => {
    const pulse: number[] = [];
    for (let i = 0; i < 1000; i++) pulse.push(i); // Abschnitt 1 voll
    for (let i = 2000; i < 3000; i++) pulse.push(i); // Abschnitt 3 voll
    pulse.splice(1000, 0, 1000, 1001); // Abschnitt 2: zwei Pulse
    expect(() => meldenBauen(SCHL, v(), messung(K, 3000, pulse), MELDEZEIT)).toThrow('Abschnitt 2');
    // mit einem Sender reicht die Summe
    expect(() => meldenBauen(SCHL, vormerkungLesen(ansicht({ sender: 1 }), K), messung(K, 3000, pulse), MELDEZEIT)).not.toThrow();
  });
});

describe('ziehen', () => {
  const K = 'cd'.repeat(32);
  it('Körper und Teilmenge; falsche Meldung oder schon gezogen abgewiesen', () => {
    const pulse: number[] = [];
    for (let x = 0; x < 3; x++) for (let i = 0; i < 250; i++) pulse.push(x * 1000 + i * 4);
    const m = meldenBauen(SCHL, vormerkungLesen(ansicht(), K), messung(K, 3000, pulse), MELDEZEIT);
    const v = vormerkungLesen(ansicht({ gemeldet: m.lambda.length, meldung: meldungHash(m.text), meldung_zeit: MELDEZEIT, runde: ECHT_RUNDE }), K);
    const o = JSON.parse(ziehenBauen(v, m.text, ECHT_SIG));
    expect(o).toEqual({ wallet: '', zeit: 0, quanten_w: { k: K, meldung: m.text, runde: ECHT_RUNDE, runde_sig: ECHT_SIG } });
    expect(() => ziehenBauen(v, kodieren(m.lambda.slice(1)), ECHT_SIG)).toThrow('nicht die gemeldete');
    expect(() => ziehenBauen(vormerkungLesen(ansicht({ ...v, gemeldet: m.lambda.length, meldung: meldungHash(m.text), meldung_zeit: MELDEZEIT, runde: ECHT_RUNDE, gezogen: 750 }), K), m.text, ECHT_SIG))
      .toThrow('schon gezogen');
    const teil = teilNachZiehen(v, m.lambda, ECHT_SIG);
    expect(teil.length).toBe(750);
    for (let x = 1; x <= 3; x++) {
      const [von, bis] = abschnittPulse(3000, 3, x);
      expect(teil.slice((x - 1) * 250, x * 250).every((p) => p >= von && p < bis)).toBe(true);
    }
  });

  it('mit dem Nachbau-Empfänger: messen, melden, Teilmenge aus der Messung', () => {
    const rnd = zufallsquelle(77);
    const text = empfaengerNachbau({ k: K, nPuls: 3000, pDet: 0.3, fehler: 0.01, praeparation: () => ({ u: 0, t: 1 }), zufall: rnd });
    const e = empfaengerLesen(text, K);
    const m = meldenBauen(SCHL, vormerkungLesen(ansicht(), K), e, MELDEZEIT);
    expect(m.lambda).toEqual(e.pulse);
  });
});

// ------------------------------------------------------------ Prüfvektor App -> Knoten

const PFAD = path.join(__dirname, 'vektoren', 'quanten_s3_inhaberin_vektor.json');

function vektorBauen() {
  const K = ethers.sha256(ethers.toUtf8Bytes('aequitas-c2b2b3c-vektor')).slice(2);
  const nPuls = 6000;
  const roh = ansicht({ k: K, n_puls: nPuls, sender: 3, gemeldet: 0 });
  const v = vormerkungLesen(roh, K);
  const rnd = zufallsquelle(2711);
  const pulse: number[] = [];
  for (let i = 0; i < nPuls; i++) if (rnd() < 0.25) pulse.push(i);
  const m = meldenBauen(SCHL, v, messung(K, nPuls, pulse), MELDEZEIT);
  const gemeldet = vormerkungLesen({ ...roh, gemeldet: m.lambda.length, meldung: meldungHash(m.text), meldung_zeit: MELDEZEIT, runde: ziehRunde(MELDEZEIT) }, K);
  return {
    hinweis: 'Aus der App (lib/__tests__/quantenS3Inhaberin.test.ts); der Knoten nimmt genau diese Körper an.',
    schluessel_nur_test: SCHL,
    wallet: ICH,
    k: K,
    n_puls: nPuls,
    sender: 3,
    gamma: 200_000,
    meldezeit: MELDEZEIT,
    koerper_melden: m.koerper,
    runde: ECHT_RUNDE,
    runde_sig: ECHT_SIG,
    koerper_ziehen: ziehenBauen(gemeldet, m.text, ECHT_SIG),
    teil: teilNachZiehen(gemeldet, m.lambda, ECHT_SIG),
  };
}

describe('C2b-2b-3c: Prüfvektor', () => {
  const neu = vektorBauen();
  if (process.env.AEQUITAS_VEKTOR_SCHREIBEN === '1') fs.writeFileSync(PFAD, JSON.stringify(neu, null, 1) + '\n');
  const alt = JSON.parse(fs.readFileSync(PFAD, 'utf8'));
  it('Byte für Byte wie im Vektor (der Knoten prüft genau ihn)', () => {
    expect(neu).toEqual(alt);
    expect(alt.runde).toBe(ziehRunde(alt.meldezeit));
  });
});
