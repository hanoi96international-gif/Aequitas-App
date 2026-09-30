import { completeWord, currentWord, secretFromInput } from '../mnemonic';

describe('Eingabe beim Wiederherstellen', () => {
  it('erkennt privaten Schluessel nur bei genau 64 Hex-Zeichen', () => {
    expect(secretFromInput(`  0x${'ab'.repeat(32)} `)).toEqual({ privateKey: `0x${'ab'.repeat(32)}` });
    expect(secretFromInput('ab'.repeat(32))).toEqual({ privateKey: 'ab'.repeat(32) });
    expect(secretFromInput('ab'.repeat(31))).toEqual({ phrase: 'ab'.repeat(31) });
    expect(secretFromInput('test test junk')).toEqual({ phrase: 'test test junk' });
  });
  it('angefangenes Wort und Vervollstaendigung', () => {
    expect(currentWord('abandon abi')).toBe('abi');
    expect(currentWord('abandon ')).toBe('');
    expect(currentWord('')).toBe('');
    expect(completeWord('abandon abi', 'ability')).toBe('abandon ability ');
    expect(completeWord('ab', 'about')).toBe('about ');
  });
});
