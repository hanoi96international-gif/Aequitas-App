/**
 * Eineiige Zwillinge (coordinator/app/zwilling.py in aequitas-biometric-beta).
 *
 * Festgehalten:
 *   - beide Wallet-Signaturen Byte fuer Byte wie in Python (eth_keys, private
 *     Schluessel 0x51..51 fuer A und 0x52..52 fuer B wie in test_zwilling.py,
 *     Anfrage "ab"*16, Nonce "nonce-1"); eine Lebensnachweis- oder
 *     Erneuerungs-Signatur gilt dort nicht;
 *   - der QR-Code wird fail-closed gelesen und fuehrt nur zu einem
 *     Coordinator aus den EIGENEN Kandidaten;
 *   - das Warten auf die Zustimmung ist begrenzt;
 *   - jeder Status hat eine eigene Meldung;
 *   - Richtung -> Anweisung, auch unter Spiegelung;
 *   - die Registrierung schickt alle gemeinsamen Felder an den Coordinator
 *     der Anfrage, und nur dorthin.
 */
import { ethers } from 'ethers';

jest.mock('expo-crypto', () => ({ randomUUID: () => 'x' }));
jest.mock('expo-file-system/legacy', () => ({ deleteAsync: jest.fn() }), { virtual: true });
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock('../attestation', () => ({ attestierungAnhaengen: async () => undefined }));
jest.mock('../api', () => ({ submitLivenessRenewal: jest.fn(), submitProofOfLife: jest.fn() }));

const zw = jest.requireActual('../zwilling');

const PRIV_A = '0x' + '51'.repeat(32);
const PRIV_B = '0x' + '52'.repeat(32);
const WALLET_A = '0xfA17c5B66A985F44Bc249C8E8faBD64767f414B1';
const WALLET_B = '0x83279FAE0994Aa1A563377E889Cc2a1d96ADb3B1';
const A = WALLET_A.toLowerCase();
const B = WALLET_B.toLowerCase();
const ANFRAGE = 'ab'.repeat(16);
const EINWILLIGUNG = 'einwilligung-v4-2026-10-21';
// Seit ec9931a mit der Fassung, der A zugestimmt hat (Pruefung 21.10.2026,
// MEDIUM-2) -- Vektor aus Python wie zwilling.zustimmung_nachricht.
const PY_ZUSTIMMUNG = `aequitas-zwilling-v1|${A}|${B}|${ANFRAGE}|${EINWILLIGUNG}`;
const PY_ZUSTIMMUNG_SIG =
  '0x7ff5c9f0ea0cefd2c23f3fa9227600a61e17b3a6eeb2f8450f6a13ad62d5d9c127a9982763c5a425de79d9c4d22c95cc39db22f5a6ab4e9322098ae5cdf50cb81b';
// Die alte Form ohne Fassung (bis 63f6554) und ihre Signatur.
const ALT_ZUSTIMMUNG = `aequitas-zwilling-v1|${A}|${B}|${ANFRAGE}`;
const ALT_ZUSTIMMUNG_SIG =
  '0x7889a37b227712adc7ac0019ffc09774c53334141d8cac7f9e66ad7462e1570f1accde8f03dbcb6f6b92adf837b25c2f3345514e0c43ac94dc893e4f4c081f4b1c';
const PY_REGISTER = `aequitas-zwilling-register-v1|${B}|${ANFRAGE}|nonce-1`;
const PY_REGISTER_SIG =
  '0x1de40d4f6f46bb026d2a2939468ae04c83ab96e850467c9857a62ebd2ed7e18238fd6ed272e839d75340a32f2ea21d0c96f5ce9605f1ea8e3d9550963dd0c7451c';

const C1 = 'https://proof1.aequitas.example';
const C2 = 'https://proof2.aequitas.example:8443';

describe('Signaturen', () => {
  it('Zustimmung von A: Nachricht und Signatur wie in Python', async () => {
    const m = zw.zwillingZustimmungMessage(` ${WALLET_A} `, WALLET_B, ANFRAGE, EINWILLIGUNG);
    expect(m).toBe(PY_ZUSTIMMUNG);
    expect(await new ethers.Wallet(PRIV_A).signMessage(m)).toBe(PY_ZUSTIMMUNG_SIG);
  });

  it('Missbrauch: die alte Zustimmung ohne Fassung gilt fuer die neue Nachricht nicht', async () => {
    expect(await new ethers.Wallet(PRIV_A).signMessage(ALT_ZUSTIMMUNG)).toBe(ALT_ZUSTIMMUNG_SIG);
    expect(ethers.verifyMessage(PY_ZUSTIMMUNG, ALT_ZUSTIMMUNG_SIG).toLowerCase()).not.toBe(A);
    // ... und eine Zustimmung zu einer anderen Fassung auch nicht.
    const v3 = await new ethers.Wallet(PRIV_A).signMessage(zw.zwillingZustimmungMessage(A, B, ANFRAGE, 'einwilligung-v3-2026-10-02'));
    expect(ethers.verifyMessage(PY_ZUSTIMMUNG, v3).toLowerCase()).not.toBe(A);
  });

  it('Registrierung von B: Nachricht und Signatur wie in Python', async () => {
    const m = zw.zwillingRegisterMessage(WALLET_B, ANFRAGE, 'nonce-1');
    expect(m).toBe(PY_REGISTER);
    expect(await new ethers.Wallet(PRIV_B).signMessage(m)).toBe(PY_REGISTER_SIG);
  });

  it('Missbrauch: eine Lebensnachweis-, Erneuerungs- oder Nachzieh-Signatur gilt hier nicht', async () => {
    const bio = require('../biometricIdentity');
    const b = new ethers.Wallet(PRIV_B);
    for (const fremd of [
      bio.lebensnachweisMessage(WALLET_B, 'nonce-1'),
      bio.erneuernMessage(WALLET_B, 'nonce-1'),
      bio.nachziehenMessage(WALLET_B, 'nonce-1'),
    ]) {
      const sig = await b.signMessage(fremd);
      expect(ethers.verifyMessage(PY_REGISTER, sig).toLowerCase()).not.toBe(B);
    }
    // Und die beiden eigenen Domaenen sind nicht austauschbar.
    const sigZ = await new ethers.Wallet(PRIV_A).signMessage(PY_ZUSTIMMUNG);
    expect(ethers.verifyMessage(zw.zwillingRegisterMessage(WALLET_A, ANFRAGE, 'nonce-1'), sigZ).toLowerCase()).not.toBe(A);
  });
});

