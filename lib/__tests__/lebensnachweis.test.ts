/**
 * Jaehrlicher Lebensnachweis (coordinator/app/lebensnachweis.py in
 * aequitas-biometric-beta, /api/proof-of-life und /api/balance der Kette).
 *
 * Was hier festgehalten wird:
 *   - die Wallet-Signatur hat eine EIGENE Domaene -- eine Erneuerungs- oder
 *     Nachzieh-Signatur gilt fuer den Lebensnachweis nicht (und umgekehrt);
 *   - an die Kette geht nur eine Bescheinigung, und nur bei "bescheinigt";
 *   - jeder Status des Coordinators hat eine eigene Meldung;
 *   - der Stand aus /api/balance wird fail-closed gelesen: ein kaputtes
 *     Objekt zeigt NICHTS an, nie "faellig" oder "pausiert";
 *   - die Erinnerung erscheint genau bei faellig, Nachfrist und pausiert.
 *
 * Die Signatur-Vorlage stammt aus Python (eth_keys, privater Schluessel
 * 0x11..11, Nonce "nonce-1", Nachricht wie lebensnachweis.nachricht) und ist
 * Byte fuer Byte festgehalten -- deterministisches ECDSA (RFC 6979) ueber den
 * EIP-191-Digest auf beiden Seiten.
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

const PRIV = '0x' + '11'.repeat(32);
const WALLET = '0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A';
const WALLET_KLEIN = WALLET.toLowerCase();
const PY_MESSAGE = 'aequitas-lebensnachweis-v1|0x19e7e376e7c213b7e7e7e46cc70a5dd086daff2a|nonce-1';
const PY_SIGNATURE =
  '0x1b2f37c9860b8c4074f15b1aa965c836132ee2b244c2c8d4195e83cbeefdf1945e9495370f8a2000f68fdefc773ec44da72e896956063539a4d32742c2c84b8b1c';

const TAG = 86400;
const JETZT = 1_900_000_000;

describe('Lebensnachweis: Besitz-Signatur', () => {
  it('baut genau die Nachricht, die der Coordinator prueft', () => {
    const { lebensnachweisMessage } = require('../biometricIdentity');
    expect(lebensnachweisMessage(` ${WALLET} `, 'nonce-1')).toBe(PY_MESSAGE);
  });

  it('signiert Byte fuer Byte wie die Python-Vorlage', async () => {
    const { lebensnachweisMessage } = require('../biometricIdentity');
    const sig = await new ethers.Wallet(PRIV).signMessage(lebensnachweisMessage(WALLET, 'nonce-1'));
    expect(sig).toBe(PY_SIGNATURE);
  });

  it('Missbrauch: eine Erneuerungs- oder Nachzieh-Signatur gilt hier nicht', async () => {
    const { lebensnachweisMessage, erneuernMessage, nachziehenMessage } = require('../biometricIdentity');
    const w = new ethers.Wallet(PRIV);
    const ln = lebensnachweisMessage(WALLET, 'n');
    for (const fremd of [erneuernMessage(WALLET, 'n'), nachziehenMessage(WALLET, 'n')]) {
      expect(fremd).not.toBe(ln);
      // Was der Coordinator aus der fremden Signatur ueber SEINE Nachricht
      // zurueckrechnet, ist nicht diese Wallet.
      const sig = await w.signMessage(fremd);
      expect(ethers.verifyMessage(ln, sig).toLowerCase()).not.toBe(WALLET_KLEIN);
    }
  });
});

// ---------------------------------------------------------------------------
// Was an Coordinator und Kette geht
// ---------------------------------------------------------------------------

const felder = (form: any): Record<string, unknown> => {
  const teile: [string, unknown][] =
    typeof form.getParts === 'function'
      ? form.getParts().map((p: any) => [p.fieldName, p.string ?? p.uri])
      : Array.from(form.entries());
  return Object.fromEntries(teile);
};

const BESCHEINIGUNG = { wallet: WALLET_KLEIN, issued_at: JETZT, signature: 'ab'.repeat(64), public_key: 'cd'.repeat(32) };

async function lauf(antwort: unknown, opts: { nonce?: string | null; httpOk?: boolean } = {}) {
  const bio = require('../biometricIdentity');
  bio._setCoordinatorCandidatesForTest(['http://coord.test']);
  const nonce = opts.nonce === undefined ? 'nonce-1' : opts.nonce;
  const urls: string[] = [];
  const signiert: string[] = [];
  let gesendet: Record<string, unknown> = {};
  const altFetch = global.fetch;
  global.fetch = jest.fn(async (u: string, init: any) => {
    urls.push(u);
    if (u.endsWith('/challenge')) {
      return { ok: true, json: async () => ({ nonce: 'nonce-1', challenge_type: 'kopf_drehen', flash_sequence: '' }) };
    }
    gesendet = felder(init.body);
    return { ok: opts.httpOk ?? true, status: opts.httpOk === false ? 502 : 200, json: async () => antwort };
  }) as any;
  try {
    if (nonce) expect((await bio.requestChallenge())?.nonce).toBe(nonce);
    const r = await bio.lebensnachweisBiometric(
      { faceUri: 'file:///f.jpg', faceBurstUris: [], burstIntervalMs: 100, challengeNonce: nonce ?? undefined },
      {
        deviceId: 'd',
        walletAddress: WALLET,
        signer: { signMessage: async (m: string) => { signiert.push(m); return '0xsig'; } },
        consent: { biometricConsent: true, bonusConsent: false, consentedAt: 7 },
      },
    );
    return { r, urls, signiert, gesendet };
  } finally {
    global.fetch = altFetch;
    bio._setCoordinatorCandidatesForTest(null);
  }
}

describe('lebensnachweisBiometric', () => {
  const api = require('../api');
  beforeEach(() => {
    api.submitProofOfLife.mockReset();
    api.submitLivenessRenewal.mockReset();
  });

  it('sendet an /lebensnachweis mit Einwilligung v4, ohne Alter; reicht die Bescheinigung unveraendert weiter', async () => {
    api.submitProofOfLife.mockResolvedValue({ ok: true, wallet: WALLET_KLEIN });
    const { r, urls, signiert, gesendet } = await lauf({
      status: 'bescheinigt',
      lebensnachweis: BESCHEINIGUNG,
      vorlage: { aufgefrischt: 1, gesamt: 1 },
      alters_signal: 'unauffaellig',
    });
    expect(urls[urls.length - 1]).toBe('http://coord.test/lebensnachweis');
    expect(signiert).toEqual([PY_MESSAGE]);
    expect(gesendet.wallet_address).toBe(WALLET_KLEIN);
    expect(gesendet.wallet_signature).toBe('0xsig');
    expect(gesendet.challenge_nonce).toBe('nonce-1');
    expect(gesendet.consent_version).toBe('einwilligung-v4-2026-10-21');
    expect(gesendet.consented_at).toBe('7');
    expect(gesendet.device_id).toBe('d');
    expect(gesendet.geburtsjahr).toBeUndefined();
    expect(gesendet.alter_anfrage).toBeUndefined();
    expect(api.submitProofOfLife).toHaveBeenCalledTimes(1);
    expect(api.submitProofOfLife).toHaveBeenCalledWith(BESCHEINIGUNG);
    // Nie an den Erneuerungs-Endpunkt.
    expect(api.submitLivenessRenewal).not.toHaveBeenCalled();
    expect(r.kette).toBe('angenommen');
    expect(r.naechster_ab).toBe(JETZT + 300 * TAG);
  });

  it('nimmt den Termin der Kette, wenn sie einen nennt', async () => {
    api.submitProofOfLife.mockResolvedValue({ ok: true, faellig_ab: JETZT + 301 * TAG });
    const { r } = await lauf({ status: 'bescheinigt', lebensnachweis: BESCHEINIGUNG });
    expect(r.naechster_ab).toBe(JETZT + 301 * TAG);
  });

  it('"schon nachgewiesen" zaehlt als Erfolg', async () => {
    api.submitProofOfLife.mockResolvedValue({ ok: true, schon_nachgewiesen: true });
    const { r } = await lauf({ status: 'bescheinigt', lebensnachweis: BESCHEINIGUNG });
    expect(r.kette).toBe('schon_nachgewiesen');
    expect(r.naechster_ab).toBeGreaterThan(JETZT);
  });

  it.each([
    'zu_frueh', 'nicht_aktiv', 'kein_mensch', 'anderes_gesicht', 'unbekanntes_gesicht', 'kein_quorum',
    'kette_nicht_erreichbar', 'lebendigkeit_unsicher', 'selbst_bescheinigung', 'vergleichsdienst_veraltet',
    'signatur_ungueltig', 'nonce_ungueltig', 'kein_schluessel', 'missing_consent', 'consent_outdated',
    'capture_failed', 'liveness_failed', 'risk_blocked', 'invalid_mode',
  ])('Missbrauch: bei %s geht nichts an die Kette -- auch nicht, wenn eine Bescheinigung beiliegt', async (status) => {
    const { r } = await lauf({ status, lebensnachweis: BESCHEINIGUNG, faellig_ab: JETZT + TAG });
    expect(api.submitProofOfLife).not.toHaveBeenCalled();
    expect(r.status).toBe(status);
    expect(r.kette).toBeUndefined();
  });

  it.each([
    ['fehlt', undefined],
    ['fremde Wallet', { ...BESCHEINIGUNG, wallet: '0x' + '22'.repeat(20) }],
    ['Zeit als Text', { ...BESCHEINIGUNG, issued_at: String(JETZT) }],
    ['Zeit null', { ...BESCHEINIGUNG, issued_at: 0 }],
    ['Signatur kein Hex', { ...BESCHEINIGUNG, signature: 'zz|chain:1' }],
    ['Schluessel fehlt', { ...BESCHEINIGUNG, public_key: undefined }],
  ])('Missbrauch: bescheinigt, aber Bescheinigung %s -- nichts an die Kette', async (_n, ln) => {
    const { r } = await lauf({ status: 'bescheinigt', lebensnachweis: ln });
    expect(api.submitProofOfLife).not.toHaveBeenCalled();
    expect(r.kette).toBe('abgelehnt');
    expect(r.naechster_ab).toBeUndefined();
  });

  it('nur die vier Felder gehen an die Kette, Werte unveraendert', async () => {
    api.submitProofOfLife.mockResolvedValue({ ok: true });
    await lauf({ status: 'bescheinigt', lebensnachweis: { ...BESCHEINIGUNG, bio_hash: '123', extra: 1 } });
    expect(api.submitProofOfLife).toHaveBeenCalledWith(BESCHEINIGUNG);
  });

  it('Kette nicht erreichbar: eigener Ausgang, und dieselbe Bescheinigung kann erneut gesendet werden', async () => {
    api.submitProofOfLife.mockRejectedValueOnce(new Error('Network request failed'));
    const { r } = await lauf({ status: 'bescheinigt', lebensnachweis: BESCHEINIGUNG });
    expect(r.kette).toBe('nicht_erreichbar');
    expect(r.naechster_ab).toBeNull();
    expect(r.lebensnachweis).toEqual(BESCHEINIGUNG);

    const { lebensnachweisAnKette } = require('../biometricIdentity');
    api.submitProofOfLife.mockResolvedValueOnce({ ok: true });
    const k = await lebensnachweisAnKette(r.lebensnachweis);
    expect(k.kette).toBe('angenommen');
    expect(api.submitProofOfLife).toHaveBeenLastCalledWith(BESCHEINIGUNG);
  });

  it('Kette lehnt ab: abgelehnt mit Grund, kein naechster Termin', async () => {
    api.submitProofOfLife.mockResolvedValue({ error: 'signature invalid' });
    const { r } = await lauf({ status: 'bescheinigt', lebensnachweis: BESCHEINIGUNG });
    expect(r.kette).toBe('abgelehnt');
    expect(r.kette_fehler).toBe('signature invalid');
    expect(r.naechster_ab).toBeNull();
  });

  it('ohne Challenge-Nonce wird nichts gesendet', async () => {
    const bio = require('../biometricIdentity');
    const altFetch = global.fetch;
    global.fetch = jest.fn() as any;
    try {
      await expect(
        bio.lebensnachweisBiometric(
          { faceUri: 'file:///f.jpg', faceBurstUris: [], burstIntervalMs: 100 },
          { deviceId: 'd', walletAddress: WALLET, signer: { signMessage: async () => '0xsig' } },
        ),
      ).rejects.toBeInstanceOf(bio.NachziehenNeedsChallenge);
      expect(global.fetch).not.toHaveBeenCalled();
    } finally {
      global.fetch = altFetch;
    }
  });

  it('HTTP-Fehler oder Antwort ohne Status: Fehler, nichts an die Kette', async () => {
    await expect(lauf({ status: 'bescheinigt', lebensnachweis: BESCHEINIGUNG }, { httpOk: false })).rejects.toThrow('HTTP 502');
    await expect(lauf({ lebensnachweis: BESCHEINIGUNG })).rejects.toThrow('without status');
    expect(api.submitProofOfLife).not.toHaveBeenCalled();
  });
});

describe('Antwort der Kette auf die Bescheinigung', () => {
  const { ketteLebensnachweisDeuten } = require('../biometricIdentity');

  it('angenommen / schon nachgewiesen', () => {
    expect(ketteLebensnachweisDeuten({ ok: true, wallet: WALLET_KLEIN })).toEqual({ kette: 'angenommen' });
    expect(ketteLebensnachweisDeuten({ ok: true, schon_nachgewiesen: true })).toEqual({ kette: 'schon_nachgewiesen' });
  });

  it('fail-closed: nur ok === true ist ein Erfolg', () => {
    expect(ketteLebensnachweisDeuten({ ok: 'true' }).kette).toBe('abgelehnt');
    expect(ketteLebensnachweisDeuten({ ok: 1 }).kette).toBe('abgelehnt');
    expect(ketteLebensnachweisDeuten({ schon_nachgewiesen: true }).kette).toBe('abgelehnt');
    expect(ketteLebensnachweisDeuten(null)).toEqual({ kette: 'abgelehnt', kette_fehler: null });
  });

  it('ein kaputter Termin der Kette wird nicht uebernommen', () => {
    expect(ketteLebensnachweisDeuten({ ok: true, faellig_ab: '1900000000' })).toEqual({ kette: 'angenommen' });
    expect(ketteLebensnachweisDeuten({ ok: true, faellig_ab: -1 })).toEqual({ kette: 'angenommen' });
  });
});

// ---------------------------------------------------------------------------
// Stand aus /api/balance
// ---------------------------------------------------------------------------

describe('lebensnachweisLesen: fail-closed', () => {
  const { lebensnachweisLesen } = jest.requireActual('../lebensnachweis');
  const am = JETZT - 100 * TAG;
  const gut = { aktiv: true, am, faellig_ab: am + 300 * TAG, frist: am + 365 * TAG, pause_ab: am + 395 * TAG, pausiert: false };

  it('liest ein gueltiges Objekt', () => {
    expect(lebensnachweisLesen(gut)).toEqual(gut);
    expect(lebensnachweisLesen({ ...gut, aktiv: false, am: 0, faellig_ab: 0, frist: 0, pause_ab: 0 })).toEqual({
      aktiv: false, am: 0, faellig_ab: 0, frist: 0, pause_ab: 0, pausiert: false,
    });
  });

  it.each([
    ['fehlt (aelterer Knoten)', undefined],
    ['null', null],
    ['Liste', [gut]],
    ['Text', 'aktiv'],
    ['aktiv als Text', { ...gut, aktiv: 'true' }],
    ['aktiv fehlt', { ...gut, aktiv: undefined }],
    ['pausiert als Zahl', { ...gut, pausiert: 0 }],
    ['pausiert fehlt', { ...gut, pausiert: undefined }],
    ['Zeit als Text', { ...gut, faellig_ab: String(gut.faellig_ab) }],
    ['Zeit negativ', { ...gut, frist: -1 }],
    ['Zeit gebrochen', { ...gut, am: am + 0.5 }],
    ['Zeit NaN', { ...gut, pause_ab: NaN }],
    ['Zeit unendlich', { ...gut, pause_ab: Infinity }],
    ['Zeit als bool', { ...gut, am: true }],
    ['Zeit absurd gross', { ...gut, pause_ab: 1e15 }],
    ['Zeit fehlt', { ...gut, frist: undefined }],
    ['Frist vor faellig_ab', { ...gut, frist: gut.faellig_ab - 1 }],
    ['Pause vor Frist', { ...gut, pause_ab: gut.frist - 1 }],
    ['aktiv ohne faellig_ab', { ...gut, faellig_ab: 0 }],
  ])('%s -> nichts', (_n, roh) => {
    expect(lebensnachweisLesen(roh)).toBeNull();
  });
});

describe('Phase und Erinnerung je Zustand', () => {
  const { lebensnachweisPhase, lebensnachweisErinnern, lebensnachweisAusKontostand } = jest.requireActual('../lebensnachweis');
  const am = JETZT;
  const stand = { aktiv: true, am, faellig_ab: am + 300 * TAG, frist: am + 365 * TAG, pause_ab: am + 395 * TAG, pausiert: false };

  it.each([
    ['nicht aktiv', { ...stand, aktiv: false }, am + 500 * TAG, 'inaktiv', false],
    ['frisch bestaetigt', stand, am + TAG, 'noch_nicht', false],
    ['eine Sekunde vor faellig_ab', stand, stand.faellig_ab - 1, 'noch_nicht', false],
    ['ab faellig_ab', stand, stand.faellig_ab, 'faellig', true],
    ['kurz vor der Frist', stand, stand.frist - 1, 'faellig', true],
    ['ab der Frist: Nachfrist', stand, stand.frist, 'nachfrist', true],
    ['kurz vor der Pause', stand, stand.pause_ab - 1, 'nachfrist', true],
    ['ab pause_ab', stand, stand.pause_ab, 'pausiert', true],
    ['die Kette meldet pausiert, die Uhr geht nach', { ...stand, pausiert: true }, stand.frist, 'pausiert', true],
  ])('%s', (_n, s, jetzt, phase, erinnern) => {
    expect(lebensnachweisPhase(s, jetzt)).toBe(phase);
    expect(lebensnachweisErinnern(phase)).toBe(erinnern);
  });

  it('keine Erinnerung ohne Stand', () => {
    expect(lebensnachweisErinnern(null)).toBe(false);
  });

  it('aus dem Kontostand: nur fuer Menschen, und nur mit gueltigem Objekt', () => {
    expect(lebensnachweisAusKontostand({ is_human: true, lebensnachweis: stand }, stand.faellig_ab)).toEqual({ stand, phase: 'faellig' });
    expect(lebensnachweisAusKontostand({ is_human: false, lebensnachweis: stand }, stand.faellig_ab)).toBeNull();
    expect(lebensnachweisAusKontostand({ is_human: true }, stand.faellig_ab)).toBeNull();
    expect(lebensnachweisAusKontostand({ is_human: true, lebensnachweis: { ...stand, pausiert: 'ja' } }, stand.pause_ab)).toBeNull();
    expect(lebensnachweisAusKontostand(null, stand.faellig_ab)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Meldungen
// ---------------------------------------------------------------------------

describe('jeder Status hat eine eigene, uebersetzte Meldung', () => {
  const { lebensnachweisMeldung } = jest.requireActual('../lebensnachweis');
  const { RESOURCES, LOCALES } = jest.requireActual('../i18n');
  const STATUS = [
    'zu_frueh', 'nicht_aktiv', 'kein_mensch', 'anderes_gesicht', 'unbekanntes_gesicht', 'kein_quorum',
    'kette_nicht_erreichbar', 'lebendigkeit_unsicher', 'selbst_bescheinigung', 'vergleichsdienst_veraltet',
    'signatur_ungueltig', 'nonce_ungueltig', 'kein_schluessel', 'missing_consent', 'consent_outdated',
    'capture_failed', 'liveness_failed', 'risk_blocked', 'invalid_mode',
  ];

  it.each(STATUS)('%s', (status) => {
    const m = lebensnachweisMeldung({ status });
    expect(m.key).not.toBe('lnErgebnisFehler');
    for (const l of LOCALES) expect(RESOURCES[l].identity[m.key]).toBeTruthy();
  });

  it('bescheinigt haengt am Ausgang der Kette', () => {
    expect(lebensnachweisMeldung({ status: 'bescheinigt', kette: 'angenommen' }).key).toBe('lnErgebnisBestaetigt');
    expect(lebensnachweisMeldung({ status: 'bescheinigt', kette: 'schon_nachgewiesen' }).key).toBe('lnErgebnisBestaetigt');
    expect(lebensnachweisMeldung({ status: 'bescheinigt', kette: 'nicht_erreichbar' }).key).toBe('lnErgebnisKetteNichtErreichbar');
    expect(lebensnachweisMeldung({ status: 'bescheinigt', kette: 'abgelehnt' }).key).toBe('lnErgebnisKetteAbgelehnt');
    // Ohne Kettenausgang ist es KEIN Erfolg.
    expect(lebensnachweisMeldung({ status: 'bescheinigt' }).key).toBe('lnErgebnisKetteAbgelehnt');
  });

  it('zu frueh nennt das Datum; Unbekanntes faellt auf die allgemeine Meldung', () => {
    expect(lebensnachweisMeldung({ status: 'zu_frueh', faellig_ab: JETZT })).toEqual({ key: 'lnErgebnisZuFrueh', datum: JETZT });
    expect(lebensnachweisMeldung({ status: 'etwas_neues' }).key).toBe('lnErgebnisFehler');
    expect(lebensnachweisMeldung(null).key).toBe('lnErgebnisFehler');
  });

  it('Texte mit Datum tragen den Platzhalter in jeder Sprache', () => {
    const mitDatum = ['lnZuletzt', 'lnNochNicht', 'lnFaellig', 'lnNachfrist', 'lnErgebnisNaechster', 'lnErgebnisZuFrueh'];
    for (const l of LOCALES) {
      for (const k of mitDatum) expect(RESOURCES[l].identity[k]).toContain('{date}');
      for (const k of ['lnHinweisFaellig', 'lnHinweisNachfrist']) expect(RESOURCES[l].home[k]).toContain('{date}');
    }
  });
});

describe('Einwilligung', () => {
  it('die App sendet v4 -- die Fassung, die den Lebensnachweis nennt', () => {
    expect(require('../biometricIdentity').CONSENT_VERSION).toBe('einwilligung-v4-2026-10-21');
  });

  it('der v4-Zusatz steht in jeder Sprache', () => {
    const { RESOURCES, LOCALES } = jest.requireActual('../i18n');
    for (const l of LOCALES) expect(RESOURCES[l].identity.biometricConsentLebensnachweis.length).toBeGreaterThan(80);
  });
});
