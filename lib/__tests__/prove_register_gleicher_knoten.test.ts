/**
 * PROVE UND REGISTER MUESSEN DENSELBEN KNOTEN TREFFEN.
 *
 * Die Kette merkt sich NUR IM ARBEITSSPEICHER, welche Nullifier aus einem
 * /api/prove dieses Knotens stammen (prove_provenance.go), und /api/register
 * nimmt keinen anderen an. Wer auf Knoten 1 beweist und auf Knoten 2
 * registriert, bekommt:
 *
 *   "this proof did not come from a verified registration on this node"
 *
 * und muss die Gesichtsaufnahme wiederholen.
 *
 * Der Ausweichknoten (v1.7.2) wechselt bei einem NETZFEHLER. Das ist richtig,
 * solange nichts an den Knoten gebunden ist -- aber zwischen Beweis und
 * Registrierung ist genau das der Fall. Zwei Wege in den Fehler:
 *
 *   1. Der Beweis liegt auf Knoten 1. Irgendein ANDERER Aufruf -- ein
 *      Kontostand, der im Hintergrund nachlaedt -- faellt ins Netz, wechselt
 *      auf Knoten 2, und die Registrierung geht dorthin.
 *   2. Die Registrierung selbst erwischt einen Netz-Blip und wird auf
 *      Knoten 2 wiederholt. Hier ERZEUGT der Ausweichknoten den Fehler: ohne
 *      ihn waere eine Wiederholung auf Knoten 1 durchgegangen.
 *
 * Fall 2 ist der schlimmere, weil der Ausweichknoten dort das Gegenteil
 * dessen tut, wofuer er gebaut wurde.
 */
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn() }), { virtual: true });

const A = 'https://a.example/api';
const B = 'https://b.example/api';

describe('prove und register treffen denselben Knoten', () => {
  afterEach(() => { jest.resetModules(); (global as any).fetch = undefined; });

  it('ein Netzfehler in einem anderen Aufruf zieht die Registrierung nicht mit', async () => {
    const calls: string[] = [];
    let balanceSollFallen = false;
    (global as any).fetch = jest.fn(async (url: string) => {
      calls.push(url);
      if (url.includes('/balance') && balanceSollFallen && url.startsWith(A)) {
        throw new TypeError('Network request failed');
      }
      return { ok: true, status: 200, json: async () => ({ success: true, zkNullifier: '0xabc', url }) } as any;
    });

    await jest.isolateModulesAsync(async () => {
      const api = require('../api');
      api._setApiCandidatesForTest([A, B]);

      // Beweis auf Knoten A.
      await api.requestProof({ bio: 'b', salt: 's', wallet: '0x1' });
      expect(calls.at(-1)).toBe(A + '/prove');

      // Ein Kontostand faellt ins Netz -> der Ausweichknoten schaltet auf B.
      balanceSollFallen = true;
      await api.getBalance('0x1');
      expect(calls.at(-1)).toBe(B + '/balance?wallet=0x1');

      // Die Registrierung MUSS trotzdem auf A gehen -- dort liegt der Beweis.
      await api.postRegister({ wallet: '0x1', zkNullifier: '0xabc' } as any);
      expect(calls.at(-1)).toBe(A + '/register');
    });
  });

  it('ein Netz-Blip auf der Registrierung wiederholt auf DEMSELBEN Knoten', async () => {
    const calls: string[] = [];
    let ersterRegisterVersuch = true;
    (global as any).fetch = jest.fn(async (url: string) => {
      calls.push(url);
      if (url.endsWith('/register') && ersterRegisterVersuch) {
        ersterRegisterVersuch = false;
        throw new TypeError('Network request failed');
      }
      return { ok: true, status: 200, json: async () => ({ success: true, zkNullifier: '0xabc', url }) } as any;
    });

    // Die Zusicherungen gehoeren IN den Callback: jest.isolateModules wartet
    // nicht auf eine async-Funktion, ein Vergleich dahinter laeuft vor den
    // Aufrufen und sieht eine leere Liste.
    await jest.isolateModulesAsync(async () => {
      const api = require('../api');
      api._setApiCandidatesForTest([A, B]);
      await api.requestProof({ bio: 'b', salt: 's', wallet: '0x1' });
      await api.postRegister({ wallet: '0x1', zkNullifier: '0xabc' } as any);

      const registerAufrufe = calls.filter((u) => u.endsWith('/register'));
      expect(registerAufrufe.length).toBe(2); // einmal gescheitert, einmal wiederholt
      expect(registerAufrufe.every((u) => u.startsWith(A))).toBe(true);
    });
  });
});
