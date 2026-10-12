/**
 * DIE AUFNAHME GEHT DORTHIN, WO IHR CHALLENGE-NONCE HERKOMMT.
 *
 * Der Nonce liegt nur im Arbeitsspeicher des Coordinators, der ihn
 * ausgestellt hat (coordinator/app/main.py, _pending_challenges, 5 Minuten).
 * Wer bei Coordinator 2 den Nonce holt und bei Coordinator 1 abgibt, bekommt
 * nonce_ungueltig -- nach der vollstaendigen Gesichtsaufnahme.
 *
 * Die Klebrigkeit allein reicht knapp nicht: ihre Uhr startet beim AUSSUCHEN
 * des Coordinators, die des Nonce erst bei der AUSSTELLUNG einen Netzumlauf
 * spaeter. Die App vergisst ihre Bindung also immer zuerst. Dieser Test baut
 * genau die Lage nach, in der das etwas aendert: beim Ausstellen war
 * Coordinator 1 krank (der Nonce liegt bei 2), bei der Abgabe ist er wieder
 * gesund -- die normale Auswahl wuerde zu 1 zurueckkehren.
 */
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn() }));
const mockDeleteAsync = jest.fn(async () => undefined);
jest.mock('expo-file-system', () => ({ deleteAsync: (...a: any[]) => (mockDeleteAsync as any)(...a) }));
jest.mock('expo-file-system/legacy', () => ({ deleteAsync: (...a: any[]) => (mockDeleteAsync as any)(...a) }));

const C1 = 'https://c1.example';
const C2 = 'https://c2.example';

describe('Challenge und Abgabe treffen denselben Coordinator', () => {
  afterEach(() => { jest.resetModules(); (global as any).fetch = undefined; });

  it('die Aufnahme geht an den Coordinator, der den Nonce ausstellte', async () => {
    const calls: string[] = [];
    let c1Gesund = false; // beim Ausstellen krank, danach gesund

    (global as any).fetch = jest.fn(async (url: string, init?: any) => {
      calls.push(url);
      if (url.endsWith('/health')) {
        const ok = url.startsWith(C1) ? c1Gesund : true;
        return { ok, status: ok ? 200 : 503, json: async () => ({}) } as any;
      }
      if (url.endsWith('/challenge')) {
        return { ok: true, status: 200, json: async () => ({ nonce: 'N-42', challenge_type: 'kopf_drehen', flash_sequence: '' }) } as any;
      }
      return { ok: true, status: 200, json: async () => ({ status: 'ok', url }) } as any;
    });

    await jest.isolateModulesAsync(async () => {
      const bio = require('../biometricIdentity');
      bio._setCoordinatorCandidatesForTest([C1, C2]);

      const ch = await bio.requestChallenge();
      expect(ch?.nonce).toBe('N-42');
      expect(calls.filter((u) => u.endsWith('/challenge'))).toEqual([C2 + '/challenge']);
      expect(bio._challengeKnotenFuerTest()).toEqual({ base: C2, nonce: 'N-42' });

      // Coordinator 1 ist wieder da, und die Klebrigkeit sei abgelaufen.
      c1Gesund = true;
      bio._verwirfCoordinatorKlebrigkeitFuerTest();

      await bio.registerBiometric(
        { faceUri: 'file:///f.jpg', faceBurstUris: [], challengeNonce: 'N-42', burstIntervalMs: 100 } as any,
        { deviceId: 'd1', walletAddress: '0x1' },
      );

      const abgaben = calls.filter((u) => u.endsWith('/register'));
      expect(abgaben).toEqual([C2 + '/register']);
    });
  });

  it('ohne Nonce gilt die normale Auswahl', async () => {
    const calls: string[] = [];
    (global as any).fetch = jest.fn(async (url: string) => {
      calls.push(url);
      if (url.endsWith('/health')) return { ok: true, status: 200, json: async () => ({}) } as any;
      return { ok: true, status: 200, json: async () => ({ status: 'ok', url }) } as any;
    });
    await jest.isolateModulesAsync(async () => {
      const bio = require('../biometricIdentity');
      bio._setCoordinatorCandidatesForTest([C1, C2]);
      await bio.registerBiometric(
        { faceUri: 'file:///f.jpg', faceBurstUris: [], burstIntervalMs: 100 } as any,
        { deviceId: 'd1', walletAddress: '0x1' },
      );
      expect(calls.filter((u) => u.endsWith('/register'))).toEqual([C1 + '/register']);
    });
  });
  // Pruefung #29, L-4: frueher fiel die App bei einem fremden Nonce auf die
  // normale Auswahl zurueck -- die Gesichtsbilder gingen an einen Coordinator,
  // der den Nonce nie gesehen hat. Jetzt: abbrechen, kein Bild verlaesst das
  // Geraet, und die Aufnahme wird trotzdem geloescht.
  describe.each([
    ['registerBiometric', '/register'],
    ['nachziehenBiometric', '/nachziehen'],
    ['erneuernBiometric', '/erneuern'],
  ])('%s mit unbekanntem Nonce', (fn, pfad) => {
    it('bricht ab, statt die Bilder umzuleiten', async () => {
      const calls: string[] = [];
      mockDeleteAsync.mockClear();
      (global as any).fetch = jest.fn(async (url: string) => {
        calls.push(url);
        return { ok: true, status: 200, json: async () => ({ status: 'ok', decision: 'x' }) } as any;
      });
      await jest.isolateModulesAsync(async () => {
        const bio = require('../biometricIdentity');
        bio._setCoordinatorCandidatesForTest([C1, C2]);
        // Kein requestChallenge: der Nonce stammt nicht aus dieser Sitzung.
        const signer = { signMessage: jest.fn(async () => '0xsig') };
        await expect(
          (bio as any)[fn](
            { faceUri: 'file:///f.jpg', faceBurstUris: [], challengeNonce: 'FREMD', burstIntervalMs: 100 } as any,
            { deviceId: 'd1', walletAddress: '0x1', signer },
          ),
        ).rejects.toBeInstanceOf(bio.NachziehenNeedsChallenge);
        expect(calls.filter((u) => u.endsWith(pfad))).toEqual([]);
        expect(signer.signMessage).not.toHaveBeenCalled();
        expect(mockDeleteAsync).toHaveBeenCalled();
      });
    });
  });
});