describe('QR-Code', () => {
  const kandidaten = [C1, C2];

  it('Hin und zurueck, mit dem Coordinator aus den eigenen Kandidaten', () => {
    const qr = zw.zwillingQrInhalt(ANFRAGE, WALLET_B, C2);
    expect(qr).toBe(`aequitas-zwilling:${ANFRAGE}:${B}:proof2.aequitas.example:8443`);
    expect(zw.zwillingQrLesen(qr, kandidaten)).toEqual({ anfrage: ANFRAGE, walletB: B, base: C2 });
    expect(zw.zwillingQrLesen(zw.zwillingQrInhalt(ANFRAGE, B, C1), kandidaten)?.base).toBe(C1);
  });

  it.each([
    ['fremder Coordinator', `aequitas-zwilling:${ANFRAGE}:${B}:evil.example`],
    ['richtiger Host, falscher Port', `aequitas-zwilling:${ANFRAGE}:${B}:proof2.aequitas.example`],
    ['Host mit Pfad', `aequitas-zwilling:${ANFRAGE}:${B}:proof1.aequitas.example/x`],
    ['Host mit Nutzer', `aequitas-zwilling:${ANFRAGE}:${B}:evil@proof1.aequitas.example`],
    ['URL statt Host', `aequitas-zwilling:${ANFRAGE}:${B}:https://proof1.aequitas.example`],
    ['ohne Host', `aequitas-zwilling:${ANFRAGE}:${B}`],
    ['anderes Praefix', `aequitas-zahlung:${ANFRAGE}:${B}:proof1.aequitas.example`],
    ['Anfrage gross', `aequitas-zwilling:${ANFRAGE.toUpperCase()}:${B}:proof1.aequitas.example`],
    ['Anfrage zu kurz', `aequitas-zwilling:${ANFRAGE.slice(1)}:${B}:proof1.aequitas.example`],
    ['Wallet kaputt', `aequitas-zwilling:${ANFRAGE}:${B.slice(0, 41)}:proof1.aequitas.example`],
    ['Wallet mit Gross', `aequitas-zwilling:${ANFRAGE}:${WALLET_B}:proof1.aequitas.example`],
    ['Zeilenumbruch', `aequitas-zwilling:${ANFRAGE}:${B}:proof1.aequitas.example\nx`],
    ['Host gross', `aequitas-zwilling:${ANFRAGE}:${B}:PROOF1.aequitas.example`],
    ['zu lang', `aequitas-zwilling:${ANFRAGE}:${B}:${'a'.repeat(500)}`],
    ['Zahlungslink', 'aequitas:pay?to=0x1'],
    ['leer', ''],
  ])('Missbrauch: %s -> abgelehnt', (_n, roh) => {
    expect(zw.zwillingQrLesen(roh, kandidaten)).toBeNull();
  });

  it('kein String, keine Kandidaten -> abgelehnt', () => {
    expect(zw.zwillingQrLesen(null, kandidaten)).toBeNull();
    expect(zw.zwillingQrLesen({ anfrage: ANFRAGE }, kandidaten)).toBeNull();
    expect(zw.zwillingQrLesen(zw.zwillingQrInhalt(ANFRAGE, B, C1), [])).toBeNull();
  });

  it('hostVon: nur http(s), ohne Nutzer, klein', () => {
    expect(zw.hostVon('https://Proof1.Aequitas.example/')).toBe('proof1.aequitas.example');
    expect(zw.hostVon('http://10.0.0.5:8000')).toBe('10.0.0.5:8000');
    expect(zw.hostVon('https://user@evil.example')).toBeNull();
    expect(zw.hostVon('ftp://proof1.aequitas.example')).toBeNull();
    expect(zw.hostVon('proof1.aequitas.example')).toBeNull();
  });

  it('ein nicht kanonischer Inhalt wird gar nicht erst erzeugt', () => {
    expect(() => zw.zwillingQrInhalt('xyz', B, C1)).toThrow();
    expect(() => zw.zwillingQrInhalt(ANFRAGE, '0x1', C1)).toThrow();
    expect(() => zw.zwillingQrInhalt(ANFRAGE, B, 'proof1')).toThrow();
  });
});

describe('Alle Mitglieder im Bild: Zahl der Gesichter', () => {
  it('aus der Zahl der Registrierten (1..3) wird 2..4', () => {
    expect(zw.gesichterAusRegistrierten(1)).toBe(2);
    expect(zw.gesichterAusRegistrierten(2)).toBe(3);
    expect(zw.gesichterAusRegistrierten(3)).toBe(4);
    for (const x of [0, 4, -1, 1.5, NaN, '1', null]) expect(zw.gesichterAusRegistrierten(x)).toBeNull();
  });

  it('nur 2..4 ist eine Zahl von Gesichtern', () => {
    expect([2, 3, 4].every(zw.istGesichterZahl)).toBe(true);
    for (const x of [1, 5, 0, 2.5, '2', true, null]) expect(zw.istGesichterZahl(x)).toBe(false);
  });
});

