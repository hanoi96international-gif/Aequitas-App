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
const PY_ZUSTIMMUNG = `aequitas-zwilling-v1|${A}|${B}|${ANFRAGE}`;
const PY_ZUSTIMMUNG_SIG =
  '0x7889a37b227712adc7ac0019ffc09774c53334141d8cac7f9e66ad7462e1570f1accde8f03dbcb6f6b92adf837b25c2f3345514e0c43ac94dc893e4f4c081f4b1c';
const PY_REGISTER = `aequitas-zwilling-register-v1|${B}|${ANFRAGE}|nonce-1`;
const PY_REGISTER_SIG =
  '0x1de40d4f6f46bb026d2a2939468ae04c83ab96e850467c9857a62ebd2ed7e18238fd6ed272e839d75340a32f2ea21d0c96f5ce9605f1ea8e3d9550963dd0c7451c';

const C1 = 'https://proof1.aequitas.example';
const C2 = 'https://proof2.aequitas.example:8443';

describe('Signaturen', () => {
  it('Zustimmung von A: Nachricht und Signatur wie in Python', async () => {
    const m = zw.zwillingZustimmungMessage(` ${WALLET_A} `, WALLET_B, ANFRAGE);
    expect(m).toBe(PY_ZUSTIMMUNG);
    expect(await new ethers.Wallet(PRIV_A).signMessage(m)).toBe(PY_ZUSTIMMUNG_SIG);
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

describe('Richtung -> Anweisung', () => {
  it('links_rechts heisst auseinander, rechts_links zueinander', () => {
    expect(zw.zwillingDrehung('links_rechts')).toBe('auseinander');
    expect(zw.zwillingDrehung('rechts_links')).toBe('zueinander');
    expect(zw.zwillingAnweisungKey('links_rechts')).toBe('zwAnweisungAuseinander');
    expect(zw.zwillingAnweisungKey('rechts_links')).toBe('zwAnweisungZueinander');
  });

  it('die Zuordnung je Person haengt nicht davon ab, ob das Bild gespiegelt ist', () => {
    for (const r of ['links_rechts', 'rechts_links'] as const) {
      expect(zw.drehungJePerson(r, true)).toEqual(zw.drehungJePerson(r, false));
    }
  });

  it('auseinander: jeder dreht sich zu seiner eigenen Aussenseite; zueinander: zur Mitte', () => {
    // Aus Sicht der beiden: wer links steht, dreht nach links (aussen) usw.
    expect(zw.drehungJePerson('links_rechts', false)).toEqual({ links: 'links', rechts: 'rechts' });
    expect(zw.drehungJePerson('rechts_links', false)).toEqual({ links: 'rechts', rechts: 'links' });
  });

  it('Gegenprobe ungespiegelt: das LINKE Gesicht im Bild dreht sich im Bild nach links', () => {
    // Ungespiegelt ist Bild-Links das Rechts der Personen. Das linke
    // Bildgesicht ist also die Person, die (aus eigener Sicht) rechts steht;
    // sie dreht nach ihrem Rechts -- im Bild nach links.
    expect(zw.drehungJePerson('links_rechts', false).rechts).toBe('rechts');
  });

  it('unbekannte Richtungen werden nicht angenommen', () => {
    expect(zw.zwillingRichtungLesen('links_rechts')).toBe('links_rechts');
    expect(zw.zwillingRichtungLesen('oben_unten')).toBeNull();
    expect(zw.zwillingRichtungLesen(undefined)).toBeNull();
  });

  it('genau zwei Gesichter', () => {
    expect(zw.zweiGesichterStatus(2)).toBe('ok');
    expect(zw.zweiGesichterStatus(0)).toBe('zu_wenige');
    expect(zw.zweiGesichterStatus(1)).toBe('zu_wenige');
    expect(zw.zweiGesichterStatus(3)).toBe('zu_viele');
    expect(zw.zweiGesichterStatus(NaN)).toBe('zu_wenige');
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
    const antworten = [{ status: 'nicht_zugestimmt' }, { status: 'bereit', richtung: 'rechts_links', gueltig_sekunden: 300 }];
    const start = jest.fn(async () => antworten.shift() as any);
    const r = await zw.wartenAufStart(start, { intervallMs: 3000, bisMs: 600_000, abgebrochen: () => false, schlafen });
    expect(r).toEqual({ ergebnis: 'bereit', richtung: 'rechts_links', gueltig_sekunden: 300 });
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

  it.each([
    [{ status: 'bereit', richtung: 'oben_unten', gueltig_sekunden: 300 }],
    [{ status: 'bereit', richtung: 'links_rechts' }],
    [{ status: 'bereit', richtung: 'links_rechts', gueltig_sekunden: '300' }],
    [{ status: 'bereit', richtung: 'links_rechts', gueltig_sekunden: 1e9 }],
    [{ status: 'erfunden' }],
    [null],
    ['bereit'],
  ])('Antwort von /zwilling/start fail-closed: %j -> unlesbar', (roh) => {
    expect(zw.startAntwortLesen(roh)).toBeNull();
  });
});

describe('Meldungen', () => {
  const { RESOURCES, LOCALES } = jest.requireActual('../i18n');
  const vorhanden = (k: string) => { for (const l of LOCALES) expect(RESOURCES[l].identity[k]).toBeTruthy(); };

  it.each(['zugestimmt', 'anfrage_ungueltig', 'signatur_ungueltig', 'kette_nicht_erreichbar', 'nicht_registriert',
    'schon_registriert', 'schon_zugestimmt', 'eigene_wallet'])('Zustimmung %s: eigene Meldung', (s) => {
    const k = zw.zustimmungMeldungKey(s);
    expect(k).not.toBe('zwZustimmungFehler');
    vorhanden(k);
  });

  it('jede Zustimmungs-Meldung ist eine andere', () => {
    const s = ['zugestimmt', 'anfrage_ungueltig', 'signatur_ungueltig', 'kette_nicht_erreichbar', 'nicht_registriert',
      'schon_registriert', 'schon_zugestimmt', 'eigene_wallet'];
    expect(new Set(s.map(zw.zustimmungMeldungKey)).size).toBe(s.length);
    expect(zw.zustimmungMeldungKey('etwas')).toBe('zwZustimmungFehler');
  });

  it.each(['kein_zwilling_noetig', 'anderes_gesicht', 'gruppe_voll', 'nicht_gestartet', 'anfrage_ungueltig',
    'schon_registriert', 'nicht_registriert', 'kette_nicht_erreichbar', 'age_proof_required', 'commit_quorum_failed',
    'capture_failed', 'liveness_failed', 'quorum_failed', 'missing_consent', 'consent_outdated', 'signatur_ungueltig',
    'nonce_ungueltig', 'kein_schluessel', 'tagesgrenze_einzelbetrieb', 'risk_blocked', 'invalid_mode',
    'lebendigkeit_unsicher', 'age_below_minimum', 'age_declaration_missing'])('Registrierung %s: eigene Meldung', (d) => {
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
        return { ok: true, json: async () => ({ status: 'bereit', richtung: 'links_rechts', gueltig_sekunden: 300 }) };
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
    const a = await bio.zwillingAnfrageAnlegen(WALLET_B);
    expect(a.base).toBe(C2);
    expect(a.qr).toBe(`aequitas-zwilling:${ANFRAGE}:${B}:proof2.aequitas.example:8443`);
    expect(JSON.parse(calls.find((c) => c.url.endsWith('/zwilling/anfrage'))!.body)).toEqual({ wallet: B });

    // C1 ist wieder gesund und die Klebrigkeit abgelaufen: trotzdem C2.
    c1Gesund = true;
    bio._verwirfCoordinatorKlebrigkeitFuerTest();
    expect(await bio.zwillingStart(ANFRAGE)).toEqual({ status: 'bereit', richtung: 'links_rechts', gueltig_sekunden: 300 });
    expect(bio.zwillingRichtung(ANFRAGE)).toBe('links_rechts');
    const ch = await bio.requestChallenge(bio.zwillingBasis(ANFRAGE));
    expect(ch?.nonce).toBe('nonce-1');

    const signiert: string[] = [];
    const r = await bio.zwillingRegister(solo('nonce-1'), gemeinsam, {
      anfrage: ANFRAGE, deviceId: 'd', walletAddress: WALLET_B, consent,
      signer: { signMessage: async (m: string) => { signiert.push(m); return '0xsig'; } },
    });
    expect(r.decision).toBe('new_enrollment');
    expect(signiert).toEqual([PY_REGISTER]);

    for (const pfad of ['/zwilling/start', '/challenge', '/zwilling/register']) {
      expect(calls.filter((c) => c.url.endsWith(pfad)).map((c) => c.url)).toEqual([C2 + pfad]);
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

  it('Einzelbilder statt Video: mindestens zwei, jedes als zwilling_burst', async () => {
    const bio = require('../biometricIdentity');
    await bio.zwillingAnfrageAnlegen(WALLET_B);
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
    await bio.zwillingAnfrageAnlegen(WALLET_B); // C2
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
    await bio.zwillingAnfrageAnlegen(WALLET_B);
    const opts = { anfrage: ANFRAGE, deviceId: 'd', walletAddress: WALLET_B, consent, signer: { signMessage: async () => '0xsig' } };
    await expect(bio.zwillingRegister(solo(), gemeinsam, opts)).rejects.toBeInstanceOf(bio.NachziehenNeedsChallenge);
    await bio.requestChallenge(bio.zwillingBasis(ANFRAGE));
    await expect(bio.zwillingRegister(solo('nonce-1'), { bildUri: 'file:///zw.jpg', burstUris: ['file:///1.jpg'], intervalMs: 100 }, opts))
      .rejects.toThrow('gemeinsame Bildserie fehlt');
    expect(calls.some((c) => c.url.endsWith('/zwilling/register'))).toBe(false);
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
    const r = await bio.zwillingZustimmen(qr, WALLET_A, { signMessage: async (m: string) => { signiert.push(m); return PY_ZUSTIMMUNG_SIG; } });
    expect(r).toEqual({ status: 'zugestimmt' });
    expect(signiert).toEqual([PY_ZUSTIMMUNG]);
    const c = calls.find((x) => x.url.endsWith('/zwilling/zustimmung'))!;
    expect(c.url).toBe(C2 + '/zwilling/zustimmung');
    expect(JSON.parse(c.body)).toEqual({ anfrage: ANFRAGE, wallet: A, signatur: PY_ZUSTIMMUNG_SIG });
  });

  it('Missbrauch: sich selbst bestaetigen -- nicht signiert, nichts gesendet', async () => {
    const bio = require('../biometricIdentity');
    const qr = zw.zwillingQrLesen(`aequitas-zwilling:${ANFRAGE}:${A}:proof1.aequitas.example`, bio.coordinatorCandidates());
    const signer = { signMessage: jest.fn(async () => '0xsig') };
    expect(await bio.zwillingZustimmen(qr, WALLET_A, signer)).toEqual({ status: 'eigene_wallet' });
    expect(signer.signMessage).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it('Missbrauch: ein Code mit einer Basis ausserhalb der Kandidaten wird nicht verwendet', async () => {
    const bio = require('../biometricIdentity');
    const signer = { signMessage: jest.fn(async () => '0xsig') };
    const r = await bio.zwillingZustimmen({ anfrage: ANFRAGE, walletB: B, base: 'https://evil.example' }, WALLET_A, signer);
    expect(r).toEqual({ status: 'anfrage_ungueltig' });
    expect(signer.signMessage).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it('eine unlesbare Anfrage-Antwort wird nicht angezeigt', async () => {
    const bio = require('../biometricIdentity');
    bio._setCoordinatorCandidatesForTest([C1]);
    (global.fetch as jest.Mock).mockImplementationOnce(async () => ({ ok: true, json: async () => ({}) }));
    (global.fetch as jest.Mock).mockImplementationOnce(async () => ({ ok: true, json: async () => ({ anfrage: 'X', gueltig_sekunden: 600 }) }));
    await expect(bio.zwillingAnfrageAnlegen(WALLET_B)).rejects.toThrow('unlesbar');
    expect(bio.zwillingBasis('X')).toBeNull();
  });

  it('Grenze des Coordinators wird als Grund weitergegeben', async () => {
    const bio = require('../biometricIdentity');
    bio._setCoordinatorCandidatesForTest([C1]);
    (global.fetch as jest.Mock).mockImplementationOnce(async () => ({ ok: false, status: 429, json: async () => ({ detail: 'zu_viele_anfragen' }) }));
    await expect(bio.zwillingAnfrageAnlegen(WALLET_B)).rejects.toThrow('zu_viele_anfragen');
  });
});
