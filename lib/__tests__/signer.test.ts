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

describe('walletConnectSigner: Wallet auf falschem Netz (Vorfall 01.10.2026)', () => {
  const unterschreibe = (s: ReturnType<typeof walletConnectSigner>) =>
    s.signTypedData(V8_DOMAIN as any, { Register: [{ name: 'x', type: 'uint256' }] }, { x: 1n });

  it('wechselt einmal das Netz und wiederholt bei "Invalid chainId"', async () => {
    const request = jest.fn()
      .mockRejectedValueOnce(new Error('Invalid chainId'))
      .mockResolvedValueOnce('0xsig');
    const wechseln = jest.fn(async () => {});
    const s = walletConnectSigner('0xABC', request, MIT_AEQUITAS, wechseln);
    await expect(unterschreibe(s)).resolves.toBe('0xsig');
    expect(wechseln).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1][1]).toBe(AEQUITAS_CAIP);
  });

  it('wiederholt hoechstens einmal', async () => {
    const request = jest.fn().mockRejectedValue(new Error('Invalid chainId'));
    const wechseln = jest.fn(async () => {});
    const s = walletConnectSigner('0xABC', request, MIT_AEQUITAS, wechseln);
    await expect(unterschreibe(s)).rejects.toThrow('Invalid chainId');
    expect(request).toHaveBeenCalledTimes(2);
    expect(wechseln).toHaveBeenCalledTimes(1);
  });

  it('andere Fehler (z. B. Ablehnung) loesen keinen Wechsel aus', async () => {
    const request = jest.fn().mockRejectedValue(Object.assign(new Error('User rejected'), { code: 4001 }));
    const wechseln = jest.fn(async () => {});
    const s = walletConnectSigner('0xABC', request, MIT_AEQUITAS, wechseln);
    await expect(unterschreibe(s)).rejects.toThrow('User rejected');
    expect(wechseln).not.toHaveBeenCalled();
  });

  it('lehnt der Mensch den Wechsel ab, wird nicht unterschrieben', async () => {
    const request = jest.fn().mockRejectedValueOnce(new Error('Invalid chainId'));
    const wechseln = jest.fn(async () => { throw Object.assign(new Error('User rejected'), { code: 4001 }); });
    const s = walletConnectSigner('0xABC', request, MIT_AEQUITAS, wechseln);
    await expect(unterschreibe(s)).rejects.toThrow('User rejected');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('ohne freigegebene Aequitas-Kette: einmal wechseln, bleibt sie aus, keine Anfrage', async () => {
    const request = jest.fn();
    const wechseln = jest.fn(async () => {});
    const s = walletConnectSigner('0xABC', request, NUR_ETHEREUM, wechseln);
    await expect(unterschreibe(s)).rejects.toThrow(NETZ_NICHT_FREIGEGEBEN);
    expect(request).not.toHaveBeenCalled();
    expect(wechseln).toHaveBeenCalledTimes(1);
  });
});

describe('walletAufAequitasSchalten (Netz fehlt in MetaMask, 01.10.2026)', () => {
  const { walletAufAequitasSchalten, NETZ_FEHLT_IN_WALLET } = require('../signer');
  const KETTE = { chainId: '0x786', chainName: 'Aequitas Chain', nativeCurrency: {}, rpcUrls: ['https://aequitas.digital/rpc'], blockExplorerUrls: ['https://aequitas.digital'] };
  const fehler = (message: string, code?: number) => Object.assign(new Error(message), code ? { code } : {});

  it('eine einzige Anfrage, wenn die Wallet auf dem ersten Leitweg steht', async () => {
    const senden = jest.fn(async (_m: string, _p: unknown[], _w: string) => null);
    await walletAufAequitasSchalten(senden, ['eip155:1', AEQUITAS_CAIP], KETTE);
    expect(senden).toHaveBeenCalledTimes(1);
    expect(senden.mock.calls[0][0]).toBe('wallet_addEthereumChain');
    expect(senden.mock.calls[0][1]).toEqual([KETTE]);
  });

  it('falscher Leitweg -> naechster, dort hinzufuegen', async () => {
    const aufrufe: string[] = [];
    const senden = jest.fn(async (m: string, _p: unknown[], weg: string) => {
      aufrufe.push(`${m}@${weg}`);
      if (weg !== AEQUITAS_CAIP) throw fehler('Invalid chainId');
      return null;
    });
    await walletAufAequitasSchalten(senden, ['eip155:1', AEQUITAS_CAIP], KETTE);
    expect(aufrufe).toEqual(['wallet_addEthereumChain@eip155:1', `wallet_addEthereumChain@${AEQUITAS_CAIP}`]);
  });

  it('Ablehnung beendet sofort', async () => {
    const senden = jest.fn(async () => { throw fehler('User rejected the request.', 4001); });
    await expect(walletAufAequitasSchalten(senden, ['eip155:1', AEQUITAS_CAIP], KETTE)).rejects.toThrow('User rejected');
    expect(senden).toHaveBeenCalledTimes(1);
  });

  it('nichts klappt: klare Meldung, hoechstens 8 Anfragen', async () => {
    const senden = jest.fn(async () => { throw fehler('internal error'); });
    const wege = Array.from({ length: 20 }, (_, i) => `eip155:${i + 1}`);
    await expect(walletAufAequitasSchalten(senden, wege, KETTE)).rejects.toThrow(NETZ_FEHLT_IN_WALLET);
    expect(senden).toHaveBeenCalledTimes(8);
  });
});