describe('Ungleiche Aufgabe -> Anweisung in der Vorschau', () => {
  const seiten = ['links', 'rechts'] as const;

  it.each([2, 3, 4])('%i Personen: jede Position und Seite ergibt genau ein Oval und eine Seite, immer gleich', (n) => {
    const gesehen = new Set<string>();
    for (let position = 0; position < n; position++) {
      for (const richtung of seiten) {
        const a = { gesichter: n, position, richtung };
        const v = zw.aufgabeInVorschau(a);
        expect(v).toEqual(zw.aufgabeInVorschau(a)); // deterministisch
        expect(v.oval).toBeGreaterThanOrEqual(0);
        expect(v.oval).toBeLessThan(n);
        gesehen.add(`${v.oval}:${v.seite}`);
      }
    }
    // Eins zu eins: jede Aufgabe eine andere Anweisung.
    expect(gesehen.size).toBe(2 * n);
  });

  it.each([2, 3, 4])('%i Personen: wer der Anweisung folgt, besteht -- ob die Kamera gespiegelt speichert oder nicht', (n) => {
    for (let position = 0; position < n; position++) {
      for (const richtung of seiten) {
        const a = { gesichter: n, position, richtung };
        const v = zw.aufgabeInVorschau(a);
        // In der gespiegelten Vorschau sehen sich die Menschen wie im
        // Spiegel: Oval v.oval von links ist die Person an Stelle v.oval von
        // ihrer eigenen linken Seite; sie dreht nach ihrer eigenen v.seite.
        for (const gespiegelt of [false, true]) {
          const bild = zw.gespeichertesBild(n, v.oval, v.seite, gespiegelt);
          expect(zw.aufgabeAkzeptiert(a, bild)).toBe(true);
        }
        // Ungespiegelt gespeichert trifft es die Aufgabe genau, nicht nur die
        // gespiegelte Lesart.
        expect(zw.gespeichertesBild(n, v.oval, v.seite, false)).toEqual({ position, richtung });
      }
    }
  });

  it('Missbrauch: eine andere Person oder die andere Seite besteht nicht', () => {
    const a = { gesichter: 3, position: 0, richtung: 'links' as const };
    expect(zw.aufgabeAkzeptiert(a, { position: 1, richtung: 'links' })).toBe(false);
    expect(zw.aufgabeAkzeptiert(a, { position: 0, richtung: 'rechts' })).toBe(false);
    expect(zw.aufgabeAkzeptiert(a, { position: 2, richtung: 'links' })).toBe(false);
    // Die gespiegelte Lesart schon (Position n-1-k, Seite getauscht).
    expect(zw.aufgabeAkzeptiert(a, { position: 2, richtung: 'rechts' })).toBe(true);
  });

  it('Beispiel: zwei Personen, Position 0 (links im gespeicherten Bild), Richtung links', () => {
    // Ungespiegelt ist links im Bild die Person, die aus eigener Sicht
    // rechts steht; in der Vorschau steht sie rechts (Oval 1) und dreht nach
    // ihrem eigenen rechts.
    expect(zw.aufgabeInVorschau({ gesichter: 2, position: 0, richtung: 'links' })).toEqual({ oval: 1, seite: 'rechts' });
    expect(zw.aufgabeInVorschau({ gesichter: 4, position: 3, richtung: 'rechts' })).toEqual({ oval: 0, seite: 'links' });
  });

  it('unbekannte Seiten werden nicht angenommen', () => {
    expect(zw.seiteLesen('links')).toBe('links');
    for (const x of ['links_rechts', 'oben', undefined, 1]) expect(zw.seiteLesen(x)).toBeNull();
  });
});

describe('Vorpruefung: genau n Gesichter, nebeneinander', () => {
  const r = (x: number, w = 100) => ({ x, y: 50, width: w, height: 130 });

  it.each([
    [2, [r(0), r(150)], 'ok'],
    [3, [r(300), r(0), r(150)], 'ok'], // Reihenfolge der Erkennung egal
    [4, [r(0), r(110), r(220), r(330)], 'ok'],
    [2, [r(0)], 'zu_wenige'],
    [3, [r(0), r(150)], 'zu_wenige'],
    [2, [r(0), r(150), r(300)], 'zu_viele'],
    [2, [r(0), r(80)], 'ueberlappen'],
    [3, [r(0), r(150), r(200)], 'ueberlappen'],
    [2, [], 'zu_wenige'],
    [5, [r(0), r(110), r(220), r(330), r(440)], 'zu_wenige'], // 5 ist keine erlaubte Zahl
    [1, [r(0)], 'zu_wenige'],
  ] as const)('soll %i, %j -> %s', (soll, rahmen, erwartet) => {
    expect(zw.gruppenBildStatus(rahmen, soll)).toBe(erwartet);
  });

  it('beruehren ist kein Ueberlappen', () => {
    expect(zw.gruppenBildStatus([r(0), r(100)], 2)).toBe('ok');
  });
});

