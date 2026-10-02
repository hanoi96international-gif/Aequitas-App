import { erzeugerAnzeige, LEER, validatorNamenLesen } from '../validatorNamen';

const C1_SIGNIER = '0x3066639af1653325100c1074a9696612dbdc42dc';
const C1_WALLET = '0x0be8b961cbf6564bd1931b0803d35c0659e0d016';

describe('erzeugerAnzeige', () => {
  it('zeigt die Betreiber-Wallet statt der Signieradresse, wie die Website', () => {
    const namen = validatorNamenLesen({
      labels: { [C1_SIGNIER]: 'Validator #1' },
      operators: { [C1_SIGNIER]: C1_WALLET },
    });
    expect(erzeugerAnzeige(C1_SIGNIER, namen)).toBe('Validator #1 · 0x0be8…d016');
  });

  it('gross geschriebene Adressen im Block werden gefunden', () => {
    const namen = validatorNamenLesen({ operators: { [C1_SIGNIER]: C1_WALLET } });
    expect(erzeugerAnzeige(C1_SIGNIER.toUpperCase().replace('0X', '0x'), namen)).toBe('0x0be8…d016');
  });

  it('ohne bekannte Wallet bleibt es die Signieradresse', () => {
    expect(erzeugerAnzeige(C1_SIGNIER, LEER)).toBe('0x3066…42dc');
    const nurLabel = validatorNamenLesen({ labels: { [C1_SIGNIER]: 'Primary' } });
    expect(erzeugerAnzeige(C1_SIGNIER, nurLabel)).toBe('Primary · 0x3066…42dc');
  });
});

describe('validatorNamenLesen verwirft, was das Netz nicht liefern sollte', () => {
  it('kaputte Antworten ergeben eine leere Zuordnung', () => {
    for (const roh of [null, undefined, 'x', 42, [], { labels: 'x', operators: 7 }]) {
      expect(validatorNamenLesen(roh)).toEqual(LEER);
    }
  });

  it('nur Adressen der Form 0x + 40 Hex, als Schluessel und als Wallet', () => {
    const namen = validatorNamenLesen({
      operators: {
        [C1_SIGNIER]: 'javascript:alert(1)',
        '0x123': C1_WALLET,
        ['0x' + 'g'.repeat(40)]: C1_WALLET,
        ['0x' + 'a'.repeat(40)]: 42,
      },
    });
    expect(namen.operators).toEqual({});
    expect(erzeugerAnzeige(C1_SIGNIER, namen)).toBe('0x3066…42dc');
  });

  it('Bezeichnungen nur kurz und ohne Steuerzeichen', () => {
    const namen = validatorNamenLesen({
      labels: {
        ['0x' + '1'.repeat(40)]: 'Validator #2',
        ['0x' + '2'.repeat(40)]: 'x'.repeat(33),
        ['0x' + '3'.repeat(40)]: 'Zeile\nZwei',
        ['0x' + '4'.repeat(40)]: '',
        ['0x' + '5'.repeat(40)]: 'Prüfer',
      },
    });
    expect(namen.labels).toEqual({ ['0x' + '1'.repeat(40)]: 'Validator #2' });
  });

  it('hoechstens 256 Eintraege, auch bei einer riesigen Antwort', () => {
    const operators: Record<string, string> = {};
    for (let i = 0; i < 5000; i++) operators['0x' + i.toString(16).padStart(40, '0')] = C1_WALLET;
    expect(Object.keys(validatorNamenLesen({ operators }).operators)).toHaveLength(256);
  });
});
