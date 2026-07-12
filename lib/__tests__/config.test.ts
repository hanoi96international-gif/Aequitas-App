describe('config', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('defaults to the production endpoints when no EXPO_PUBLIC_* override is set', () => {
    delete process.env.EXPO_PUBLIC_API_BASE;
    delete process.env.EXPO_PUBLIC_WEBAPP;
    delete process.env.EXPO_PUBLIC_RPC_URL;
    const config = require('../config');
    expect(config.API_BASE).toBe('https://aequitas.digital/api');
    expect(config.WEBAPP).toBe('https://aequitas.digital');
    expect(config.RPC_URL).toBe('https://aequitas.digital/rpc');
  });

  it('honors an EXPO_PUBLIC_API_BASE override (the staging-config mechanism)', () => {
    process.env.EXPO_PUBLIC_API_BASE = 'https://staging.example.com/api';
    const config = require('../config');
    expect(config.API_BASE).toBe('https://staging.example.com/api');
  });

  it('matches the chain\'s actual mainnet chain ID (0x786 == 1926 decimal)', () => {
    const config = require('../config');
    expect(parseInt(config.CHAIN_ID_HEX, 16)).toBe(config.CHAIN_ID_DEC);
    expect(config.CHAIN_ID_DEC).toBe(1926);
  });
});