describe('Warten auf die Zustimmung: begrenzt', () => {
  const schlafen = jest.fn(async () => undefined);
  beforeEach(() => schlafen.mockClear());

  it('fragt hoechstens bis zum Ablauf, dann ist Schluss', async () => {
    const start = jest.fn(async () => ({ status: 'nicht_zugestimmt' as const }));
    const r = await zw.wartenAufStart(start, { intervallMs: 3000, bisMs: 600_000, abgebrochen: () => false, schlafen });
    expect(r).toEqual({ ergebnis: 'abgelaufen' });
    expect(start).toHaveBeenCalledTimes(200);
    expect(schlafen).toHaveBeenCalledTimes(199);
    expect(schlafen).toHaveBeenCalledWith(3000);
  });

  it('ein zu kurzer Abstand wird nicht zur Dauerschleife (mindestens 1 s)', async () => {
    const start = jest.fn(async () => ({ status: 'nicht_zugestimmt' as const }));
    await zw.wartenAufStart(start, { intervallMs: 0, bisMs: 10_000, abgebrochen: () => false, schlafen });
    expect(start).toHaveBeenCalledTimes(10);
  });

  it('endet sofort bei "bereit" mit der Richtung', async () => {
    const antworten = [{ status: 'nicht_zugestimmt' }, { status: 'bereit', gueltig_sekunden: 1200 }];
    const start = jest.fn(async () => antworten.shift() as any);
    const r = await zw.wartenAufStart(start, { intervallMs: 3000, bisMs: 600_000, abgebrochen: () => false, schlafen });
    expect(r).toEqual({ ergebnis: 'bereit', gueltig_sekunden: 1200 });
    expect(start).toHaveBeenCalledTimes(2);
  });

  it('endet bei einer ungueltigen Anfrage', async () => {
    const start = jest.fn(async () => ({ status: 'anfrage_ungueltig' as const }));
    expect(await zw.wartenAufStart(start, { intervallMs: 3000, bisMs: 600_000, abgebrochen: () => false, schlafen }))
      .toEqual({ ergebnis: 'anfrage_ungueltig' });
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('endet, sobald der Bildschirm geschlossen wird', async () => {
    let zu = false;
    const start = jest.fn(async () => { zu = start.mock.calls.length >= 3; return { status: 'nicht_zugestimmt' as const }; });
    const r = await zw.wartenAufStart(start, { intervallMs: 3000, bisMs: 600_000, abgebrochen: () => zu, schlafen });
    expect(r).toEqual({ ergebnis: 'abgebrochen' });
    expect(start).toHaveBeenCalledTimes(3);
  });

  it('Netzfehler und unlesbare Antworten zaehlen als "noch nicht", nicht als Erfolg', async () => {
    const start = jest.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ status: 'nicht_zugestimmt' });
    const r = await zw.wartenAufStart(start, { intervallMs: 3000, bisMs: 9000, abgebrochen: () => false, schlafen });
    expect(r).toEqual({ ergebnis: 'abgelaufen' });
    expect(start).toHaveBeenCalledTimes(3);
  });

  it('auch nach der Uhr begrenzt: haengende Antworten verbrauchen die Frist mit', async () => {
    // Jede Antwort braucht 60 s -- nach Versuchen waeren es 200, nach der
    // Uhr (600 s) ist nach 10 Schluss.
    let uhr = 1_000_000;
    const start = jest.fn(async () => { uhr += 60_000; return { status: 'nicht_zugestimmt' as const }; });
    const r = await zw.wartenAufStart(start, { intervallMs: 3000, bisMs: 600_000, abgebrochen: () => false, schlafen, jetzt: () => uhr });
    expect(r).toEqual({ ergebnis: 'abgelaufen' });
    expect(start).toHaveBeenCalledTimes(10);
  });

  it('eine Richtung in /zwilling/start wird nicht uebernommen', () => {
    expect(zw.startAntwortLesen({ status: 'bereit', gueltig_sekunden: 1200 })).toEqual({ status: 'bereit', gueltig_sekunden: 1200 });
    expect(zw.startAntwortLesen({ status: 'bereit', richtung: 'links_rechts', gueltig_sekunden: 1200 }))
      .toEqual({ status: 'bereit', gueltig_sekunden: 1200 });
  });

  it.each([
    [{ status: 'bereit' }],
    [{ status: 'bereit', gueltig_sekunden: '300' }],
    [{ status: 'bereit', gueltig_sekunden: 1e9 }],
    [{ status: 'bereit', gueltig_sekunden: -1 }],
    [{ status: 'erfunden' }],
    [null],
    ['bereit'],
  ])('Antwort von /zwilling/start fail-closed: %j -> unlesbar', (roh) => {
    expect(zw.startAntwortLesen(roh)).toBeNull();
  });

  it('Antwort von /zwilling/challenge: Aufgabe und Farbfolge', () => {
    expect(zw.challengeAntwortLesen({ status: 'bereit', gesichter: 3, position: 2, richtung: 'rechts', flash_sequence: 'red,green,blue,red', gueltig_sekunden: 300 }))
      .toEqual({ status: 'bereit', gesichter: 3, position: 2, richtung: 'rechts', farbfolge: ['red', 'green', 'blue', 'red'], gueltig_sekunden: 300 });
    for (const status of ['nicht_gestartet', 'nicht_zugestimmt', 'anfrage_ungueltig']) {
      expect(zw.challengeAntwortLesen({ status })).toEqual({ status });
    }
  });

  const ok = { status: 'bereit', gesichter: 2, position: 0, richtung: 'links', flash_sequence: 'red,green,blue,red', gueltig_sekunden: 300 };
  it.each([
    [{ ...ok, position: 2 }], // Position >= gesichter
    [{ ...ok, gesichter: 4, position: 4 }],
    [{ ...ok, position: -1 }],
    [{ ...ok, position: 0.5 }],
    [{ ...ok, position: '0' }],
    [{ ...ok, position: undefined }],
    [{ ...ok, gesichter: 1 }],
    [{ ...ok, gesichter: 5, position: 0 }],
    [{ ...ok, gesichter: '2' }],
    [{ ...ok, gesichter: undefined }],
    [{ ...ok, richtung: 'links_rechts' }],
    [{ ...ok, richtung: 'oben' }],
    [{ ...ok, richtung: undefined }],
    [{ ...ok, flash_sequence: 'red,green,blue' }],
    [{ ...ok, flash_sequence: 'red,green,blue,red,green' }],
    [{ ...ok, flash_sequence: 'red,green,blue,pink' }],
    [{ ...ok, flash_sequence: ['red', 'green', 'blue', 'red'] }],
    [{ ...ok, gueltig_sekunden: undefined }],
    [{ status: 'erfunden' }],
    [null],
  ])('Antwort von /zwilling/challenge fail-closed: %j -> unlesbar', (roh) => {
    expect(zw.challengeAntwortLesen(roh)).toBeNull();
  });
});

