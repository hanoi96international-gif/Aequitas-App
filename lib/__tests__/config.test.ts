describe('config', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  // The defaults are TEMPORARY and must be reverted on 2026-08-18, when the
  // domain arrives. Until then the app talks to Contabo1 by IP, because
  // aequitas.digital currently resolves to a host serving a different,
  // near-empty chain — an app pointed there shows nothing and would register
  // onto a chain nobody follows.
  //
  // This test switches sides on the date ON PURPOSE. A comment saying
  // "remember to revert" is a comment nobody reads on launch day; a red CI
  // run is not. From 2026-08-18 onward it demands the https://aequitas.digital
  // defaults back, and app.json's android.usesCleartextTraffic gone with them.
  const DOMAIN_HANDOVER = new Date('2026-08-18T00:00:00Z');
  const TEMP_NODE = 'http://173.249.37.118:8080';

  it('defaults to the endpoint that actually serves this chain', () => {
    delete process.env.EXPO_PUBLIC_API_BASE;
    delete process.env.EXPO_PUBLIC_WEBAPP;
    delete process.env.EXPO_PUBLIC_RPC_URL;
    const config = require('../config');
    if (new Date() < DOMAIN_HANDOVER) {
      expect(config.API_BASE).toBe(TEMP_NODE + '/api');
      expect(config.WEBAPP).toBe(TEMP_NODE);
      expect(config.RPC_URL).toBe(TEMP_NODE + '/rpc');
    } else {
      expect(config.API_BASE).toBe('https://aequitas.digital/api');
      expect(config.WEBAPP).toBe('https://aequitas.digital');
      expect(config.RPC_URL).toBe('https://aequitas.digital/rpc');
    }
  });

  it('ships without cleartext HTTP once the domain has been handed over', () => {
    if (new Date() < DOMAIN_HANDOVER) return; // still needed for the IP endpoint
    const appJson = require('../../app.json');
    expect(appJson.expo.android.usesCleartextTraffic).toBeFalsy();
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

  // ── Decommissioned-host guard ───────────────────────────────────────────
  //
  // Railway was shut down on 2026-08-14 and hosts no part of this network
  // any more (see the chain repo's docs/MIGRATION_RAILWAY_TO_CONTABO.md).
  // Every EXPO_PUBLIC_* value below is inlined into the JS bundle by
  // babel-preset-expo at build time, so a stale host here does not fail at
  // deploy time or show up in a log — it ships inside the APK and only
  // surfaces as a dead app in a user's hands.
  //
  // This mirrors the chain repo's own TestDefaultBootstrapNodes_
  // NoDecommissionedHosts / TestDefaultPublicSeeds_NoDecommissionedHosts,
  // which exist for exactly this failure mode on the Go side. Found live on
  // 2026-08-15: the repository variable EXPO_PUBLIC_COORDINATOR_BASE still
  // pointed at coordinator-production-dcd1.up.railway.app, which answers
  // {"status":"error","code":404,"message":"Application not found"} — with
  // EXPO_PUBLIC_BIOMETRIC_ENABLED=true, so the app offered a registration
  // flow that could not possibly complete.
  // CORRECTED 2026-08-23. The list above was right about the CHAIN and wrong
  // as a blanket rule. Railway project aequitas-matching is still running and
  // hosts the only reachable coordinator: /challenge returns a real liveness
  // challenge with a nonce, /register names its missing required fields.
  //
  // So this guard blocked a LIVE host because it matched a hostname, while it
  // would have waved through a dead Contabo endpoint without a word. The
  // property worth testing was never "which provider" but "does it answer",
  // and a unit test cannot answer that -- so reachability now lives in
  // build-apk.yml, which probes /health and additionally rejects an HTML
  // response, after EXPO_PUBLIC_COORDINATOR_BASE briefly pointed at
  // https://aequitas.digital/coordinator where every path returned 200 by
  // serving the node's landing page.
  //
  // What remains here is the one host that is genuinely gone: the specific
  // coordinator deployment found dead on 2026-08-15, which answers
  // {"status":"error","code":404,"message":"Application not found"}.
  const DECOMMISSIONED_HOSTS = [/coordinator-production-dcd1\.up\.railway\.app/i];

  it.each([
    ['API_BASE', 'EXPO_PUBLIC_API_BASE'],
    ['WEBAPP', 'EXPO_PUBLIC_WEBAPP'],
    ['RPC_URL', 'EXPO_PUBLIC_RPC_URL'],
    ['COORDINATOR_BASE', 'EXPO_PUBLIC_COORDINATOR_BASE'],
  ])('%s never resolves to a decommissioned host', (key, envVar) => {
    const config = require('../config');
    const value = String(config[key] ?? '');
    for (const host of DECOMMISSIONED_HOSTS) {
      expect(value).not.toMatch(host);
    }
    // Also catches the value being passed through from the build environment
    // rather than from the defaults above.
    const fromEnv = process.env[envVar];
    if (fromEnv) {
      for (const host of DECOMMISSIONED_HOSTS) {
        expect(fromEnv).not.toMatch(host);
      }
    }
  });

  it('does not offer the biometric flow without a coordinator to serve it', () => {
    // BIOMETRIC_ENABLED routes identity.tsx straight to /biometric-capture,
    // which is several minutes of palm/face/burst/fingertip/ear/audio capture
    // before registerBiometric() posts anything anywhere. With no
    // COORDINATOR_BASE, lib/biometricIdentity.ts throws
    // "Biometric coordinator not configured" only at that final step — the
    // user has already done all the work by then. The two must ship together.
    const config = require('../config');
    if (config.BIOMETRIC_ENABLED) {
      expect(config.COORDINATOR_BASE).not.toBe('');
    }
  });
});
