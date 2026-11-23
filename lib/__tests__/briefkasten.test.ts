// Briefkasten der App (lib/briefkasten.ts) gegen den Prüfvektor des Knotens
// (aequitas x/humanity/keeper/briefkasten_vektor_test.go): dieselben
// Nachrichten, dieselben Unterschriften, dieselben Grenzen.
import vektor from './vektoren/briefkasten_vektor.json';
import { CHAIN_ID, QuantenSFehler, unterschreiben } from '../quantenS';
import {
  ABHOLEN_BYTES,
  ABHOLEN_HOECHSTENS,
  ANTWORT_MAX,
  INHALT_MAX,
  ZEIT_SPIEL,
  abholen,
  abholenLesen,
  abholenNachricht,
  ablegen,
  ablegenNachricht,
  inhaltHash,
  quittieren,
  quittierenNachricht,
} from '../briefkasten';

const API = 'https://knoten.test/api';

function signerAus(schluessel: string) {
  return { signMessage: async (m: string) => unterschreiben(schluessel, m) };
}
const absender = signerAus(vektor.absender_schluessel_nur_test);
const empfaenger = signerAus(vektor.empfaenger_schluessel_nur_test);

interface Aufruf {
  url: string;
  koerper: Record<string, unknown>;
}

/** Ein Knoten, der Aufrufe festhält und eine feste Antwort gibt. */
function knoten(status: number, body: string) {
  const aufrufe: Aufruf[] = [];
  const f = (async (url: string, init: RequestInit) => {
    aufrufe.push({ url, koerper: JSON.parse(init.body as string) });
    return { ok: status >= 200 && status < 300, status, text: async () => body } as unknown as Response;
  }) as unknown as typeof fetch;
  return { f, aufrufe };
}

describe('Prüfvektor Knoten ↔ App', () => {
  it('rechnet Nachrichten, Hash und Unterschriften wie der Knoten', () => {
    expect(vektor.chain_id).toBe(CHAIN_ID);
    expect(inhaltHash(vektor.inhalt)).toBe(vektor.inhalt_hash);
    expect(ablegenNachricht(vektor.absender, vektor.empfaenger, vektor.inhalt_hash, vektor.zeit)).toBe(vektor.ablegen_nachricht);
    expect(abholenNachricht(vektor.empfaenger, vektor.nach, vektor.zeit + 1)).toBe(vektor.abholen_nachricht);
    expect(quittierenNachricht(vektor.empfaenger, vektor.bis, vektor.zeit + 2)).toBe(vektor.quittieren_nachricht);
    expect(unterschreiben(vektor.absender_schluessel_nur_test, vektor.ablegen_nachricht)).toBe(vektor.ablegen_sig);
    expect(unterschreiben(vektor.empfaenger_schluessel_nur_test, vektor.abholen_nachricht)).toBe(vektor.abholen_sig);
    expect(unterschreiben(vektor.empfaenger_schluessel_nur_test, vektor.quittieren_nachricht)).toBe(vektor.quittieren_sig);
  });

  it('hat dieselben Grenzen wie der Knoten', () => {
    expect(vektor.pfad).toBe('/api/briefkasten/');
    expect(INHALT_MAX).toBe(vektor.inhalt_max);
    expect(ABHOLEN_HOECHSTENS).toBe(vektor.abholen_hoechstens);
    expect(ABHOLEN_BYTES).toBe(vektor.abholen_bytes);
    expect(ZEIT_SPIEL).toBe(vektor.zeit_spiel);
  });
});