describe('Meldungen', () => {
  const { RESOURCES, LOCALES } = jest.requireActual('../i18n');
  const vorhanden = (k: string) => { for (const l of LOCALES) expect(RESOURCES[l].identity[k]).toBeTruthy(); };

  it.each(['zugestimmt', 'anfrage_ungueltig', 'signatur_ungueltig', 'kette_nicht_erreichbar', 'nicht_registriert',
    'schon_registriert', 'schon_zugestimmt', 'eigene_wallet', 'consent_outdated', 'einwilligung_fehlt'])('Zustimmung %s: eigene Meldung', (s) => {
    const k = zw.zustimmungMeldungKey(s);
    expect(k).not.toBe('zwZustimmungFehler');
    vorhanden(k);
  });

  it('jede Zustimmungs-Meldung ist eine andere', () => {
    const s = ['zugestimmt', 'anfrage_ungueltig', 'signatur_ungueltig', 'kette_nicht_erreichbar', 'nicht_registriert',
      'schon_registriert', 'schon_zugestimmt', 'eigene_wallet', 'consent_outdated', 'einwilligung_fehlt'];
    expect(new Set(s.map(zw.zustimmungMeldungKey)).size).toBe(s.length);
    expect(zw.zustimmungMeldungKey('etwas')).toBe('zwZustimmungFehler');
  });

  it.each(['kein_zwilling_noetig', 'anderes_gesicht', 'gruppe_voll', 'nicht_gestartet', 'anfrage_ungueltig',
    'schon_registriert', 'nicht_registriert', 'kette_nicht_erreichbar', 'age_proof_required', 'commit_quorum_failed',
    'capture_failed', 'liveness_failed', 'quorum_failed', 'missing_consent', 'consent_outdated', 'signatur_ungueltig',
    'nonce_ungueltig', 'kein_schluessel', 'tagesgrenze_einzelbetrieb', 'risk_blocked', 'invalid_mode',
    'lebendigkeit_unsicher', 'age_below_minimum', 'age_declaration_missing', 'aufnahme_abgelaufen',
    'gruppe_unvollstaendig'])('Registrierung %s: eigene Meldung', (d) => {
    const k = zw.zwillingRegisterMeldungKey(d);
    expect(k).not.toBe('biometricResultFailed');
    vorhanden(k);
  });

  it('Unbekanntes faellt auf die allgemeine Meldung', () => {
    expect(zw.zwillingRegisterMeldungKey('neu_erfunden')).toBe('biometricResultFailed');
  });

  it('{n} steht in jeder Sprache, wo die Gruppengroesse genannt wird', () => {
    for (const l of LOCALES) {
      expect(RESOURCES[l].identity.zwWarnung).toContain('{n}');
      expect(RESOURCES[l].identity.zwErklaerung).toContain('{n}');
    }
  });
});

// ---------------------------------------------------------------------------
// Netz: derselbe Coordinator von der Anfrage bis zur Registrierung
// ---------------------------------------------------------------------------

const felder = (form: any): Record<string, unknown[]> => {
  const teile: [string, unknown][] =
    typeof form.getParts === 'function'
      ? form.getParts().map((p: any) => [p.fieldName, p.string ?? p.uri])
      : Array.from(form.entries());
  const out: Record<string, unknown[]> = {};
  for (const [k, v] of teile) (out[k] ??= []).push(v);
  return out;
};