describe('Netz noch nicht freigegeben (neue Verbindung, 01.10.2026)', () => {
  const unterschreibe = (s: ReturnType<typeof walletConnectSigner>) =>
    s.signTypedData(V8_DOMAIN as any, { Register: [{ name: 'x', type: 'uint256' }] }, { x: 1n });

  it('bringt die Wallet erst auf Aequitas, dann wird unterschrieben', async () => {
    let ketten = ['eip155:1'];
    const request = jest.fn(async (_a: unknown, _k?: string) => '0xsig');
    const wechseln = jest.fn(async () => { ketten = ['eip155:1', AEQUITAS_CAIP]; });
    const s = walletConnectSigner('0xABC', request, () => ketten, wechseln);
    await expect(unterschreibe(s)).resolves.toBe('0xsig');
    expect(wechseln).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][1]).toBe(AEQUITAS_CAIP);
  });

  it('gibt die Wallet das Netz nicht frei: keine Unterschrift', async () => {
    const request = jest.fn();
    const wechseln = jest.fn(async () => {});
    const s = walletConnectSigner('0xABC', request, NUR_ETHEREUM, wechseln);
    await expect(unterschreibe(s)).rejects.toThrow(NETZ_NICHT_FREIGEGEBEN);
    expect(request).not.toHaveBeenCalled();
  });
});

describe('walletAufAequitasSchalten: Wallet antwortet nicht', () => {
  const { walletAufAequitasSchalten, WALLET_ANTWORTET_NICHT } = require('../signer');
  it('bricht ab statt weitere Anfragen zu stapeln', async () => {
    const senden = jest.fn(() => new Promise(() => {}));
    await expect(walletAufAequitasSchalten(senden, ['eip155:1', AEQUITAS_CAIP], { chainId: '0x786', chainName: 'A', nativeCurrency: {}, rpcUrls: [], blockExplorerUrls: [] }, 20))
      .rejects.toThrow(WALLET_ANTWORTET_NICHT);
    expect(senden).toHaveBeenCalledTimes(1);
  });
});

describe('Sitzung lesen (Vorfall 1.8.8: keine Adresse ohne Aequitas-Freigabe)', () => {
  const { adresseDerSitzung, kettenDerSitzung } = require('../signer');
  const sitzung = { namespaces: { eip155: { chains: ['eip155:1'], accounts: ['eip155:1:0x52908400098527886e0f7030069857d2e4169ee7'] } } };

  it('Adresse kommt aus der Sitzung, mit Pruefsumme', () => {
    expect(adresseDerSitzung(sitzung)).toBe('0x52908400098527886E0F7030069857D2E4169EE7');
  });

  it('kaputte oder fehlende Sitzung -> null, keine Ausnahme', () => {
    expect(adresseDerSitzung(undefined)).toBeNull();
    expect(adresseDerSitzung({ namespaces: { eip155: { accounts: ['eip155:1:0x123', 42] } } })).toBeNull();
  });

  it('Ketten aus der Sitzung', () => {
    expect(kettenDerSitzung(sitzung)).toEqual(['eip155:1']);
    expect(kettenDerSitzung(null)).toEqual([]);
  });
});