describe('ablegen, abholen, quittieren', () => {
  it('schickt genau die Anfragen aus dem Vektor', async () => {
    const k1 = knoten(200, '{"ok":true,"id":7}');
    expect(await ablegen(vektor.absender, vektor.empfaenger, vektor.inhalt, absender, vektor.zeit, k1.f, API)).toBe(7);
    expect(k1.aufrufe[0].url).toBe(`${API}/briefkasten/ablegen`);
    expect(k1.aufrufe[0].koerper).toEqual({ von: vektor.absender, an: vektor.empfaenger, inhalt: vektor.inhalt, zeit: vektor.zeit, sig: vektor.ablegen_sig });

    const k2 = knoten(200, JSON.stringify({ briefe: [{ id: 42, von: vektor.absender, inhalt: vektor.inhalt, zeit: vektor.zeit }], mehr: false }));
    const r = await abholen(vektor.empfaenger, vektor.nach, empfaenger, vektor.zeit + 1, k2.f, API);
    expect(r.briefe).toEqual([{ id: 42, von: vektor.absender, inhalt: vektor.inhalt, zeit: vektor.zeit }]);
    expect(k2.aufrufe[0].koerper).toEqual({ an: vektor.empfaenger, nach: vektor.nach, zeit: vektor.zeit + 1, sig: vektor.abholen_sig });

    const k3 = knoten(200, '{"ok":true,"geloescht":1}');
    expect(await quittieren(vektor.empfaenger, vektor.bis, empfaenger, vektor.zeit + 2, k3.f, API)).toBe(1);
    expect(k3.aufrufe[0].koerper).toEqual({ an: vektor.empfaenger, bis: vektor.bis, zeit: vektor.zeit + 2, sig: vektor.quittieren_sig });
  });

  it('nimmt Adressen mit Prüfsumme an und schickt sie klein', async () => {
    const k = knoten(200, '{"ok":true,"id":1}');
    const gemischt = '0x' + vektor.absender.slice(2).toUpperCase();
    await ablegen(gemischt, vektor.empfaenger, vektor.inhalt, absender, vektor.zeit, k.f, API);
    expect(k.aufrufe[0].koerper.von).toBe(vektor.absender);
  });

  it('reicht nie eine Unterschrift ein, die nicht zur eigenen Wallet passt', async () => {
    const k = knoten(200, '{"ok":true,"id":1}');
    await expect(ablegen(vektor.absender, vektor.empfaenger, vektor.inhalt, empfaenger, vektor.zeit, k.f, API)).rejects.toThrow('Unterschrift');
    await expect(abholen(vektor.empfaenger, 0, absender, vektor.zeit, k.f, API)).rejects.toThrow('Unterschrift');
    await expect(quittieren(vektor.empfaenger, 1, absender, vektor.zeit, k.f, API)).rejects.toThrow('Unterschrift');
    expect(k.aufrufe).toHaveLength(0);
  });

  it.each([
    ['leer', ''],
    ['groß geschrieben', vektor.inhalt.toUpperCase()],
    ['ungerade Länge', vektor.inhalt + 'a'],
    ['mit 0x', '0x' + vektor.inhalt],
    ['zu groß', 'ab'.repeat(INHALT_MAX + 1)],
  ])('legt keinen Inhalt ab: %s', async (_n, inhalt) => {
    const k = knoten(200, '{"ok":true,"id":1}');
    await expect(ablegen(vektor.absender, vektor.empfaenger, inhalt, absender, vektor.zeit, k.f, API)).rejects.toThrow(QuantenSFehler);
    expect(k.aufrufe).toHaveLength(0);
  });

  it('legt genau INHALT_MAX Byte ab', async () => {
    const k = knoten(200, '{"ok":true,"id":1}');
    await expect(ablegen(vektor.absender, vektor.empfaenger, 'ab'.repeat(INHALT_MAX), absender, vektor.zeit, k.f, API)).resolves.toBe(1);
  });

  it('meldet den Grund des Knotens', async () => {
    const k = knoten(429, '{"error":"Kontingent des Absenders voll"}');
    await expect(ablegen(vektor.absender, vektor.empfaenger, vektor.inhalt, absender, vektor.zeit, k.f, API)).rejects.toThrow('HTTP 429: Kontingent des Absenders voll');
  });

  it('weist eine zu große Antwort ab', async () => {
    const k = knoten(200, JSON.stringify({ briefe: [], mehr: false }) + ' '.repeat(ANTWORT_MAX));
    await expect(abholen(vektor.empfaenger, 0, empfaenger, vektor.zeit, k.f, API)).rejects.toThrow('zu groß');
  });

  it('meldet Netzfehler als Netz', async () => {
    const f = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    await expect(quittieren(vektor.empfaenger, 1, empfaenger, vektor.zeit, f, API)).rejects.toThrow('Netz');
  });

  it.each([
    ['ohne ok', '{"id":3}'],
    ['id 0', '{"ok":true,"id":0}'],
    ['id als Text', '{"ok":true,"id":"3"}'],
    ['kein JSON', 'ok'],
  ])('liest keine falsche Ablage-Antwort: %s', async (_n, body) => {
    const k = knoten(200, body);
    await expect(ablegen(vektor.absender, vektor.empfaenger, vektor.inhalt, absender, vektor.zeit, k.f, API)).rejects.toThrow(QuantenSFehler);
  });
});

