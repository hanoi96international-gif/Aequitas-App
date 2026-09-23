/**
 * WIDERSPRUCH GEGEN EINE DUPLIKAT-ABWEISUNG -- ART. 22 ABS. 3 DSGVO.
 *
 * Der Coordinator legt zu jeder Abweisung einen Vorgang an und gibt dessen
 * Kennung zurueck (coordinator/app/widerspruch.py). Bis 1.7.3 kannte die App
 * das Feld im Typ der Registrierung gar nicht und zeigte die Kennung nirgends
 * an: wer faelschlich als Duplikat galt, hatte einen Widerspruchsweg, den er
 * nicht finden konnte.
 *
 * Der Vorgang liegt nur in der Datenbank DES Coordinators, der abgewiesen hat
 * -- dieselbe Fehlerklasse wie beim Challenge-Nonce und beim Beweis. Ein
 * falscher Coordinator antwortet "unbekannt". Die Kennung ist zufaellig, also
 * ist Durchprobieren sicher; es macht den Weg auch nach einem App-Neustart
 * gangbar, wenn die App nicht mehr weiss, wer abgewiesen hat.
 */
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn() }), { virtual: true });
jest.mock('expo-file-system', () => ({ deleteAsync: jest.fn(async () => undefined) }), { virtual: true });

const C1 = 'https://c1.example';
const C2 = 'https://c2.example';

type Antwort = { ok: boolean; status: number; json: () => Promise<any> };
const json = (body: any, status = 200): Antwort => ({ ok: status < 400, status, json: async () => body });

describe('Widerspruch', () => {
  afterEach(() => { jest.resetModules(); (global as any).fetch = undefined; });

  it('geht an den Coordinator, der abgewiesen hat -- zuerst', async () => {
    const calls: { url: string; body?: any }[] = [];
    (global as any).fetch = jest.fn(async (url: string, init?: any) => {
      calls.push({ url, body: init?.body });
      if (url.endsWith('/health')) return json({});
      if (url.endsWith('/challenge')) return json({ nonce: 'N-1', challenge_type: 'look_left', flash_sequence: '' });
      if (url.endsWith('/register')) return json({ decision: 'duplicate_detected', widerspruch_kennung: 'W-ABC' });
      if (url.endsWith('/widerspruch')) return json({ status: url.startsWith(C2) ? 'aufgenommen' : 'unbekannt', kennung: 'W-ABC' });
      return json({});
    });

    await jest.isolateModulesAsync(async () => {
      const bio = require('../biometricIdentity');
      bio._setCoordinatorCandidatesForTest([C1, C2]);
      // Die Abweisung kommt von C2 (C1 ist beim Ausstellen des Nonce krank).
      (global as any).fetch.mockImplementationOnce(async (url: string) => {
        calls.push({ url });
        return json({}, 503); // C1 /health
      });
      await bio.requestChallenge();
      const r = await bio.registerBiometric(
        { faceUri: 'file:///f.jpg', faceBurstUris: [], challengeNonce: 'N-1', burstIntervalMs: 100 } as any,
        { deviceId: 'd1', walletAddress: '0x1' },
      );
      expect(r.widerspruch_kennung).toBe('W-ABC');

      const erg = await bio.widerspruchEinlegen('W-ABC');
      expect(erg.status).toBe('aufgenommen');
      const posts = calls.filter((c) => c.url.endsWith('/widerspruch'));
      expect(posts.map((c) => c.url)).toEqual([C2 + '/widerspruch']);
      expect(JSON.parse(posts[0].body)).toEqual({ kennung: 'W-ABC', standpunkt: '' });
    });
  });

  it('ohne Erinnerung probiert er alle durch, bis einer ihn kennt', async () => {
    const urls: string[] = [];
    (global as any).fetch = jest.fn(async (url: string) => {
      urls.push(url);
      return json({ status: url.startsWith(C2) ? 'aufgenommen' : 'unbekannt' });
    });
    await jest.isolateModulesAsync(async () => {
      const bio = require('../biometricIdentity');
      bio._setCoordinatorCandidatesForTest([C1, C2]);
      const erg = await bio.widerspruchEinlegen('W-NACH-NEUSTART');
      expect(erg.status).toBe('aufgenommen');
      expect(urls).toEqual([C1 + '/widerspruch', C2 + '/widerspruch']);
    });
  });

  it('ein unerreichbarer Coordinator macht das Ergebnis "nicht_erreichbar", nicht "unbekannt"', async () => {
    // Wuerde hier "unbekannt" stehen, hiesse das fuer den Menschen: deine
    // Kennung gibt es nicht. Dabei war nur der eine Coordinator, der sie
    // kennt, gerade nicht da. Das ist ein anderer Satz mit einer anderen
    // Handlung (spaeter nochmal), und er muss ankommen.
    (global as any).fetch = jest.fn(async (url: string) => {
      if (url.startsWith(C2)) throw new TypeError('Network request failed');
      return json({ status: 'unbekannt' });
    });
    await jest.isolateModulesAsync(async () => {
      const bio = require('../biometricIdentity');
      bio._setCoordinatorCandidatesForTest([C1, C2]);
      expect((await bio.widerspruchEinlegen('W-X')).status).toBe('nicht_erreichbar');
    });
  });

  it('kennt ihn keiner und sind alle erreichbar, heisst es "unbekannt"', async () => {
    (global as any).fetch = jest.fn(async () => json({ status: 'unbekannt' }));
    await jest.isolateModulesAsync(async () => {
      const bio = require('../biometricIdentity');
      bio._setCoordinatorCandidatesForTest([C1, C2]);
      expect((await bio.widerspruchEinlegen('W-GIBTS-NICHT')).status).toBe('unbekannt');
    });
  });

  it('eine leere Kennung schickt nichts los', async () => {
    (global as any).fetch = jest.fn();
    await jest.isolateModulesAsync(async () => {
      const bio = require('../biometricIdentity');
      bio._setCoordinatorCandidatesForTest([C1, C2]);
      expect((await bio.widerspruchEinlegen('  ')).status).toBe('unbekannt');
      expect((global as any).fetch).not.toHaveBeenCalled();
    });
  });

  it('auch das Nachziehen merkt sich, wer abgewiesen hat', async () => {
    const posts: string[] = [];
    (global as any).fetch = jest.fn(async (url: string) => {
      if (url.endsWith('/health')) return json({});
      if (url.endsWith('/challenge')) return json({ nonce: 'N-2', challenge_type: 'look_right', flash_sequence: '' });
      if (url.endsWith('/nachziehen')) return json({ decision: 'bereits_in_galerie', widerspruch_kennung: 'W-NZ' });
      if (url.endsWith('/widerspruch')) { posts.push(url); return json({ status: url.startsWith(C1) ? 'aufgenommen' : 'unbekannt' }); }
      return json({});
    });
    await jest.isolateModulesAsync(async () => {
      const bio = require('../biometricIdentity');
      bio._setCoordinatorCandidatesForTest([C2, C1]);
      (global as any).fetch.mockImplementationOnce(async () => json({}, 503)); // C2 /health krank
      await bio.requestChallenge();
      await bio.nachziehenBiometric(
        { faceUri: 'file:///f.jpg', faceBurstUris: [], challengeNonce: 'N-2', burstIntervalMs: 100 } as any,
        { deviceId: 'd1', walletAddress: '0x1', signer: { signMessage: async () => '0xsig' } as any },
      );
      expect((await bio.widerspruchEinlegen('W-NZ')).status).toBe('aufgenommen');
      expect(posts).toEqual([C1 + '/widerspruch']);
    });
  });
});