describe('Netz', () => {
  let calls: { url: string; body: any }[] = [];
  let c1Gesund = true;
  let registerAntwort: any = { decision: 'new_enrollment', bio_hash: '7', quorum_size: 1, validator_count: 1, votes: [] };
  const altFetch = global.fetch;
  const altFormData = global.FormData;
  // Wie React Natives FormData: Dateien sind {uri, name, type}. Die
  // FormData von Node macht daraus "[object Object]".
  class RnFormData {
    teile: [string, any][] = [];
    append(k: string, v: any) { this.teile.push([k, v]); }
    getParts() { return this.teile.map(([k, v]) => ({ fieldName: k, string: typeof v === 'string' ? v : undefined, uri: v?.uri })); }
  }

  beforeEach(() => {
    (global as any).FormData = RnFormData;
    const bio = require('../biometricIdentity');
    bio._setCoordinatorCandidatesForTest([C1, C2]);
    bio._vergissZwillingKnotenFuerTest();
    calls = [];
    c1Gesund = true;
    global.fetch = jest.fn(async (url: string, init?: any) => {
      calls.push({ url, body: init?.body });
      if (url.endsWith('/health')) {
        const ok = url.startsWith(C1) ? c1Gesund : true;
        return { ok, status: ok ? 200 : 503, json: async () => ({}) };
      }
      if (url.endsWith('/zwilling/anfrage')) return { ok: true, json: async () => ({ anfrage: ANFRAGE, gueltig_sekunden: 600 }) };
      if (url.endsWith('/zwilling/start')) {
        // Ein aelterer Coordinator nannte hier die Richtung -- sie darf nicht zaehlen.
        return { ok: true, json: async () => ({ status: 'bereit', gueltig_sekunden: 1200, richtung: 'rechts_links' }) };
      }
      if (url.endsWith('/zwilling/challenge')) {
        return { ok: true, json: async () => ({ status: 'bereit', gesichter: 2, position: 1, richtung: 'links', flash_sequence: 'blue,red,red,green', gueltig_sekunden: 300 }) };
      }
      if (url.endsWith('/challenge')) return { ok: true, json: async () => ({ nonce: 'nonce-1', challenge_type: 'look_left', flash_sequence: '' }) };
      if (url.endsWith('/zwilling/zustimmung')) return { ok: true, json: async () => ({ status: 'zugestimmt' }) };
      if (url.endsWith('/zwilling/register')) return { ok: true, json: async () => registerAntwort };
      return { ok: false, status: 404, json: async () => ({}) };
    }) as any;
  });

  afterEach(() => {
    global.fetch = altFetch;
    global.FormData = altFormData;
    require('../biometricIdentity')._setCoordinatorCandidatesForTest(null);
  });

  const solo = (nonce?: string) => ({
    faceUri: 'file:///solo.jpg', faceBurstUris: [], faceBurstVideoUri: 'file:///solo.mp4', burstIntervalMs: 183,
    imuSamples: [{ t: 0, rotationRate: { alpha: 0, beta: 0, gamma: 0 } }], challengeNonce: nonce,
  });
  const gemeinsam = { bildUri: 'file:///zw.jpg', videoUri: 'file:///zw.mp4', burstUris: [], intervalMs: 183 };
  const consent = {
    biometricConsent: true, bonusConsent: true, consentedAt: 7,
    alter: { geburtsjahr: 1990, geburtsmonat: 5, land: 'DE' },
  };

  it('Anfrage, Start, Challenge und Registrierung treffen denselben Coordinator -- mit allen gemeinsamen Feldern', async () => {
    const bio = require('../biometricIdentity');
    c1Gesund = false; // die Anfrage landet bei C2
    const a = await bio.zwillingAnfrageAnlegen(WALLET_B, 2);
    expect(a.base).toBe(C2);
    expect(a.qr).toBe(`aequitas-zwilling:${ANFRAGE}:${B}:proof2.aequitas.example:8443`);
    expect(JSON.parse(calls.find((c) => c.url.endsWith('/zwilling/anfrage'))!.body)).toEqual({ wallet: B, gesichter: 2 });
    expect(bio.zwillingGesichter(ANFRAGE)).toBe(2);

    // C1 ist wieder gesund und die Klebrigkeit abgelaufen: trotzdem C2.
    c1Gesund = true;
    bio._verwirfCoordinatorKlebrigkeitFuerTest();
    expect(await bio.zwillingStart(ANFRAGE)).toEqual({ status: 'bereit', gueltig_sekunden: 1200 });
    // Die Richtung kommt NUR aus /zwilling/challenge.
    expect(bio.zwillingRichtung(ANFRAGE)).toBeNull();
    expect(await bio.zwillingChallenge(ANFRAGE)).toEqual({
      status: 'bereit', gesichter: 2, position: 1, richtung: 'links', farbfolge: ['blue', 'red', 'red', 'green'], gueltig_sekunden: 300,
    });
    expect(bio.zwillingRichtung(ANFRAGE)).toBe('links');
    const ch = await bio.requestChallenge(bio.zwillingBasis(ANFRAGE));
    expect(ch?.nonce).toBe('nonce-1');

    const signiert: string[] = [];
    const r = await bio.zwillingRegister(solo('nonce-1'), gemeinsam, {
      anfrage: ANFRAGE, deviceId: 'd', walletAddress: WALLET_B, consent,
      signer: { signMessage: async (m: string) => { signiert.push(m); return '0xsig'; } },
    });
    expect(r.decision).toBe('new_enrollment');
    expect(signiert).toEqual([PY_REGISTER]);

    for (const pfad of ['/zwilling/start', '/zwilling/challenge', '/challenge', '/zwilling/register']) {
      expect(calls.filter((c) => c.url.replace(/^https?:\/\/[^/]+/, '') === pfad).map((c) => c.url)).toEqual([C2 + pfad]);
    }
    const f = felder(calls.find((c) => c.url.endsWith('/zwilling/register'))!.body);
    expect(f.anfrage).toEqual([ANFRAGE]);
    expect(f.wallet_address).toEqual([B]);
    expect(f.wallet_signature).toEqual(['0xsig']);
    expect(f.challenge_nonce).toEqual(['nonce-1']);
    expect(f.consent_version).toEqual(['einwilligung-v4-2026-10-21']);
    expect(f.consented_at).toEqual(['7']);
    expect(f.geburtsjahr).toEqual(['1990']);
    expect(f.geburtsmonat).toEqual(['5']);
    expect(f.land).toEqual(['DE']);
    expect(f.face_image).toEqual(['file:///solo.jpg']);
    expect(f.face_burst_video).toEqual(['file:///solo.mp4']);
    expect(f.burst_interval_ms).toEqual(['183']);
    expect(f.imu_samples).toHaveLength(1);
    expect(f.zwilling_bild).toEqual(['file:///zw.jpg']);
    expect(f.zwilling_video).toEqual(['file:///zw.mp4']);
    expect(f.zwilling_interval_ms).toEqual(['183']);
  });

  it('Missbrauch: andere Wallet als die der Anfrage -> Abbruch vor jedem Upload, Dateien geloescht', async () => {
    const bio = require('../biometricIdentity');
    const geloescht: string[] = [];
    bio._setLoeschenFuerTest(async (u: string) => { geloescht.push(u); });
    try {
      await bio.zwillingAnfrageAnlegen(WALLET_B, 2);
      await bio.requestChallenge(bio.zwillingBasis(ANFRAGE));
      const signer = { signMessage: jest.fn(async () => '0xsig') };
      await expect(bio.zwillingRegister(solo('nonce-1'), gemeinsam, {
        anfrage: ANFRAGE, deviceId: 'd', walletAddress: WALLET_A, consent, signer,
      })).rejects.toBeInstanceOf(bio.ZwillingAndereWallet);
      expect(signer.signMessage).not.toHaveBeenCalled();
      expect(calls.some((c) => c.url.endsWith('/zwilling/register'))).toBe(false);
      expect(geloescht.sort()).toEqual(['file:///solo.jpg', 'file:///solo.mp4', 'file:///zw.jpg', 'file:///zw.mp4']);
    } finally {
      bio._setLoeschenFuerTest(null);
    }
  });

  it('/zwilling/challenge ohne "bereit" setzt keine Richtung', async () => {
    const bio = require('../biometricIdentity');
    await bio.zwillingAnfrageAnlegen(WALLET_B, 2);
    for (const status of ['nicht_gestartet', 'nicht_zugestimmt', 'anfrage_ungueltig']) {
      (global.fetch as jest.Mock).mockImplementationOnce(async () => ({ ok: true, json: async () => ({ status }) }));
      expect(await bio.zwillingChallenge(ANFRAGE)).toEqual({ status });
    }
    (global.fetch as jest.Mock).mockImplementationOnce(async () => ({ ok: true, json: async () => ({ status: 'bereit', gesichter: 2, position: 0, richtung: 'links', flash_sequence: 'red', gueltig_sekunden: 300 }) }));
    expect(await bio.zwillingChallenge(ANFRAGE)).toBeNull();
    // Eine Aufgabe fuer eine andere Zahl von Menschen als angefragt wird nicht verwendet.
    (global.fetch as jest.Mock).mockImplementationOnce(async () => ({ ok: true, json: async () => ({ status: 'bereit', gesichter: 3, position: 0, richtung: 'links', flash_sequence: 'red,red,red,red', gueltig_sekunden: 300 }) }));
    expect(await bio.zwillingChallenge(ANFRAGE)).toBeNull();
    expect(bio.zwillingRichtung(ANFRAGE)).toBeNull();
  });

  it('Einzelbilder statt Video: mindestens zwei, jedes als zwilling_burst', async () => {
    const bio = require('../biometricIdentity');
    await bio.zwillingAnfrageAnlegen(WALLET_B, 2);
    await bio.requestChallenge(bio.zwillingBasis(ANFRAGE));
    await bio.zwillingRegister(solo('nonce-1'), { bildUri: 'file:///zw.jpg', burstUris: ['file:///1.jpg', 'file:///2.jpg'], intervalMs: 100 }, {
      anfrage: ANFRAGE, deviceId: 'd', walletAddress: WALLET_B, consent, signer: { signMessage: async () => '0xsig' },
    });
    const f = felder(calls.find((c) => c.url.endsWith('/zwilling/register'))!.body);
    expect(f.zwilling_burst).toEqual(['file:///1.jpg', 'file:///2.jpg']);
    expect(f.zwilling_video).toBeUndefined();
  });

  it('Missbrauch: Nonce von einem anderen Coordinator als die Anfrage -> nichts wird gesendet', async () => {
    const bio = require('../biometricIdentity');
    c1Gesund = false;
    await bio.zwillingAnfrageAnlegen(WALLET_B, 2); // C2
    await bio.requestChallenge(C1); // Nonce bei C1
    const signer = { signMessage: jest.fn(async () => '0xsig') };
    await expect(bio.zwillingRegister(solo('nonce-1'), gemeinsam, {
      anfrage: ANFRAGE, deviceId: 'd', walletAddress: WALLET_B, consent, signer,
    })).rejects.toBeInstanceOf(bio.NachziehenNeedsChallenge);
    expect(signer.signMessage).not.toHaveBeenCalled();
    expect(calls.some((c) => c.url.endsWith('/zwilling/register'))).toBe(false);
  });

  it('Missbrauch: unbekannte Anfrage (z. B. aus einem Link) -> nichts wird gesendet', async () => {
    const bio = require('../biometricIdentity');
    await bio.requestChallenge();
    await expect(bio.zwillingRegister(solo('nonce-1'), gemeinsam, {
      anfrage: 'cd'.repeat(16), deviceId: 'd', walletAddress: WALLET_B, consent, signer: { signMessage: async () => '0xsig' },
    })).rejects.toBeInstanceOf(bio.ZwillingAnfrageUnbekannt);
    await expect(bio.zwillingStart('cd'.repeat(16))).rejects.toBeInstanceOf(bio.ZwillingAnfrageUnbekannt);
    expect(bio.zwillingRichtung('cd'.repeat(16))).toBeNull();
    expect(calls.some((c) => c.url.includes('/zwilling/'))).toBe(false);
  });

  it('ohne Nonce oder ohne gemeinsame Bildserie wird nichts gesendet', async () => {
    const bio = require('../biometricIdentity');
    await bio.zwillingAnfrageAnlegen(WALLET_B, 2);
    const opts = { anfrage: ANFRAGE, deviceId: 'd', walletAddress: WALLET_B, consent, signer: { signMessage: async () => '0xsig' } };
    await expect(bio.zwillingRegister(solo(), gemeinsam, opts)).rejects.toBeInstanceOf(bio.NachziehenNeedsChallenge);
    await bio.requestChallenge(bio.zwillingBasis(ANFRAGE));
    await expect(bio.zwillingRegister(solo('nonce-1'), { bildUri: 'file:///zw.jpg', burstUris: ['file:///1.jpg'], intervalMs: 100 }, opts))
      .rejects.toThrow('gemeinsame Bildserie fehlt');
    expect(calls.some((c) => c.url.endsWith('/zwilling/register'))).toBe(false);
  });

  it('Anfrage mit 3 bzw. 4 Gesichtern; 1 und 5 werden gar nicht erst gesendet', async () => {
    const bio = require('../biometricIdentity');
    await bio.zwillingAnfrageAnlegen(WALLET_B, 4);
    expect(JSON.parse(calls.find((c) => c.url.endsWith('/zwilling/anfrage'))!.body)).toEqual({ wallet: B, gesichter: 4 });
    calls = [];
    for (const g of [1, 5, 2.5, 0]) {
      await expect(bio.zwillingAnfrageAnlegen(WALLET_B, g)).rejects.toThrow('gesichter_ungueltig');
    }
    expect(calls).toEqual([]);
  });

  it('requestChallenge(fest) nur fuer einen eigenen Kandidaten', async () => {
    const bio = require('../biometricIdentity');
    expect(await bio.requestChallenge('https://evil.example')).toBeNull();
    expect(calls).toEqual([]);
  });

  it('A stimmt zu: signiert genau die Nachricht und schickt sie an den Coordinator aus dem Code', async () => {
    const bio = require('../biometricIdentity');
    const qr = zw.zwillingQrLesen(`aequitas-zwilling:${ANFRAGE}:${B}:proof2.aequitas.example:8443`, bio.coordinatorCandidates());
    const signiert: string[] = [];
    const r = await bio.zwillingZustimmen(qr, WALLET_A, { signMessage: async (m: string) => { signiert.push(m); return PY_ZUSTIMMUNG_SIG; } }, { zugestimmt: true });
    expect(r).toEqual({ status: 'zugestimmt' });
    expect(signiert).toEqual([PY_ZUSTIMMUNG]);
    const c = calls.find((x) => x.url.endsWith('/zwilling/zustimmung'))!;
    expect(c.url).toBe(C2 + '/zwilling/zustimmung');
    expect(JSON.parse(c.body)).toEqual({ anfrage: ANFRAGE, wallet: A, signatur: PY_ZUSTIMMUNG_SIG, einwilligung: EINWILLIGUNG });
  });

  it('Missbrauch: ohne A\'s Einwilligung wird nicht signiert und nichts gesendet', async () => {
    const bio = require('../biometricIdentity');
    const qr = zw.zwillingQrLesen(`aequitas-zwilling:${ANFRAGE}:${B}:proof1.aequitas.example`, bio.coordinatorCandidates());
    const signer = { signMessage: jest.fn(async () => '0xsig') };
    for (const einw of [{ zugestimmt: false }, undefined, null, { zugestimmt: 'ja' }]) {
      expect(await bio.zwillingZustimmen(qr, WALLET_A, signer, einw)).toEqual({ status: 'einwilligung_fehlt' });
    }
    expect(signer.signMessage).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it('Missbrauch: sich selbst bestaetigen -- nicht signiert, nichts gesendet', async () => {
    const bio = require('../biometricIdentity');
    const qr = zw.zwillingQrLesen(`aequitas-zwilling:${ANFRAGE}:${A}:proof1.aequitas.example`, bio.coordinatorCandidates());
    const signer = { signMessage: jest.fn(async () => '0xsig') };
    expect(await bio.zwillingZustimmen(qr, WALLET_A, signer, { zugestimmt: true })).toEqual({ status: 'eigene_wallet' });
    expect(signer.signMessage).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it('Missbrauch: ein Code mit einer Basis ausserhalb der Kandidaten wird nicht verwendet', async () => {
    const bio = require('../biometricIdentity');
    const signer = { signMessage: jest.fn(async () => '0xsig') };
    const r = await bio.zwillingZustimmen({ anfrage: ANFRAGE, walletB: B, base: 'https://evil.example' }, WALLET_A, signer, { zugestimmt: true });
    expect(r).toEqual({ status: 'anfrage_ungueltig' });
    expect(signer.signMessage).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it('eine unlesbare Anfrage-Antwort wird nicht angezeigt', async () => {
    const bio = require('../biometricIdentity');
    bio._setCoordinatorCandidatesForTest([C1]);
    (global.fetch as jest.Mock).mockImplementationOnce(async () => ({ ok: true, json: async () => ({}) }));
    (global.fetch as jest.Mock).mockImplementationOnce(async () => ({ ok: true, json: async () => ({ anfrage: 'X', gueltig_sekunden: 600 }) }));
    await expect(bio.zwillingAnfrageAnlegen(WALLET_B, 2)).rejects.toThrow('unlesbar');
    expect(bio.zwillingBasis('X')).toBeNull();
  });

  it('Grenze des Coordinators wird als Grund weitergegeben', async () => {
    const bio = require('../biometricIdentity');
    bio._setCoordinatorCandidatesForTest([C1]);
    (global.fetch as jest.Mock).mockImplementationOnce(async () => ({ ok: false, status: 429, json: async () => ({ detail: 'zu_viele_anfragen' }) }));
    await expect(bio.zwillingAnfrageAnlegen(WALLET_B, 2)).rejects.toThrow('zu_viele_anfragen');
  });
});

describe('volle Adresse zum Vergleichen', () => {
  it('in Vierergruppen, klein, vollstaendig', () => {
    expect(zw.walletGruppiert(WALLET_B)).toBe('0x8327 9fae 0994 aa1a 5633 77e8 89cc 2a1d 96ad b3b1');
    expect(zw.walletGruppiert(WALLET_B).replace(/ /g, '')).toBe(B);
    expect(zw.walletGruppiert('0x1')).toBe('');
  });
});

describe('Frist bis zur gelesenen Antwort (LOW-3)', () => {
  const altFetch = global.fetch;
  afterEach(() => { global.fetch = altFetch; jest.useRealTimers(); });

  it('Kopfzeilen da, Koerper nie: nach der Frist ist Schluss', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: () => new Promise(() => undefined) })) as any;
    const { jsonMitFrist } = jest.requireActual('../frist');
    const p = jsonMitFrist('https://c.example/zwilling/start', {}, 5000);
    const erwartung = expect(p).rejects.toThrow('Frist');
    await jest.advanceTimersByTimeAsync(5001);
    await erwartung;
  });

  it('liest JSON, und kein JSON ist null', async () => {
    const { jsonMitFrist } = jest.requireActual('../frist');
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ a: 1 }) })) as any;
    expect(await jsonMitFrist('https://c.example', {}, 1000)).toEqual({ ok: true, status: 200, body: { a: 1 } });
    global.fetch = jest.fn(async () => ({ ok: false, status: 502, json: async () => { throw new Error('html'); } })) as any;
    expect(await jsonMitFrist('https://c.example', {}, 1000)).toEqual({ ok: false, status: 502, body: null });
  });
});

