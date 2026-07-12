import { fmtAEQ, formatBalance, shortWallet, parseAEQToWei, formatWeiToAEQ, isValidAddress } from '../format';

describe('fmtAEQ', () => {
  it('returns an em-dash for null/undefined', () => {
    expect(fmtAEQ(null)).toBe('—');
    expect(fmtAEQ(undefined)).toBe('—');
  });

  it('returns an em-dash for a non-numeric string', () => {
    expect(fmtAEQ('not-a-number')).toBe('—');
  });

  it('formats sub-thousand values with 4 decimals', () => {
    expect(fmtAEQ(123.456789)).toBe('123.4568');
  });

  it('formats thousands with a K suffix', () => {
    expect(fmtAEQ(2500)).toBe('2.50K');
  });

  it('formats millions with an M suffix', () => {
    expect(fmtAEQ(3_400_000)).toBe('3.40M');
  });

  it('accepts numeric strings the same as numbers', () => {
    expect(fmtAEQ('2500')).toBe(fmtAEQ(2500));
  });

  it('treats the 1000/1e6 boundaries correctly (not off-by-one)', () => {
    expect(fmtAEQ(999)).toBe('999.0000');
    expect(fmtAEQ(1000)).toBe('1.00K');
    expect(fmtAEQ(999_999)).toBe('1000.00K');
    expect(fmtAEQ(1_000_000)).toBe('1.00M');
  });
});

describe('formatBalance', () => {
  it('returns "0" for null/undefined', () => {
    expect(formatBalance(null)).toBe('0');
    expect(formatBalance(undefined)).toBe('0');
  });

  it('returns "0" for a non-numeric string', () => {
    expect(formatBalance('abc')).toBe('0');
  });

  it('adds thousands separators', () => {
    expect(formatBalance(1234567)).toBe('1,234,567');
  });

  it('caps at 2 fraction digits', () => {
    expect(formatBalance(1234.5678)).toBe('1,234.57');
  });
});

describe('shortWallet', () => {
  it('returns empty string for null/undefined/empty', () => {
    expect(shortWallet(null)).toBe('');
    expect(shortWallet(undefined)).toBe('');
    expect(shortWallet('')).toBe('');
  });

  it('shows the first 10 and last 6 characters with an ellipsis', () => {
    const addr = '0x1234567890abcdef1234567890abcdef12345678';
    expect(shortWallet(addr)).toBe('0x12345678...345678');
  });
});

describe('parseAEQToWei', () => {
  it('rejects non-numeric input', () => {
    expect(parseAEQToWei('abc')).toBeNull();
    expect(parseAEQToWei('')).toBeNull();
    expect(parseAEQToWei('-1')).toBeNull();
    expect(parseAEQToWei('1.2.3')).toBeNull();
  });

  it('converts a whole number to wei (18 decimals)', () => {
    expect(parseAEQToWei('5')).toBe(5n * 10n ** 18n);
  });

  it('converts a fractional amount without floating-point error', () => {
    // 0.1 AEQ is exactly representable as an integer in wei, but NOT as a
    // float — this is the whole point of the function existing at all.
    expect(parseAEQToWei('0.1')).toBe(100000000000000000n);
  });

  it('pads short fractional parts and truncates long ones to 18 digits', () => {
    expect(parseAEQToWei('1.5')).toBe(1_500_000_000_000_000_000n);
    // 19th+ digits must be dropped, not rounded, to match the server's
    // parseAEQToWei exactly (see the function's own doc comment).
    expect(parseAEQToWei('1.1234567890123456789')).toBe(
      1_123_456_789_012_345_678n
    );
  });

  it('accepts a trailing decimal point with no digits after it', () => {
    expect(parseAEQToWei('5.')).toBe(5n * 10n ** 18n);
  });
});

describe('formatWeiToAEQ', () => {
  it('formats a whole-number wei amount with no decimal point', () => {
    expect(formatWeiToAEQ(5n * 10n ** 18n)).toBe('5');
  });

  it('strips trailing zeros from the fractional part', () => {
    expect(formatWeiToAEQ(1_500_000_000_000_000_000n)).toBe('1.5');
  });

  it('round-trips with parseAEQToWei for a representative value', () => {
    const wei = parseAEQToWei('123.456')!;
    expect(formatWeiToAEQ(wei, 6)).toBe('123.456');
  });

  it('truncates the fractional display to maxDecimals', () => {
    const wei = parseAEQToWei('1.123456789')!;
    expect(formatWeiToAEQ(wei, 4)).toBe('1.1234');
  });

  it('formats zero wei as "0", not an empty string or "0."', () => {
    expect(formatWeiToAEQ(0n)).toBe('0');
  });
});

describe('isValidAddress', () => {
  it('accepts a well-formed 0x + 40 hex char address', () => {
    const addr = '0x1234567890abcdef1234567890ABCDEF12345678';
    expect(addr.length).toBe(42); // sanity-check the fixture itself: 0x + 40 hex chars
    expect(isValidAddress(addr)).toBe(true);
  });

  it('rejects a missing 0x prefix', () => {
    expect(isValidAddress('1234567890abcdef1234567890abcdef12345678')).toBe(false);
  });

  it('rejects the wrong length', () => {
    expect(isValidAddress('0x1234')).toBe(false);
    expect(isValidAddress('0x' + '1'.repeat(41))).toBe(false);
  });

  it('rejects non-hex characters', () => {
    expect(isValidAddress('0x' + 'g'.repeat(40))).toBe(false);
  });
});
