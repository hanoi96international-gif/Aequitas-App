import { withTimeout, walletConnectSigner } from '../signer';

describe('withTimeout', () => {
  it('resolves with the underlying promise\'s value when it settles before the timeout', async () => {
    const result = await withTimeout(Promise.resolve('ok'), 1000, 'timed out');
    expect(result).toBe('ok');
  });

  it('rejects with the original error when the promise rejects before the timeout', async () => {
    await expect(
      withTimeout(Promise.reject(new Error('boom')), 1000, 'timed out')
    ).rejects.toThrow('boom');
  });

  it('rejects with the timeout message when the promise never settles in time', async () => {
    jest.useFakeTimers();
    const neverResolves = new Promise(() => {});
    const raced = withTimeout(neverResolves, 5000, 'timed out');
    const assertion = expect(raced).rejects.toThrow('timed out');
    jest.advanceTimersByTime(5000);
    await assertion;
    jest.useRealTimers();
  });

  it('does not fire the timeout after the promise already resolved (no leaked timer rejection)', async () => {
    jest.useFakeTimers();
    const raced = withTimeout(Promise.resolve('fast'), 5000, 'timed out');
    await Promise.resolve(); // let the microtask queue flush the immediate resolve
    jest.advanceTimersByTime(10000); // well past the timeout window
    await expect(raced).resolves.toBe('fast');
    jest.useRealTimers();
  });
});

describe('walletConnectSigner', () => {
  it('hex-encodes a plain-text message before calling personal_sign', async () => {
    const request = jest.fn().mockResolvedValue('0xsignature');
    const signer = walletConnectSigner('0xABC', request);
    await signer.signMessage('hello world');
    expect(request).toHaveBeenCalledWith({
      method: 'personal_sign',
      // "hello world" in UTF-8 hex
      params: ['0x68656c6c6f20776f726c64', '0xABC'],
    });
  });

  it('passes an already-hex message straight through unmodified', async () => {
    const request = jest.fn().mockResolvedValue('0xsignature');
    const signer = walletConnectSigner('0xABC', request);
    const digest = '0x' + 'ab'.repeat(32);
    await signer.signMessage(digest);
    expect(request).toHaveBeenCalledWith({
      method: 'personal_sign',
      params: [digest, '0xABC'],
    });
  });

  it('builds eth_sendTransaction with a hex-encoded value', async () => {
    const request = jest.fn().mockResolvedValue('0xtxhash');
    const signer = walletConnectSigner('0xABC', request);
    await signer.sendTransaction({ to: '0xDEF', value: 255n });
    expect(request).toHaveBeenCalledWith({
      method: 'eth_sendTransaction',
      params: [{ from: '0xABC', to: '0xDEF', value: '0xff' }],
    });
  });

  it('reports kind: "walletconnect"', () => {
    const signer = walletConnectSigner('0xABC', jest.fn());
    expect(signer.kind).toBe('walletconnect');
    expect(signer.address).toBe('0xABC');
  });
});
