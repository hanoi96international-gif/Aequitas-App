// Die App als Präparatorin (lib/quantenSPraeparator.ts) gegen den Prüfvektor
// des Knotens (aequitas x/humanity/keeper/quanten_s_praep_vektor_test.go):
// derselbe Schlüssel K, dieselben Nachrichten, dieselben Unterschriften.
import { ethers } from 'ethers';
import vektor from './vektoren/quanten_s_praep_vektor.json';
import { CHAIN_ID, QuantenSFehler, unterschreiben } from '../quantenS';
import {
  EINTRAEGE_MAX,
  REGISTER_MAX,
  holeRegister,
  meinStand,
  praepEinreichen,
  praepK,
  praepNachricht,
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
  const gut = {
    aktiv: true,
    vorlauf: 86400,
    nachlauf: 695160,
    hoechstens: 256,
    praeparatoren: [
      { konto: vektor.konto, gemeldet: 1000, im_los_ab: 87400 },
      { konto: '0x' + '11'.repeat(20), gemeldet: 500, im_los_ab: 86900, abgemeldet: 2000 },
    ],
    bestellungen: [],
  };

  it('liest eine gültige Antwort', () => {
    const r = registerLesen(gut) as Register;
    expect(r.aktiv).toBe(true);
    expect(r.eintraege).toHaveLength(2);
    expect(r.eintraege[1].abgemeldet).toBe(2000);
  });

  it.each([
    ['kein Objekt', []],
    ['aktiv fehlt', { ...gut, aktiv: undefined }],
    ['aktiv als Text', { ...gut, aktiv: 'true' }],
    ['Liste fehlt', { ...gut, praeparatoren: undefined }],
    ['Konto groß geschrieben', { ...gut, praeparatoren: [{ konto: '0x' + vektor.konto.slice(2).toUpperCase(), gemeldet: 1, im_los_ab: 2 }] }],
    ['Konto kurz', { ...gut, praeparatoren: [{ konto: '0x1234', gemeldet: 1, im_los_ab: 2 }] }],
    ['negative Zeit', { ...gut, praeparatoren: [{ konto: vektor.konto, gemeldet: -1, im_los_ab: 2 }] }],
    ['im Los vor der Meldung', { ...gut, praeparatoren: [{ konto: vektor.konto, gemeldet: 10, im_los_ab: 5 }] }],
    ['vor der Meldung abgemeldet', { ...gut, praeparatoren: [{ konto: vektor.konto, gemeldet: 10, im_los_ab: 20, abgemeldet: 5 }] }],
    ['Zeit als Bruch', { ...gut, praeparatoren: [{ konto: vektor.konto, gemeldet: 1.5, im_los_ab: 2 }] }],
    ['zu viele', { ...gut, praeparatoren: Array.from({ length: EINTRAEGE_MAX + 1 }, () => ({ konto: vektor.konto, gemeldet: 1, im_los_ab: 2 })) }],
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
    expect(meinStand(r, '0x' + '11'.repeat(20), 9e9)).toEqual({ art: 'abgemeldet', neuAb: 2000 + 695160 });
  });
});
