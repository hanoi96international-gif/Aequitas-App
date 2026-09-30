import { VaultError } from '@/src/crypto/vault';
import type { I18nKey, I18nParams } from '@/src/i18n';

type T = (key: I18nKey, params?: I18nParams) => string;

/** Fehler aus dem Tresor -> Text fuer den Menschen. Unbekanntes wird nie roh angezeigt. */
export function vaultErrorText(t: T, e: unknown): string {
  if (!(e instanceof VaultError)) return t('vault.unknown');
  if (e.reason === 'pinLocked') return t('vault.pinLocked', { count: Math.max(1, Math.ceil((e.waitMs ?? 0) / 1000)) });
  return t(`vault.${e.reason}`);
}
