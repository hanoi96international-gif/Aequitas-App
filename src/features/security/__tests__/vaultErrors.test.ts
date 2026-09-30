import { VaultError } from '@/src/crypto/vault';
import { translate } from '@/src/i18n';
import { vaultErrorText } from '../vaultErrors';

const t = (k: string, p?: Record<string, string | number>) => translate('de', k, p);

describe('Tresorfehler als Text', () => {
  it('jeder Grund hat einen Text, keiner faellt auf den rohen Schluessel zurueck', () => {
    for (const r of ['noVault', 'cancelled', 'pinRequired', 'pinWrong', 'pinLocked', 'pinWeak', 'invalidSecret', 'mismatch', 'exists'] as const) {
      expect(vaultErrorText(t, new VaultError(r, 30_000))).not.toMatch(/⟦/);
    }
  });
  it('Wartezeit in Sekunden, aufgerundet, mit Plural', () => {
    expect(vaultErrorText(t, new VaultError('pinLocked', 29_001))).toBe('Zu viele Versuche. Nächster Versuch in 30 Sekunden.');
    expect(vaultErrorText(t, new VaultError('pinLocked', 1))).toBe('Zu viele Versuche. Nächster Versuch in 1 Sekunde.');
  });
  it('fremde Fehler werden nie roh angezeigt', () => {
    expect(vaultErrorText(t, new Error('0xgeheim'))).toBe('Das hat nicht geklappt. Bitte versuche es erneut.');
  });
});
