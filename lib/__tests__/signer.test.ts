import { AEQUITAS_CAIP, NETZ_NICHT_FREIGEGEBEN, sitzungsKetten, withTimeout, walletConnectSigner } from '../signer';

const MIT_AEQUITAS = () => ['eip155:1', AEQUITAS_CAIP];
const NUR_ETHEREUM = () => ['eip155:1'];
const V8_DOMAIN = { name: 'Aequitas', version: '8', chainId: 1926, verifyingContract: '0x20D271028f32577FCd07b4583A8e0E4eBBdB4F78', salt: '0x' + '11'.repeat(32) };

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
    const signer = walletConnectSigner('0xABC', request, MIT_AEQUITAS);
    await signer.signMessage('hello world');
    expect(request).toHaveBeenCalledWith({
      method: 'personal_sign',
      // "hello world" in UTF-8 hex
      params: ['0x68656c6c6f20776f726c64', '0xABC'],
    });
  });

  it('passes an already-hex message straight through unmodified', async () => {
    const request = jest.fn().mockResolvedValue('0xsignature');
    const signer = walletConnectSigner('0xABC', request, MIT_AEQUITAS);
    const digest = '0x' + 'ab'.repeat(32);
    await signer.signMessage(digest);
    expect(request).toHaveBeenCalledWith({
      method: 'personal_sign',
      params: [digest, '0xABC'],
    });
  });

  it('builds eth_sendTransaction with a hex-encoded value, the Aequitas chainId, routed via the Aequitas chain', async () => {
    const request = jest.fn().mockResolvedValue('0xtxhash');
    const signer = walletConnectSigner('0xABC', request, MIT_AEQUITAS);
    await signer.sendTransaction({ to: '0xDEF', value: 255n });
    expect(request).toHaveBeenCalledWith(
      {
        method: 'eth_sendTransaction',
        params: [{ from: '0xABC', to: '0xDEF', value: '0xff', chainId: '0x786' }],
      },
      'eip155:1926',
    );
  });

  it('sends eth_signTypedData_v4 with EIP712Domain and bigints as decimal text', async () => {
    const request = jest.fn().mockResolvedValue('0xsignature');
    const signer = walletConnectSigner('0xABC', request, MIT_AEQUITAS);
    await signer.signTypedData(V8_DOMAIN, { Register: [{ name: 'nonce', type: 'uint256' }] }, { nonce: 0n });
    const [{ method, params }, kette] = request.mock.calls[0];
    expect(kette).toBe('eip155:1926');
    expect(method).toBe('eth_signTypedData_v4');
    expect(params[0]).toBe('0xABC');
    const payload = JSON.parse(params[1]);
    expect(payload.primaryType).toBe('Register');
    expect(payload.types.EIP712Domain.map((f: any) => f.name)).toEqual(['name', 'version', 'chainId', 'verifyingContract', 'salt']);
    expect(payload.message).toEqual({ nonce: '0' });
  });

  it('reports kind: "walletconnect"', () => {
    const signer = walletConnectSigner('0xABC', jest.fn(), MIT_AEQUITAS);
    expect(signer.kind).toBe('walletconnect');
    expect(signer.address).toBe('0xABC');
  });

  // Befund vom Geraet (30.09.2026, MetaMask Mobile): alle Anfragen liefen
  // ueber den Routing-Anker eip155:1; MetaMask nahm Ethereum als aktives Netz
  // und lehnte die V8-Unterschrift ab: "active chainId is different than the
  // one provided".
  it('routes the V8 signature via the Aequitas chain, never via the eip155:1 anchor', async () => {
    const request = jest.fn().mockResolvedValue('0xsignature');
    const signer = walletConnectSigner('0xABC', request, MIT_AEQUITAS);
    await signer.signTypedData(V8_DOMAIN, { Register: [{ name: 'nonce', type: 'uint256' }] }, { nonce: 0n });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][1]).not.toBe('eip155:1');
  });

  it('sends nothing when the wallet has not approved the Aequitas chain for this session (fail-closed)', async () => {
    const request = jest.fn().mockResolvedValue('0xsignature');
    const signer = walletConnectSigner('0xABC', request, NUR_ETHEREUM);
    await expect(
      signer.signTypedData(V8_DOMAIN, { Register: [{ name: 'nonce', type: 'uint256' }] }, { nonce: 0n })
    ).rejects.toThrow(NETZ_NICHT_FREIGEGEBEN);
    await expect(signer.sendTransaction({ to: '0xDEF', value: 1n })).rejects.toThrow(NETZ_NICHT_FREIGEGEBEN);
    expect(request).not.toHaveBeenCalled();
  });

  it('refuses a typed-data domain for another chain or without chainId, without contacting the wallet', async () => {
    const request = jest.fn().mockResolvedValue('0xsignature');
    const signer = walletConnectSigner('0xABC', request, MIT_AEQUITAS);
    const types = { Register: [{ name: 'nonce', type: 'uint256' }] };
    await expect(signer.signTypedData({ ...V8_DOMAIN, chainId: 1 }, types, { nonce: 0n })).rejects.toThrow('chainId 1926');
    const { chainId: _weg, ...ohneKette } = V8_DOMAIN;
    await expect(signer.signTypedData(ohneKette, types, { nonce: 0n })).rejects.toThrow('chainId 1926');
    await expect(signer.signTypedData({ ...V8_DOMAIN, chainId: 'kaputt' as any }, types, { nonce: 0n })).rejects.toThrow('chainId 1926');
    expect(request).not.toHaveBeenCalled();
  });

  it('reads the approved chains live, so a session_update after adding the chain takes effect', async () => {
    const request = jest.fn().mockResolvedValue('0xsignature');
    let ketten = ['eip155:1'];
    const signer = walletConnectSigner('0xABC', request, () => ketten);
    const types = { Register: [{ name: 'nonce', type: 'uint256' }] };
    await expect(signer.signTypedData(V8_DOMAIN, types, { nonce: 0n })).rejects.toThrow(NETZ_NICHT_FREIGEGEBEN);
    ketten = ['eip155:1', 'eip155:1926'];
    await signer.signTypedData(V8_DOMAIN, types, { nonce: 0n });
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('sitzungsKetten', () => {
  const addr = '0x' + 'ab'.repeat(20);

  it('collects chains from both `chains` and the CAIP-10 accounts', () => {
    const provider = { session: { namespaces: { eip155: { chains: ['eip155:1'], accounts: [`eip155:1:${addr}`, `eip155:1926:${addr}`] } } } };
    expect(sitzungsKetten(provider).sort()).toEqual(['eip155:1', 'eip155:1926']);
  });

  it('returns an empty list for a missing or malformed session instead of throwing', () => {
    expect(sitzungsKetten(undefined)).toEqual([]);
    expect(sitzungsKetten({})).toEqual([]);
    expect(sitzungsKetten({ session: { namespaces: { eip155: { chains: 'eip155:1926', accounts: {} } } } })).toEqual([]);
  });

  it('ignores entries that only look like the Aequitas chain', () => {
    const provider = { session: { namespaces: { eip155: { chains: ['eip155:1926x', 'solana:1926', 'eip155:19260'], accounts: ['eip155:1926:nichtadresse'] } } } };
    expect(sitzungsKetten(provider)).not.toContain('eip155:1926');
  });
});