describe('aequitasNetzEinrichten', () => {
  const { aequitasNetzEinrichten, NETZ_FEHLT_IN_WALLET, KEINE_KETTE_IN_SITZUNG } = require('../signer');
  const KETTE = { chainId: '0x786', chainName: 'Aequitas Chain', nativeCurrency: { name: 'Aequitas', symbol: 'AEQ', decimals: 18 }, rpcUrls: ['https://aequitas.digital/rpc'], blockExplorerUrls: ['https://aequitas.digital'] };
  const fehler = (message: string, code?: number) => Object.assign(new Error(message), code ? { code } : {});
  const schnell = { zeitJeAnfrageMs: 2_000, freigabeWarteMs: 600 };

  it('Aequitas schon freigegeben: keine Anfrage an die Wallet', async () => {
    const senden = jest.fn();
    await aequitasNetzEinrichten({ senden, ketten: MIT_AEQUITAS, kette: KETTE, ...schnell });
    expect(senden).not.toHaveBeenCalled();
  });

  it('Netz fehlt: EIN wallet_addEthereumChain ueber die aktive Kette der Wallet, dann Freigabe', async () => {
    let ketten = ['eip155:1', 'eip155:59144'];
    const senden = jest.fn(async (m: string, _p: unknown[], _w: string) => {
      if (m === 'wallet_addEthereumChain') ketten = [...ketten, AEQUITAS_CAIP];
      return null;
    });
    await aequitasNetzEinrichten({ senden, ketten: () => ketten, walletKette: () => 'eip155:59144', kette: KETTE, ...schnell });
    expect(senden).toHaveBeenCalledTimes(1);
    expect(senden.mock.calls[0][0]).toBe('wallet_addEthereumChain');
    expect(senden.mock.calls[0][1]).toEqual([KETTE]);
    expect(senden.mock.calls[0][2]).toBe('eip155:59144');
  });

  it('Freigabe kommt erst nach der Antwort (session_update spaeter): wartet darauf', async () => {
    let ketten = ['eip155:1'];
    const senden = jest.fn(async () => {
      setTimeout(() => { ketten = ['eip155:1', AEQUITAS_CAIP]; }, 200);
      return null;
    });
    await aequitasNetzEinrichten({ senden, ketten: () => ketten, kette: KETTE, ...schnell });
    expect(senden).toHaveBeenCalledTimes(1);
  });

  it('Antwort geht verloren, Freigabe ist aber da: gilt als gelungen', async () => {
    let ketten = ['eip155:1'];
    const senden = jest.fn(() => {
      setTimeout(() => { ketten = ['eip155:1', AEQUITAS_CAIP]; }, 100);
      return new Promise(() => {});
    });
    await aequitasNetzEinrichten({ senden, ketten: () => ketten, kette: KETTE, zeitJeAnfrageMs: 5_000, freigabeWarteMs: 600 });
    expect(senden).toHaveBeenCalledTimes(1);
  });

  it('angelegt, aber nicht freigegeben: einmal umschalten, dann freigegeben', async () => {
    let ketten = ['eip155:1'];
    const senden = jest.fn(async (m: string, _p?: unknown[], _w?: string) => {
      if (m === 'wallet_switchEthereumChain') ketten = ['eip155:1', AEQUITAS_CAIP];
      return null;
    });
    await aequitasNetzEinrichten({ senden, ketten: () => ketten, kette: KETTE, ...schnell });
    expect(senden.mock.calls.map((c) => c[0])).toEqual(['wallet_addEthereumChain', 'wallet_switchEthereumChain']);
    expect(senden.mock.calls[1][1]).toEqual([{ chainId: '0x786' }]);
  });

  it('bleibt die Freigabe ganz aus: fail-closed mit Meldung, begrenzte Anfragen', async () => {
    const senden = jest.fn(async () => null);
    await expect(aequitasNetzEinrichten({ senden, ketten: NUR_ETHEREUM, kette: KETTE, ...schnell })).rejects.toThrow(NETZ_NICHT_FREIGEGEBEN);
    expect(senden).toHaveBeenCalledTimes(2);
  });

  it('Ablehnung beim Hinzufuegen: sofort Schluss, kein Umschalten', async () => {
    const senden = jest.fn(async () => { throw fehler('User rejected the request.', 4001); });
    await expect(aequitasNetzEinrichten({ senden, ketten: NUR_ETHEREUM, kette: KETTE, ...schnell })).rejects.toThrow('User rejected');
    expect(senden).toHaveBeenCalledTimes(1);
  });

  it('Fehler der Wallet steht in der Meldung (Diagnose am Geraet)', async () => {
    const senden = jest.fn(async () => { throw fehler('Chain ID returned by RPC URL does not match 0x786'); });
    await expect(aequitasNetzEinrichten({ senden, ketten: NUR_ETHEREUM, kette: KETTE, ...schnell }))
      .rejects.toThrow(`${NETZ_FEHLT_IN_WALLET} (Wallet: Chain ID returned by RPC URL does not match 0x786)`);
  });

  it('Sitzung ohne Kette: keine Anfrage', async () => {
    const senden = jest.fn();
    await expect(aequitasNetzEinrichten({ senden, ketten: () => [], kette: KETTE, ...schnell })).rejects.toThrow(KEINE_KETTE_IN_SITZUNG);
    expect(senden).not.toHaveBeenCalled();
  });
});

describe('walletConnectSigner: Umschalten statt Einrichten bei "Invalid chainId"', () => {
  it('nutzt walletUmschalten, wenn angegeben', async () => {
    const request = jest.fn()
      .mockRejectedValueOnce(new Error('Invalid chainId'))
      .mockResolvedValueOnce('0xsig');
    const einrichten = jest.fn(async () => {});
    const umschalten = jest.fn(async () => {});
    const s = walletConnectSigner('0xABC', request, MIT_AEQUITAS, einrichten, umschalten);
    await expect(s.signTypedData(V8_DOMAIN as any, { Register: [{ name: 'x', type: 'uint256' }] }, { x: 1n })).resolves.toBe('0xsig');
    expect(umschalten).toHaveBeenCalledTimes(1);
    expect(einrichten).not.toHaveBeenCalled();
  });
});
