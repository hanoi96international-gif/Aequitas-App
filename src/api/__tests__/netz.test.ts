import { gueltigeKennung, pruefeNetz, signierenErlaubt } from '../netz';

const K1 = 'aequitas-1926-1790000000';
const K2 = 'aequitas-1926-1800000000';

describe('Netzabgleich', () => {
  it('erstes Mal: Kennung wird uebernommen', () => {
    expect(pruefeNetz({ chain_evm_id: 1926, netz_kennung: K1 }, null)).toEqual({ art: 'erstmals', kennung: K1 });
  });
  it('gleiches Netz: ok', () => {
    expect(pruefeNetz({ chain_evm_id: 1926, netz_kennung: K1 }, K1)).toEqual({ art: 'ok', kennung: K1 });
  });
  it('Neustart bei null wird erkannt', () => {
    expect(pruefeNetz({ chain_evm_id: 1926, netz_kennung: K2 }, K1)).toEqual({ art: 'gewechselt', bisher: K1, neu: K2 });
  });
  it('aeltere Knoten ohne Kennung: ok, aber keine Behauptung ueber einen Wechsel', () => {
    expect(pruefeNetz({ chain_evm_id: 1926 }, K1)).toEqual({ art: 'ok', kennung: null });
  });
  it('beschaedigter Speicherwert zaehlt wie "noch nichts gespeichert"', () => {
    expect(pruefeNetz({ chain_evm_id: 1926, netz_kennung: K1 }, 'kaputt')).toEqual({ art: 'erstmals', kennung: K1 });
  });
});

describe('Missbrauch: Antwort eines fremden oder kaputten Knotens', () => {
  it('fremde Chain-ID -> nichts signieren', () => {
    for (const id of [1, '1926', 0x786 + 1, null, undefined]) {
      const b = pruefeNetz({ chain_evm_id: id, netz_kennung: K1 }, K1);
      expect(b).toEqual({ art: 'fremdeKette' });
      expect(signierenErlaubt(b)).toBe(false);
    }
  });
  it('Kennung im falschen Format oder fuer eine andere Kette -> ungueltig, nichts signieren', () => {
    for (const k of ['aequitas-1-1790000000', 'aequitas-1926-', 'aequitas-1926-12x', 42, {}, 'a'.repeat(5000), `${K1}\n`]) {
      const b = pruefeNetz({ chain_evm_id: 1926, netz_kennung: k }, K1);
      expect(b).toEqual({ art: 'ungueltig' });
      expect(signierenErlaubt(b)).toBe(false);
    }
  });
  it('keine oder verformte Antwort -> ungueltig', () => {
    for (const s of [null, undefined, 'status', 1926, [], [{ chain_evm_id: 1926 }]]) expect(pruefeNetz(s, K1)).toEqual({ art: 'ungueltig' });
  });
  it('nach einem Wechsel wird erst nach Bestaetigung wieder signiert', () => {
    expect(signierenErlaubt(pruefeNetz({ chain_evm_id: 1926, netz_kennung: K2 }, K1))).toBe(false);
    expect(signierenErlaubt(null)).toBe(false);
    expect(signierenErlaubt(pruefeNetz({ chain_evm_id: 1926, netz_kennung: K2 }, K2))).toBe(true);
  });
  it('Kennungsformat', () => {
    expect(gueltigeKennung(K1)).toBe(true);
    expect(gueltigeKennung(`aequitas-1926-${'9'.repeat(13)}`)).toBe(false);
  });
});
