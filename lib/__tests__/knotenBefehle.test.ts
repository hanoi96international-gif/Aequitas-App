// Die Befehle des Tabs "Knoten" landen in einer Root-Shell: die Wallet nur,
// wenn sie genau eine Adresse ist -- nie etwas anderes.
import { knotenBefehl, validatorBefehl, VERIFIER_BEFEHL } from '../knotenBefehle';

const W = '0x000000000000000000000000000000000000dEaD';

describe('Einrichtungsbefehle', () => {
  test('Knoten und Validator mit der Wallet (klein geschrieben) am Ende', () => {
    expect(knotenBefehl(W).split('\n')[2]).toBe(`cd Aequitas/deploy/knoten && bash einrichten.sh ${W.toLowerCase()}`);
    expect(validatorBefehl(W).split('\n')[2]).toBe(`cd Aequitas/deploy/validator && bash einrichten.sh ${W.toLowerCase()}`);
    expect(VERIFIER_BEFEHL.split('\n')[2]).toBe('cd Aequitas/deploy/verifier && bash einrichten.sh');
    for (const b of [knotenBefehl(W), validatorBefehl(W), VERIFIER_BEFEHL]) expect(b.split('\n')).toHaveLength(3);
  });

  test.each([
    ['ohne Wallet', undefined],
    ['null', null],
    ['zu kurz', '0x1234'],
    ['Befehl angehängt', W + '; rm -rf /'],
    ['Zeilenumbruch', W + '\nrm -rf /'],
    ['Befehlsersetzung', '0x$(curl evil)00000000000000000000000000000'],
    ['Leerzeichen davor', ' ' + W],
    ['ohne 0x', W.slice(2) + '00'],
  ])('%s: keine Wallet im Befehl, das Skript fragt selbst', (_n, w) => {
    for (const b of [knotenBefehl(w as any), validatorBefehl(w as any)]) {
      expect(b.split('\n')).toHaveLength(3);
      expect(b.endsWith('bash einrichten.sh')).toBe(true);
      expect(b).not.toContain('rm -rf');
      expect(b).not.toContain('$(');
    }
  });
});
