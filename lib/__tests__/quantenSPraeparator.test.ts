// Die App als Präparatorin (lib/quantenSPraeparator.ts) gegen den Prüfvektor
// des Knotens (aequitas x/humanity/keeper/quanten_s_praep_vektor_test.go):
// derselbe Schlüssel K, dieselben Nachrichten, dieselben Unterschriften.
import { ethers } from 'ethers';
import vektor from './vektoren/quanten_s_praep_vektor.json';
import { CHAIN_ID, QuantenSFehler, unterschreiben } from '../quantenS';
import {
  EINTRAEGE_MAX,
  PRAEP_PFAND_MIKRO,
  REGISTER_MAX,
  holePfaenderAb,
  holePraepPfandAb,
  holeRegister,
  meinStand,
  praepEinreichen,
  praepK,
  pfandZurueckEinreichen,
  praepNachricht,
  pubPasst,
  registerLesen,
  sigNormal,
  type Register,
} from '../quantenSPraeparator';

const API = 'https://knoten.test/api';

function lokalerSigner(schluessel: string) {
  return { signMessage: async (m: string) => unterschreiben(schluessel, m) };
}

function antwort(status: number, body: string) {
  return { ok: status >= 200 && status < 300, status, text: async () => body } as unknown as Response;
}

describe('Prüfvektor Knoten ↔ App', () => {
  it('rechnet Konto, K, Nachrichten und Unterschriften wie der Knoten', () => {
    expect(vektor.chain_id).toBe(CHAIN_ID);
    expect(new ethers.Wallet('0x' + vektor.schluessel_nur_test).address.toLowerCase()).toBe(vektor.konto);
    expect(praepK(vektor.konto)).toBe(vektor.k);
    expect(praepK(vektor.konto.toUpperCase().replace('0X', '0x'))).toBe(vektor.k);
    expect(praepNachricht('melden', vektor.konto, vektor.k, vektor.zeit)).toBe(vektor.melden_nachricht);
    expect(praepNachricht('abmelden', vektor.konto, vektor.k, vektor.zeit + 60)).toBe(vektor.abmelden_nachricht);
    // Die Wallet meldet ihre Adresse oft mit Pruefsumme (gemischt): dieselbe Nachricht.
    expect(praepNachricht('melden', ethers.getAddress(vektor.konto), vektor.k, vektor.zeit)).toBe(vektor.melden_nachricht);
    expect(unterschreiben(vektor.schluessel_nur_test, vektor.melden_nachricht)).toBe(vektor.melden_sig);
    expect(unterschreiben(vektor.schluessel_nur_test, vektor.abmelden_nachricht)).toBe(vektor.abmelden_sig);
    expect(vektor.melden_pfad).toBe('/api/quanten-w/s_praep_melden');
    expect(vektor.register_pfad).toBe('/api/quanten-w/praeparatoren');
    expect(vektor.hoechstens_eintraege).toBe(EINTRAEGE_MAX);
  });

  it('kennt den Schlüssel, den der Knoten aus der Meldung wiederherstellt (B4b-4a)', () => {
    const ausSig = ethers.SigningKey.recoverPublicKey(ethers.hashMessage(vektor.melden_nachricht), vektor.melden_sig);
    expect(ausSig.slice(2)).toBe(vektor.pub);
    expect(new ethers.SigningKey('0x' + vektor.schluessel_nur_test).publicKey.slice(2)).toBe(vektor.pub);
    expect(pubPasst(vektor.pub, vektor.konto)).toBe(true);
  });

  it('reicht genau den Satz des Vektors ein', async () => {
    const posts: { url: string; body: any }[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      posts.push({ url, body: JSON.parse(String(init?.body)) });
      return antwort(200, '{"ok":true}');
    }) as unknown as typeof fetch;
    await praepEinreichen('melden', vektor.konto, lokalerSigner(vektor.schluessel_nur_test), vektor.zeit, f, API);
    expect(posts).toEqual([
      { url: `${API}/quanten-w/s_praep_melden`, body: { wallet: vektor.konto, zeit: vektor.zeit, quanten_w: { k: vektor.k, wallet_sig: vektor.melden_sig } } },
    ]);
  });
});

