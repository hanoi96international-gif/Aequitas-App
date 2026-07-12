export function fmtAEQ(v: number | string | null | undefined): string {
  if (v == null) return '—';
  const n = typeof v === 'string' ? parseFloat(v) : v;
  if (Number.isNaN(n)) return '—';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  return n.toFixed(4);
}

export function formatBalance(v: number | string | null | undefined): string {
  if (v == null) return '0';
  const n = typeof v === 'string' ? parseFloat(v) : v;
  if (Number.isNaN(n)) return '0';
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

export function shortWallet(addr: string | null | undefined): string {
  if (!addr) return '';
  return addr.slice(0, 10) + '...' + addr.slice(-6);
}

/**
 * String -> wei BigInt without floating point, matching aequitas-dapp.html's
 * parseAEQToWei exactly (server-side signature checks depend on identical
 * amount formatting, e.g. amt.toFixed(8) in the swap message).
 */
export function parseAEQToWei(str: string): bigint | null {
  const s = str.trim();
  if (!/^\d+(\.\d*)?$/.test(s)) return null;
  const parts = s.split('.');
  const intPart = parts[0];
  const fracPart = (parts[1] || '').padEnd(18, '0').slice(0, 18);
  return BigInt(intPart) * 10n ** 18n + BigInt(fracPart || '0');
}

export function formatWeiToAEQ(wei: bigint, maxDecimals = 6): string {
  const whole = wei / 10n ** 18n;
  const frac = wei % 10n ** 18n;
  const fracStr = frac.toString().padStart(18, '0').slice(0, maxDecimals).replace(/0+$/, '');
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

export function isValidAddress(addr: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(addr);
}
