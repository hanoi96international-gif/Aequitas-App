// Overridable via EXPO_PUBLIC_* env vars (e.g. an .env.staging loaded at
// build time) so a staging backend can be targeted without editing source.
// Unset in every build today, so production behavior is unchanged.
// `??` is deliberately NOT used here. It falls back only on null/undefined,
// and the value that actually arrives is neither: the APK workflow maps every
// EXPO_PUBLIC_* secret into the job env, so a secret nobody has set arrives as
// an empty string. babel-preset-expo then inlines that empty string into this
// module at transform time, `??` sees a defined value, and the app ships with
// API_BASE === '' -- every request going to a relative empty base. An empty
// URL is never a meaningful override, so treat it as absent.
const orDefault = (value: string | undefined, fallback: string) =>
  value && value.trim() !== '' ? value : fallback;

// TEMPORARY — REVERT ON 2026-08-18. See docs/ENDPOINTS.md.
//
// aequitas.digital does not belong to this project yet; it arrives on
// 2026-08-18. Measured 2026-08-16, that name resolves to a host serving a
// DIFFERENT chain: height ~50, 0 humans, unknown node id, while the real
// network is past 3.8 million blocks with 15 humans. An app pointed there
// shows an empty chain, a zero balance and a zero supply, and any
// registration it completed would land on a chain nobody else follows.
//
// RESOLVED 2026-08-22. aequitas.digital now serves the primary over HTTPS:
// /api/status reports height 4,511,424 and commit 7bf2db9, identical to the
// node at 173.249.37.118, /rpc answers eth_chainId with 0x786, and the
// certificate verifies. So the temporary IP default and the cleartext
// permission that went with it are both gone -- config.test.ts had been red
// since the 18th demanding exactly this, which is what that test is for.
//
// Both halves of the revert matter. Leaving usesCleartextTraffic enabled in a
// shipped app is a downgrade nobody would notice, and a hardcoded IP is one
// server move away from an app that shows nothing.
const PRIMARY_NODE = 'https://aequitas.digital';

export const API_BASE = orDefault(process.env.EXPO_PUBLIC_API_BASE, PRIMARY_NODE + '/api');
export const WEBAPP = orDefault(process.env.EXPO_PUBLIC_WEBAPP, PRIMARY_NODE);
export const RPC_URL = orDefault(process.env.EXPO_PUBLIC_RPC_URL, PRIMARY_NODE + '/rpc');

export const CHAIN_ID_HEX = '0x786';
export const CHAIN_ID_DEC = 1926;
export const V7_CONTRACT = '0x20D271028f32577FCd07b4583A8e0E4eBBdB4F78';

export const NATIVE_CURRENCY = { name: 'Aequitas', symbol: 'AEQ', decimals: 18 } as const;

export const WALLETCONNECT_PROJECT_ID = process.env.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID ?? '';

// Biometrischer Menschlichkeitsnachweis (Gesichtsvergleich, siehe
// aequitas-biometric-beta).
//
// Phase 0 launch (2026-09): default OFF. When true, Identity routes to
// /biometric-capture and registerBiometric() REQUIRES COORDINATOR_BASE;
// do not ship true without a live coordinator.
//
// When BIOMETRIC_ENABLED is false, registration is NOT a silent fallback to
// the device-secret path. It runs only if ALLOW_DEVICE_SECRET_REGISTER is
// explicitly true (build-time EXPO_PUBLIC_ALLOW_DEVICE_SECRET_REGISTER=true);
// otherwise Identity fail-closes with identity.biometricDisabled.
// Device-secret uniqueness is per-device, not per-face — intentional for the
// Phase 0 launch window without face/coordinator.
//
// v1.6.0 was built with the repo variable set true (23.08.2026) while public
// docs later removed the coordinator URL — that combination cannot register.
// Phase 0 APK builds should leave BIOMETRIC unset/false and set ALLOW=true.
//
// Server note (not changed here): device-secret proofs omit bioAttestation.
// That works when proof servers run BIO_ATTESTATION_MODE=off|optional; if
// mode=required, Phase 0 registration will 403 until mode is relaxed or a
// coordinator is restored (Contabo / proof-server out of scope for this PR).
export const BIOMETRIC_ENABLED = process.env.EXPO_PUBLIC_BIOMETRIC_ENABLED === 'true';
export const ALLOW_DEVICE_SECRET_REGISTER = process.env.EXPO_PUBLIC_ALLOW_DEVICE_SECRET_REGISTER === 'true';
export const COORDINATOR_BASE = process.env.EXPO_PUBLIC_COORDINATOR_BASE ?? '';