describe('Einreichen: fail-closed', () => {
  const nieAufrufen = (async () => {
    throw new Error('darf nicht einreichen');
  }) as unknown as typeof fetch;

  it('reicht nichts ein, wenn die Wallet mit einem fremden Schlüssel unterschreibt', async () => {
    const fremd = lokalerSigner('62'.repeat(32));
    await expect(praepEinreichen('melden', vektor.konto, fremd, vektor.zeit, nieAufrufen, API)).rejects.toThrow('Unterschrift passt nicht');
  });

  it('reicht keine gespiegelte (nicht kanonische) Unterschrift ein', async () => {
    const N = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');
    const s = BigInt('0x' + vektor.melden_sig.slice(66, 130));
    const v = vektor.melden_sig.slice(130) === '1b' ? '1c' : '1b';
    const gespiegelt = vektor.melden_sig.slice(0, 66) + (N - s).toString(16).padStart(64, '0') + v;
    const signer = { signMessage: async () => gespiegelt };
    await expect(praepEinreichen('melden', vektor.konto, signer, vektor.zeit, nieAufrufen, API)).rejects.toThrow(QuantenSFehler);
  });

  it('nimmt eine Wallet-Unterschrift mit v = 00/01 und Großbuchstaben an (normalisiert)', () => {
    const roh = vektor.melden_sig.slice(0, 130).toUpperCase().replace('0X', '0x') + (vektor.melden_sig.endsWith('1b') ? '00' : '01');
    expect(sigNormal(roh)).toBe(vektor.melden_sig);
  });

  it('meldet den Grund des Knotens (z. B. Weg B noch nicht aktiv)', async () => {
    const f = (async () => antwort(409, '{"error":"quantum money way B (preparators) not active"}')) as unknown as typeof fetch;
    await expect(praepEinreichen('melden', vektor.konto, lokalerSigner(vektor.schluessel_nur_test), vektor.zeit, f, API)).rejects.toThrow(
      'HTTP 409: quantum money way B (preparators) not active',
    );
  });

  it('meldet Netzfehler als Netz', async () => {
    const f = (async () => {
      throw new TypeError('offline');
    }) as unknown as typeof fetch;
    await expect(praepEinreichen('abmelden', vektor.konto, lokalerSigner(vektor.schluessel_nur_test), vektor.zeit, f, API)).rejects.toThrow('Netz');
  });

  it('weist eine ungültige eigene Adresse ab', async () => {
    await expect(praepEinreichen('melden', 'kein-konto', lokalerSigner(vektor.schluessel_nur_test), vektor.zeit, nieAufrufen, API)).rejects.toThrow(
      'Wallet-Adresse',
    );
  });
});