describe('Anzeige: keine Einzelgruende der Dienste, Einwilligung beim Lebensnachweis', () => {
  const fs = require('fs');
  const path = require('path');
  const src: string = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'biometric-capture.tsx'), 'utf8');

  it('commit_quorum_failed: eine allgemeine Meldung, commit_results werden nie angezeigt', () => {
    expect(zw.zwillingRegisterMeldungKey('commit_quorum_failed')).toBe('zwErgebnisCommit');
    expect(src).not.toMatch(/commit_results/);
  });

  it('gruppe_unvollstaendig hat eine eigene Meldung', () => {
    expect(zw.zwillingRegisterMeldungKey('gruppe_unvollstaendig')).toBe('zwErgebnisGruppeUnvollstaendig');
  });

  it('Lebensnachweis: consent_outdated zeigt die v4-Einwilligung erneut', () => {
    const { lebensnachweisMeldung } = jest.requireActual('../lebensnachweis');
    expect(lebensnachweisMeldung({ status: 'consent_outdated' }).key).toBe('lnErgebnisEinwilligung');
    expect(src).toMatch(/lnResult\?\.status === 'consent_outdated'[\s\S]{0,400}identity\.lnEinwilligungErneut[\s\S]{0,300}setStep\('consent'\)/);
  });
});
