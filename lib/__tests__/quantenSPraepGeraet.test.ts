// Die Präparatorin im Gerät (lib/quantenSPraepGeraet.ts): SecureStore nur dieses
// Gerät und ohne eigene Biometrie-Abfrage, Knotenliste, IBM-Zugang, keine Runde
// ohne Zugang.
const mockSecure = new Map<string, { w: string; opt: any }>();
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'nur-dieses-geraet',
  getItemAsync: async (k: string) => mockSecure.get(k)?.w ?? null,
  setItemAsync: async (k: string, w: string, opt: any) => void mockSecure.set(k, { w, opt }),
  deleteItemAsync: async (k: string) => void mockSecure.delete(k),
}));
jest.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => new Uint8Array(n).fill(7) }));
jest.mock('expo-file-system', () => ({ Directory: class {}, File: class {}, Paths: {} }));
jest.mock('../config', () => ({ API_BASE: 'https://knoten.test/api', API_FALLBACKS: ['https://zwei.test/api/', 'https://knoten.test/api'] }));

import { geheimSpeicher, ibmZugangDa, ibmZugangLoeschen, ibmZugangSetzen, praepKnoten, praepRundeJetzt, praepUmgebung } from '../quantenSPraepGeraet';

const ZUGANG = { apiKey: 'a'.repeat(44), crn: 'crn:v1:bluemix:public:quantum-computing:us-east:a/' + 'b'.repeat(32) + ':' + 'c'.repeat(8) + '-' + 'd'.repeat(4) + '-' + 'e'.repeat(4) + '-' + 'f'.repeat(4) + '-' + '0'.repeat(12) + '::' };

describe('Präparatorin im Gerät', () => {
  beforeEach(() => mockSecure.clear());

  test('Knoten: eigener zuerst, ohne Doppelte und Schrägstriche, höchstens 8', () => {
    expect(praepKnoten()).toEqual(['https://knoten.test/api', 'https://zwei.test/api']);
    expect(praepKnoten('https://a/api', Array.from({ length: 12 }, (_, i) => `https://n${i}/api`))).toHaveLength(8);
    expect(praepKnoten('', [])).toEqual([]);
  });

  test('geheimer Speicher: nur dieses Gerät, nur entsperrt, ohne eigene Biometrie-Abfrage', async () => {
    await geheimSpeicher().schreiben('k', 'w', true);
    expect(mockSecure.get('k')!.opt).toEqual({ keychainAccessible: 'nur-dieses-geraet' });
    expect(await geheimSpeicher().lesen('k')).toBe('w');
  });

  test('IBM-Zugang: setzen, da, löschen; falsche Form abgewiesen', async () => {
    const u = praepUmgebung();
    expect(await ibmZugangDa(u)).toBe(false);
    await expect(ibmZugangSetzen({ apiKey: 'kurz', crn: ZUGANG.crn }, u)).rejects.toThrow('API-Schlüssel');
    expect(await ibmZugangDa(u)).toBe(false);
    await ibmZugangSetzen(ZUGANG, u);
    expect(await ibmZugangDa(u)).toBe(true);
    expect(mockSecure.get('aequitas.quantenS.praep.ibmZugang')!.opt).toEqual({ keychainAccessible: 'nur-dieses-geraet' });
    await ibmZugangLoeschen(u);
    expect(await ibmZugangDa(u)).toBe(false);
  });

  test('ohne IBM-Zugang keine Runde (nichts abgeholt)', async () => {
    let netz = 0;
    const u = { ...praepUmgebung(), fetchFn: (async () => (netz++, new Response('{}'))) as unknown as typeof fetch };
    await expect(praepRundeJetzt({ entsperren: async () => ({ privateKey: '0x' + '11'.repeat(32) }) }, u)).rejects.toThrow('kein IBM-Zugang');
    expect(netz).toBe(0);
  });
});