describe('Register lesen', () => {
  const zweite = new ethers.SigningKey('0x' + '22'.repeat(32));
  const zweitesKonto = ethers.computeAddress(zweite.publicKey).toLowerCase();
  const zweitePub = zweite.publicKey.slice(2);
  const eintrag = (x: Record<string, unknown>) => ({ ...gut, praeparatoren: [{ konto: vektor.konto, pub: vektor.pub, gemeldet: 1, im_los_ab: 2, ...x }] });
  const gut = {
    aktiv: true,
    vorlauf: 86400,
    nachlauf: 695160,
    hoechstens: 256,
    praeparatoren: [
      { konto: vektor.konto, pub: vektor.pub, gemeldet: 1000, im_los_ab: 87400 },
      { konto: zweitesKonto, pub: zweitePub, gemeldet: 500, im_los_ab: 86900, abgemeldet: 2000 },
    ],
    bestellungen: [],
  };

  it('der Baustein der Fehlfälle ist selbst gültig', () => {
    expect(registerLesen(eintrag({}))?.eintraege).toHaveLength(1);
  });

  it('liest eine gültige Antwort', () => {
    const r = registerLesen(gut) as Register;
    expect(r.aktiv).toBe(true);
    expect(r.eintraege).toHaveLength(2);
    expect(r.eintraege[1].abgemeldet).toBe(2000);
    expect(r.eintraege[0].pub).toBe(vektor.pub);
  });

  it.each([
    ['kein Objekt', []],
    ['aktiv fehlt', { ...gut, aktiv: undefined }],
    ['aktiv als Text', { ...gut, aktiv: 'true' }],
    ['Liste fehlt', { ...gut, praeparatoren: undefined }],
    ['Konto groß geschrieben', eintrag({ konto: '0x' + vektor.konto.slice(2).toUpperCase() })],
    ['Konto kurz', eintrag({ konto: '0x1234' })],
    ['negative Zeit', eintrag({ gemeldet: -1 })],
    ['im Los vor der Meldung', eintrag({ gemeldet: 10, im_los_ab: 5 })],
    ['vor der Meldung abgemeldet', eintrag({ gemeldet: 10, im_los_ab: 20, abgemeldet: 5 })],
    ['Zeit als Bruch', eintrag({ gemeldet: 1.5 })],
    // Schlüssel (B4b-4b): nie ein Eintrag, an den die App nicht sicher
    // verschlüsseln kann -- ein Knoten könnte sonst einen eigenen einsetzen.
    ['ohne Schlüssel', eintrag({ pub: undefined })],
    ['fremder Schlüssel', eintrag({ pub: zweitePub })],
    ['Schlüssel groß', eintrag({ pub: vektor.pub.toUpperCase() })],
    ['Schlüssel mit 0x', eintrag({ pub: '0x' + vektor.pub })],
    ['Schlüssel komprimiert', eintrag({ pub: ethers.SigningKey.computePublicKey('0x' + vektor.pub, true).slice(2) })],
    ['Schlüssel neben der Kurve', eintrag({ pub: vektor.pub.slice(0, 129) + (vektor.pub.endsWith('0') ? '1' : '0') })],
    ['Schlüssel als Zahl', eintrag({ pub: 4 })],
    ['zu viele', { ...gut, praeparatoren: Array.from({ length: EINTRAEGE_MAX + 1 }, () => ({ konto: vektor.konto, pub: vektor.pub, gemeldet: 1, im_los_ab: 2 })) }],
  ])('weist ab: %s', (_name, roh) => {
    expect(registerLesen(roh)).toBeNull();
  });

  it('holt höchstens REGISTER_MAX Zeichen und gibt sonst null', async () => {
    const gross = (async () => antwort(200, JSON.stringify(gut) + ' '.repeat(REGISTER_MAX))) as unknown as typeof fetch;
    expect(await holeRegister(gross, API)).toBeNull();
    const fehler = (async () => antwort(404, '')) as unknown as typeof fetch;
    expect(await holeRegister(fehler, API)).toBeNull();
    const ok = (async () => antwort(200, JSON.stringify(gut))) as unknown as typeof fetch;
    expect((await holeRegister(ok, API))?.eintraege).toHaveLength(2);
  });

  it('bestimmt den eigenen Stand', () => {
    const r = registerLesen(gut) as Register;
    expect(meinStand(r, '0x' + '22'.repeat(20), 5000)).toEqual({ art: 'nicht_gemeldet' });
    expect(meinStand(r, vektor.konto, 87399)).toEqual({ art: 'wartet', imLosAb: 87400 });
    expect(meinStand(r, vektor.konto, 87400)).toEqual({ art: 'im_los', seit: 87400 });
    expect(meinStand(r, zweitesKonto, 9e9)).toEqual({ art: 'abgemeldet', neuAb: 2000 + 695160 });
  });
});