describe('Antwort beim Abholen streng lesen', () => {
  const brief = (x: Record<string, unknown> = {}) => ({ id: 42, von: vektor.absender, inhalt: vektor.inhalt, zeit: vektor.zeit, ...x });
  const gut = { briefe: [brief(), brief({ id: 43 })], mehr: true };

  it('liest eine gültige Antwort', () => {
    expect(abholenLesen(gut, 41)?.briefe.map((b) => b.id)).toEqual([42, 43]);
    expect(abholenLesen({ briefe: [], mehr: false }, 0)).toEqual({ briefe: [], mehr: false });
  });

  it.each([
    ['kein Objekt', []],
    ['mehr fehlt', { briefe: [] }],
    ['Liste fehlt', { mehr: false }],
    ['mehr ohne Brief', { briefe: [], mehr: true }],
    ['Nummer nicht nach "nach"', { briefe: [brief({ id: 41 })], mehr: false }],
    ['Reihenfolge', { briefe: [brief({ id: 43 }), brief({ id: 42 })], mehr: false }],
    ['doppelt', { briefe: [brief(), brief()], mehr: false }],
    ['Absender groß', { briefe: [brief({ von: vektor.absender.toUpperCase() })], mehr: false }],
    ['Inhalt leer', { briefe: [brief({ inhalt: '' })], mehr: false }],
    ['Inhalt groß geschrieben', { briefe: [brief({ inhalt: vektor.inhalt.toUpperCase() })], mehr: false }],
    ['Inhalt zu groß', { briefe: [brief({ inhalt: 'ab'.repeat(INHALT_MAX + 1) })], mehr: false }],
    ['Zeit 0', { briefe: [brief({ zeit: 0 })], mehr: false }],
    ['fremdes Feld', { briefe: [{ ...brief(), an: vektor.empfaenger }], mehr: false }],
    ['zu viele', { briefe: Array.from({ length: ABHOLEN_HOECHSTENS + 1 }, (_, i) => brief({ id: 42 + i })), mehr: true }],
  ])('weist ab: %s', (_n, roh) => {
    expect(abholenLesen(roh, 41)).toBeNull();
  });

  it('liest die größte erlaubte Antwort (32 volle Briefe = ABHOLEN_BYTES)', () => {
    const voll = { briefe: Array.from({ length: ABHOLEN_HOECHSTENS }, (_, i) => brief({ id: 42 + i, inhalt: 'ab'.repeat(INHALT_MAX) })), mehr: true };
    expect(abholenLesen(voll, 41)?.briefe).toHaveLength(ABHOLEN_HOECHSTENS);
    expect(JSON.stringify(voll).length).toBeLessThanOrEqual(ANTWORT_MAX);
  });

  it('weist eine falsche Antwort beim Abholen als Fehler ab', async () => {
    const k = knoten(200, JSON.stringify({ briefe: [brief({ id: 5 })], mehr: false }));
    await expect(abholen(vektor.empfaenger, 10, empfaenger, vektor.zeit, k.f, API)).rejects.toThrow('Antwort: Briefe');
  });
});
