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
// So until the DNS switch, the app talks to Contabo1 — the primary
// validator — by IP. That is plain HTTP, which is why app.json now sets
// android.usesCleartextTraffic: true; without it Android (API 28+) blocks
// every request and the app simply shows nothing.
//
// On 2026-08-18, after `Serve aequitas.digital from Contabo1` has issued the
// certificate: put the three https://aequitas.digital values back and remove
// usesCleartextTraffic. Both halves of that revert matter — leaving cleartext
// enabled in a shipped app is a downgrade nobody would notice.
const PRIMARY_NODE = 'http://173.249.37.118:8080';

export const API_BASE = orDefault(process.env.EXPO_PUBLIC_API_BASE, PRIMARY_NODE + '/api');
export const WEBAPP = orDefault(process.env.EXPO_PUBLIC_WEBAPP, PRIMARY_NODE);
export const RPC_URL = orDefault(process.env.EXPO_PUBLIC_RPC_URL, PRIMARY_NODE + '/rpc');

export const CHAIN_ID_HEX = '0x786';
export const CHAIN_ID_DEC = 1926;
export const V7_CONTRACT = '0x20D271028f32577FCd07b4583A8e0E4eBBdB4F78';

export const NATIVE_CURRENCY = { name: 'Aequitas', symbol: 'AEQ', decimals: 18 } as const;

export const WALLETCONNECT_PROJECT_ID = process.env.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID ?? '';

// Phase 0 biometric proof-of-personhood (palm+face matching, see
// aequitas-biometric-beta). Defaults OFF/empty -- unset in every build
// today, so the Identity tab's existing device-secret flow (and its "your
// biometric data never leaves this device" copy, which is true for THAT
// flow) is completely unchanged unless this is explicitly turned on. Do
// not enable before Phase 0 accuracy validation and Phase 2 legal review
// are actually done, not just this code being merged.
export const BIOMETRIC_ENABLED = process.env.EXPO_PUBLIC_BIOMETRIC_ENABLED === 'true';
export const COORDINATOR_BASE = process.env.EXPO_PUBLIC_COORDINATOR_BASE ?? '';