// P2 (Knoten quanten_s_pfaender.go): Pfand je Präparatorin.
describe('Pfand (P2)', () => {
  const basis = { aktiv: true, vorlauf: 86400, nachlauf: 695160, hoechstens: 256, bestellungen: [] };
  const mit = (x: Record<string, unknown>) => ({ ...basis, praeparatoren: [{ konto: vektor.konto, pub: vektor.pub, gemeldet: 1000, im_los_ab: 87400, ...x }] });

  it('liest Pfand und Rückgabezeit', () => {
    const r = registerLesen(mit({ pfand: PRAEP_PFAND_MIKRO, abgemeldet: 5000, pfand_zurueck_ab: 5000 + 30 * 86400 })) as Register;
    expect(r.eintraege[0]).toMatchObject({ pfand: PRAEP_PFAND_MIKRO, abgemeldet: 5000, pfandZurueckAb: 5000 + 30 * 86400 });
    expect(registerLesen(mit({ pfand: 9_000_000 }))?.eintraege[0].pfand).toBe(9_000_000); // nach einem Nachweis
  });

  it('weist unmögliche Pfänder ab (fail-closed)', () => {
    for (const x of [
      { pfand: 0 },
      { pfand: -1 },
      { pfand: PRAEP_PFAND_MIKRO + 1 },
      { pfand: 1.5 },
      { pfand: '10' },
      { pfand_zurueck_ab: 9_999_999 }, // ohne Pfand
      { pfand: PRAEP_PFAND_MIKRO, pfand_zurueck_ab: 9_999_999 }, // nicht abgemeldet
      { pfand: PRAEP_PFAND_MIKRO, abgemeldet: 5000, pfand_zurueck_ab: 4999 }, // vor der Abmeldung
    ]) {
      expect(registerLesen(mit(x))).toBeNull();
    }
  });

  it('bestimmt den Stand mit Pfand', () => {
    const jetzt = 100_000;
    const stand = (x: Record<string, unknown>, aktiv: boolean) => meinStand(registerLesen(mit(x)) as Register, vektor.konto, jetzt, aktiv);
    expect(stand({}, true)).toEqual({ art: 'nachlegen' }); // ohne Pfand nicht im Los
    expect(stand({}, false)).toEqual({ art: 'im_los', seit: 87400 }); // vor dem Stichtag wie bisher
    expect(stand({ pfand: PRAEP_PFAND_MIKRO }, true)).toEqual({ art: 'im_los', seit: 87400 });
    expect(stand({ pfand: PRAEP_PFAND_MIKRO, abgemeldet: 5000, pfand_zurueck_ab: jetzt + 1 }, true)).toEqual({ art: 'pfand_wartet', zurueckAb: jetzt + 1 });
    expect(stand({ pfand: PRAEP_PFAND_MIKRO, abgemeldet: 5000, pfand_zurueck_ab: jetzt }, true)).toEqual({ art: 'pfand_zurueck', pfand: PRAEP_PFAND_MIKRO });
    // Abgemeldet mit Pfand, aber ohne Rückgabezeit: nie "zurück" (fail-closed).
    expect(stand({ pfand: PRAEP_PFAND_MIKRO, abgemeldet: 5000 }, true).art).toBe('pfand_wartet');
    expect(stand({ abgemeldet: 5000 }, true)).toEqual({ art: 'abgemeldet', neuAb: 5000 + 695160 });
  });

  it('liest den Stichtag der Pfänder aus dem Status', async () => {
    const mitStatus = (body: string, status = 200) => jest.fn(async () => antwort(status, body)) as unknown as typeof fetch;
    expect(await holePfaenderAb(mitStatus(JSON.stringify({ quanten_w: { pfaender_ab: 1_800_000_000 } })), API)).toBe(1_800_000_000);
    expect(await holePfaenderAb(mitStatus(JSON.stringify({ quanten_w: {} })), API)).toBeNull(); // schlafend
    expect(await holePfaenderAb(mitStatus(JSON.stringify({ quanten_w: { pfaender_ab: '1' } })), API)).toBeNull();
    expect(await holePfaenderAb(mitStatus(JSON.stringify({ quanten_w: { pfaender_ab: 1.5 } })), API)).toBeNull();
    expect(await holePfaenderAb(mitStatus(JSON.stringify({ quanten_w: { pfaender_ab: -1 } })), API)).toBeNull();
    expect(await holePfaenderAb(mitStatus('kein json'), API)).toBeNull();
    expect(await holePfaenderAb(mitStatus('{}', 500), API)).toBeNull();
    expect(await holePfaenderAb(mitStatus('x'.repeat(REGISTER_MAX + 1)), API)).toBeNull();
    // Das Pfand je Präparatorin hat einen eigenen Stichtag: pfaender_ab allein schaltet es nicht ein.
    expect(await holePraepPfandAb(mitStatus(JSON.stringify({ quanten_w: { pfaender_ab: 1_800_000_000 } })), API)).toBeNull();
    expect(await holePraepPfandAb(mitStatus(JSON.stringify({ quanten_w: { pfaender_ab: 1, praep_pfand_ab: 1_900_000_000 } })), API)).toBe(1_900_000_000);
  });

  it('holt das Pfand zurück: ohne Wallet und Unterschrift, nur mit K des eigenen Eintrags', async () => {
    const fetchFn = jest.fn(async () => antwort(200, '{"ok":true}'));
    await pfandZurueckEinreichen(ethers.getAddress(vektor.konto), fetchFn as unknown as typeof fetch, API);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${API}/quanten-w/s_pfand_zurueck`);
    expect(JSON.parse(init.body as string)).toEqual({ wallet: '', zeit: 0, quanten_w: { k: vektor.k } });
    const abgewiesen = jest.fn(async () => antwort(409, JSON.stringify({ error: 'rejected: quanten_s_pfand_gebunden: steht im Los' })));
    await expect(pfandZurueckEinreichen(vektor.konto, abgewiesen as unknown as typeof fetch, API)).rejects.toThrow('quanten_s_pfand_gebunden');
    await expect(pfandZurueckEinreichen('0x12', fetchFn as unknown as typeof fetch, API)).rejects.toThrow(QuantenSFehler);
  });
});
